
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
  speedKt: number | null
  onGround: boolean | null
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
const LIVE_TRAIL_SOURCE = 'aerotrace-live-trail'
const LIVE_TRAIL_LAYER = 'aerotrace-live-trail-line'

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

let airportsDataPromise: Promise<
  FeatureCollection<Point, AirportProperties>
> | null = null

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

  const aircraftPositionsRef = useRef<Map<string, Position>>(new Map())
  const aircraftTargetsRef = useRef<Map<string, Position>>(new Map())
  const aircraftMotionRef = useRef<
    Map<string, {
      observedPosition: Position
      observedAt: number
      speedKt: number | null
      heading: number | null
      onGround: boolean | null
    }>
  >(new Map())
  const aircraftAnimationsRef = useRef<
    Map<string, { from: Position; start: number; duration: number }>
  >(new Map())
  const aircraftAnimationFrameRef = useRef<number | null>(null)
  const aircraftAnimationLastFrameRef = useRef(0)

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

  function projectAircraftPosition(
    motion: {
      observedPosition: Position
      observedAt: number
      speedKt: number | null
      heading: number | null
      onGround: boolean | null
    },
    now: number,
  ): Position {
    const elapsedSeconds = Math.min(55, Math.max(0, (now - motion.observedAt) / 1000))
    const speedKt = motion.speedKt
    const heading = motion.heading

    // Dead-reckoning is display-only, limited to 55 seconds between observations.
    // It uses reported speed/heading and is corrected whenever a new observed
    // position arrives; the saved trail continues to use observed points only.
    if (
      elapsedSeconds <= 0 ||
      elapsedSeconds >= 55 ||
      motion.onGround === true ||
      speedKt == null ||
      !Number.isFinite(speedKt) ||
      speedKt < 30 ||
      heading == null ||
      !Number.isFinite(heading)
    ) {
      return motion.observedPosition
    }

    const earthRadiusMeters = 6_371_008.8
    const distanceMeters = (speedKt * 1852 * elapsedSeconds) / 3600
    const angularDistance = distanceMeters / earthRadiusMeters
    const bearing = (heading * Math.PI) / 180
    const latitude1 = (motion.observedPosition[1] * Math.PI) / 180
    const longitude1 = (motion.observedPosition[0] * Math.PI) / 180

    const latitude2 = Math.asin(
      Math.sin(latitude1) * Math.cos(angularDistance) +
        Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const longitude2 =
      longitude1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
        Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2),
      )

    let longitude = (longitude2 * 180) / Math.PI
    if (longitude > 180) longitude -= 360
    if (longitude < -180) longitude += 360

    return [longitude, (latitude2 * 180) / Math.PI]
  }

  function animateAircraftFrame(map: maplibregl.Map) {
    if (mapRef.current !== map) {
      aircraftAnimationFrameRef.current = null
      return
    }

    const frameTime = performance.now()

    // Cap source updates at 20 FPS; all aircraft are updated in one diff.
    if (frameTime - aircraftAnimationLastFrameRef.current < 50) {
      aircraftAnimationFrameRef.current = requestAnimationFrame(() =>
        animateAircraftFrame(map),
      )
      return
    }

    aircraftAnimationLastFrameRef.current = frameTime
    const updates: Array<{ id: string; newGeometry: Point }> = []

    for (const [id, motion] of aircraftMotionRef.current) {
      const projected = projectAircraftPosition(motion, frameTime)
      const animation = aircraftAnimationsRef.current.get(id)
      let position = projected

      if (animation) {
        const progress = Math.min(
          1,
          Math.max(0, (frameTime - animation.start) / animation.duration),
        )
        const eased = progress * progress * (3 - 2 * progress)
        const longitudeDelta =
          projected[0] - animation.from[0] > 180
            ? projected[0] - animation.from[0] - 360
            : projected[0] - animation.from[0] < -180
              ? projected[0] - animation.from[0] + 360
              : projected[0] - animation.from[0]

        let longitude = animation.from[0] + longitudeDelta * eased
        if (longitude > 180) longitude -= 360
        if (longitude < -180) longitude += 360

        position = [
          longitude,
          animation.from[1] + (projected[1] - animation.from[1]) * eased,
        ]

        if (progress >= 1) {
          aircraftAnimationsRef.current.delete(id)
        }
      }

      const previous = aircraftPositionsRef.current.get(id)
      if (
        previous &&
        (Math.abs(previous[0] - position[0]) > 0.000001 ||
          Math.abs(previous[1] - position[1]) > 0.000001)
      ) {
        aircraftPositionsRef.current.set(id, position)
        updates.push({
          id,
          newGeometry: {
            type: 'Point',
            coordinates: position,
          },
        })
      }
    }

    const source = map.getSource(AIRCRAFT_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined

    if (source && updates.length > 0) {
      source.updateData({ update: updates })
    }

    if (showTrailsRef.current) {
      updateLiveTrail(map)
    }

    // Continue while any transition is active or an aircraft can still be
    // projected forward from its last observed position.
    const hasMovingAircraft = Array.from(aircraftMotionRef.current.values()).some(
      (motion) =>
        motion.onGround !== true &&
        motion.speedKt != null &&
        motion.speedKt >= 30 &&
        motion.heading != null &&
        frameTime - motion.observedAt < 55_000,
    )

    if (aircraftAnimationsRef.current.size > 0 || hasMovingAircraft) {
      aircraftAnimationFrameRef.current = requestAnimationFrame(() =>
        animateAircraftFrame(map),
      )
    } else {
      aircraftAnimationFrameRef.current = null
    }
  }

  function updateAircraftSource(map: maplibregl.Map) {
    if (mapRef.current !== map) return

    const source = map.getSource(
      AIRCRAFT_SOURCE,
    ) as maplibregl.GeoJSONSource | undefined

    if (!source) return

    const add: FeatureCollection<Point, AircraftProperties>['features'] = []
    const remove: string[] = []
    const update: Array<{
      id: string
      addOrUpdateProperties: Array<{ key: string; value: unknown }>
    }> = []
    const nextIds = new Set<string>()
    const now = performance.now()

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

      const id = item.id
      const target: Position = [item.longitude, item.latitude]
      const properties: AircraftProperties = {
        id,
        callsign: item.callsign?.trim() || item.icao24.toUpperCase(),
        heading:
          item.heading != null && Number.isFinite(item.heading)
            ? item.heading
            : 0,
        speedKt:
          item.speedKt != null && Number.isFinite(item.speedKt)
            ? item.speedKt
            : null,
        onGround: item.onGround,
        selected: id === selectedIdRef.current,
        hovered: id === hoveredIdRef.current,
      }

      nextIds.add(id)
      const existingPosition = aircraftPositionsRef.current.get(id)

      if (!existingPosition) {
        add.push({
          type: 'Feature',
          id,
          properties,
          geometry: {
            type: 'Point',
            coordinates: target,
          },
        })
        aircraftPositionsRef.current.set(id, target)
        aircraftTargetsRef.current.set(id, target)
        aircraftMotionRef.current.set(id, {
          observedPosition: target,
          observedAt: now,
          speedKt: properties.speedKt,
          heading: item.heading,
          onGround: item.onGround,
        })
        continue
      }

      update.push({
        id,
        addOrUpdateProperties: [
          { key: 'id', value: properties.id },
          { key: 'callsign', value: properties.callsign },
          { key: 'heading', value: properties.heading },
          { key: 'speedKt', value: properties.speedKt },
          { key: 'onGround', value: properties.onGround },
          { key: 'selected', value: properties.selected },
          { key: 'hovered', value: properties.hovered },
        ],
      })

      const previousTarget = aircraftTargetsRef.current.get(id)
      const motion = aircraftMotionRef.current.get(id)
      if (
        !previousTarget ||
        Math.abs(previousTarget[0] - target[0]) > 0.000001 ||
        Math.abs(previousTarget[1] - target[1]) > 0.000001
      ) {
        const from = aircraftPositionsRef.current.get(id) ?? target
        aircraftTargetsRef.current.set(id, target)
        aircraftMotionRef.current.set(id, {
          observedPosition: target,
          observedAt: now,
          speedKt: properties.speedKt,
          heading: item.heading,
          onGround: item.onGround,
        })

        if (
          Math.abs(from[0] - target[0]) < 0.000001 &&
          Math.abs(from[1] - target[1]) < 0.000001
        ) {
          aircraftAnimationsRef.current.delete(id)
          aircraftPositionsRef.current.set(id, target)
        } else {
          aircraftAnimationsRef.current.set(id, {
            from,
            start: now,
            duration: 1400,
          })
        }
      } else if (motion) {
        // Keep velocity data fresh without resetting the position timestamp.
        motion.speedKt = properties.speedKt
        motion.heading = item.heading
        motion.onGround = item.onGround
      }
    }

    for (const id of aircraftPositionsRef.current.keys()) {
      if (!nextIds.has(id)) {
        remove.push(id)
        aircraftPositionsRef.current.delete(id)
        aircraftTargetsRef.current.delete(id)
        aircraftAnimationsRef.current.delete(id)
        aircraftMotionRef.current.delete(id)
      }
    }

    if (add.length || remove.length || update.length) {
      source.updateData({ add, remove, update })
    }

    const hasMovingAircraft = Array.from(aircraftMotionRef.current.values()).some(
      (motion) =>
        motion.onGround !== true &&
        motion.speedKt != null &&
        motion.speedKt >= 30 &&
        motion.heading != null &&
        now - motion.observedAt < 55_000,
    )

    if (
      (aircraftAnimationsRef.current.size > 0 || hasMovingAircraft) &&
      aircraftAnimationFrameRef.current === null
    ) {
      aircraftAnimationFrameRef.current = requestAnimationFrame(() =>
        animateAircraftFrame(map),
      )
    }
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

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { aircraftId: selectedAircraft.id },
          geometry: {
            type: 'LineString',
            coordinates: positions,
          },
        },
      ],
    })
  }


  function updateLiveTrail(map: maplibregl.Map) {
    const source = map.getSource(LIVE_TRAIL_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined
    if (!source) return

    const selectedAircraft = aircraftRef.current.find(
      (item) => item.id === selectedIdRef.current,
    )
    const positions = selectedAircraft
      ? historyRef.current.get(selectedAircraft.id) ?? []
      : []

    if (!showTrailsRef.current || !selectedAircraft || positions.length === 0) {
      source.setData(emptyLines)
      return
    }

    const lastObserved = positions[positions.length - 1]
    const current =
      aircraftPositionsRef.current.get(selectedAircraft.id) ??
      ([selectedAircraft.longitude, selectedAircraft.latitude] as Position)

    const distance = distanceMeters(
      { longitude: lastObserved[0], latitude: lastObserved[1] },
      { longitude: current[0], latitude: current[1] },
    )
    if (distance > 150_000) {
      source.setData(emptyLines)
      return
    }

    if (
      Math.abs(lastObserved[0] - current[0]) < 0.000001 &&
      Math.abs(lastObserved[1] - current[1]) < 0.000001
    ) {
      source.setData(emptyLines)
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { estimated: true },
        geometry: { type: 'LineString', coordinates: [lastObserved, current] },
      }],
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
      // Parse the large public CSV only once per page session. Additional map
      // mounts reuse the cached GeoJSON instead of downloading and parsing it again.
      if (!airportsDataPromise) {
        airportsDataPromise = (async () => {
          const response = await fetch(
            'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
          )

          if (!response.ok) {
            throw new Error(`Airport dataset request failed (${response.status}).`)
          }

          const csv = await response.text()
          const lines = csv.split(/\r?\n/)
          if (lines.length < 2) {
            return emptyAirports
          }

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

            features.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [longitude, latitude],
              },
              properties: {
                name: values[nameIndex] || 'Airport',
                iata: values[iataIndex] || '',
                icao: values[icaoIndex] || '',
              },
            })
          }

          return {
            type: 'FeatureCollection' as const,
            features,
          }
        })().catch((error) => {
          // Permit retrying if the dataset request fails temporarily.
          airportsDataPromise = null
          throw error
        })
      }

      const data = await airportsDataPromise
      if (mapRef.current !== map) return

      const source = map.getSource(AIRPORT_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      source?.setData(data)
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
        minzoom: 5.5,
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
            5.5, 8,
            9, 11,
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

    if (!map.getSource(LIVE_TRAIL_SOURCE)) {
      map.addSource(LIVE_TRAIL_SOURCE, {
        type: 'geojson',
        data: emptyLines,
      })
    }

    if (!map.getLayer(LIVE_TRAIL_LAYER)) {
      map.addLayer({
        id: LIVE_TRAIL_LAYER,
        type: 'line',
        source: LIVE_TRAIL_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#55B7FF',
          'line-width': 3,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2],
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
    updateLiveTrail(map)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      // OpenFreeMap's dark style is free to use without an API key.
      // Keep custom airport attribution visible alongside the style's OSM attribution.
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [15, 48],
      zoom: 3.2,
      minZoom: 2,
      maxZoom: 16,
      // Reduce map rendering and tile-cache overhead on lower-powered devices.
      fadeDuration: 0,
      maxTileCacheSize: 96,
      maxTileCacheZoomLevels: 3,
      refreshExpiredTiles: false,
      attributionControl: {
        customAttribution: 'Airport data © OurAirports',
      },
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

      if (aircraftAnimationFrameRef.current !== null) {
        cancelAnimationFrame(aircraftAnimationFrameRef.current)
        aircraftAnimationFrameRef.current = null
      }

      aircraftAnimationsRef.current.clear()
      aircraftPositionsRef.current.clear()
      aircraftTargetsRef.current.clear()
      aircraftMotionRef.current.clear()
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

        const seenPositions = new Set<string>()
        const orderedPoints = (data.points ?? [])
          .filter(
            (point) =>
              Number.isFinite(point.time) &&
              Number.isFinite(point.longitude) &&
              Number.isFinite(point.latitude) &&
              point.latitude >= -90 &&
              point.latitude <= 90 &&
              point.longitude >= -180 &&
              point.longitude <= 180,
          )
          .sort((a, b) => a.time - b.time)

        const positions: Position[] = []
        for (const point of orderedPoints) {
          const key = `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`
          if (seenPositions.has(key)) continue
          seenPositions.add(key)
          positions.push([point.longitude, point.latitude])
        }

        historyRef.current.set(selectedId, positions)

        const map = mapRef.current

        if (map) {
          updateHistoryPath(map)
          updateLiveTrail(map)
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
