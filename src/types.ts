
export type AircraftCategory =
  | 'Passenger'
  | 'Cargo'
  | 'Business'
  | 'Military'
  | 'General aviation'
  | 'Unknown'

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
}
