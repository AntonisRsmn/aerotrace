import type { Vessel } from '../types'

export type VesselMapBounds = {
  lamin: number
  lamax: number
  lomin: number
  lomax: number
}

type VesselResponse = {
  source: string
  vessels: Array<{
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
    lastSeen?: number
  }>
  available: boolean
  streamConnected?: boolean
  time: number
  error?: string
}

export async function fetchVessels(
  bounds: VesselMapBounds,
  signal?: AbortSignal,
): Promise<{
  vessels: Vessel[]
  source: string
  available: boolean
  streamConnected: boolean
  time: number
}> {
  const params = new URLSearchParams({
    lamin: String(bounds.lamin),
    lamax: String(bounds.lamax),
    lomin: String(bounds.lomin),
    lomax: String(bounds.lomax),
  })

  const response = await fetch('/api/vessels?' + params.toString(), { signal })
  const data = (await response.json()) as VesselResponse

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load vessel data.')
  }

  return {
    vessels: (data.vessels ?? []).map((item) => ({
      ...item,
      id: 'vessel:' + item.mmsi,
      lastSeenSeconds:
        item.lastSeen == null
          ? null
          : Math.max(0, (Date.now() - item.lastSeen) / 1000),
    })),
    source: data.source,
    available: data.available,
    streamConnected: data.streamConnected === true,
    time: data.time,
  }
}
