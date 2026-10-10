const API_URL = 'https://adsb.aero/api/v1/query'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REPLAY_DURATION_MIN_SECONDS = 12 * 60
const REPLAY_DURATION_MAX_SECONDS = 32 * 60
const REQUEST_TIMEOUT_MS = 20_000

let cachedFlights = []
let cacheExpiresAt = 0
let pendingRefresh = null

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function flattenPath(flight) {
  const segments = flight?.path?.coordinates
  if (!Array.isArray(segments)) return []

  const points = []
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue
    for (const coordinate of segment) {
      if (!Array.isArray(coordinate) || !isNumber(coordinate[0]) || !isNumber(coordinate[1])) continue
      const point = {
        longitude: coordinate[0],
        latitude: coordinate[1],
        altitudeFt: isNumber(coordinate[2]) ? Math.max(0, Math.round(coordinate[2])) : null,
      }
      const previous = points[points.length - 1]
      if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) {
        points.push(point)
      }
    }
  }

  return points
}

function flightToTemplate(flight) {
  const path = flattenPath(flight)
  if (path.length < 5) return null
  if (!/^[a-f0-9]{6}$/i.test(flight.icao24 || '')) return null

  const startTime = Date.parse(flight.start_ts)
  const endTime = Date.parse(flight.end_ts)
  const actualDurationSeconds = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
    ? (endTime - startTime) / 1000
    : null

  return {
    flightId: String(flight.flight_id || `${flight.icao24}:${flight.start_ts || ''}`),
    icao24: String(flight.icao24).toLowerCase(),
    callsign: String(flight.callsign || '').trim().toUpperCase(),
    registration: flight.registration || null,
    aircraftType: flight.icao_type || null,
    model: flight.model || null,
    airline: flight.operator || null,
    categoryCode: flight.emitter_category ? Number.parseInt(String(flight.emitter_category).replace(/\D/g, ''), 10) || null : null,
    origin: flight.start_airport_ident || null,
    destination: flight.end_airport_ident || null,
    originName: flight.start_airport_name || null,
    destinationName: flight.end_airport_name || null,
    startTime: Number.isFinite(startTime) ? startTime / 1000 : 0,
    actualDurationSeconds,
    path,
    squawk: Array.isArray(flight.squawk_runs) ? flight.squawk_runs.flat(2).find((value) => typeof value === 'string' && /^\d{4}$/.test(value)) || null : null,
  }
}

async function refreshTemplates() {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ limit: 1000, window_days: 7, include_path: true }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Historical flight archive returned HTTP ${response.status}.`)
  }

  const payload = await response.json()
  const templates = (Array.isArray(payload.flights) ? payload.flights : [])
    .map(flightToTemplate)
    .filter((flight) => flight && flight.callsign && flight.path.length >= 5)

  if (templates.length < 10) {
    throw new Error('The historical flight archive did not return enough complete flight tracks for demo mode.')
  }

  cachedFlights = templates
  cacheExpiresAt = Date.now() + CACHE_TTL_MS
  console.info(`[AeroTrace demo replay] Loaded ${templates.length} historical flight tracks from adsb.aero.`)
  return cachedFlights
}

async function getTemplates() {
  if (cachedFlights.length && Date.now() < cacheExpiresAt) return cachedFlights
  if (pendingRefresh) return pendingRefresh

  pendingRefresh = refreshTemplates()
    .catch((error) => {
      // Keep serving the last successful snapshot if a refresh fails.
      if (cachedFlights.length) {
        console.warn('[AeroTrace demo replay] Refresh failed; retaining cached historical tracks:', error.message)
        cacheExpiresAt = Date.now() + 60_000
        return cachedFlights
      }
      throw error
    })
    .finally(() => {
      pendingRefresh = null
    })

  return pendingRefresh
}

function seededNumber(value) {
  let hash = 2166136261
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

function interpolatePoint(a, b, fraction) {
  const altitudeA = a.altitudeFt
  const altitudeB = b.altitudeFt
  return {
    longitude: a.longitude + (b.longitude - a.longitude) * fraction,
    latitude: a.latitude + (b.latitude - a.latitude) * fraction,
    altitudeFt: altitudeA == null || altitudeB == null
      ? altitudeA ?? altitudeB
      : Math.round(altitudeA + (altitudeB - altitudeA) * fraction),
  }
}

function bearing(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180
  const toDegrees = (value) => value * 180 / Math.PI
  const lat1 = radians(a.latitude)
  const lat2 = radians(b.latitude)
  const deltaLon = radians(b.longitude - a.longitude)
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function replayFlight(template, index, nowSeconds) {
  const route = template.path.map((point) => [Number(point.longitude.toFixed(5)), Number(point.latitude.toFixed(5))])
  const replayDuration = REPLAY_DURATION_MIN_SECONDS
    + seededNumber(template.flightId) * (REPLAY_DURATION_MAX_SECONDS - REPLAY_DURATION_MIN_SECONDS)
  const offset = seededNumber(`${template.flightId}:offset`) * replayDuration
  const progress = ((nowSeconds + offset) % replayDuration) / replayDuration
  const scaled = progress * (template.path.length - 1)
  const pointIndex = Math.min(template.path.length - 2, Math.floor(scaled))
  const point = interpolatePoint(template.path[pointIndex], template.path[pointIndex + 1], scaled - pointIndex)
  const previous = template.path[Math.max(0, pointIndex - 1)]
  const next = template.path[Math.min(template.path.length - 1, pointIndex + 1)]
  const altitude = point.altitudeFt
  const previousAltitude = previous.altitudeFt
  const nextAltitude = next.altitudeFt
  const verticalRateFpm = altitude == null || previousAltitude == null || nextAltitude == null
    ? null
    : Math.round((nextAltitude - previousAltitude) * 30)
  const category = /^(B74|B76|B77F|A30B|A306|DC10|MD11)/.test(template.aircraftType || '')
    ? 'Cargo'
    : /^(H|R22|R44|AS50|AS55|EC)/.test(template.aircraftType || '')
      ? 'Helicopter'
      : 'Passenger'
  const isGround = altitude != null && altitude < 1000
  const id = `replay-${template.icao24}-${index}-${Math.abs(template.startTime)}`

  return {
    id,
    icao24: template.icao24,
    callsign: template.callsign,
    originCountry: null,
    airline: template.airline,
    category,
    longitude: Number(point.longitude.toFixed(5)),
    latitude: Number(point.latitude.toFixed(5)),
    altitudeFt: altitude,
    onGround: isGround,
    speedKt: 250 + Math.round(seededNumber(`${template.flightId}:speed`) * 220),
    heading: Math.round(bearing(point, next)) % 360,
    verticalRateFpm,
    squawk: template.squawk,
    lastSeenSeconds: 0,
    registration: template.registration,
    aircraftType: template.model || template.aircraftType,
    aircraftTypeCode: template.aircraftType,
    categoryCode: template.categoryCode,
    isHelicopter: category === 'Helicopter',
    origin: template.origin,
    destination: template.destination,
    routeCoordinates: route,
    routeProgress: progress,
    routeDurationSeconds: replayDuration,
    routeProgressUpdatedAt: nowSeconds,
    isDemo: true,
    replaySource: 'adsb.aero historical ADS-B track',
    recordedFlightDate: template.startTime ? new Date(template.startTime * 1000).toISOString() : null,
  }
}

function insideBounds(item, bounds) {
  const insideLongitude = bounds.lomin <= bounds.lomax
    ? item.longitude >= bounds.lomin && item.longitude <= bounds.lomax
    : item.longitude >= bounds.lomin || item.longitude <= bounds.lomax
  return item.latitude >= bounds.lamin && item.latitude <= bounds.lamax && insideLongitude
}

export async function generateDemoAircraft(bounds, count = 1000) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const templates = await getTemplates()
  const aircraft = templates
    .slice(0, Math.max(count * 2, count))
    .map((template, index) => replayFlight(template, index, nowSeconds))
    .filter((item) => insideBounds(item, bounds))
    .slice(0, count)

  return {
    source: 'AeroTrace Historical Flight Replay · adsb.aero',
    mode: 'demo',
    time: nowSeconds,
    aircraft,
    totalSimulated: aircraft.length,
    historicalTemplatesAvailable: templates.length,
    replayOnly: true,
  }
}
