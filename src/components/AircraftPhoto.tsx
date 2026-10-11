import { useEffect, useState } from 'react'

type AircraftPhotoData = {
  src: string
  link: string
  photographer: string
  source?: string
  match?: 'exact' | 'representative'
  matchedBy?: string
  representative?: boolean
  license?: string | null
  licenseUrl?: string | null
}

type AircraftPhotoResponse = {
  photo: AircraftPhotoData | null
  cached?: boolean
  error?: string
}

type AircraftPhotoProps = {
  icao24: string
  registration?: string | null
  callsign?: string | null
  aircraftType?: string | null
  airline?: string | null
}

export default function AircraftPhoto({
  icao24,
  registration,
  callsign,
  aircraftType,
  airline,
}: AircraftPhotoProps) {
  const [photo, setPhoto] = useState<AircraftPhotoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [imageFailed, setImageFailed] = useState(false)
  const [lookupFailed, setLookupFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function loadPhoto() {
      setLoading(true)
      setPhoto(null)
      setImageFailed(false)
      setLookupFailed(false)

      try {
        const params = new URLSearchParams({
          icao24: icao24.trim().toLowerCase(),
        })

        if (registration?.trim()) params.set('registration', registration.trim())
        if (callsign?.trim()) params.set('callsign', callsign.trim())
        if (aircraftType?.trim()) params.set('aircraftType', aircraftType.trim())
        if (airline?.trim()) params.set('airline', airline.trim())

        const response = await fetch(
          `/api/aircraft-photo?${params.toString()}`,
          {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          },
        )

        const payload = (await response.json()) as AircraftPhotoResponse

        if (!response.ok) {
          throw new Error(payload.error || 'Aircraft photo lookup failed.')
        }

        if (active) setPhoto(payload.photo ?? null)
      } catch (error) {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return

        console.warn(
          '[AeroTrace aircraft photo]',
          error instanceof Error ? error.message : error,
        )
        setLookupFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    }

    if (/^[a-f0-9]{6}$/i.test(icao24)) {
      void loadPhoto()
    } else {
      setPhoto(null)
      setLoading(false)
    }

    return () => {
      active = false
      controller.abort()
    }
  }, [icao24, registration, callsign, aircraftType, airline])

  const cardStyle: React.CSSProperties = {
    margin: '0 14px 16px',
    overflow: 'hidden',
    background: 'rgba(8, 14, 22, 0.78)',
    border: '1px solid rgba(135, 166, 204, 0.15)',
    borderRadius: 9,
  }

  const placeholderStyle: React.CSSProperties = {
    display: 'flex',
    minHeight: 145,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: 20,
    color: '#8192a8',
    textAlign: 'center',
  }

  const isRepresentative = Boolean(photo?.representative || photo?.match === 'representative')

  return (
    <section style={cardStyle} aria-label="Aircraft photograph">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '11px 12px',
          borderBottom: '1px solid rgba(135, 166, 204, 0.12)',
        }}
      >
        <span
          style={{
            color: '#a7b5c8',
            font: '9px "DM Mono", monospace',
            letterSpacing: '0.08em',
          }}
        >
          AIRCRAFT PHOTOGRAPH
        </span>

        <span style={{ color: isRepresentative ? '#d6aa68' : '#72869d', fontSize: 9 }}>
          {loading
            ? 'Searching…'
            : photo && !imageFailed
              ? isRepresentative
                ? 'Representative photo'
                : 'Exact aircraft'
              : 'No photo'}
        </span>
      </div>

      {loading ? (
        <div style={placeholderStyle} role="status">
          <span
            style={{
              width: 22,
              height: 22,
              border: '2px solid rgba(88, 169, 255, 0.2)',
              borderTopColor: '#58a9ff',
              borderRadius: '50%',
              animation: 'spin 0.9s linear infinite',
            }}
          />
          <span style={{ fontSize: 10 }}>Looking for this aircraft…</span>
        </div>
      ) : photo && !imageFailed ? (
        <>
          <a
            href={photo.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open original aircraft photograph on ${photo.source || 'photo provider'}`}
            style={{ display: 'block', background: '#080d14' }}
          >
            <img
              src={photo.src}
              alt={
                isRepresentative
                  ? `Representative photograph for ${airline || aircraftType || 'this aircraft type'}`
                  : `Aircraft ${registration || icao24.toUpperCase()}`
              }
              loading="lazy"
              onError={() => setImageFailed(true)}
              style={{
                display: 'block',
                width: '100%',
                height: 190,
                objectFit: 'contain',
                objectPosition: 'center',
                background: '#080d14',
              }}
            />
          </a>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '9px 11px',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  overflow: 'hidden',
                  color: '#8294aa',
                  fontSize: 9,
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Photo: {photo.photographer || 'Unknown photographer'}
              </div>
              <div style={{ marginTop: 3, color: '#667b92', fontSize: 8 }}>
                {isRepresentative
                  ? `Representative match · ${photo.matchedBy || 'aircraft metadata'}`
                  : `Exact-aircraft match · ${photo.matchedBy || 'aircraft identity'}`}
                {photo.source ? ` · ${photo.source}` : ''}
                {photo.license ? ` · ${photo.license}` : ''}
              </div>
            </div>

            <a
              href={photo.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flexShrink: 0,
                color: '#78baff',
                fontSize: 9,
                textDecoration: 'none',
              }}
            >
              View original ↗
            </a>
          </div>
        </>
      ) : (
        <div style={placeholderStyle}>
          <span
            aria-hidden="true"
            style={{
              display: 'grid',
              width: 38,
              height: 38,
              placeItems: 'center',
              color: '#7ebcff',
              background: 'rgba(72, 144, 218, 0.1)',
              border: '1px solid rgba(88, 169, 255, 0.16)',
              borderRadius: 10,
              fontSize: 21,
            }}
          >
            ✈
          </span>

          <strong style={{ color: '#b8c7d9', fontSize: 11, fontWeight: 500 }}>
            {imageFailed
              ? 'Photo could not be displayed'
              : lookupFailed
                ? 'Photo service unavailable'
                : 'No photograph available'}
          </strong>

          <span
            style={{
              maxWidth: 230,
              color: '#72869d',
              fontSize: 9,
              lineHeight: 1.6,
            }}
          >
            {imageFailed
              ? 'The photo provider returned an image that could not be loaded.'
              : lookupFailed
                ? 'Aircraft data is still available. Try selecting this aircraft again later.'
                : 'No suitable exact or representative photograph was found.'}
          </span>
        </div>
      )}
    </section>
  )
}
