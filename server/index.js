
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.API_PORT || 3000)

const OPENSKY_API = 'https://opensky-network.org/api'
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

const ADSBDB_API = 'https://api.adsbdb.com/v0'

const CACHE_TTL_MS = 60_000
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
const MAX_TRACKED_AIRCRAFT = 10_000
const MAX_DETAILS_CACHE_SIZE = 2000
const MAX_PHOTO_CACHE_SIZE = 2000
const AIRCRAFT_TYPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TYPE_LOOKUPS_PER_MINUTE = 24

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
      heading: item.heading,
      altitudeFt: item.altitudeFt,
    }

    const history = tracks[item.id] ?? {
      icao24: item.icao24,
      callsign: item.callsign,
      points: [],
    }

    history.callsign = item.callsign || history.callsign

    // Keep persisted observations in timestamp order, including when an API
    // response contains a slightly older observation than the last saved one.
    history.points.sort((a, b) => a.time - b.time)
    const previous = history.points[history.points.length - 1]

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

        console.warn(
          `[AeroTrace OpenSky track] ${account.label} account failed:`,
          error instanceof Error ? error.message : error,
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
    isHelicopter: Number(category) === 8,
    lastSeenSeconds:
      typeof contactTime === 'number'
        ? Math.max(0, Math.round(nowSeconds - contactTime))
        : null,
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
    throw createUnavailableError(
      'OpenSky credentials are not configured. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET, or configure the corresponding _BACKUP variables.',
      503,
    )
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

      console.warn(
        `[AeroTrace OpenSky] ${account.label} account failed:`,
        error instanceof Error ? error.message : error,
      )

      // Continue to the next configured account automatically.
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

  if (
    parsed.protocol !== 'https:' ||
    !(
      parsed.hostname === 'planespotters.net' ||
      parsed.hostname.endsWith('.planespotters.net')
    )
  ) {
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

async function lookupAircraftPhoto(icao24, registration) {
  const endpoints = [
    `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24)}`,
    ...(registration
      ? [
          `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
        ]
      : []),
  ]

  for (const endpoint of endpoints) {
    try {
      const upstream = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace; contact: https://rusman.gr)',
        },
        signal: AbortSignal.timeout(8000),
      })

      if (!upstream.ok) continue

      const payload = await upstream.json()
      const photos = Array.isArray(payload.photos)
        ? payload.photos
        : []

      for (const item of photos) {
        const src =
          item?.thumbnail_large?.src ||
          item?.thumbnail?.src ||
          item?.thumbnail_small?.src ||
          (typeof item?.thumbnail_large === 'string'
            ? item.thumbnail_large
            : null) ||
          (typeof item?.thumbnail === 'string'
            ? item.thumbnail
            : null) ||
          item?.src

        const link = item?.link || item?.url

        if (
          typeof src !== 'string' ||
          typeof link !== 'string'
        ) {
          continue
        }

        try {
          if (
            new URL(src).protocol !== 'https:' ||
            new URL(link).protocol !== 'https:'
          ) {
            continue
          }
        } catch {
          continue
        }

        return {
          src,
          link,
          photographer:
            typeof item.photographer === 'string' &&
            item.photographer.trim()
              ? item.photographer.trim()
              : 'Unknown photographer',
        }
      }
    } catch (error) {
      console.warn(
        '[AeroTrace aircraft photo]',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return null
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

  if (
    request.method === 'GET' &&
    url.pathname === '/api/aircraft-photo'
  ) {
    const icao24 = (
      url.searchParams.get('icao24') || ''
    ).trim().toLowerCase()

    const registration = (
      url.searchParams.get('registration') || ''
    ).trim().toUpperCase()

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

    const cacheKey = `${icao24}:${registration}`
    const cached = getCachedPhoto(cacheKey)

    if (cached !== undefined) {
      return sendJson(response, 200, {
        photo: proxiedAircraftPhoto(cached),
        cached: true,
      })
    }

    const photo = await lookupAircraftPhoto(
      icao24,
      registration,
    )

    saveCachedPhoto(cacheKey, photo)

    return sendJson(response, 200, {
      photo: proxiedAircraftPhoto(photo),
      cached: false,
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
    const recordedPoints = history?.points ?? []
    const providerPoints = await fetchOpenSkyTrackPoints(icao24)

    // Combine AeroTrace's higher-frequency observations with OpenSky's
    // trajectory waypoints, then sort the union by observation time.
    const combined = [...recordedPoints, ...providerPoints]
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

  if (request.method !== 'GET' || url.pathname !== '/api/aircraft') {
    return sendJson(response, 404, { error: 'Endpoint not found.' })
  }

  let bounds

  try {
    bounds = getBounds(url)
  } catch (error) {
    return sendJson(response, 400, { error: error.message })
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

  const accounts = getOpenSkyAccounts()

  console.log(
    `[AeroTrace OpenSky] ${accounts.length} account(s) configured: ` +
      (accounts.map((account) => account.label).join(', ') || 'none'),
  )
})
