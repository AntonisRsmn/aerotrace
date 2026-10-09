export type AircraftCategory = 'Passenger' | 'Cargo' | 'Business' | 'Military' | 'General aviation'

export type Aircraft = {
  id: string
  callsign: string
  registration: string
  aircraftType: string
  category: AircraftCategory
  airline: string
  origin: string
  destination: string
  altitudeFt: number
  speedKt: number
  heading: number
  latitude: number
  longitude: number
  verticalRateFpm: number
  squawk: string
  lastSeenSeconds: number
}
