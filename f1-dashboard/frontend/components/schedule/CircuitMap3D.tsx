'use client'

/**
 * Satellite view that flies between circuits as the schedule carousel moves.
 *
 * MapLibre GL, not Mapbox GL. MapLibre is the open fork of Mapbox GL JS v1 —
 * near-identical API — and the reason for the swap is that Mapbox requires an
 * account with a card on file before it will serve a single tile. This needs
 * no account, no token and no billing relationship.
 *
 * The imagery is Esri's World Imagery raster service, which is public and
 * keyless. Attribution is carried on the source below and rendered by the
 * built-in attribution control; it is a condition of use, so do not remove it.
 *
 * Still loaded via next/dynamic: maplibre-gl is a large dependency and the
 * schedule page works without it (it falls back to the SVG track outline), so
 * it must stay out of the critical path.
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as LibreMap, Marker, GeoJSONSource } from 'maplibre-gl'
import { appendTrail, geographicHeading, matchDriver, shortestAngle, telemetryColor, validGeoFix } from '../../lib/tactical/camera'
import type { CameraMode, TacticalDriver } from '../../lib/tactical/camera'
import { mapLibreEngine } from '../../lib/tactical/mapEngine'

export interface MapCircuit {
  key: string
  name: string
  lat: number
  lng: number
}

/**
 * A raster style built inline rather than fetched from a hosted style.json —
 * one less third-party request, one less thing to be down, and it keeps the
 * tile hosts visible right here next to the CSP entry that has to allow them.
 *
 * Two layers, because the original design used Mapbox's "satellite-streets":
 * imagery alone has no place names, and a circuit is much harder to place
 * without them.
 */
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: 'raster' as const,
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    },
    places: {
      type: 'raster' as const,
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster' as const, source: 'satellite' },
    { id: 'places', type: 'raster' as const, source: 'places' },
  ],
}

const NO_DRIVERS: TacticalDriver[] = []

export default function CircuitMap3D({ circuit, drivers = NO_DRIVERS, selectedDriver, onSelectDriver }: {
  circuit: MapCircuit | null
  drivers?: TacticalDriver[]
  selectedDriver?: number | null
  onSelectDriver?: (id: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Type-only imports are erased and preserve dynamic code splitting.
  const mapRef = useRef<LibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const driverMarkers = useRef(new Map<number, Marker>())
  const trails = useRef(new Map<number, TacticalDriver[]>())
  const bearing = useRef(0)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState(false)
  const [mode, setMode] = useState<CameraMode>('free')
  const [lockedDriver, setLockedDriver] = useState<number | null>(selectedDriver ?? null)
  const latest = useRef({ drivers, onSelectDriver })
  latest.current = { drivers, onSelectDriver }
  const initialCircuit = useRef(circuit)
  initialCircuit.current = circuit
  const hasCircuit = Boolean(circuit)

  useEffect(() => {
    if (selectedDriver === undefined) return
    setLockedDriver(selectedDriver)
    setMode(selectedDriver == null ? 'free' : 'follow')
  }, [selectedDriver])

  useEffect(() => {
    if (mode === 'free' && latest.current.drivers.length) mapRef.current?.stop()
  }, [mode])

  useEffect(() => { bearing.current = mapRef.current?.getBearing() ?? 0 }, [lockedDriver])

  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.type === 'camera' && ['free', 'follow', 'chase'].includes(detail.mode)) setMode(detail.mode)
      if (detail?.type === 'track-driver' && typeof detail.query === 'string') {
        const driver = matchDriver(latest.current.drivers, detail.query)
        if (driver) { setLockedDriver(driver.id); setMode('follow'); latest.current.onSelectDriver?.(driver.id) }
      }
    }
    window.addEventListener('f1:tactical-command', command)
    return () => window.removeEventListener('f1:tactical-command', command)
  }, [])

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    const start = initialCircuit.current
    if (!containerRef.current || mapRef.current || !start) return

    ;(async () => {
      try {
      const maplibregl = await import('maplibre-gl')
      await import('maplibre-gl/dist/maplibre-gl.css')
      if (cancelled || !containerRef.current) return

      // MapLibre v6 loads its worker as a separate ES module, and Turbopack
      // does not emit that file as a servable asset — the request comes back
      // as the dev server's 404 HTML, the worker never starts, and the map
      // renders an empty canvas without throwing. scripts/sync-maplibre-worker
      // copies it into /public; this points MapLibre at that copy.
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

      // No accessToken line. That is the whole point of the switch.
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: SATELLITE_STYLE,
        center: [start.lng, start.lat],
        zoom: 13.4,
        pitch: 48,
        bearing: -18,
        // The carousel drives the camera; free-panning fights it.
        dragRotate: false,
      })
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      const el = document.createElement('div')
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:var(--accent);' +
        'border:2px solid #fff;box-shadow:0 0 0 4px rgba(225,6,0,0.35)'
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([start.lng, start.lat])
        .addTo(map)

      map.on('error', (e: any) => console.error('[map] maplibre:', e?.error?.message || e))
      map.on('dragstart', () => setMode('free'))
      map.on('load', () => {
        if (cancelled) return
        map.addSource('driver-trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'driver-trail-glow', type: 'line', source: 'driver-trails',
          paint: { 'line-color': ['get', 'color'], 'line-width': 10, 'line-blur': 5, 'line-opacity': 0.4 } })
        map.addLayer({ id: 'driver-trail-line', type: 'line', source: 'driver-trails',
          paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 } })
        setReady(true)
      })
      mapRef.current = map
      } catch (err) {
        // An async IIFE swallows anything thrown in here, which is how a map
        // that never appeared produced no error at all.
        console.error('[map] failed to initialise:', err)
        if (!cancelled) setFailure(true)
      }
    })()

    return () => {
      cancelled = true
      driverMarkers.current.forEach(marker => marker.remove())
      driverMarkers.current.clear()
      trails.current.clear()
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCircuit])

  // Fly to the selected circuit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !circuit) return
    trails.current.clear()
    setMode(selectedDriver == null ? 'free' : 'follow')
    setLockedDriver(selectedDriver ?? null)
    map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 13.4, pitch: 48, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2200 })
    markerRef.current?.setLngLat([circuit.lng, circuit.lat])
  }, [ready, circuit?.key, circuit?.lat, circuit?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let cancelled = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (cancelled) return
      const ids = new Set<number>()
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
      for (const driver of drivers.filter(validGeoFix)) {
        ids.add(driver.id)
        const previous = trails.current.get(driver.id) ?? []
        if (driver.id === lockedDriver && previous.length && driver.timestamp < previous[previous.length - 1].timestamp) bearing.current = 0
        const history = appendTrail(previous, driver)
        trails.current.set(driver.id, history)
        for (let i = 1; i < history.length; i++) features.push({ type: 'Feature', properties: { color: telemetryColor(history[i]) },
          geometry: { type: 'LineString', coordinates: [[history[i - 1].lng, history[i - 1].lat], [history[i].lng, history[i].lat]] } })
        let marker = driverMarkers.current.get(driver.id)
        if (!marker) {
          const button = document.createElement('button')
          button.type = 'button'
          button.style.cssText = 'min-width:34px;height:30px;border-radius:4px;background:#08111ddd;color:#fff;font:700 10px monospace;cursor:pointer;box-shadow:0 0 14px #00e0b533'
          button.onclick = () => { setLockedDriver(driver.id); setMode('follow'); latest.current.onSelectDriver?.(driver.id) }
          marker = new Marker({ element: button }).setLngLat([driver.lng, driver.lat]).addTo(map)
          driverMarkers.current.set(driver.id, marker)
        }
        marker.setLngLat([driver.lng, driver.lat])
        const element = marker.getElement()
        element.textContent = driver.acronym
        element.setAttribute('aria-label', `Track ${driver.name}`)
        element.style.border = `2px solid ${driver.id === lockedDriver ? '#fff' : driver.color ?? '#65e6d2'}`
      }
      for (const [id, marker] of driverMarkers.current) if (!ids.has(id)) { marker.remove(); driverMarkers.current.delete(id); trails.current.delete(id) }
      ;(map.getSource('driver-trails') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
      const target = drivers.find(d => d.id === lockedDriver && validGeoFix(d))
      const engine = mapLibreEngine(map)
      if (mode === 'free') return
      if (!target) { engine.release(); return }
      const history = trails.current.get(target.id) ?? []
      const heading = history.length > 1 ? geographicHeading(history[history.length - 2], target) : null
      if (heading != null) bearing.current += shortestAngle(bearing.current, heading)
      engine.follow({ ...target, bearing: bearing.current, mode }, window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    })
    return () => { cancelled = true }
  }, [drivers, ready, mode, lockedDriver])

  return <>
    <div ref={containerRef} className="ops-map-surface" data-camera-mode={mode} style={{ position: 'absolute', inset: 0 }} aria-label="Circuit location map" />
    {failure && <div role="status" style={{ position: 'absolute', bottom: 36, left: 12, color: '#fff', background: '#09121d', padding: 10 }}>Satellite renderer unavailable. Use the local track view.</div>}
    {drivers.length > 0 && <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {(['free', 'follow', 'chase'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={value !== 'free' && lockedDriver == null}
        onClick={() => setMode(value)} style={{ background: mode === value ? '#175b51' : '#07111de6', color: '#e5fff8', border: '1px solid #56877e', borderRadius: 3, padding: '8px 10px', font: '600 10px monospace', cursor: 'pointer' }}>{value === 'chase' ? 'CHASE CAM' : value.toUpperCase()}</button>)}
      <button type="button" onClick={() => { setMode('free'); if (circuit) mapRef.current?.jumpTo({ center: [circuit.lng, circuit.lat], zoom: 13.4, pitch: 48, bearing: -18 }) }}
        style={{ background: '#07111de6', color: '#e5fff8', border: '1px solid #56877e', borderRadius: 3, padding: '8px 10px', font: '600 10px monospace', cursor: 'pointer' }}>RESET VIEW</button>
      <span role="status" style={{ width: '100%', font: '10px monospace', color: '#e5fff8', background: '#07111de6', padding: 5 }}>{lockedDriver == null ? 'SELECT A DRIVER TO LOCK' : `${mode.toUpperCase()} · CAR ${lockedDriver}`} · TRAILS: THROTTLE / BRAKE / GREY UNKNOWN</span>
    </div>}
  </>
}
