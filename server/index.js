
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDemoAircraft } from './recorded-demo.js'

const PORT = Number(process.env.PORT || process.env.API_PORT || 3000)

const AEROTRACE_MODE = ['demo', 'dev', 'hybrid'].includes(
  (process.env.AEROTRACE_MODE || 'live').trim().toLowerCase(),
) ? (['dev'].includes((process.env.AEROTRACE_MODE || '').trim().toLowerCase()) ? 'demo' : (process.env.AEROTRACE_MODE || '').trim().toLowerCase()) : 'live'
const DEMO_AIRCRAFT_COUNT = Math.max(
  100,
  Math.min(3000, Number.parseInt(process.env.DEMO_AIRCRAFT_COUNT || '1000', 10) || 1000),
)

const OPENSKY_API = 'https://opensky-network.org/api'
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

const ADSBDB_API = 'https://api.adsbdb.com/v0'
const ADSB_LOL_API = 'https://api.adsb.lol'

const CACHE_TTL_MS = 15_000
const HYBRID_CACHE_TTL_MS = 30_000
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000
const TIMEOUT_COOLDOWN_MS = 60_000
const DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000
// OpenSky track waypoints update much less frequently than the live state feed.
// Cache them to avoid spending track API credits on every map poll.
const OPENSKY_TRACK_CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_POINTS_PER_AIRCRAFT = 5000
const MIN_TRACK_DISTANCE_METERS = 100
const MIN_TRACK_INTERVAL_SECONDS = 15
const TAKEOFF_TRACK_SPEED_KT = 70
const LANDING_TRACK_STOP_SPEED_KT = 45
const AIRBORNE_TRACK_ALTITUDE_FT = 150
const MAX_TRACKED_AIRCRAFT = 10_000
const MAX_DETAILS_CACHE_SIZE = 2000
const MAX_PHOTO_CACHE_SIZE = 2000
const AIRCRAFT_TYPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TYPE_LOOKUPS_PER_MINUTE = 24

const AISSTREAM_API = 'wss://stream.aisstream.io/v0/stream'
const AISSTREAM_MAX_VESSELS = 25_000
const AISSTREAM_STALE_MS = 10 * 60_000

const vesselCache = new Map()
let aisStreamSocket = null
let aisStreamReconnectTimer = null
let aisStreamBoundsKey = ''
let aisStreamConnecting = false

function normalizeVesselType(type) {
  const code = Number(type)
  if (!Number.isFinite(code)) return 'Unknown'

  if (code >= 70 && code <= 79) return 'Cargo'
  if (code >= 80 && code <= 89) return 'Tanker'
  if (code === 60 || code === 61 || code === 62 || code === 63 || code === 64 || code === 65 || code === 69) return 'Passenger'
  if (code >= 30 && code <= 39) return 'Tug / Special'
  if (code >= 36 && code <= 37) return 'Sailing / Pleasure'
  if (code === 30) return 'Fishing'
  return 'Other'
}

function vesselFromPositionReport(message) {
  const report = message?.PositionReport ?? message?.positionReport
  if (!report) return null

  const mmsi = Number(report.UserID ?? report.userId)
  const latitude = Number(report.Latitude ?? report.latitude)
  const longitude = Number(report.Longitude ?? report.longitude)

  if (
    !Number.isInteger(mmsi) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  const existing = vesselCache.get(String(mmsi)) ?? {
    mmsi: String(mmsi),
    name: null,
    imo: null,
    callsign: null,
    vesselType: 'Unknown',
    vesselTypeCode: null,
    destination: null,
    draughtM: null,
  }

  const sog = Number(report.Sog ?? report.sog)
  const cog = Number(report.Cog ?? report.cog)
  const heading = Number(report.TrueHeading ?? report.trueHeading)

  existing.latitude = latitude
  existing.longitude = longitude
  existing.speedKt = Number.isFinite(sog) && sog >= 0 ? sog : null
  existing.course = Number.isFinite(cog) && cog >= 0 ? cog : null
  existing.heading = Number.isFinite(heading) && heading >= 0 && heading < 360 ? heading : null
  existing.navigationStatus = Number.isFinite(Number(report.NavigationalStatus ?? report.navigationalStatus))
    ? Number(report.NavigationalStatus ?? report.navigationalStatus)
    : null
  existing.lastSeen = Date.now()
  existing.vesselType = existing.vesselType || 'Unknown'

  vesselCache.set(existing.mmsi, existing)

  while (vesselCache.size > AISSTREAM_MAX_VESSELS) {
    const oldest = vesselCache.keys().next().value
    if (oldest === undefined) break
    vesselCache.delete(oldest)
  }

  return existing
}

function applyVesselStaticReport(message) {
  const report = message?.ShipStaticData ?? message?.shipStaticData
  if (!report) return

  const mmsi = Number(report.UserID ?? report.userId)
  if (!Number.isInteger(mmsi)) return

  const key = String(mmsi)
  const existing = vesselCache.get(key) ?? {
    mmsi: key,
    latitude: null,
    longitude: null,
    speedKt: null,
    course: null,
    heading: null,
    navigationStatus: null,
    lastSeen: Date.now(),
  }

  const typeCode = Number(report.Type ?? report.type)
  const name = String(report.Name ?? report.name ?? '').trim()
  const imo = Number(report.ImoNumber ?? report.imoNumber)
  const callsign = String(report.CallSign ?? report.callSign ?? '').trim()
  const destination = String(report.Destination ?? report.destination ?? '').trim()
  const draught = Number(report.MaximumStaticDraught ?? report.maximumStaticDraught)

  existing.name = name || existing.name
  existing.imo = Number.isFinite(imo) && imo > 0 ? String(imo) : existing.imo
  existing.callsign = callsign || existing.callsign
  existing.vesselTypeCode = Number.isFinite(typeCode) ? typeCode : existing.vesselTypeCode
  existing.vesselType = Number.isFinite(typeCode) ? normalizeVesselType(typeCode) : existing.vesselType
  existing.destination = destination || existing.destination
  existing.draughtM = Number.isFinite(draught) && draught > 0 ? draught : existing.draughtM
  existing.lastSeen = Date.now()

  vesselCache.set(key, existing)
}

function scheduleAISStreamReconnect() {
  if (aisStreamReconnectTimer || !process.env.AISSTREAM_API_KEY) return

  aisStreamReconnectTimer = setTimeout(() => {
    aisStreamReconnectTimer = null
    connectAISStream()
  }, 5000)
}

function sendAISStreamSubscription() {
  if (!aisStreamSocket || aisStreamSocket.readyState !== 1) return

  const bounds = aisStreamSubscriptionBounds
  aisStreamSocket.send(JSON.stringify({
    APIKey: process.env.AISSTREAM_API_KEY,
    BoundingBoxes: [[
      [bounds.lamin, bounds.lomin],
      [bounds.lamax, bounds.lomax],
    ]],
    FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
  }))
}

let aisStreamSubscriptionBounds = {
  lamin: -90,
  lamax: 90,
  lomin: -180,
  lomax: 180,
}

function connectAISStream() {
  if (!process.env.AISSTREAM_API_KEY || aisStreamConnecting) return
  if (aisStreamSocket?.readyState === 1 || aisStreamSocket?.readyState === 0) return

  if (typeof globalThis.WebSocket !== 'function') {
    console.error('[AeroTrace AIS] WebSocket is unavailable in this Node runtime.')
    return
  }

  aisStreamConnecting = true
  const socket = new globalThis.WebSocket(AISSTREAM_API)
  aisStreamSocket = socket

  socket.addEventListener('open', () => {
    aisStreamConnecting = false
    console.log('[AeroTrace AIS] Connected to AISStream.')
    sendAISStreamSubscription()
  })

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data))
      const messageType = payload?.MessageType
      if (messageType === 'PositionReport') {
        vesselFromPositionReport(payload.Message)
      } else if (messageType === 'ShipStaticData') {
        applyVesselStaticReport(payload.Message)
      }
    } catch (error) {
      console.warn('[AeroTrace AIS] Invalid stream message:', error instanceof Error ? error.message : error)
    }
  })

  socket.addEventListener('error', (event) => {
    console.warn('[AeroTrace AIS] Stream error:', event?.message || 'WebSocket error')
  })

  socket.addEventListener('close', () => {
    aisStreamConnecting = false
    if (aisStreamSocket === socket) aisStreamSocket = null
    console.warn('[AeroTrace AIS] Stream disconnected; retrying in 5 seconds.')
    scheduleAISStreamReconnect()
  })
}

function setAISStreamBounds(bounds) {
  const normalized = {
    lamin: Math.max(-90, Math.min(90, bounds.lamin)),
    lamax: Math.max(-90, Math.min(90, bounds.lamax)),
    lomin: Math.max(-180, Math.min(180, bounds.lomin)),
    lomax: Math.max(-180, Math.min(180, bounds.lomax)),
  }

  const key = Object.values(normalized).map((value) => value.toFixed(2)).join(':')
  if (key === aisStreamBoundsKey) return
  aisStreamBoundsKey = key
  aisStreamSubscriptionBounds = normalized

  if (aisStreamSocket?.readyState === 1) {
    sendAISStreamSubscription()
  } else {
    connectAISStream()
  }
}

function getVisibleVessels(bounds) {
  const cutoff = Date.now() - AISSTREAM_STALE_MS
  const vessels = []

  for (const [mmsi, vessel] of vesselCache) {
    if (vessel.lastSeen < cutoff) {
      vesselCache.delete(mmsi)
      continue
    }

    if (
      Number.isFinite(vessel.latitude) &&
      Number.isFinite(vessel.longitude) &&
      vessel.latitude >= bounds.lamin &&
      vessel.latitude <= bounds.lamax &&
      vessel.longitude >= bounds.lomin &&
      vessel.longitude <= bounds.lomax
    ) {
      vessels.push(vessel)
    }
  }

  return vessels
}

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST_DIR = join(ROOT_DIR, 'dist')
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')
const TRACKS_FILE = join(DATA_DIR, 'tracks.json')

// Each account has its own token and cooldown.
const accessTokens = new Map()
const accountCooldowns = new Map()

const aircraftCache = new Map()
const aircraftDetailsCache = new Map()
const aircraftTypeCache = new Map()
const aircraftTypeRequestsInFlight = new Map()
const aircraftPhotoCache = new Map()
const aircraftRequestsInFlight = new Map()
const hybridAircraftCache = new Map()
const hybridAircraftRequestsInFlight = new Map()
const openSkyTrackCache = new Map()
const openSkyTrackRequestsInFlight = new Map()

let tracks = {}
let trackWriteQueue = Promise.resolve()
let typeLookupWindowStartedAt = Date.now()
let typeLookupsInWindow = 0

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  response.end(JSON.stringify(body))
}

function getOpenSkyAccounts() {
  const definitions = [
    {
      key: 'primary',
      label: 'primary',
      clientId: process.env.OPENSKY_CLIENT_ID,
      clientSecret: process.env.OPENSKY_CLIENT_SECRET,
    },
    {
      key: 'backup',
      label: 'backup',
      clientId: process.env.OPENSKY_CLIENT_ID_BACKUP,
      clientSecret: process.env.OPENSKY_CLIENT_SECRET_BACKUP,
    },
  ]

  return definitions.filter(
    (account) => account.clientId && account.clientSecret,
  )
}

function getAccountCooldown(accountKey) {
  return accountCooldowns.get(accountKey) || 0
}

function activateAccountCooldown(accountKey, durationMs) {
  accountCooldowns.set(
    accountKey,
    Math.max(
      getAccountCooldown(accountKey),
      Date.now() + durationMs,
    ),
  )
}

function createUnavailableError(message, statusCode = 502) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function createRateLimitError(retryAfterSeconds = 0) {
  const error = createUnavailableError(
    'OpenSky rate limit or API credit limit reached on the available accounts. Please try again later.',
    429,
  )

  error.retryAfterSeconds = retryAfterSeconds

  return error
}

function getRetryAfterSeconds() {
  const now = Date.now()

  const remaining = [...accountCooldowns.values()]
    .map((until) => Math.max(0, until - now))

  return remaining.length
    ? Math.ceil(Math.max(...remaining) / 1000)
    : 0
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
      speedKt: item.speedKt,
      heading: item.heading,
      altitudeFt: item.altitudeFt,
    }

    const history = tracks[item.id] ?? {
      icao24: item.icao24,
      callsign: item.callsign,
      points: [],
      trackingActive: false,
      flightSequence: 0,
    }

    history.callsign = item.callsign || history.callsign
    history.points = Array.isArray(history.points) ? history.points : []
    history.trackingActive = history.trackingActive === true
    history.flightSequence = Number.isInteger(history.flightSequence)
      ? history.flightSequence
      : 0

    const speedKt = Number.isFinite(item.speedKt) ? item.speedKt : null
    const altitudeFt = Number.isFinite(item.altitudeFt) ? item.altitudeFt : null
    const clearlyAirborne =
      item.onGround === false ||
      (altitudeFt != null && altitudeFt >= AIRBORNE_TRACK_ALTITUDE_FT)
    const takeoffRoll =
      item.onGround === true &&
      speedKt != null &&
      speedKt >= TAKEOFF_TRACK_SPEED_KT
    const landedAndSlow =
      item.onGround === true &&
      speedKt != null &&
      speedKt <= LANDING_TRACK_STOP_SPEED_KT

    if (!history.trackingActive) {
      if (!takeoffRoll && !clearlyAirborne) {
        tracks[item.id] = history
        continue
      }

      history.trackingActive = true
      history.flightSequence += 1
    } else if (landedAndSlow) {
      history.trackingActive = false
      tracks[item.id] = history
      changed = true
      continue
    }

    point.flightSequence = history.flightSequence

    // Keep persisted observations in timestamp order, including when an API
    // response contains a slightly older observation than the last saved one.
    history.points.sort((a, b) => a.time - b.time)
    const previous = [...history.points]
      .reverse()
      .find((savedPoint) => savedPoint.flightSequence === history.flightSequence)

    if (previous && timestamp >= previous.time) {
      const elapsed = timestamp - previous.time
      const distance = distanceMeters(previous, point)

      if (
        elapsed < MIN_TRACK_INTERVAL_SECONDS &&
        distance < MIN_TRACK_DISTANCE_METERS
      ) {
        tracks[item.id] = history
        continue
      }
    }

    history.points.push(point)
    history.points.sort((a, b) => a.time - b.time)

    if (history.points.length > MAX_POINTS_PER_AIRCRAFT) {
      history.points.splice(
        0,
        history.points.length - MAX_POINTS_PER_AIRCRAFT,
      )
    }

    tracks[item.id] = history
    changed = true
  }

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

async function fetchOpenSkyTrackPoints(icao24) {
  const cached = openSkyTrackCache.get(icao24)

  if (cached && Date.now() - cached.cachedAt < OPENSKY_TRACK_CACHE_TTL_MS) {
    return cached.points
  }

  const existingRequest = openSkyTrackRequestsInFlight.get(icao24)
  if (existingRequest) return existingRequest

  const request = (async () => {
    const accounts = getOpenSkyAccounts()
    const now = Date.now()

    for (const account of accounts) {
      if (now < getAccountCooldown(account.key)) continue

      try {
        const token = await getAccessToken(account)
        const query = new URLSearchParams({
          icao24,
          time: '0',
        })
        const response = await fetch(
          `${OPENSKY_API}/tracks/all?${query}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )

        if (response.status === 429) {
          activateAccountCooldown(account.key, RATE_LIMIT_COOLDOWN_MS)
          continue
        }

        // A 404 commonly means OpenSky has no active track for this aircraft.
        if (response.status === 404) {
          openSkyTrackCache.set(icao24, { points: [], cachedAt: Date.now() })
          return []
        }

        if (!response.ok) continue

        const payload = await response.json()
        const points = (Array.isArray(payload.path) ? payload.path : [])
          .filter(
            (point) =>
              Array.isArray(point) &&
              Number.isFinite(point[0]) &&
              Number.isFinite(point[1]) &&
              Number.isFinite(point[2]) &&
              point[1] >= -90 &&
              point[1] <= 90 &&
              point[2] >= -180 &&
              point[2] <= 180,
          )
          .map((point) => ({
            time: point[0],
            latitude: point[1],
            longitude: point[2],
            altitudeFt:
              typeof point[3] === 'number'
                ? Math.round(point[3] * 3.28084)
                : null,
            heading: typeof point[4] === 'number' ? point[4] : null,
            onGround: typeof point[5] === 'boolean' ? point[5] : null,
          }))
          .sort((a, b) => a.time - b.time)

        openSkyTrackCache.set(icao24, {
          points,
          cachedAt: Date.now(),
        })
        return points
      } catch (error) {
        const isTimeout =
          error?.name === 'TimeoutError' || error?.name === 'AbortError'

        if (isTimeout) {
          activateAccountCooldown(account.key, TIMEOUT_COOLDOWN_MS)
        }

        const cause =
  error instanceof Error ? error.cause : undefined

console.warn(
  `[AeroTrace OpenSky] ${account.label} account failed:`,
  {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    cause:
      cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            code: cause.code,
            errno: cause.errno,
            syscall: cause.syscall,
            hostname: cause.hostname,
          }
        : cause ?? null,
    stack: error instanceof Error ? error.stack : undefined,
  },
)
      }
    }

    // Cache temporary misses briefly so polling the map cannot hammer OpenSky.
    openSkyTrackCache.set(icao24, {
      points: [],
      cachedAt: Date.now() - OPENSKY_TRACK_CACHE_TTL_MS + 30_000,
    })
    return []
  })()

  openSkyTrackRequestsInFlight.set(icao24, request)

  try {
    return await request
  } finally {
    if (openSkyTrackRequestsInFlight.get(icao24) === request) {
      openSkyTrackRequestsInFlight.delete(icao24)
    }
  }
}

async function getAccessToken(account) {
  const existing = accessTokens.get(account.key)

  if (existing && Date.now() < existing.expiresAt - 60_000) {
    return existing.token
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: account.clientId,
      client_secret: account.clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 429) {
      activateAccountCooldown(
        account.key,
        RATE_LIMIT_COOLDOWN_MS,
      )

      throw createRateLimitError(
        Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000),
      )
    }

    const message =
      response.status === 401 || response.status === 403
        ? `OpenSky rejected the ${account.label} account credentials.`
        : `OpenSky ${account.label} authentication failed (${response.status}).`

    throw createUnavailableError(message, 502)
  }

  const data = await response.json()

  if (!data.access_token || !Number.isFinite(data.expires_in)) {
    throw createUnavailableError(
      `OpenSky returned an invalid token for the ${account.label} account.`,
    )
  }

  accessTokens.set(account.key, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  return data.access_token
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
    ,
    ,
    category,
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
    categoryCode:
      category == null || category === '' || !Number.isFinite(Number(category))
        ? null
        : Number(category),
    isHelicopter: Number(category) === 7,
    lastSeenSeconds:
      typeof contactTime === 'number'
        ? Math.max(0, Math.round(nowSeconds - contactTime))
        : null,
  }
}

async function fetchAircraftAnonymously(bounds) {
  const query = new URLSearchParams({
    lamin: String(bounds.lamin),
    lamax: String(bounds.lamax),
    lomin: String(bounds.lomin),
    lomax: String(bounds.lomax),
    extended: '1',
  })

  console.info('[AeroTrace OpenSky] Trying anonymous aircraft access as a fallback.')

  const response = await fetch(
    `${OPENSKY_API}/states/all?${query}`,
    {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    if (response.status === 429) {
      throw createRateLimitError(60)
    }

    throw createUnavailableError(
      `OpenSky anonymous aircraft request failed (${response.status}).`,
      502,
    )
  }

  const payload = await response.json()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const states = Array.isArray(payload.states) ? payload.states : []

  console.info(
    `[AeroTrace OpenSky] Anonymous aircraft access succeeded with ${states.length} state records.`,
  )

  return {
    source: 'OpenSky Network (anonymous)',
    time: typeof payload.time === 'number' ? payload.time : nowSeconds,
    aircraft: states
      .map((state) => normalizeState(state, nowSeconds))
      .filter(Boolean),
  }
}


function normalizeAdsbLolAircraft(item, nowSeconds) {
  const hex = typeof item?.hex === 'string' ? item.hex.trim().toLowerCase() : ''
  const longitude = Number(item?.lon)
  const latitude = Number(item?.lat)

  if (
    !/^[a-f0-9]{6}$/.test(hex) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }

  const rawAltitude = item.alt_baro
  const altitude =
    typeof rawAltitude === 'number'
      ? rawAltitude
      : typeof item.alt_geom === 'number'
        ? item.alt_geom
        : null
  const seen = Number(item.seen_pos ?? item.seen)

  return {
    id: hex,
    icao24: hex,
    callsign: typeof item.flight === 'string' ? item.flight.trim() : '',
    originCountry: null,
    airline: typeof item.ownop === 'string' && item.ownop.trim() ? item.ownop.trim() : null,
    longitude,
    latitude,
    registration: typeof item.r === 'string' && item.r.trim() ? item.r.trim().toUpperCase() : null,
    aircraftType: typeof item.t === 'string' && item.t.trim() ? item.t.trim().toUpperCase() : null,
    aircraftTypeCode: typeof item.t === 'string' && item.t.trim() ? item.t.trim().toUpperCase() : null,
    altitudeFt: altitude === null ? null : Math.round(altitude),
    onGround: rawAltitude === 'ground' || item.ground === true ? true : (typeof rawAltitude === 'number' || typeof item.alt_geom === 'number' ? false : null),
    speedKt: typeof item.gs === 'number' && Number.isFinite(item.gs) ? Math.round(item.gs) : null,
    heading:
      typeof item.track === 'number' && Number.isFinite(item.track)
        ? ((Math.round(item.track) % 360) + 360) % 360
        : null,
    verticalRateFpm:
      typeof item.baro_rate === 'number'
        ? Math.round(item.baro_rate)
        : typeof item.geom_rate === 'number'
          ? Math.round(item.geom_rate)
          : null,
    squawk: typeof item.squawk === 'string' ? item.squawk : null,
    categoryCode:
      item.category != null && Number.isFinite(Number(item.category))
        ? Number(item.category)
        : null,
    category: typeof item.category === 'string' ? item.category : null,
    isHelicopter:
      Number(item.category) === 7 ||
      (typeof item.t === 'string' && /^(H|R22|R44|R66|AS3|AS5|EC|AW|UH|CH)/i.test(item.t)),
    lastSeenSeconds: Number.isFinite(seen) ? Math.max(0, Math.round(seen)) : null,
  }
}

async function fetchAircraftFromAdsbLol(bounds) {
  const latSpan = bounds.lamax - bounds.lamin
  const lonSpan = bounds.lomax - bounds.lomin
  const centerLat = (bounds.lamin + bounds.lamax) / 2
  const centerLon = (bounds.lomin + bounds.lomax) / 2

  // The public ADSB.lol radius endpoint supports up to 250 nautical miles.
  // Use a small viewport-aware grid to cover ordinary map views without
  // generating hundreds of upstream requests when the map is zoomed out.
  const rows = Math.min(3, Math.max(1, Math.ceil(latSpan / 6)))
  const columns = Math.min(3, Math.max(1, Math.ceil(lonSpan / 6)))
  const points = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({
        lat: rows === 1
          ? centerLat
          : bounds.lamin + ((row + 0.5) / rows) * latSpan,
        lon: columns === 1
          ? centerLon
          : bounds.lomin + ((column + 0.5) / columns) * lonSpan,
      })
    }
  }

  const uniqueAircraft = new Map()
  let newestTimestamp = 0
  let successfulRequests = 0
  const failures = []

  console.info(
    `[AeroTrace ADSB.lol] Trying fallback for viewport using ${points.length} radius request(s).`,
  )

  // Limit concurrency to reduce pressure on this community-run free service.
  for (let offset = 0; offset < points.length; offset += 3) {
    const batch = points.slice(offset, offset + 3)
    const results = await Promise.allSettled(
      batch.map(async (point) => {
        const endpoint =
          `${ADSB_LOL_API}/v2/lat/${point.lat.toFixed(4)}/lon/${point.lon.toFixed(4)}/dist/250`
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        if (!response.ok) {
          throw createUnavailableError(
            `ADSB.lol aircraft request failed (${response.status}).`,
            response.status === 429 ? 429 : 502,
          )
        }

        const payload = await response.json()
        if (!Array.isArray(payload.ac)) {
          throw createUnavailableError('ADSB.lol returned an unexpected response.')
        }

        successfulRequests += 1
        if (typeof payload.now === 'number') {
          newestTimestamp = Math.max(newestTimestamp, Math.floor(payload.now / 1000))
        }

        for (const rawAircraft of payload.ac) {
          const aircraft = normalizeAdsbLolAircraft(rawAircraft, Math.floor(Date.now() / 1000))
          if (aircraft) {
            const existing = uniqueAircraft.get(aircraft.id)
            if (!existing || (aircraft.lastSeenSeconds ?? Infinity) < (existing.lastSeenSeconds ?? Infinity)) {
              uniqueAircraft.set(aircraft.id, aircraft)
            }
          }
        }
      }),
    )

    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
  }

  if (successfulRequests === 0) {
    const error = failures[0] || createUnavailableError('ADSB.lol did not return aircraft data.')
    console.warn('[AeroTrace ADSB.lol] Fallback failed:', {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      code: error?.cause?.code,
    })
    throw error
  }

  const aircraft = [...uniqueAircraft.values()]
  console.info(
    `[AeroTrace ADSB.lol] Fallback succeeded: ${aircraft.length} unique aircraft from ${successfulRequests}/${points.length} request(s).`,
  )

  return {
    source: 'ADSB.lol',
    time: newestTimestamp || Math.floor(Date.now() / 1000),
    aircraft,
  }
}


async function fetchAircraftFromAirplanesLive(bounds) {
  const centerLat = (bounds.lamin + bounds.lamax) / 2
  const centerLon = (bounds.lomin + bounds.lomax) / 2
  const endpoint =
    `https://api.airplanes.live/v2/point/${centerLat.toFixed(4)}/${centerLon.toFixed(4)}/250`

  console.info('[AeroTrace Airplanes.live] Trying independent live aircraft provider.')

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AeroTrace/0.1 (live aircraft map)',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw createUnavailableError(
      `Airplanes.live aircraft request failed (${response.status}).`,
      response.status === 429 ? 429 : 502,
    )
  }

  const payload = await response.json()
  if (!Array.isArray(payload.ac)) {
    throw createUnavailableError('Airplanes.live returned an unexpected response.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const aircraft = payload.ac
    .map((item) => normalizeAdsbLolAircraft(item, nowSeconds))
    .filter(Boolean)

  console.info(
    `[AeroTrace Airplanes.live] Fallback succeeded with ${aircraft.length} aircraft.`,
  )

  return {
    source: 'Airplanes.live',
    time:
      typeof payload.now === 'number'
        ? Math.floor(payload.now / 1000)
        : nowSeconds,
    aircraft,
  }
}


async function fetchAircraftFromAdsbFi(bounds) {
  const centerLat = (bounds.lamin + bounds.lamax) / 2
  const centerLon = (bounds.lomin + bounds.lomax) / 2
  const endpoint =
    `https://opendata.adsb.fi/api/v3/lat/${centerLat.toFixed(4)}/lon/${centerLon.toFixed(4)}/dist/250`

  console.info('[AeroTrace ADSB.fi] Trying public open-data aircraft provider.')

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AeroTrace/0.1 (aircraft tracking map)',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw createUnavailableError(
      `ADSB.fi aircraft request failed (${response.status}).`,
      response.status === 429 ? 429 : 502,
    )
  }

  const payload = await response.json()
  if (!Array.isArray(payload.ac)) {
    throw createUnavailableError('ADSB.fi returned an unexpected response.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const aircraft = payload.ac
    .map((item) => normalizeAdsbLolAircraft(item, nowSeconds))
    .filter(Boolean)

  console.info(
    `[AeroTrace ADSB.fi] Fallback succeeded with ${aircraft.length} aircraft.`,
  )

  return {
    source: 'ADSB.fi',
    time:
      typeof payload.now === 'number'
        ? Math.floor(payload.now / 1000)
        : nowSeconds,
    aircraft,
  }
}

async function fetchAircraftFromAccount(bounds, account) {
  const token = await getAccessToken(account)

  const query = new URLSearchParams({
    lamin: String(bounds.lamin),
    lamax: String(bounds.lamax),
    lomin: String(bounds.lomin),
    lomax: String(bounds.lomax),
    extended: '1',
  })

  const response = await fetch(
    `${OPENSKY_API}/states/all?${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    if (response.status === 429) {
      activateAccountCooldown(
        account.key,
        RATE_LIMIT_COOLDOWN_MS,
      )

      throw createRateLimitError(
        Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000),
      )
    }

    throw createUnavailableError(
      `OpenSky ${account.label} aircraft request failed (${response.status}).`,
      502,
    )
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

async function fetchAircraft(bounds) {
  const accounts = getOpenSkyAccounts()

  if (accounts.length === 0) {
    console.warn(
      '[AeroTrace OpenSky] No credentials configured; trying anonymous access before ADSB.lol.',
    )
    try {
      return await fetchAircraftAnonymously(bounds)
    } catch (anonymousError) {
      console.warn(
        '[AeroTrace OpenSky] Anonymous access failed; trying ADSB.lol.',
        anonymousError instanceof Error ? anonymousError.message : anonymousError,
      )
    }

    try {
      return await fetchAircraftFromAdsbLol(bounds)
    } catch (adsbLolError) {
      console.warn(
        '[AeroTrace ADSB.lol] Fallback failed; trying Airplanes.live.',
        adsbLolError instanceof Error ? adsbLolError.message : adsbLolError,
      )
      try {
        return await fetchAircraftFromAirplanesLive(bounds)
      } catch (airplanesLiveError) {
        console.warn(
          '[AeroTrace Airplanes.live] Fallback failed; trying ADSB.fi.',
          airplanesLiveError instanceof Error ? airplanesLiveError.message : airplanesLiveError,
        )
        return fetchAircraftFromAdsbFi(bounds)
      }
    }
  }

  const now = Date.now()
  const errors = []
  let attemptedAccount = false

  // Try the primary first, then the backup.
  for (const account of accounts) {
    const cooldownUntil = getAccountCooldown(account.key)

    if (now < cooldownUntil) {
      errors.push({
        account: account.label,
        error: createRateLimitError(
          Math.ceil((cooldownUntil - now) / 1000),
        ),
      })

      console.warn(
        `[AeroTrace OpenSky] Skipping ${account.label} account; ` +
          `cooldown has ${Math.ceil((cooldownUntil - now) / 1000)} seconds remaining.`,
      )

      continue
    }

    attemptedAccount = true

    try {
      const data = await fetchAircraftFromAccount(bounds, account)

      console.info(
        `[AeroTrace OpenSky] Aircraft data retrieved using ${account.label} account.`,
      )

      return data
    } catch (error) {
      const isTimeout =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError'

      if (isTimeout) {
        activateAccountCooldown(
          account.key,
          TIMEOUT_COOLDOWN_MS,
        )
      }

      errors.push({
        account: account.label,
        error,
      })

      const cause =
        error instanceof Error ? error.cause : undefined

      console.warn(
        `[AeroTrace OpenSky] ${account.label} account failed:`,
        {
          name: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
          cause:
            cause instanceof Error
              ? {
                  name: cause.name,
                  message: cause.message,
                  code: cause.code,
                  errno: cause.errno,
                  syscall: cause.syscall,
                  hostname: cause.hostname,
                }
              : cause ?? null,
          stack: error instanceof Error ? error.stack : undefined,
        },
      )

      // Continue to the next configured account automatically.
    }
  }

  // If authenticated OpenSky requests failed, try its anonymous endpoint and
  // then the independent ADSB.lol provider. This also covers rejected or
  // unavailable credentials, not only connection timeouts.
  if (errors.length > 0) {
    try {
      return await fetchAircraftAnonymously(bounds)
    } catch (fallbackError) {
      console.warn(
        '[AeroTrace OpenSky] Anonymous fallback failed; trying ADSB.lol.',
        {
          name:
            fallbackError instanceof Error
              ? fallbackError.name
              : typeof fallbackError,
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          cause:
            fallbackError instanceof Error &&
            fallbackError.cause instanceof Error
              ? {
                  name: fallbackError.cause.name,
                  message: fallbackError.cause.message,
                  code: fallbackError.cause.code,
                }
              : null,
        },
      )
      errors.push({ account: 'anonymous fallback', error: fallbackError })
    }

    try {
      return await fetchAircraftFromAdsbLol(bounds)
    } catch (alternativeError) {
      console.warn(
        '[AeroTrace ADSB.lol] Alternative provider failed:',
        {
          name:
            alternativeError instanceof Error
              ? alternativeError.name
              : typeof alternativeError,
          message:
            alternativeError instanceof Error
              ? alternativeError.message
              : String(alternativeError),
          cause:
            alternativeError instanceof Error &&
            alternativeError.cause instanceof Error
              ? {
                  name: alternativeError.cause.name,
                  message: alternativeError.cause.message,
                  code: alternativeError.cause.code,
                }
              : null,
        },
      )
      errors.push({ account: 'ADSB.lol fallback', error: alternativeError })

      try {
        return await fetchAircraftFromAirplanesLive(bounds)
      } catch (airplanesLiveError) {
        console.warn(
          '[AeroTrace Airplanes.live] Alternative provider failed:',
          {
            name:
              airplanesLiveError instanceof Error
                ? airplanesLiveError.name
                : typeof airplanesLiveError,
            message:
              airplanesLiveError instanceof Error
                ? airplanesLiveError.message
                : String(airplanesLiveError),
            cause:
              airplanesLiveError instanceof Error &&
              airplanesLiveError.cause instanceof Error
                ? {
                    name: airplanesLiveError.cause.name,
                    message: airplanesLiveError.cause.message,
                    code: airplanesLiveError.cause.code,
                  }
                : null,
          },
        )
        errors.push({
          account: 'Airplanes.live fallback',
          error: airplanesLiveError,
        })

        try {
          return await fetchAircraftFromAdsbFi(bounds)
        } catch (adsbFiError) {
          console.warn(
            '[AeroTrace ADSB.fi] Alternative provider failed:',
            {
              name: adsbFiError instanceof Error ? adsbFiError.name : typeof adsbFiError,
              message: adsbFiError instanceof Error ? adsbFiError.message : String(adsbFiError),
              cause:
                adsbFiError instanceof Error && adsbFiError.cause instanceof Error
                  ? {
                      name: adsbFiError.cause.name,
                      message: adsbFiError.cause.message,
                      code: adsbFiError.cause.code,
                    }
                  : null,
            },
          )
          errors.push({ account: 'ADSB.fi fallback', error: adsbFiError })
        }
      }
    }
  }

  const lastError = errors[errors.length - 1]?.error

  const allAccountsCoolingDown =
    accounts.every(
      (account) => Date.now() < getAccountCooldown(account.key),
    )

  const anyRateLimited = errors.some(
    (entry) => entry.error?.statusCode === 429,
  )

  if (anyRateLimited || allAccountsCoolingDown) {
    const retryAfterSeconds = getRetryAfterSeconds()

    const error = createRateLimitError(retryAfterSeconds)
    error.retryAfterSeconds = retryAfterSeconds
    throw error
  }

  if (!attemptedAccount && lastError) {
    throw lastError
  }

  if (lastError) {
    throw createUnavailableError(
      `Both OpenSky accounts failed or are unavailable. Last error: ${lastError.message || 'Unknown error'}`,
      lastError.statusCode || 502,
    )
  }

  throw createUnavailableError(
    'No OpenSky account could retrieve aircraft data.',
  )
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

function isRotorcraftMetadata(aircraft) {
  const typeCode = String(aircraft?.icao_type || '').trim().toUpperCase()
  const description = [
    typeCode,
    aircraft?.type,
    aircraft?.manufacturer,
  ].filter(Boolean).join(' ').toUpperCase()

  if (/HELICOPTER|ROTORCRAFT|ROTOR-WING|ROTOR WING/.test(description)) {
    return true
  }

  // ICAO type designators commonly used by helicopters. Keep this list
  // deliberately specific so fixed-wing types are not classified by accident.
  return /^(A109|A119|A139|A169|A189|AS32|AS50|AS55|AS65|B06|B06T|B47G|B407|B412|B429|B430|BK17|BK11|CH47|CH53|EC20|EC25|EC30|EC35|EC45|EC55|EC75|H120|H125|H130|H135|H145|H160|H175|H215|H225|MD52|MD60|MI8|MI17|MI24|R22|R44|R66|S61|S76|S92|UH60|AW09|AW10|AW11|AW13|AW16|AW18|AW19|AW20|AW22|AW25|AW30|AW32|AW39|AW60)/.test(typeCode)
}

async function lookupAircraftType(icao24) {
  const existing = aircraftTypeRequestsInFlight.get(icao24)
  if (existing) return existing

  const request = (async () => {
    const response = await fetch(
      `${ADSBDB_API}/aircraft/${encodeURIComponent(icao24)}`,
      {
        signal: AbortSignal.timeout(6000),
        headers: { Accept: 'application/json' },
      },
    )

    if (response.status === 404) {
      const empty = {
        registration: null,
        aircraftType: null,
        aircraftTypeCode: null,
        isHelicopter: false,
      }
      aircraftTypeCache.set(icao24, { data: empty, cachedAt: Date.now() })
      while (aircraftTypeCache.size > MAX_DETAILS_CACHE_SIZE) {
        const oldestKey = aircraftTypeCache.keys().next().value
        if (oldestKey === undefined) break
        aircraftTypeCache.delete(oldestKey)
      }
      return empty
    }

    if (!response.ok) {
      throw new Error(`Aircraft type provider returned ${response.status}.`)
    }

    const payload = await response.json()
    const record = payload?.response?.aircraft
    if (!record || typeof record !== 'object') {
      throw new Error('Aircraft type provider returned an invalid record.')
    }

    const typeCode = String(record.icao_type || '').trim().toUpperCase() || null
    const model = [record.manufacturer, record.type].filter(Boolean).join(' ').trim()
    const metadata = {
      registration: record.registration || null,
      aircraftType: [typeCode, model].filter(Boolean).join(' · ') || null,
      aircraftTypeCode: typeCode,
      isHelicopter: isRotorcraftMetadata(record),
    }

    aircraftTypeCache.delete(icao24)
    aircraftTypeCache.set(icao24, { data: metadata, cachedAt: Date.now() })
    while (aircraftTypeCache.size > MAX_DETAILS_CACHE_SIZE) {
      const oldestKey = aircraftTypeCache.keys().next().value
      if (oldestKey === undefined) break
      aircraftTypeCache.delete(oldestKey)
    }

    return metadata
  })()

  aircraftTypeRequestsInFlight.set(icao24, request)
  try {
    return await request
  } finally {
    if (aircraftTypeRequestsInFlight.get(icao24) === request) {
      aircraftTypeRequestsInFlight.delete(icao24)
    }
  }
}

function applyAircraftTypeMetadata(data) {
  const now = Date.now()
  if (now - typeLookupWindowStartedAt >= 60_000) {
    typeLookupWindowStartedAt = now
    typeLookupsInWindow = 0
  }

  for (const item of data.aircraft || []) {
    const cached = aircraftTypeCache.get(item.icao24)
    if (!cached) continue

    if (now - cached.cachedAt >= AIRCRAFT_TYPE_CACHE_TTL_MS) {
      aircraftTypeCache.delete(item.icao24)
      continue
    }

    Object.assign(item, cached.data, {
      isHelicopter: Boolean(item.isHelicopter || cached.data.isHelicopter),
    })
  }

  // Enrich a small number per minute in the background. Live position updates
  // remain fast, while repeated map polls reuse the metadata cache.
  for (const item of data.aircraft || []) {
    if (typeLookupsInWindow >= MAX_TYPE_LOOKUPS_PER_MINUTE) break
    if (
      item.isHelicopter ||
      aircraftTypeCache.has(item.icao24) ||
      aircraftTypeRequestsInFlight.has(item.icao24)
    ) continue

    typeLookupsInWindow += 1
    void lookupAircraftType(item.icao24)
      .then((metadata) => {
        // Update all currently cached map responses for this aircraft so the
        // next regular poll can deliver its resolved type to the client.
        for (const entry of aircraftCache.values()) {
          const matching = entry.data.aircraft?.find(
            (candidate) => candidate.icao24 === item.icao24,
          )
          if (matching) {
            Object.assign(matching, metadata, {
              isHelicopter: Boolean(matching.isHelicopter || metadata.isHelicopter),
            })
          }
        }
        Object.assign(item, metadata, {
          isHelicopter: Boolean(item.isHelicopter || metadata.isHelicopter),
        })
      })
      .catch((error) => {
        console.warn(
          '[AeroTrace aircraft type lookup]',
          error instanceof Error ? error.message : error,
        )
      })
  }
}

/* Aircraft photo lookup and caching. */

function getCachedPhoto(key) {
  const entry = aircraftPhotoCache.get(key)

  if (!entry) return undefined

  const ttl = entry.photo ? PHOTO_CACHE_TTL_MS : 5 * 60 * 1000
  if (Date.now() - entry.cachedAt >= ttl) {
    aircraftPhotoCache.delete(key)
    return undefined
  }

  aircraftPhotoCache.delete(key)
  aircraftPhotoCache.set(key, entry)

  return entry.photo
}

function saveCachedPhoto(key, photo) {
  aircraftPhotoCache.delete(key)

  aircraftPhotoCache.set(key, {
    photo,
    cachedAt: Date.now(),
  })

  while (aircraftPhotoCache.size > MAX_PHOTO_CACHE_SIZE) {
    const oldestKey = aircraftPhotoCache.keys().next().value
    if (oldestKey === undefined) break
    aircraftPhotoCache.delete(oldestKey)
  }
}

function proxiedAircraftPhoto(photo) {
  if (!photo) return null
  return {
    ...photo,
    src: `/api/aircraft-photo-image?url=${encodeURIComponent(photo.src)}`,
  }
}

async function proxyAircraftPhotoImage(url, response) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return sendJson(response, 400, { error: 'Invalid photo URL.' })
  }

  const allowedPhotoHost =
    parsed.hostname === 'planespotters.net' ||
    parsed.hostname.endsWith('.planespotters.net') ||
    parsed.hostname === 'plnspttrs.net' ||
    parsed.hostname.endsWith('.plnspttrs.net') ||
    parsed.hostname === 'upload.wikimedia.org' ||
    parsed.hostname === 'airport-data.com' ||
    parsed.hostname.endsWith('.airport-data.com')

  if (parsed.protocol !== 'https:' || !allowedPhotoHost) {
    return sendJson(response, 400, { error: 'Unsupported photo host.' })
  }

  try {
    const upstream = await fetch(parsed, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://www.planespotters.net/',
        'User-Agent': 'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace)',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!upstream.ok) {
      return sendJson(response, 502, { error: 'Photo provider could not return this image.' })
    }

    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return sendJson(response, 502, { error: 'Photo provider returned a non-image response.' })
    }

    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) {
      return sendJson(response, 502, { error: 'Photo image size is invalid.' })
    }

    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(bytes)
  } catch (error) {
    console.warn('[AeroTrace aircraft photo proxy]', error instanceof Error ? error.message : error)
    return sendJson(response, 502, { error: 'Aircraft photo image could not be loaded.' })
  }
}

function normalizePlanespottersPhoto(payload, matchedBy) {
  const photos = Array.isArray(payload?.photos) ? payload.photos : []

  for (const item of photos) {
    // Planespotters' documented response uses photos[].thumbnail.src.
    // Newer responses may also expose thumbnail_large/src or full-size src.
    const candidates = [
      item?.thumbnail?.src,
      item?.thumbnail_large?.src,
      item?.thumbnail_small?.src,
      item?.src,
      item?.image,
      item?.image_url,
      typeof item?.thumbnail === 'string' ? item.thumbnail : null,
      typeof item?.thumbnail_large === 'string' ? item.thumbnail_large : null,
    ]

    const src = candidates.find((value) => {
      if (typeof value !== 'string' || !value.trim()) return false
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    })

    if (!src) continue

    const rawLink = item?.link || item?.url
    let link = 'https://www.planespotters.net/'
    if (typeof rawLink === 'string' && rawLink.trim()) {
      try {
        if (new URL(rawLink).protocol === 'https:') link = rawLink
      } catch {
        // Keep the safe provider homepage.
      }
    }

    return {
      src,
      link,
      photographer:
        typeof item?.photographer === 'string' && item.photographer.trim()
          ? item.photographer.trim()
          : 'Unknown photographer',
      source: 'Planespotters.net',
      match: 'exact',
      matchedBy,
      representative: false,
      license: null,
      licenseUrl: null,
    }
  }

  return null
}


function normalizeAirportDataPhoto(payload, matchedBy) {
  const items = Array.isArray(payload?.data) ? payload.data : []

  for (const item of items) {
    const src = typeof item?.image === 'string' ? item.image.trim() : ''
    if (!src) continue

    try {
      if (new URL(src).protocol !== 'https:') continue
    } catch {
      continue
    }

    const link =
      typeof item?.link === 'string' && item.link.startsWith('https://')
        ? item.link
        : 'https://airport-data.com/'

    return {
      src,
      link,
      photographer:
        typeof item?.photographer === 'string' && item.photographer.trim()
          ? item.photographer.trim()
          : 'Unknown photographer',
      source: 'Airport-Data.com',
      match: 'exact',
      matchedBy,
      representative: false,
      license: null,
      licenseUrl: null,
    }
  }

  return null
}

async function lookupAirportDataPhoto(icao24, registration) {
  const params = new URLSearchParams({
    m: icao24.toUpperCase(),
    n: '5',
  })

  if (registration) params.set('r', registration)

  try {
    const upstream = await fetch(
      `https://airport-data.com/api/ac_thumb.json?${params}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace)',
        },
        signal: AbortSignal.timeout(8000),
      },
    )

    if (!upstream.ok) return null

    return normalizeAirportDataPhoto(
      await upstream.json(),
      registration ? 'registration/icao24' : 'icao24',
    )
  } catch (error) {
    console.warn(
      '[AeroTrace Airport-Data photo]',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

async function lookupPlanespottersPagePhoto(icao24, registration) {
  // Deterministic final Planespotters lookup: the same HEX URL a user can
  // enter in Planespotters. The page redirects to the exact airframe record.
  const pages = [
    `https://www.planespotters.net/hex/${encodeURIComponent(icao24.toUpperCase())}`,
    ...(registration
      ? [`https://www.planespotters.net/search?q=${encodeURIComponent(registration)}`]
      : []),
  ]

  for (const pageUrl of pages) {
    try {
      const upstream = await fetch(pageUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent':
            'Mozilla/5.0 (compatible; AeroTrace/1.0; +https://github.com/AntonisRsmn/aerotrace)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })

      if (!upstream.ok) {
        console.warn(
          '[AeroTrace Planespotters page photo] Page request failed:',
          pageUrl,
          upstream.status,
        )
        continue
      }

      const html = await upstream.text()

      // The HEX page can expose a small gallery preview. To get the actual
      // high-resolution photograph, follow the exact /photo/<id>/... link and
      // read the image metadata from that photo page.
      const photoLinks = [
        ...html.matchAll(/href=["']([^"']*\/photo\/\d+[^"']*)["']/gi),
      ]
        .map((match) => match[1])
        .map((value) => {
          try {
            return new URL(
              value.replace(/&amp;/g, '&'),
              upstream.url || pageUrl,
            ).toString()
          } catch {
            return null
          }
        })
        .filter((value) => value && value.startsWith('https://'))
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 5)

      const decodeHtmlUrl = (value) =>
        value
          .replace(/&amp;/g, '&')
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/')
          .trim()

      const isHttpsUrl = (value) => {
        if (typeof value !== 'string' || !value.trim()) return false
        try {
          return new URL(decodeHtmlUrl(value)).protocol === 'https:'
        } catch {
          return false
        }
      }

      const extractImageUrl = (photoHtml) => {
        const metaPatterns = [
          /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
          /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image["']/i,
        ]

        for (const pattern of metaPatterns) {
          const match = photoHtml.match(pattern)
          if (match?.[1] && isHttpsUrl(match[1])) {
            return decodeHtmlUrl(match[1])
          }
        }

        const imagePatterns = [
          /(?:src|data-src|data-original)=["'](https?:[^"']+)["']/gi,
          /"image"\s*:\s*"([^"]+)"/gi,
        ]

        for (const pattern of imagePatterns) {
          for (const match of photoHtml.matchAll(pattern)) {
            const value = match[1]
            if (isHttpsUrl(value)) return decodeHtmlUrl(value)
          }
        }

        return null
      }

      for (const photoUrl of photoLinks) {
        try {
          const photoPage = await fetch(photoUrl, {
            headers: {
              Accept: 'text/html,application/xhtml+xml',
              Referer: upstream.url || pageUrl,
              'User-Agent':
                'Mozilla/5.0 (compatible; AeroTrace/1.0; +https://github.com/AntonisRsmn/aerotrace)',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          })

          if (!photoPage.ok) continue

          const photoHtml = await photoPage.text()
          const fullResolutionSrc = extractImageUrl(photoHtml)

          if (!fullResolutionSrc) continue

          console.log(
            '[AeroTrace Planespotters] Full-resolution photo found:',
            photoUrl,
          )

          return {
            src: fullResolutionSrc,
            link: photoPage.url || photoUrl,
            photographer: 'Planespotters.net',
            source: 'Planespotters.net',
            match: 'exact',
            matchedBy: registration ? 'registration/photo-page' : 'icao24/photo-page',
            representative: false,
            license: null,
            licenseUrl: null,
          }
        } catch (error) {
          console.warn(
            '[AeroTrace Planespotters photo page]',
            error instanceof Error ? error.message : error,
          )
        }
      }

      // If the photo page is unavailable, continue with the aircraft page metadata.
      // Prefer the page preview image, then inspect the actual photo gallery.
      // Planespotters serves gallery images from cdn.planespotters.net and
      // may expose them through src, data-src, data-original, or srcset.
      const patterns = [
        /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
        /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image["']/i,
      ]

      let src = null
      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1] && isHttpsUrl(match[1])) {
          src = decodeHtmlUrl(match[1])
          break
        }
      }

      if (!src) {
        // Find an actual Planespotters photo link and its nearby image.
        // RegExp() avoids parser ambiguity from the many slash characters.
        const photoBlockPatterns = [
          new RegExp('<a[^>]+href=["\\\']([^"\\\']*/photo/\\d+[^"\\\']*)["\\\'][^>]*>[\\s\\S]{0,5000}?<img[^>]+(?:src|data-src|data-original)=["\\\']([^"\\\']+)["\\\']', 'gi'),
          new RegExp('<img[^>]+(?:src|data-src|data-original)=["\\\']([^"\\\']+)["\\\'][^>]*>[\\s\\S]{0,5000}?<a[^>]+href=["\\\']([^"\\\']*/photo/\\d+[^"\\\']*)["\\\']', 'gi'),
        ]

        for (const pattern of photoBlockPatterns) {
          const matches = [...html.matchAll(pattern)]
          for (const match of matches) {
            const candidates = match.slice(1).filter(isHttpsUrl)
            const candidate = candidates.find((value) =>
              /(?:planespotters\.net|plnspttrs\.net)/i.test(decodeHtmlUrl(value)),
            )
            if (candidate) {
              src = decodeHtmlUrl(candidate)
              break
            }
          }
          if (src) break
        }
      }

      if (!src) {
        // Capture any Planespotters CDN image in the page, including lazy-load
        // attributes and responsive srcset values.
        const imageAttributes = [
          new RegExp('(?:src|data-src|data-original)=["\\\'](https://(?:cdn|images)\\.(?:planespotters\\.net|plnspttrs\\.net)/[^"\\\']+)["\\\']', 'gi'),
          new RegExp('srcset=["\\\']([^"\\\']+)["\\\']', 'gi'),
        ]

        for (const pattern of imageAttributes) {
          for (const match of html.matchAll(pattern)) {
            const values = pattern.source.startsWith('srcset')
              ? match[1].split(',').map((item) => item.trim().split(/\\s+/)[0])
              : [match[1]]
            const candidate = values.find(isHttpsUrl)
            if (candidate) {
              src = decodeHtmlUrl(candidate)
              break
            }
          }
          if (src) break
        }
      }

      if (!src) {
        // Some page versions expose the primary photo in JSON-LD.
        const jsonLdImages = [
          ...html.matchAll(/"image"\s*:\s*"([^"]+)"/gi),
        ]
        src = jsonLdImages
          .map((match) => decodeHtmlUrl(match[1]))
          .find(isHttpsUrl) || null
      }

      if (!src) continue

      try {
        if (new URL(src).protocol !== 'https:') continue
      } catch {
        continue
      }

      return {
        src,
        link: upstream.url || pageUrl,
        photographer: 'Planespotters.net',
        source: 'Planespotters.net',
        match: 'exact',
        matchedBy: registration ? 'registration/page' : 'icao24/page',
        representative: false,
        license: null,
        licenseUrl: null,
      }
    } catch (error) {
      console.warn(
        '[AeroTrace Planespotters page photo]',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return null
}

async function lookupPlanespottersPhoto(icao24, registration, aircraftType) {
  const directEndpoints = [
    ...(registration
      ? [{
          url: `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
          matchedBy: 'registration',
        }]
      : []),
    {
      url: `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24)}`,
      matchedBy: 'icao24',
    },
  ]

  for (const endpoint of directEndpoints) {
    try {
      const upstream = await fetch(endpoint.url, {
        headers: {
          Accept: 'application/json',
          // Planespotters can return 403 to generic application clients.
          // A browser-compatible UA is accepted by the public endpoint.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Referer: 'https://www.planespotters.net/',
          Origin: 'https://www.planespotters.net',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (!upstream.ok) {
        console.warn(
          '[AeroTrace Planespotters photo] API request failed:',
          endpoint.url,
          upstream.status,
        )
        continue
      }

      const payload = await upstream.json()
      const photo = normalizePlanespottersPhoto(payload, endpoint.matchedBy)
      if (photo) return photo

      console.warn(
        '[AeroTrace Planespotters photo] API returned no usable photo:',
        endpoint.url,
      )
    } catch (error) {
      console.warn(
        '[AeroTrace Planespotters photo]',
        error instanceof Error ? error.message : error,
      )
    }
  }

  // adsb.lol exposes a documented-compatible cached proxy for the
  // Planespotters hex endpoint. This gives AeroTrace a no-key second path
  // when direct Planespotters access is rate-limited or blocked upstream.
  try {
    const params = new URLSearchParams()
    if (registration) params.set('reg', registration)
    if (aircraftType) params.set('icaoType', aircraftType)

    const suffix = params.size ? `?${params}` : ''
    const upstream = await fetch(
      `https://api.adsb.lol/0/planespotters_net/hex/${encodeURIComponent(icao24)}${suffix}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace; contact: https://rusman.gr)',
        },
        signal: AbortSignal.timeout(8000),
      },
    )

    if (upstream.ok) {
      const photo = normalizePlanespottersPhoto(
        await upstream.json(),
        registration ? 'registration/icao24' : 'icao24',
      )
      if (photo) return photo
    }
  } catch (error) {
    console.warn(
      '[AeroTrace adsb.lol photo proxy]',
      error instanceof Error ? error.message : error,
    )
  }

  // Airport-Data provides a documented, no-key aircraft thumbnail
  // endpoint keyed by Mode-S/ICAO24, with an optional registration filter.
  const airportDataPhoto = await lookupAirportDataPhoto(icao24, registration)
  if (airportDataPhoto) return airportDataPhoto

  console.warn(
    '[AeroTrace Planespotters] All exact photo lookups returned no photo:',
    { icao24, registration, aircraftType },
  )
  return null
}

function cleanCommonsMetadata(value) {
  if (typeof value !== 'string') return null
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim() || null
}

async function searchWikimediaCommonsPhoto(queries) {
  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: query.text,
        gsrlimit: '8',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '900',
        origin: '*',
      })

      const upstream = await fetch(
        `https://commons.wikimedia.org/w/api.php?${params}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent':
              'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace; contact: https://rusman.gr)',
          },
          signal: AbortSignal.timeout(8000),
        },
      )

      if (!upstream.ok) continue

      const payload = await upstream.json()
      const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : []

      for (const page of pages) {
        const info = page?.imageinfo?.[0]
        const src = info?.thumburl || info?.url
        const canonicalTitle =
          typeof page?.title === 'string' ? page.title.replace(/^File:/, '') : ''
        const link = canonicalTitle
          ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(canonicalTitle.replace(/ /g, '_'))}`
          : null

        if (typeof src !== 'string' || !link) continue

        const metadata = info?.extmetadata || {}
        const license = cleanCommonsMetadata(
          metadata.LicenseShortName?.value || metadata.License?.value,
        )
        const licenseUrl =
          typeof metadata.LicenseUrl?.value === 'string' &&
          metadata.LicenseUrl.value.startsWith('https://')
            ? metadata.LicenseUrl.value
            : null
        const photographer =
          cleanCommonsMetadata(metadata.Artist?.value) ||
          cleanCommonsMetadata(metadata.Credit?.value) ||
          'Wikimedia Commons contributor'

        return {
          src,
          link,
          photographer,
          source: 'Wikimedia Commons',
          match: query.match,
          matchedBy: query.matchedBy,
          representative: query.match !== 'exact',
          license,
          licenseUrl,
        }
      }
    } catch (error) {
      console.warn(
        '[AeroTrace Wikimedia photo]',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return null
}

async function lookupAircraftPhoto({
  icao24,
  registration,
  callsign,
  aircraftType,
  airline,
}) {
  // Planespotters blocks server-side aircraft-page requests with 403.
  // Use the public API (or its ADSB.lol-compatible cache) first. The API's
  // thumbnail_large field is the highest-resolution image exposed without
  // scraping a protected page.
  const exact = await lookupPlanespottersPhoto(icao24, registration, aircraftType)
  if (exact) return exact

  // Only try the aircraft page as a final fallback. It is frequently blocked
  // by Planespotters' anti-bot protection, so it must never delay normal photo
  // resolution.
  const pagePhoto = await lookupPlanespottersPagePhoto(icao24, registration)
  if (pagePhoto) return pagePhoto

  const normalizedModel = (aircraftType || '').replace(/\s*·\s*/g, ' ').trim()
  const queries = []
  const addQuery = (text, match, matchedBy) => {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized || queries.some((item) => item.text === normalized)) return
    queries.push({ text: normalized, match, matchedBy })
  }

  // Commons is a free, documented API and does not require an API key.
  // Search strongest identity metadata first, then deliberately degrade to
  // representative operator/model and finally model-only photographs.
  // Commons file names frequently contain the registration without the word
  // "aircraft", so do not over-constrain exact-registration searches.
  if (registration) {
    addQuery(`intitle:${registration}`, 'exact', 'registration')
    addQuery(registration, 'exact', 'registration')
  }
  if (registration && normalizedModel) {
    addQuery(`${registration} ${normalizedModel}`, 'exact', 'registration+model')
  }
  if (callsign && normalizedModel) {
    addQuery(`${callsign} ${normalizedModel}`, 'representative', 'callsign+model')
  }
  if (airline && normalizedModel) {
    addQuery(`${airline} ${normalizedModel}`, 'representative', 'airline+model')
  }
  if (normalizedModel) {
    addQuery(normalizedModel, 'representative', 'model')
    // Historical archives sometimes provide a verbose model string. The
    // leading ICAO/type token is useful as a broader last-resort search.
    const modelTokens = normalizedModel.split(/\s+/).filter(Boolean)
    if (modelTokens.length > 1) {
      addQuery(modelTokens.slice(0, 2).join(' '), 'representative', 'model')
    }
  }

  return searchWikimediaCommonsPhoto(queries)
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

  // Serve provider images through the backend so the browser does not hit
  // hotlinking/CORS restrictions. proxyAircraftPhotoImage validates the host.
  if (
    request.method === 'GET' &&
    url.pathname === '/api/aircraft-photo-image'
  ) {
    const imageUrl = url.searchParams.get('url')

    if (!imageUrl) {
      return sendJson(response, 400, { error: 'An image URL is required.' })
    }

    return proxyAircraftPhotoImage(imageUrl, response)
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/aircraft-photo'
  ) {
    const icao24 = (url.searchParams.get('icao24') || '').trim().toLowerCase()
    const registration = (url.searchParams.get('registration') || '').trim().toUpperCase()
    const callsign = (url.searchParams.get('callsign') || '').trim().toUpperCase()
    const aircraftType = (url.searchParams.get('aircraftType') || '').trim()
    const airline = (url.searchParams.get('airline') || '').trim()

    if (!/^[a-f0-9]{6}$/.test(icao24)) {
      return sendJson(response, 400, {
        error: 'A valid six-character ICAO24 address is required.',
        photo: null,
      })
    }

    if (
      registration.length > 12 ||
      (registration && !/^[A-Z0-9-]+$/.test(registration))
    ) {
      return sendJson(response, 400, {
        error: 'Invalid aircraft registration.',
        photo: null,
      })
    }

    if (
      callsign.length > 16 ||
      aircraftType.length > 100 ||
      airline.length > 100
    ) {
      return sendJson(response, 400, {
        error: 'Aircraft photo search metadata is too long.',
        photo: null,
      })
    }

    // Bump the cache namespace when lookup strategy changes so an old
    // five-minute cached miss cannot hide newly available fallback results.
    const cacheKey = [
      'photo-v14-planespotters-full-resolution',
      icao24,
      registration,
      callsign,
      aircraftType.toLowerCase(),
      airline.toLowerCase(),
    ].join(':')

    const cached = getCachedPhoto(cacheKey)
    if (cached !== undefined) {
      console.log('[AeroTrace photo] Cache hit:', cacheKey, cached ? cached.source : 'null')

      return sendJson(response, 200, {
        photo: proxiedAircraftPhoto(cached),
        cached: true,
      })
    }

    const photo = await lookupAircraftPhoto({
      icao24,
      registration,
      callsign,
      aircraftType,
      airline,
    })

    saveCachedPhoto(cacheKey, photo)

    return sendJson(response, 200, {
      photo: proxiedAircraftPhoto(photo),
      cached: false,
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/vessels') {
    let bounds

    try {
      bounds = getBounds(url)
    } catch (error) {
      return sendJson(response, 400, { error: error.message })
    }

    if (!process.env.AISSTREAM_API_KEY) {
      return sendJson(response, 503, {
        source: 'AISStream',
        vessels: [],
        available: false,
        error: 'AISStream API key is not configured on the server.',
      })
    }

    setAISStreamBounds(bounds)
    connectAISStream()

    return sendJson(response, 200, {
      source: 'AISStream',
      vessels: getVisibleVessels(bounds),
      available: true,
      streamConnected: aisStreamSocket?.readyState === 1,
      time: Math.floor(Date.now() / 1000),
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const accounts = getOpenSkyAccounts()
    const now = Date.now()

    return sendJson(response, 200, {
      status: 'ok',
      credentialsConfigured: accounts.length > 0,
      openSkyAccounts: {
        primaryConfigured: Boolean(
          process.env.OPENSKY_CLIENT_ID &&
            process.env.OPENSKY_CLIENT_SECRET,
        ),
        backupConfigured: Boolean(
          process.env.OPENSKY_CLIENT_ID_BACKUP &&
            process.env.OPENSKY_CLIENT_SECRET_BACKUP,
        ),
        primaryRetryAfterSeconds: Math.max(
          0,
          Math.ceil(
            (getAccountCooldown('primary') - now) / 1000,
          ),
        ),
        backupRetryAfterSeconds: Math.max(
          0,
          Math.ceil(
            (getAccountCooldown('backup') - now) / 1000,
          ),
        ),
      },
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
    const allRecordedPoints = history?.points ?? []
    const activeFlightSequence =
      history?.trackingActive === true ? history.flightSequence : null
    const recordedPoints = activeFlightSequence == null
      ? []
      : allRecordedPoints.filter(
          (point) => point.flightSequence === activeFlightSequence,
        )
    // If the aircraft was already airborne when AeroTrace first saw it,
    // bootstrap the beginning of the current journey from OpenSky's active
    // trajectory. Trim ground/taxi samples and never include provider points
    // newer than AeroTrace's own current-flight observations.
    const providerTrack = activeFlightSequence == null
      ? []
      : await fetchOpenSkyTrackPoints(icao24)

    let providerPoints = providerTrack
    if (providerPoints.length) {
      const firstAirborneIndex = providerPoints.findIndex(
        (point) =>
          point.onGround === false ||
          (Number.isFinite(point.altitudeFt) &&
            point.altitudeFt >= AIRBORNE_TRACK_ALTITUDE_FT),
      )

      if (firstAirborneIndex >= 0) {
        // Keep one point immediately before airborne state when available so
        // the line begins near the runway/takeoff roll rather than in mid-air.
        providerPoints = providerPoints.slice(Math.max(0, firstAirborneIndex - 1))
      } else {
        providerPoints = []
      }

      const firstRecordedTime = recordedPoints[0]?.time
      if (Number.isFinite(firstRecordedTime)) {
        providerPoints = providerPoints.filter(
          (point) => point.time <= firstRecordedTime,
        )
      }
    }

    // Merge OpenSky's already-flown portion with AeroTrace's live observations
    // for the active flight only. A new flightSequence after the next takeoff
    // prevents separate journeys from ever being connected.
    const combined = [...providerPoints, ...recordedPoints]
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

    const seen = new Set()
    const points = combined.filter((point) => {
      const key = `${point.time}:${point.longitude.toFixed(5)}:${point.latitude.toFixed(5)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return sendJson(response, 200, {
      icao24,
      callsign: history?.callsign ?? null,
      points,
      source: providerPoints.length
        ? 'AeroTrace recorded history + OpenSky trajectory'
        : 'AeroTrace recorded history',
      providerPoints: providerPoints.length,
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

  // Serve the production Vite build from the same Web Service as the API.
  // API paths remain API-only; all other GET/HEAD paths use static assets or
  // the SPA entry point for client-side routes.
  if (!url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      return sendJson(response, 405, { error: 'Method not allowed.' })
    }

    const requestedPath = decodeURIComponent(url.pathname)
    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1)
    const assetPath = resolve(DIST_DIR, relativePath)
    const distPrefix = DIST_DIR.endsWith(sep) ? DIST_DIR : DIST_DIR + sep

    if (assetPath !== DIST_DIR && !assetPath.startsWith(distPrefix)) {
      return sendJson(response, 403, { error: 'Forbidden path.' })
    }

    let filePath = assetPath
    let fileContents

    try {
      fileContents = await readFile(filePath)
    } catch (error) {
      // Missing files and SPA routes should fall back to index.html. Do not
      // turn missing API endpoints into HTML responses.
      try {
        filePath = join(DIST_DIR, 'index.html')
        fileContents = await readFile(filePath)
      } catch {
        return sendJson(response, 503, {
          error: 'Frontend build not found. Run "npm run build" before starting the server.',
        })
      }
    }

    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json; charset=utf-8',
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    })
    return response.end(request.method === 'HEAD' ? undefined : fileContents)
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

  // Hybrid mode combines real, provider-reported aircraft with simulated
  // traffic. Real aircraft retain their actual provider data; synthetic
  // aircraft are marked isDemo so the UI can identify them separately.
  if (AEROTRACE_MODE === 'hybrid') {
    const cacheKey = [
      bounds.lamin,
      bounds.lamax,
      bounds.lomin,
      bounds.lomax,
    ].map((value) => value.toFixed(1)).join(':')
    const now = Date.now()
    const cached = hybridAircraftCache.get(cacheKey)

    if (cached && now - cached.cachedAt < HYBRID_CACHE_TTL_MS) {
      return sendJson(response, 200, { ...cached.data, cached: true })
    }

    let pending = hybridAircraftRequestsInFlight.get(cacheKey)
    if (!pending) {
      pending = (async () => {
        let live = { source: 'Live feed unavailable', time: Math.floor(Date.now() / 1000), aircraft: [] }
        let liveAvailable = false

        try {
          live = await fetchAircraft(bounds)
          liveAvailable = true
        } catch (error) {
          console.warn(
            '[AeroTrace hybrid] Live aircraft feed unavailable; serving simulated traffic too.',
            error instanceof Error ? error.message : error,
          )
        }

        const simulated = await generateDemoAircraft(bounds, DEMO_AIRCRAFT_COUNT)
        const data = {
          source: liveAvailable ? 'Live aircraft + AeroTrace simulation' : 'AeroTrace simulation (live feed unavailable)',
          mode: 'hybrid',
          time: live.time ?? Math.floor(Date.now() / 1000),
          aircraft: [...live.aircraft, ...simulated.aircraft],
          liveAircraftCount: live.aircraft.length,
          totalSimulated: simulated.totalSimulated,
          liveAvailable,
        }
        hybridAircraftCache.set(cacheKey, { data, cachedAt: Date.now() })

        while (hybridAircraftCache.size > 100) {
          const oldestKey = hybridAircraftCache.keys().next().value
          if (oldestKey === undefined) break
          hybridAircraftCache.delete(oldestKey)
        }
        return data
      })()
      hybridAircraftRequestsInFlight.set(cacheKey, pending)
    }

    try {
      const data = await pending
      return sendJson(response, 200, {
        ...data,
        cached: hybridAircraftCache.get(cacheKey)?.cachedAt !== undefined &&
          Date.now() - hybridAircraftCache.get(cacheKey).cachedAt < 1000,
      })
    } finally {
      if (hybridAircraftRequestsInFlight.get(cacheKey) === pending) {
        hybridAircraftRequestsInFlight.delete(cacheKey)
      }
    }
  }

  // Demo mode is intentionally isolated from every live aircraft provider.
  // Replay archived ADS-B tracks only. No live aircraft-position provider is called in demo mode.
  if (AEROTRACE_MODE === 'demo') {
    try {
      const simulated = await generateDemoAircraft(bounds, DEMO_AIRCRAFT_COUNT)
      return sendJson(response, 200, {
        ...simulated,
        cached: false,
      })
    } catch (error) {
      console.error('[AeroTrace demo replay] Historical track source unavailable:', error instanceof Error ? error.message : error)
      return sendJson(response, 503, {
        source: 'AeroTrace Historical Flight Replay',
        mode: 'demo',
        time: Math.floor(Date.now() / 1000),
        aircraft: [],
        totalSimulated: 0,
        replayOnly: true,
        error: 'Historical flight tracks are temporarily unavailable. Please retry shortly.',
      })
    }
  }

  const cacheKey = [
    bounds.lamin,
    bounds.lamax,
    bounds.lomin,
    bounds.lomax,
  ]
    .map((value) => value.toFixed(1))
    .join(':')

  const cached = aircraftCache.get(cacheKey)
  const now = Date.now()

  // Fresh cache is served immediately.
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    applyAircraftTypeMetadata(cached.data)
    return sendJson(response, 200, {
      ...cached.data,
      cached: true,
    })
  }

  // Stale-while-revalidate: return the last known positions immediately while
  // refreshing them in the background. The map never waits on OpenSky when a
  // previous snapshot exists for these bounds.
  if (cached) {
    if (!aircraftRequestsInFlight.has(cacheKey)) {
      const refreshRequest = (async () => {
        const data = await fetchAircraft(bounds)
        await recordAircraftPositions(data.aircraft)
        aircraftCache.set(cacheKey, { data, cachedAt: Date.now() })
        applyAircraftTypeMetadata(data)

        while (aircraftCache.size > 100) {
          const oldestKey = aircraftCache.keys().next().value
          if (oldestKey === undefined) break
          aircraftCache.delete(oldestKey)
        }
        return data
      })()

      aircraftRequestsInFlight.set(cacheKey, refreshRequest)
      void refreshRequest.catch((error) => {
        console.warn(
          '[AeroTrace background refresh]',
          error instanceof Error ? error.message : error,
        )
      }).finally(() => {
        if (aircraftRequestsInFlight.get(cacheKey) === refreshRequest) {
          aircraftRequestsInFlight.delete(cacheKey)
        }
      })
    }

    applyAircraftTypeMetadata(cached.data)
    return sendJson(response, 200, {
      ...cached.data,
      cached: true,
      stale: true,
      refreshing: true,
    })
  }

  // If both accounts are cooling down, use stale data where possible.
  const accounts = getOpenSkyAccounts()
  const allAccountsCoolingDown =
    accounts.length > 0 &&
    accounts.every(
      (account) => now < getAccountCooldown(account.key),
    )

  if (allAccountsCoolingDown) {
    if (cached) {
      return sendJson(response, 200, {
        ...cached.data,
        cached: true,
        stale: true,
        rateLimited: true,
        retryAfterSeconds: getRetryAfterSeconds(),
      })
    }

    return sendJson(response, 429, {
      error:
        'Both OpenSky accounts are temporarily unavailable. Please wait before retrying.',
      retryAfterSeconds: getRetryAfterSeconds(),
    })
  }

  // Deduplicate simultaneous requests for identical bounds.
  let pendingRequest = aircraftRequestsInFlight.get(cacheKey)
  const joinedExistingRequest = Boolean(pendingRequest)

  if (!pendingRequest) {
    pendingRequest = (async () => {
      const data = await fetchAircraft(bounds)

      await recordAircraftPositions(data.aircraft)

      aircraftCache.set(cacheKey, {
        data,
        cachedAt: Date.now(),
      })
      applyAircraftTypeMetadata(data)

      while (aircraftCache.size > 100) {
        const oldestKey = aircraftCache.keys().next().value

        if (oldestKey === undefined) break

        aircraftCache.delete(oldestKey)
      }

      return data
    })()

    aircraftRequestsInFlight.set(cacheKey, pendingRequest)
  }

  try {
    const data = await pendingRequest
    applyAircraftTypeMetadata(data)

    return sendJson(response, 200, {
      ...data,
      cached: joinedExistingRequest,
    })
  } catch (error) {
    console.error(
      '[AeroTrace API]',
      error instanceof Error ? error.message : error,
    )

    // Preserve the map if both accounts fail but cached data exists.
    if (cached) {
      return sendJson(response, 200, {
        ...cached.data,
        cached: true,
        stale: true,
        rateLimited: error.statusCode === 429,
        ...(error.statusCode === 429
          ? { retryAfterSeconds: getRetryAfterSeconds() }
          : {}),
      })
    }

    return sendJson(response, error.statusCode || 502, {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to retrieve aircraft data.',
      ...(error.statusCode === 429
        ? { retryAfterSeconds: getRetryAfterSeconds() }
        : {}),
    })
  } finally {
    if (aircraftRequestsInFlight.get(cacheKey) === pendingRequest) {
      aircraftRequestsInFlight.delete(cacheKey)
    }
  }
})

server.listen(PORT, () => {
  console.log(`AeroTrace API listening on http://localhost:${PORT}`)

  if (process.env.AISSTREAM_API_KEY) {
    console.log('[AeroTrace AIS] AISStream API key configured.')
    connectAISStream()
  } else {
    console.warn('[AeroTrace AIS] AISStream API key is not configured; vessels disabled.')
  }

  const accounts = getOpenSkyAccounts()

  console.log(
    `[AeroTrace OpenSky] ${accounts.length} account(s) configured: ` +
      (accounts.map((account) => account.label).join(', ') || 'none'),
  )
})