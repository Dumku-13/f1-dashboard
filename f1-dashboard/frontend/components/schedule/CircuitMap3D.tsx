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

import { useEffect, useRef } from 'react'

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

export default function CircuitMap3D({ circuit }: { circuit: MapCircuit | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // `any` because maplibre-gl is imported dynamically; importing its types
  // eagerly would defeat the point of code-splitting it.
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    if (!containerRef.current || mapRef.current || !circuit) return

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
        center: [circuit.lng, circuit.lat],
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
        .setLngLat([circuit.lng, circuit.lat])
        .addTo(map)

      map.on('error', (e: any) => console.error('[map] maplibre:', e?.error?.message || e))
      mapRef.current = map
      } catch (err) {
        // An async IIFE swallows anything thrown in here, which is how a map
        // that never appeared produced no error at all.
        console.error('[map] failed to initialise:', err)
      }
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fly to the selected circuit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !circuit) return
    map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 13.4, pitch: 48, duration: 2200, essential: true })
    markerRef.current?.setLngLat([circuit.lng, circuit.lat])
  }, [circuit?.key, circuit?.lat, circuit?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label="Circuit location map" />
}
