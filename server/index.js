
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.API_PORT || 3000)
const OPENSKY_API = 'https://opensky-network.org/api'
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

const ADSBDB_API = 'https://api.adsbdb.com/v0'

const CACHE_TTL_MS = 10_000
const DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_POINTS_PER_AIRCRAFT = 5000
const MIN_TRACK_DISTANCE_METERS = 100
const MIN_TRACK_INTERVAL_SECONDS = 15
const MAX_TRACKED_AIRCRAFT = 10_000
const MAX_DETAILS_CACHE_SIZE = 2000

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')
const TRACKS_FILE = join(DATA_DIR, 'tracks.json')

let cachedToken = null
let tokenExpiresAt = 0

const aircraftCache = new Map()
const aircraftDetailsCache = new Map()

let tracks = {}
let trackWriteQueue = Promise.resolve()

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  response.end(JSON.stringify(body))
}

function getBounds(url) {
  const names = ['lamin', 'lamax', 'lomin', 'lomax']

  const values = Object.fromEntries(
    names.map((name) => [name, Number(url.searchParams.get(name))]),
  )

  if (
    names.some((name) => url.searchParams.get(name) === null) ||
    Object.values(values).some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Provide valid lamin, lamax, lomin, and lomax bounds.')
  }

  const { lamin, lamax, lomin, lomax } = values

  if (
    lamin < -90 ||
    lamax > 90 ||
    lamin >= lamax ||
    lomin < -180 ||
    lomin >= 180 ||
    lomax < -180 ||
    lomax > 180 ||
    lomin >= lomax
  ) {
    throw new Error('Geographic bounds are outside the supported range.')
  }

  return values
}

async function loadTracks() {
  await mkdir(DATA_DIR, { recursive: true })

  try {
    const saved = await readFile(TRACKS_FILE, 'utf8')
    const parsed = JSON.parse(saved)

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      tracks = parsed
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[AeroTrace tracks] Could not load history:', error)
    }
  }
}

function persistTracks() {
  // Serialize writes so overlapping requests cannot corrupt the JSON file.
  trackWriteQueue = trackWriteQueue
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true })

      const temporaryFile = `${TRACKS_FILE}.tmp`

      await writeFile(temporaryFile, JSON.stringify(tracks), 'utf8')
      await rename(temporaryFile, TRACKS_FILE)
    })
    .catch((error) => {
      console.error('[AeroTrace tracks] Could not save history:', error)
    })

  return trackWriteQueue
}

function distanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180

  const lat1 = radians(a.latitude)
  const lat2 = radians(b.latitude)
  const dLat = lat2 - lat1
  const dLon = radians(b.longitude - a.longitude)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2

  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

async function recordAircraftPositions(aircraft) {
  let changed = false

  for (const item of aircraft) {
    const timestamp =
      Math.floor(Date.now() / 1000) - (item.lastSeenSeconds ?? 0)

    const point = {
      time: timestamp,
      longitude: item.longitude,
      latitude: item.latitude,
      onGround: item.onGround,
      heading: item.heading,
      altitudeFt: item.altitudeFt,
    }

    const history = tracks[item.id] ?? {
      icao24: item.icao24,
      callsign: item.callsign,
      points: [],
    }

    history.callsign = item.callsign || history.callsign

    const previous = history.points[history.points.length - 1]

    if (previous) {
      const elapsed = timestamp - previous.time
      const distance = distanceMeters(previous, point)

      // Skip repeated positions unless enough time has elapsed.
      if (
        elapsed < MIN_TRACK_INTERVAL_SECONDS &&
        distance < MIN_TRACK_DISTANCE_METERS
      ) {
        tracks[item.id] = history
        continue
      }
    }

    history.points.push(point)

    if (history.points.length > MAX_POINTS_PER_AIRCRAFT) {
      history.points.splice(
        0,
        history.points.length - MAX_POINTS_PER_AIRCRAFT,
      )
    }

    tracks[item.id] = history
    changed = true
  }

  // Bound the number of aircraft retained in this local JSON store.
  const ids = Object.keys(tracks)

  if (ids.length > MAX_TRACKED_AIRCRAFT) {
    const oldest = ids
      .sort((a, b) => {
        const aPoints = tracks[a]?.points ?? []
        const bPoints = tracks[b]?.points ?? []

        return (
          (aPoints[aPoints.length - 1]?.time ?? 0) -
          (bPoints[bPoints.length - 1]?.time ?? 0)
        )
      })
      .slice(0, ids.length - MAX_TRACKED_AIRCRAFT)

    for (const id of oldest) {
      delete tracks[id]
      changed = true
    }
  }

  if (changed) {
    await persistTracks()
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken
  }

  const clientId = process.env.OPENSKY_CLIENT_ID
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    const error = new Error('OpenSky credentials are not configured.')
    error.statusCode = 503
    throw error
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const error = new Error(
      response.status === 401 || response.status === 403
        ? 'OpenSky rejected the credentials. Check your client ID and secret.'
        : `OpenSky authentication failed (${response.status}).`,
    )

    error.statusCode = response.status === 429 ? 429 : 502
    throw error
  }

  const data = await response.json()

  if (!data.access_token || !Number.isFinite(data.expires_in)) {
    const error = new Error(
      'OpenSky returned an invalid authentication response.',
    )

    error.statusCode = 502
    throw error
  }

  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + data.expires_in * 1000

  return cachedToken
}

function normalizeState(state, nowSeconds) {
  const [
    icao24,
    rawCallsign,
    originCountry,
    timePosition,
    lastContact,
    longitude,
    latitude,
    baroAltitude,
    onGround,
    velocity,
    trueTrack,
    verticalRate,
    ,
    geoAltitude,
    squawk,
  ] = state

  if (
    typeof icao24 !== 'string' ||
    !/^[a-f0-9]{6}$/i.test(icao24) ||
    typeof longitude !== 'number' ||
    typeof latitude !== 'number' ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    return null
  }

  const contactTime =
    typeof lastContact === 'number' ? lastContact : timePosition

  return {
    id: icao24.toLowerCase(),
    icao24: icao24.toLowerCase(),
    callsign:
      typeof rawCallsign === 'string' ? rawCallsign.trim() : '',
    originCountry:
      typeof originCountry === 'string' ? originCountry : null,
    longitude,
    latitude,
    altitudeFt:
      typeof baroAltitude === 'number'
        ? Math.round(baroAltitude * 3.28084)
        : typeof geoAltitude === 'number'
          ? Math.round(geoAltitude * 3.28084)
          : null,
    onGround: typeof onGround === 'boolean' ? onGround : null,
    speedKt:
      typeof velocity === 'number'
        ? Math.round(velocity * 1.943844)
        : null,
    heading:
      typeof trueTrack === 'number'
        ? Math.round(trueTrack) % 360
        : null,
    verticalRateFpm:
      typeof verticalRate === 'number'
        ? Math.round(verticalRate * 196.8504)
        : null,
    squawk: typeof squawk === 'string' ? squawk : null,
    lastSeenSeconds:
      typeof contactTime === 'number'
        ? Math.max(0, Math.round(nowSeconds - contactTime))
        : null,
  }
}

async function fetchAircraft(bounds) {
  const token = await getAccessToken()

  const query = new URLSearchParams({
    lamin: String(bounds.lamin),
    lamax: String(bounds.lamax),
    lomin: String(bounds.lomin),
    lomax: String(bounds.lomax),
  })

  const response = await fetch(
    `${OPENSKY_API}/states/all?${query}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    const error = new Error(
      response.status === 429
        ? 'OpenSky rate limit or API credit limit reached. Try again later.'
        : `OpenSky aircraft request failed (${response.status}).`,
    )

    error.statusCode = response.status === 429 ? 429 : 502
    throw error
  }

  const payload = await response.json()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const states = Array.isArray(payload.states) ? payload.states : []

  return {
    source: 'OpenSky Network',
    time: typeof payload.time === 'number' ? payload.time : nowSeconds,
    aircraft: states
      .map((state) => normalizeState(state, nowSeconds))
      .filter(Boolean),
  }
}

function airportLabel(airport) {
  if (!airport || typeof airport !== 'object') return null

  const name = airport.name || airport.municipality || null
  const code = airport.icao_code || airport.iata_code || null

  if (name && code) return `${name} (${code})`
  return name || code || null
}

function getCachedDetails(key) {
  const entry = aircraftDetailsCache.get(key)

  if (!entry) return null

  if (Date.now() - entry.cachedAt >= DETAILS_CACHE_TTL_MS) {
    aircraftDetailsCache.delete(key)
    return null
  }

  // Move recently used entries to the end of the Map.
  aircraftDetailsCache.delete(key)
  aircraftDetailsCache.set(key, entry)

  return entry.data
}

function saveDetails(key, data) {
  aircraftDetailsCache.delete(key)
  aircraftDetailsCache.set(key, {
    data,
    cachedAt: Date.now(),
  })

  while (aircraftDetailsCache.size > MAX_DETAILS_CACHE_SIZE) {
    const oldestKey = aircraftDetailsCache.keys().next().value
    if (oldestKey === undefined) break
    aircraftDetailsCache.delete(oldestKey)
  }
}

function sendUnavailableDetails(response, statusCode, message) {
  return sendJson(response, statusCode, {
    registration: null,
    aircraftType: null,
    airline: null,
    origin: null,
    destination: null,
    routeAvailable: false,
    error: message,
  })
}

await loadTracks()

const server = createServer(async (request, response) => {
  let url

  try {
    url = new URL(request.url || '/', `http://localhost:${PORT}`)
  } catch {
    return sendJson(response, 400, { error: 'Invalid request URL.' })
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, {
      status: 'ok',
      credentialsConfigured: Boolean(
        process.env.OPENSKY_CLIENT_ID &&
          process.env.OPENSKY_CLIENT_SECRET,
      ),
    })
  }

  if (
    request.method === 'GET' &&
    url.pathname.startsWith('/api/tracks/')
  ) {
    let icao24

    try {
      icao24 = decodeURIComponent(
        url.pathname.slice('/api/tracks/'.length),
      ).toLowerCase()
    } catch {
      return sendJson(response, 400, { error: 'Invalid aircraft ID.' })
    }

    if (!/^[a-f0-9]{6}$/.test(icao24)) {
      return sendJson(response, 400, {
        error: 'A valid six-character ICAO24 address is required.',
      })
    }

    const history = tracks[icao24]

    return sendJson(response, 200, {
      icao24,
      callsign: history?.callsign ?? null,
      points: history?.points ?? [],
      source: 'AeroTrace recorded history',
    })
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/aircraft-details'
  ) {
    const icao24 = (
      url.searchParams.get('icao24') || ''
    ).trim().toLowerCase()

    const callsign = (
      url.searchParams.get('callsign') || ''
    ).trim().toUpperCase()

    if (!/^[a-f0-9]{6}$/.test(icao24)) {
      return sendJson(response, 400, {
        error: 'A valid six-character ICAO24 address is required.',
      })
    }

    if (callsign.length > 16 || /[^A-Z0-9-]/.test(callsign)) {
      return sendJson(response, 400, {
        error: 'Invalid aircraft callsign.',
      })
    }

    const cacheKey = `${icao24}:${callsign}`
    const cached = getCachedDetails(cacheKey)

    if (cached) {
      return sendJson(response, 200, {
        ...cached,
        cached: true,
      })
    }

    try {
      // Query by ICAO24 for aircraft identity. Callsign-specific route
      // data is not guaranteed by every metadata provider response.
      const upstream = await fetch(
        `${ADSBDB_API}/aircraft/${encodeURIComponent(icao24)}`,
        {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        },
      )

      if (upstream.status === 404) {
        const data = {
          registration: null,
          aircraftType: null,
          airline: null,
          origin: null,
          destination: null,
          routeAvailable: false,
        }

        saveDetails(cacheKey, data)

        return sendJson(response, 200, {
          ...data,
          cached: false,
        })
      }

      if (!upstream.ok) {
        return sendUnavailableDetails(
          response,
          502,
          `Aircraft metadata provider returned ${upstream.status}.`,
        )
      }

      const payload = await upstream.json()
      const record = payload?.response ?? {}
      const aircraftInfo = record.aircraft ?? {}

      // Route lookup is a separate request using the callsign.
      let route = null

      if (callsign) {
        try {
          const routeResponse = await fetch(
            `${ADSBDB_API}/callsign/${encodeURIComponent(callsign)}`,
            {
              signal: AbortSignal.timeout(8000),
              headers: { Accept: 'application/json' },
            },
          )

          if (routeResponse.ok) {
            const routePayload = await routeResponse.json()
            route = routePayload?.response?.flightroute ?? null
          }
        } catch (error) {
          console.warn(
            '[AeroTrace route lookup]',
            error instanceof Error ? error.message : error,
          )
        }
      }

      const airlineInfo = route?.airline ?? {}

      const data = {
        registration: aircraftInfo.registration || null,
        aircraftType:
          [
            aircraftInfo.icao_type,
            aircraftInfo.type,
          ].filter(Boolean).join(' · ') || null,
        airline:
          airlineInfo.name ||
          aircraftInfo.registered_owner ||
          null,
        origin: airportLabel(route?.origin),
        destination: airportLabel(route?.destination),
        routeAvailable: Boolean(route?.origin && route?.destination),
      }

      saveDetails(cacheKey, data)

      return sendJson(response, 200, {
        ...data,
        cached: false,
      })
    } catch (error) {
      console.error(
        '[AeroTrace aircraft details]',
        error instanceof Error ? error.message : error,
      )

      return sendUnavailableDetails(
        response,
        502,
        'Aircraft details are temporarily unavailable.',
      )
    }
  }

  if (request.method !== 'GET' || url.pathname !== '/api/aircraft') {
    return sendJson(response, 404, { error: 'Endpoint not found.' })
  }

  let bounds

  try {
    bounds = getBounds(url)
  } catch (error) {
    return sendJson(response, 400, { error: error.message })
  }

  // Reuse data for nearby map bounds rounded to one decimal place.
  const cacheKey = [
    bounds.lamin,
    bounds.lamax,
    bounds.lomin,
    bounds.lomax,
  ]
    .map((value) => value.toFixed(1))
    .join(':')

  const cached = aircraftCache.get(cacheKey)

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return sendJson(response, 200, {
      ...cached.data,
      cached: true,
    })
  }

  try {
    const data = await fetchAircraft(bounds)

    await recordAircraftPositions(data.aircraft)

    aircraftCache.set(cacheKey, {
      data,
      cachedAt: Date.now(),
    })

    if (aircraftCache.size > 100) {
      const oldestKey = aircraftCache.keys().next().value
      if (oldestKey) aircraftCache.delete(oldestKey)
    }

    return sendJson(response, 200, {
      ...data,
      cached: false,
    })
  } catch (error) {
    console.error(
      '[AeroTrace API]',
      error instanceof Error ? error.message : error,
    )

    return sendJson(response, error.statusCode || 502, {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to retrieve aircraft data.',
    })
  }
})

server.listen(PORT, () => {
  console.log(`AeroTrace API listening on http://localhost:${PORT}`)
})
