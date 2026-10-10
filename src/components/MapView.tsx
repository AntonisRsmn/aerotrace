
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection, Point, LineString } from 'geojson'
import type { Aircraft } from '../types'

export type MapBounds = {
  lamin: number
  lamax: number
  lomin: number
  lomax: number
}

type Props = {
  aircraft: Aircraft[]
  selectedId: string | null
  onSelect: (id: string) => void
  onBoundsChange: (bounds: MapBounds) => void
  showTrails?: boolean
}

type Position = [number, number]

type SavedTrack = {
  points?: Array<{
    time: number
    longitude: number
    latitude: number
    onGround: boolean | null
    heading: number | null
    altitudeFt: number | null
  }>
}

type AircraftProperties = {
  id: string
  heading: number
  selected: boolean
}

const AIRCRAFT_SOURCE = 'aerotrace-aircraft'
const AIRCRAFT_GLOW_LAYER = 'aerotrace-aircraft-glow'
const AIRCRAFT_LAYER = 'aerotrace-aircraft-symbols'

const HISTORY_SOURCE = 'aerotrace-history-path'
const HISTORY_CASING_LAYER = 'aerotrace-history-casing'
const HISTORY_LAYER = 'aerotrace-history-line'

const PLANE_IMAGE = 'aerotrace-plane-white-v3'

const emptyLines: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
}

const emptyAircraft: FeatureCollection<Point, AircraftProperties> = {
  type: 'FeatureCollection',
  features: [],
}

export default function MapView({
  aircraft,
  selectedId,
  onSelect,
  onBoundsChange,
  showTrails = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const aircraftRef = useRef(aircraft)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  const onBoundsChangeRef = useRef(onBoundsChange)
  const showTrailsRef = useRef(showTrails)

  const historyRef = useRef<Map<string, Position[]>>(new Map())
  const imageLoadingRef = useRef(false)

  useEffect(() => {
    aircraftRef.current = aircraft
  }, [aircraft])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange
  }, [onBoundsChange])

  useEffect(() => {
    showTrailsRef.current = showTrails
  }, [showTrails])

  function updateAircraftSource(map: maplibregl.Map) {
    if (mapRef.current !== map) return

    const source = map.getSource(
      AIRCRAFT_SOURCE,
    ) as maplibregl.GeoJSONSource | undefined

    if (!source) return

    const features: FeatureCollection<
      Point,
      AircraftProperties
    >['features'] = []

    for (const item of aircraftRef.current) {
      if (
        !Number.isFinite(item.longitude) ||
        !Number.isFinite(item.latitude) ||
        item.latitude < -90 ||
        item.latitude > 90 ||
        item.longitude < -180 ||
        item.longitude > 180
      ) {
        continue
      }

      features.push({
        type: 'Feature',
        properties: {
          id: item.id,
          heading: Number.isFinite(item.heading) ? item.heading : 0,
          selected: item.id === selectedIdRef.current,
        },
        geometry: {
          type: 'Point',
          coordinates: [item.longitude, item.latitude],
        },
      })
    }

    source.setData({
      type: 'FeatureCollection',
      features,
    })
  }

  function updateHistoryPath(map: maplibregl.Map) {
    if (mapRef.current !== map) return

    const source = map.getSource(
      HISTORY_SOURCE,
    ) as maplibregl.GeoJSONSource | undefined

    if (!source) return

    const selectedAircraft = aircraftRef.current.find(
      (item) => item.id === selectedIdRef.current,
    )

    if (!showTrailsRef.current || !selectedAircraft) {
      source.setData(emptyLines)
      return
    }

    const positions =
      historyRef.current.get(selectedAircraft.id) ?? []

    if (positions.length < 2) {
      source.setData(emptyLines)
      return
    }

    const current: Position = [
      selectedAircraft.longitude,
      selectedAircraft.latitude,
    ]

    const last = positions[positions.length - 1]

    const coordinates =
      last[0] === current[0] && last[1] === current[1]
        ? positions
        : [...positions, current]

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { aircraftId: selectedAircraft.id },
          geometry: {
            type: 'LineString',
            coordinates,
          },
        },
      ],
    })
  }

  function createPlaneImage(map: maplibregl.Map) {
    if (
      mapRef.current !== map ||
      map.hasImage(PLANE_IMAGE) ||
      imageLoadingRef.current
    ) {
      return
    }

    imageLoadingRef.current = true

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="64"
           height="64"
           viewBox="0 0 64 64">
        <path
          d="M32 3
             C34.1 3 35.1 5.3 35.7 9
             L38.4 23
             L55 31
             L55 35
             L37.7 31.5
             L36.5 44
             L43 50
             L43 53
             L32 50
             L21 53
             L21 50
             L27.5 44
             L26.3 31.5
             L9 35
             L9 31
             L25.6 23
             L28.3 9
             C28.9 5.3 29.9 3 32 3 Z"
          fill="#FFFFFF"
          stroke="#111827"
          stroke-width="2.5"
          stroke-linejoin="round"
        />
      </svg>
    `

    const blob = new Blob([svg], {
      type: 'image/svg+xml;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      try {
        if (
          mapRef.current !== map ||
          !map.isStyleLoaded()
        ) {
          return
        }

        if (!map.hasImage(PLANE_IMAGE)) {
          map.addImage(PLANE_IMAGE, image, {
            pixelRatio: 2,
          })
        }
      } catch (error) {
        console.error(
          '[AeroTrace] Could not register aircraft icon:',
          error,
        )
      } finally {
        URL.revokeObjectURL(url)
        imageLoadingRef.current = false
      }

      if (
        mapRef.current === map &&
        map.isStyleLoaded() &&
        map.hasImage(PLANE_IMAGE)
      ) {
        ensureMapLayers(map)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      imageLoadingRef.current = false

      console.error(
        '[AeroTrace] Could not load aircraft icon.',
      )
    }

    image.src = url
  }

  function ensureMapLayers(map: maplibregl.Map) {
    if (
      mapRef.current !== map ||
      !map.isStyleLoaded()
    ) {
      return
    }

    // Historical trail source and its two contrasting line layers.
    if (!map.getSource(HISTORY_SOURCE)) {
      map.addSource(HISTORY_SOURCE, {
        type: 'geojson',
        data: emptyLines,
      })
    }

    // Dark casing improves contrast against roads and map details.
    if (!map.getLayer(HISTORY_CASING_LAYER)) {
      map.addLayer({
        id: HISTORY_CASING_LAYER,
        type: 'line',
        source: HISTORY_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#07111F',
          'line-width': 7,
          'line-opacity': 0.95,
        },
      })
    }

    // Bright cyan trail sits above the dark casing.
    if (!map.getLayer(HISTORY_LAYER)) {
      map.addLayer({
        id: HISTORY_LAYER,
        type: 'line',
        source: HISTORY_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#00D9FF',
          'line-width': 3.5,
          'line-opacity': 1,
        },
      })
    }

    if (!map.getSource(AIRCRAFT_SOURCE)) {
      map.addSource(AIRCRAFT_SOURCE, {
        type: 'geojson',
        data: emptyAircraft,
      })
    }

    if (!map.hasImage(PLANE_IMAGE)) {
      createPlaneImage(map)
      return
    }

    // The glow only appears for the selected aircraft.
    if (!map.getLayer(AIRCRAFT_GLOW_LAYER)) {
      map.addLayer({
        id: AIRCRAFT_GLOW_LAYER,
        type: 'circle',
        source: AIRCRAFT_SOURCE,
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'selected'], false],
            19,
            0,
          ],
          'circle-color': '#00D9FF',
          'circle-opacity': 0.75,
          'circle-blur': 0.85,
          'circle-stroke-color': '#00D9FF',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': [
            'case',
            ['boolean', ['get', 'selected'], false],
            0.8,
            0,
          ],
        },
      })
    }

    if (!map.getLayer(AIRCRAFT_LAYER)) {
      map.addLayer({
        id: AIRCRAFT_LAYER,
        type: 'symbol',
        source: AIRCRAFT_SOURCE,
        layout: {
          'icon-image': PLANE_IMAGE,
          'icon-size': [
            'case',
            ['boolean', ['get', 'selected'], false],
            0.85,
            0.7,
          ],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': 1,
        },
      })

      map.on('click', AIRCRAFT_LAYER, (event) => {
        const id = event.features?.[0]?.properties?.id

        if (typeof id === 'string') {
          onSelectRef.current(id)
        }
      })

      map.on('mouseenter', AIRCRAFT_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', AIRCRAFT_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    // Keep aircraft above the glow and the historical trail.
    updateAircraftSource(map)
    updateHistoryPath(map)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [15, 48],
      zoom: 3.2,
      minZoom: 2,
      maxZoom: 16,
      attributionControl: {},
    })

    mapRef.current = map

    const reportBounds = () => {
      if (mapRef.current !== map) return

      const bounds = map.getBounds()

      onBoundsChangeRef.current({
        lamin: Math.max(-90, bounds.getSouth()),
        lamax: Math.min(90, bounds.getNorth()),
        lomin: Math.max(-180, bounds.getWest()),
        lomax: Math.min(180, bounds.getEast()),
      })
    }

    const onLoad = () => {
      ensureMapLayers(map)
      reportBounds()
    }

    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: false,
      }),
      'top-right',
    )

    map.on('load', onLoad)
    map.on('moveend', reportBounds)

    map.on('error', (event) => {
      console.error(
        '[AeroTrace map]',
        event.error?.message ?? event,
      )
    })

    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current === map) {
        map.resize()
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()

      if (mapRef.current === map) {
        mapRef.current = null
      }

      imageLoadingRef.current = false
      map.remove()
    }
  }, [])

  // Keep positions, selection glow, and trail synchronized.
  useEffect(() => {
    const map = mapRef.current

    if (
      !map ||
      !map.isStyleLoaded() ||
      mapRef.current !== map
    ) {
      return
    }

    ensureMapLayers(map)
  }, [aircraft, selectedId, showTrails])

  // Load saved historical positions for the selected aircraft.
  useEffect(() => {
    if (!selectedId) {
      const map = mapRef.current

      if (map) {
        updateHistoryPath(map)
      }

      return
    }

    let cancelled = false
    let inFlight = false
    let controller: AbortController | null = null

    const loadSavedTrack = async () => {
      if (inFlight || cancelled) return

      inFlight = true

      const currentController = new AbortController()
      controller = currentController

      try {
        const response = await fetch(
          `/api/tracks/${encodeURIComponent(selectedId)}`,
          { signal: currentController.signal },
        )

        if (!response.ok) return

        const data = (await response.json()) as SavedTrack

        if (cancelled) return

        const positions: Position[] = (data.points ?? [])
          .filter(
            (point) =>
              Number.isFinite(point.longitude) &&
              Number.isFinite(point.latitude) &&
              point.latitude >= -90 &&
              point.latitude <= 90 &&
              point.longitude >= -180 &&
              point.longitude <= 180,
          )
          .map((point) => [
            point.longitude,
            point.latitude,
          ])

        historyRef.current.set(selectedId, positions)

        const map = mapRef.current

        if (map) {
          updateHistoryPath(map)
        }
      } catch (error) {
        if (
          !cancelled &&
          error instanceof Error &&
          error.name !== 'AbortError'
        ) {
          console.error(
            '[AeroTrace] Could not load saved flight history:',
            error,
          )
        }
      } finally {
        inFlight = false
      }
    }

    void loadSavedTrack()

    const interval = window.setInterval(() => {
      void loadSavedTrack()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      controller?.abort()
    }
  }, [selectedId])

  return (
    <div
      ref={containerRef}
      className="maplibre-container"
      aria-label="Interactive aircraft tracking map"
    />
  )
}
