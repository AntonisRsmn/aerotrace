
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
  showLabels?: boolean
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
  callsign: string
  heading: number
  selected: boolean
  hovered: boolean
}

type AirportProperties = {
  name: string
  iata: string
  icao: string
}

const AIRCRAFT_SOURCE = 'aerotrace-aircraft'
const AIRCRAFT_GLOW_LAYER = 'aerotrace-aircraft-glow'
const AIRCRAFT_LAYER = 'aerotrace-aircraft-symbols'
const AIRCRAFT_LABEL_LAYER = 'aerotrace-aircraft-labels'

const AIRPORT_SOURCE = 'aerotrace-airports'
const AIRPORT_DOTS_LAYER = 'aerotrace-airport-dots'
const AIRPORT_LABELS_LAYER = 'aerotrace-airport-labels'

const HISTORY_SOURCE = 'aerotrace-history-path'
const HISTORY_CASING_LAYER = 'aerotrace-history-casing'
const HISTORY_LAYER = 'aerotrace-history-line'

const PLANE_IMAGE = 'aerotrace-plane-blue-v4'
const PLANE_IMAGE_HOVER = 'aerotrace-plane-yellow-v4'

const emptyLines: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
}

const emptyAircraft: FeatureCollection<Point, AircraftProperties> = {
  type: 'FeatureCollection',
  features: [],
}

const emptyAirports: FeatureCollection<Point, AirportProperties> = {
  type: 'FeatureCollection',
  features: [],
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }

  fields.push(field)
  return fields
}

export default function MapView({
  aircraft,
  selectedId,
  onSelect,
  onBoundsChange,
  showTrails = true,
  showLabels = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const aircraftRef = useRef(aircraft)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  const onBoundsChangeRef = useRef(onBoundsChange)
  const showTrailsRef = useRef(showTrails)
  const showLabelsRef = useRef(showLabels)

  const hoveredIdRef = useRef<string | null>(null)
  const historyRef = useRef<Map<string, Position[]>>(new Map())
  const imageLoadingRef = useRef<Set<string>>(new Set())

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

  useEffect(() => {
    showLabelsRef.current = showLabels

    const map = mapRef.current

    if (map?.getLayer(AIRCRAFT_LABEL_LAYER)) {
      map.setLayoutProperty(
        AIRCRAFT_LABEL_LAYER,
        'visibility',
        showLabels ? 'visible' : 'none',
      )
    }
  }, [showLabels])

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
          callsign: item.callsign?.trim() || item.icao24.toUpperCase(),
          heading:
            item.heading != null && Number.isFinite(item.heading)
              ? item.heading
              : 0,
          selected: item.id === selectedIdRef.current,
          hovered: item.id === hoveredIdRef.current,
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

  function createPlaneImage(
    map: maplibregl.Map,
    imageName: string,
    fillColor: string,
  ) {
    if (
      mapRef.current !== map ||
      map.hasImage(imageName) ||
      imageLoadingRef.current.has(imageName)
    ) {
      return
    }

    imageLoadingRef.current.add(imageName)

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
          fill="${fillColor}"
          stroke="#07111F"
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
          mapRef.current === map &&
          map.isStyleLoaded() &&
          !map.hasImage(imageName)
        ) {
          map.addImage(imageName, image, {
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
        imageLoadingRef.current.delete(imageName)
      }

      if (mapRef.current === map && map.isStyleLoaded()) {
        ensureMapLayers(map)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      imageLoadingRef.current.delete(imageName)

      console.error(
        `[AeroTrace] Could not load aircraft icon: ${imageName}`,
      )
    }

    image.src = url
  }

  async function loadAirports(map: maplibregl.Map) {
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
      )

      if (!response.ok) {
        throw new Error(`Airport dataset request failed (${response.status}).`)
      }

      const csv = await response.text()
      const lines = csv.split(/\r?\n/)
      if (lines.length < 2) return

      const headers = parseCsvLine(lines[0])
      const column = (name: string) => headers.indexOf(name)
      const typeIndex = column('type')
      const nameIndex = column('name')
      const latIndex = column('latitude_deg')
      const lonIndex = column('longitude_deg')
      const iataIndex = column('iata_code')
      const icaoIndex = column('gps_code')

      const features: FeatureCollection<Point, AirportProperties>['features'] = []

      for (const line of lines.slice(1)) {
        if (!line) continue
        const values = parseCsvLine(line)
        const airportType = values[typeIndex]

        if (airportType !== 'large_airport' && airportType !== 'medium_airport') {
          continue
        }

        const latitude = Number(values[latIndex])
        const longitude = Number(values[lonIndex])
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          continue
        }

        const iata = values[iataIndex] || ''
        const icao = values[icaoIndex] || ''
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          properties: {
            name: values[nameIndex] || 'Airport',
            iata,
            icao,
          },
        })
      }

      if (mapRef.current !== map) return

      const source = map.getSource(AIRPORT_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      source?.setData({
        type: 'FeatureCollection',
        features,
      })
    } catch (error) {
      console.error('[AeroTrace] Could not load airport data:', error)
    }
  }

  function ensureMapLayers(map: maplibregl.Map) {
    if (
      mapRef.current !== map ||
      !map.isStyleLoaded()
    ) {
      return
    }

    if (!map.getSource(AIRPORT_SOURCE)) {
      map.addSource(AIRPORT_SOURCE, {
        type: 'geojson',
        data: emptyAirports,
      })
    }

    if (!map.getLayer(AIRPORT_DOTS_LAYER)) {
      map.addLayer({
        id: AIRPORT_DOTS_LAYER,
        type: 'circle',
        source: AIRPORT_SOURCE,
        minzoom: 3,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3, 1.5,
            6, 3,
            9, 4.5,
          ],
          'circle-color': '#58D7FF',
          'circle-opacity': 0.95,
          'circle-stroke-color': '#07111F',
          'circle-stroke-width': 1.2,
        },
      })
    }

    if (!map.getLayer(AIRPORT_LABELS_LAYER)) {
      map.addLayer({
        id: AIRPORT_LABELS_LAYER,
        type: 'symbol',
        source: AIRPORT_SOURCE,
        minzoom: 4.5,
        layout: {
          'text-field': [
            'case',
            ['!=', ['get', 'iata'], ''],
            ['get', 'iata'],
            ['get', 'icao'],
          ],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4.5, 8,
            8, 11,
          ],
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
          'text-max-width': 7,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': '#BDEFFF',
          'text-halo-color': '#08121E',
          'text-halo-width': 1.5,
        },
      })
    }

    if (!map.getSource(HISTORY_SOURCE)) {
      map.addSource(HISTORY_SOURCE, {
        type: 'geojson',
        data: emptyLines,
      })
    }

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
      createPlaneImage(map, PLANE_IMAGE, '#258BFF')
    }

    if (!map.hasImage(PLANE_IMAGE_HOVER)) {
      createPlaneImage(map, PLANE_IMAGE_HOVER, '#FFD43B')
    }

    if (
      !map.hasImage(PLANE_IMAGE) ||
      !map.hasImage(PLANE_IMAGE_HOVER)
    ) {
      return
    }

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
          'circle-color': '#258BFF',
          'circle-opacity': 0.6,
          'circle-blur': 0.85,
          'circle-stroke-color': '#258BFF',
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
          'icon-image': [
            'case',
            ['boolean', ['get', 'hovered'], false],
            PLANE_IMAGE_HOVER,
            PLANE_IMAGE,
          ],
          'icon-size': [
            'case',
            ['boolean', ['get', 'hovered'], false],
            0.9,
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

      map.on('mousemove', AIRCRAFT_LAYER, (event) => {
        map.getCanvas().style.cursor = 'pointer'

        const id = event.features?.[0]?.properties?.id

        if (
          typeof id === 'string' &&
          hoveredIdRef.current !== id
        ) {
          hoveredIdRef.current = id
          updateAircraftSource(map)
        }
      })

      map.on('mouseleave', AIRCRAFT_LAYER, () => {
        map.getCanvas().style.cursor = ''

        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null
          updateAircraftSource(map)
        }
      })
    }

    if (!map.getLayer(AIRCRAFT_LABEL_LAYER)) {
      map.addLayer({
        id: AIRCRAFT_LABEL_LAYER,
        type: 'symbol',
        source: AIRCRAFT_SOURCE,
        filter: ['==', ['get', 'hovered'], true],
        layout: {
          'text-field': ['get', 'callsign'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
          'text-size': [
            'case',
            ['boolean', ['get', 'hovered'], false],
            12,
            10,
          ],
          'text-anchor': 'bottom',
          'text-offset': [0, -1.55],
          'text-max-width': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'visibility': showLabelsRef.current ? 'visible' : 'none',
        },
        paint: {
          'text-color': [
            'case',
            ['boolean', ['get', 'hovered'], false],
            '#FFD43B',
            '#EAF4FF',
          ],
          'text-halo-color': '#07111F',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.3,
        },
      })
    }

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
          basemap: {
            type: 'raster',
            tiles: [
              'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a> · Airport data: <a href="https://ourairports.com/data/">OurAirports</a>',
          },
        },
        layers: [
          {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
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
      void loadAirports(map)
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

      imageLoadingRef.current.clear()
      map.remove()
    }
  }, [])

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
  }, [aircraft, selectedId, showTrails, showLabels])

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
