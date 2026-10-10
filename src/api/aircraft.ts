
import type { Aircraft, AircraftCategory } from '../types'

export type MapBounds = {
  lamin: number
  lamax: number
  lomin: number
  lomax: number
}

type OpenSkyAircraft = {
  id: string
  icao24: string
  callsign: string
  originCountry: string | null
  longitude: number
  latitude: number
  altitudeFt: number | null
  onGround: boolean | null
  speedKt: number | null
  heading: number | null
  verticalRateFpm: number | null
  squawk: string | null
  lastSeenSeconds: number | null
  isHelicopter?: boolean
}

type AircraftResponse = {
  source?: string
  time?: number
  cached?: boolean
  aircraft: OpenSkyAircraft[]
  error?: string
}

export type LiveAircraftResult = {
  source: string
  time: number
  cached: boolean
  aircraft: Aircraft[]
}

export type AircraftDetails = {
  registration: string | null
  aircraftType: string | null
  airline: string | null
  origin: string | null
  destination: string | null
  routeAvailable: boolean
  cached?: boolean
}

function categoryFor(
  _onGround: boolean | null,
): AircraftCategory {
  return 'Unknown'
}

export async function fetchAircraft(
  bounds: MapBounds,
  signal?: AbortSignal,
): Promise<LiveAircraftResult> {
  const params = new URLSearchParams({
    lamin: String(bounds.lamin),
    lamax: String(bounds.lamax),
    lomin: String(bounds.lomin),
    lomax: String(bounds.lomax),
  })

  const response = await fetch(`/api/aircraft?${params}`, { signal })

  const payload = (await response.json()) as AircraftResponse

  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Aircraft request failed (${response.status}).`,
    )
  }

  if (!Array.isArray(payload.aircraft)) {
    throw new Error(
      'The AeroTrace API returned an invalid aircraft response.',
    )
  }

  return {
    source: payload.source || 'OpenSky Network',
    time: payload.time ?? Math.floor(Date.now() / 1000),
    cached: Boolean(payload.cached),
    aircraft: payload.aircraft.map((item) => ({
      id: item.icao24,
      icao24: item.icao24,
      callsign: item.callsign?.trim() || item.icao24.toUpperCase(),
      registration: null,
      aircraftType: null,
      category: categoryFor(item.onGround),
      airline: null,
      origin: null,
      destination: null,
      altitudeFt: item.altitudeFt,
      speedKt: item.speedKt,
      heading: item.heading,
      latitude: item.latitude,
      longitude: item.longitude,
      verticalRateFpm: item.verticalRateFpm,
      squawk: item.squawk,
      lastSeenSeconds: item.lastSeenSeconds,
      originCountry: item.originCountry,
      onGround: item.onGround,
      isHelicopter: Boolean(item.isHelicopter),
    })),
  }
}

export async function fetchAircraftDetails(
  icao24: string,
  callsign: string,
  signal?: AbortSignal,
): Promise<AircraftDetails> {
  const params = new URLSearchParams({
    icao24,
    callsign,
  })

  const response = await fetch(
    `/api/aircraft-details?${params}`,
    { signal },
  )

  const payload = (await response.json()) as AircraftDetails & {
    error?: string
  }

  if (!response.ok) {
    throw new Error(
      payload.error || 'Unable to retrieve aircraft details.',
    )
  }

  return {
    registration: payload.registration ?? null,
    aircraftType: payload.aircraftType ?? null,
    airline: payload.airline ?? null,
    origin: payload.origin ?? null,
    destination: payload.destination ?? null,
    routeAvailable: Boolean(payload.routeAvailable),
    cached: Boolean(payload.cached),
  }
}
