
export type AircraftCategory =
  | 'Passenger'
  | 'Cargo'
  | 'Business'
  | 'Military'
  | 'General aviation'
  | 'Helicopter'
  | 'Glider'
  | 'Lighter-than-air'
  | 'UAV'
  | 'High performance'
  | 'Heavy'
  | 'Large'
  | 'Small / light'
  | 'Unknown'

export type Vessel = {
  id: string
  mmsi: string
  name: string | null
  imo: string | null
  callsign: string | null
  vesselType: string
  vesselTypeCode: number | null
  destination: string | null
  draughtM: number | null
  latitude: number
  longitude: number
  speedKt: number | null
  course: number | null
  heading: number | null
  navigationStatus: number | null
  lastSeenSeconds: number | null
}

export type Aircraft = {
  id: string
  icao24: string
  callsign: string
  registration: string | null
  aircraftType: string | null
  category: AircraftCategory
  airline: string | null
  origin: string | null
  destination: string | null
  altitudeFt: number | null
  speedKt: number | null
  heading: number | null
  latitude: number
  longitude: number
  verticalRateFpm: number | null
  squawk: string | null
  lastSeenSeconds: number | null
  originCountry?: string | null
  onGround?: boolean | null
  isHelicopter?: boolean
  categoryCode?: number | null
  aircraftTypeCode?: string | null
  /** True when this aircraft is simulated or replayed for demo mode. */
  isDemo?: boolean
  /** Recorded or simulated route coordinates [longitude, latitude]. */
  routeCoordinates?: [number, number][]
  /** Progress along the route at routeProgressUpdatedAt (0-1). */
  routeProgress?: number
  routeDurationSeconds?: number
  routeProgressUpdatedAt?: number
  /** Historical source label for a replayed demo flight. */
  replaySource?: string | null
  /** UTC timestamp of the recorded flight, not the replay clock. */
  recordedFlightDate?: string | null
}
