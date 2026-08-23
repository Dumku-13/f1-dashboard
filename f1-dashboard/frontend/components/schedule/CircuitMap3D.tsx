'use client'

/**
 * Mapbox satellite view that flies between circuits as the schedule carousel moves.
 *
 * Loaded only via next/dynamic AND only when a token exists — `mapbox-gl` is a
 * large dependency and the whole page works without it (the schedule falls back
 * to the SVG track outline), so it must never be in the critical path.
 */

import { useEffect, useRef } from 'react'

export interface MapCircuit {
  key: string
  name: string
  lat: number
  lng: number
}

export default function CircuitMap3D({
  circuit,
  token,
}: {
  circuit: MapCircuit | null
  token: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // `any` because mapbox-gl is imported dynamically; importing its types
  // eagerly would defeat the point of code-splitting it.
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    if (!containerRef.current || mapRef.current || !circuit) return

    ;(async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      await import('mapbox-gl/dist/mapbox-gl.css')
      if (cancelled || !containerRef.current) return

      mapboxgl.accessToken = token
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [circuit.lng, circuit.lat],
        zoom: 13.4,
        pitch: 48,
        bearing: -18,
        attributionControl: true,
        // The carousel drives the camera; free-panning fights it.
        dragRotate: false,
      })
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

      const el = document.createElement('div')
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:var(--accent);' +
        'border:2px solid #fff;box-shadow:0 0 0 4px rgba(225,6,0,0.35)'
      markerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([circuit.lng, circuit.lat])
        .addTo(map)

      mapRef.current = map
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Fly to the selected circuit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !circuit) return
    map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 13.4, pitch: 48, duration: 2200, essential: true })
    markerRef.current?.setLngLat([circuit.lng, circuit.lat])
  }, [circuit?.key, circuit?.lat, circuit?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label="Circuit location map" />
}
