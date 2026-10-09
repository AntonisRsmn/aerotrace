import { useCallback, useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Aircraft } from '../types'

type Props = {
  aircraft: Aircraft[]
  selectedId: string
  onSelect: (aircraft: Aircraft) => void
}

// Use standard OpenStreetMap raster tiles: no API key is required.
// Keep attribution visible and follow OSM's tile usage policy.
const DARK_RASTER_STYLE = {
  version: 8 as const,
  sources: {
    'openstreetmap': {
      type: 'raster' as const,
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'openstreetmap-layer',
      type: 'raster' as const,
      source: 'openstreetmap',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
}

export default function MapView({ aircraft, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const onSelectRef = useRef(onSelect)
  const aircraftRef = useRef(aircraft)
  const selectedIdRef = useRef(selectedId)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    aircraftRef.current = aircraft
    selectedIdRef.current = selectedId
  }, [aircraft, selectedId])

  const syncMarkers = useCallback((map: MapLibreMap) => {
    const existing = markersRef.current
    const activeIds = new Set(aircraftRef.current.map((item) => item.id))

    existing.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove()
        existing.delete(id)
      }
    })

    aircraftRef.current.forEach((item) => {
      let marker = existing.get(item.id)

      if (!marker) {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'aircraft-marker'
        element.setAttribute('aria-label', `Select ${item.callsign}`)

        const plane = document.createElement('span')
        plane.className = 'marker-plane'
        plane.textContent = '✈'

        const label = document.createElement('span')
        label.className = 'marker-callsign'
        label.textContent = item.callsign

        element.append(plane, label)
        element.addEventListener('click', () => onSelectRef.current(item))

        marker = new maplibregl.Marker({
          element,
          anchor: 'center',
          rotationAlignment: 'map',
        })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map)

        existing.set(item.id, marker)
      } else {
        marker.setLngLat([item.longitude, item.latitude])
        const label = marker.getElement().querySelector('.marker-callsign')
        if (label) label.textContent = item.callsign
      }

      const element = marker.getElement()
      element.classList.toggle('is-selected', item.id === selectedIdRef.current)
      element.style.setProperty('--heading', `${item.heading}deg`)
    })
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_RASTER_STYLE,
      center: [14, 43],
      zoom: 3.1,
      minZoom: 1.5,
      maxZoom: 12,
      attributionControl: false,
      renderWorldCopies: true,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    mapRef.current = map

    // Add targets after the map is ready. This avoids markers being skipped
    // because the first React effect ran before MapLibre finished initializing.
    map.on('load', () => syncMarkers(map))
    map.on('error', (event) => {
      // Useful when diagnosing blocked tile requests in the browser console.
      console.warn('[AeroTrace map]', event.error?.message ?? event)
    })

    // Ensure MapLibre recalculates its canvas after the surrounding layout settles.
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
    }
  }, [syncMarkers])

  useEffect(() => {
    const map = mapRef.current
    if (map?.isStyleLoaded()) syncMarkers(map)
  }, [aircraft, selectedId, syncMarkers])

  return <div className="map-canvas" ref={containerRef} aria-label="Worldwide aircraft map" />
}
