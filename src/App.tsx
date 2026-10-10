
import { useCallback, useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import AircraftPhoto from './components/AircraftPhoto'
import {
  fetchAircraft,
  fetchAircraftDetails,
  type AircraftDetails,
  type MapBounds,
} from './api/aircraft'
import type { Aircraft } from './types'

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—'

  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function formatAltitude(value: number | null) {
  return value == null ? '—' : `${formatNumber(value)} ft`
}

function formatSpeed(value: number | null) {
  return value == null ? '—' : `${formatNumber(value)} kt`
}

function formatVerticalRate(value: number | null) {
  if (value == null) return '—'
  return `${value > 0 ? '+' : ''}${formatNumber(value)} ft/min`
}

function formatLastSeen(value: number | null) {
  if (value == null) return '—'
  if (value < 5) return 'Just now'
  return `${Math.round(value)}s ago`
}

const routeCardStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '8px',
  marginTop: '12px',
  padding: '16px 12px',
  background: 'linear-gradient(135deg, rgba(37, 139, 255, 0.12), rgba(37, 139, 255, 0.035))',
  border: '1px solid rgba(88, 169, 255, 0.24)',
  borderRadius: '12px',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.025)',
} as const

const routeEndpointStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  minWidth: 0,
} as const

const routeLabelStyle = {
  color: '#7E8DA2',
  fontSize: '9px',
  fontFamily: 'var(--mono)',
  letterSpacing: '0.1em',
} as const

const routeCodeStyle = {
  display: '-webkit-box',
  overflow: 'hidden',
  color: '#F1F6FF',
  fontSize: '13px',
  fontWeight: 750,
  letterSpacing: '0.005em',
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
  textOverflow: 'ellipsis',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  whiteSpace: 'normal',
} as const

export default function App() {
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'airborne' | 'ground' | 'unknown'>('all')
  const [aircraftKindFilter, setAircraftKindFilter] = useState<'all' | 'helicopter' | 'non-helicopter'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'known' | 'unknown'>('all')
  const [minAltitude, setMinAltitude] = useState('')
  const [maxAltitude, setMaxAltitude] = useState('')
  const [minSpeed, setMinSpeed] = useState('')
  const [maxSpeed, setMaxSpeed] = useState('')
  const [showLabels, setShowLabels] = useState(true)
  const [showTrails, setShowTrails] = useState(true)
  const [showAirports, setShowAirports] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState('OpenSky Network')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [mobilePanel, setMobilePanel] = useState<'list' | 'details' | null>(
    null,
  )

  const [selectedDetails, setSelectedDetails] =
    useState<AircraftDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds(nextBounds)
  }, [])

  const handleSelect = useCallback((id: string) => {
    setSelectedId((currentId) => {
      const nextId = !id || currentId === id ? null : id
      setMobilePanel(nextId ? 'details' : null)
      return nextId
    })
  }, [])

  useEffect(() => {
    if (!bounds) return

    let active = true
    let firstRequest = true
    let controller: AbortController | null = null

    let requestInProgress = false

    const refreshAircraft = async () => {
      // Never abort a useful live-feed request just because the polling interval
      // elapsed. OpenSky can take longer than one second to answer.
      if (requestInProgress) return
      requestInProgress = true

      const currentController = new AbortController()
      controller = currentController

      const isFirstRequest = firstRequest
      firstRequest = false

      if (isFirstRequest) setLoading(true)

      try {
        const result = await fetchAircraft(
          bounds,
          currentController.signal,
        )

        if (!active) return

        setAircraft((currentAircraft) => {
          // Keep the selected aircraft in state when a map pan changes the
          // visible-bounds query and that aircraft is no longer in its results.
          // If it is returned by the new query, use its fresh live data.
          const selectedAircraft = selectedId
            ? currentAircraft.find((item) => item.id === selectedId)
            : null
          const selectedIncluded = selectedId
            ? result.aircraft.some((item) => item.id === selectedId)
            : true

          if (selectedAircraft && !selectedIncluded) {
            return [...result.aircraft, selectedAircraft]
          }

          return result.aircraft
        })
        setSource(result.source)
        setUpdatedAt(result.time)
        setError(null)
      } catch (caught) {
        if (
          !active ||
          currentController.signal.aborted ||
          (caught instanceof Error && caught.name === 'AbortError')
        ) {
          return
        }

        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load aircraft.',
        )
      } finally {
        requestInProgress = false
        if (active && isFirstRequest) {
          setLoading(false)
        }
      }
    }

    void refreshAircraft()

    // OpenSky updates more slowly than a one-second UI poll. A 10-second
    // interval avoids request churn while keeping the map responsive.
    const interval = window.setInterval(() => {
      void refreshAircraft()
    }, 10_000)

    return () => {
      active = false
      window.clearInterval(interval)
      controller?.abort()
    }
  }, [bounds])

  const filteredAircraft = useMemo(() => {
    const query = search.trim().toLowerCase()
    const minAlt = minAltitude.trim() === '' ? null : Number(minAltitude)
    const maxAlt = maxAltitude.trim() === '' ? null : Number(maxAltitude)
    const minGs = minSpeed.trim() === '' ? null : Number(minSpeed)
    const maxGs = maxSpeed.trim() === '' ? null : Number(maxSpeed)

    return aircraft.filter((item) => {
      const matchesSearch = !query || [
        item.callsign, item.icao24, item.registration, item.aircraftType,
        item.airline, item.originCountry, item.squawk, item.category,
      ].some((value) => value?.toLowerCase().includes(query))
      if (!matchesSearch) return false

      if (statusFilter === 'airborne' && item.onGround !== false) return false
      if (statusFilter === 'ground' && item.onGround !== true) return false
      if (statusFilter === 'unknown' && item.onGround != null) return false

      const isHelicopter = Boolean(item.isHelicopter) || item.category === 'Helicopter'
      if (aircraftKindFilter === 'helicopter' && !isHelicopter) return false
      if (aircraftKindFilter === 'non-helicopter' && isHelicopter) return false

      const hasType = Boolean(item.aircraftType?.trim())
      if (typeFilter === 'known' && !hasType) return false
      if (typeFilter === 'unknown' && hasType) return false

      if (minAlt != null && (!Number.isFinite(minAlt) || item.altitudeFt == null || item.altitudeFt < minAlt)) return false
      if (maxAlt != null && (!Number.isFinite(maxAlt) || item.altitudeFt == null || item.altitudeFt > maxAlt)) return false
      if (minGs != null && (!Number.isFinite(minGs) || item.speedKt == null || item.speedKt < minGs)) return false
      if (maxGs != null && (!Number.isFinite(maxGs) || item.speedKt == null || item.speedKt > maxGs)) return false
      return true
    })
  }, [aircraft, search, statusFilter, aircraftKindFilter, typeFilter, minAltitude, maxAltitude, minSpeed, maxSpeed])

  const activeFilterCount = [
    search.trim() !== '', statusFilter !== 'all', aircraftKindFilter !== 'all',
    typeFilter !== 'all', minAltitude !== '', maxAltitude !== '', minSpeed !== '', maxSpeed !== '',
  ].filter(Boolean).length

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setAircraftKindFilter('all')
    setTypeFilter('all')
    setMinAltitude('')
    setMaxAltitude('')
    setMinSpeed('')
    setMaxSpeed('')
  }

  const selectedAircraft = useMemo(
    () => aircraft.find((item) => item.id === selectedId) ?? null,
    [aircraft, selectedId],
  )

  useEffect(() => {
    if (!selectedAircraft) {
      setSelectedDetails(null)
      setDetailsLoading(false)
      setDetailsError(null)
      return
    }

    const controller = new AbortController()
    let active = true

    setSelectedDetails(null)
    setDetailsLoading(true)
    setDetailsError(null)

    fetchAircraftDetails(
      selectedAircraft.icao24,
      selectedAircraft.callsign,
      controller.signal,
    )
      .then((details) => {
        if (active) setSelectedDetails(details)
      })
      .catch((caught: unknown) => {
        if (
          !active ||
          (caught instanceof Error && caught.name === 'AbortError')
        ) {
          return
        }

        setDetailsError(
          caught instanceof Error
            ? caught.message
            : 'Aircraft details are unavailable.',
        )
      })
      .finally(() => {
        if (active) setDetailsLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [selectedAircraft?.icao24, selectedAircraft?.callsign])

  const airborneCount = aircraft.filter(
    (item) => item.onGround === false,
  ).length

  const groundCount = aircraft.filter(
    (item) => item.onGround === true,
  ).length

  const origin =
    selectedDetails?.origin || selectedAircraft?.origin || null

  const destination =
    selectedDetails?.destination || selectedAircraft?.destination || null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path
                d="M20 5 7 31h8l5-10 5 10h8L20 5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M13 25h14" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <div className="brand-name">AeroTrace</div>
            <div className="brand-subtitle">GLOBAL TRACKING SYSTEM</div>
          </div>
        </div>

        <div className="topbar-status">
          <span className={`status-dot ${error ? 'status-error' : ''}`} />
          <span>{error ? 'Connection issue' : 'Aircraft feed'}</span>
          <span className="status-divider" />
          <span className="source-label">{source}</span>
        </div>

        <div className="topbar-actions">
          <span className="live-pill">
            <span className={`status-dot ${error ? 'status-error' : ''}`} />
            {loading ? 'CONNECTING' : error ? 'DEGRADED' : 'LIVE'}
          </span>
        </div>
      </header>

      <section className="dashboard">
        <div className="map-stage">
          <MapView
            aircraft={filteredAircraft}
            selectedId={selectedId}
            onSelect={handleSelect}
            onBoundsChange={handleBoundsChange}
            showTrails={showTrails}
            showLabels={showLabels}
            showAirports={showAirports}
          />
        </div>

        <aside
          className={`sidebar panel ${
            mobilePanel === 'list' ? 'mobile-panel-open' : ''
          }`}
          aria-label="Aircraft search and controls"
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AIRSPACE MONITOR</span>
              <h1>Aircraft</h1>
              <p>Traffic in the visible map area</p>
            </div>
            <button
              type="button"
              className="panel-close mobile-only"
              onClick={() => setMobilePanel(null)}
              aria-label="Close aircraft panel"
            >
              ×
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">TRACKED</span>
              <strong>{formatNumber(aircraft.length)}</strong>
              <span className="stat-caption">Visible aircraft</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">AIRBORNE</span>
              <strong>{formatNumber(airborneCount)}</strong>
              <span className="stat-caption">In flight</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">ON GROUND</span>
              <strong>{formatNumber(groundCount)}</strong>
              <span className="stat-caption">Ground status known</span>
            </div>
          </div>

          <label className="search-box">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                cx="10.8"
                cy="10.8"
                r="6.8"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="m16 16 4.2 4.2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              placeholder="Callsign, ICAO24, country..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>

          <section className="filter-panel" aria-label="Aircraft filters">
            <div className="filter-panel-heading">
              <span className="section-heading-label">FILTERS</span>
              <span className="filter-count">{activeFilterCount} active</span>
              <button type="button" className="filter-reset" onClick={clearFilters} disabled={activeFilterCount === 0}>Reset</button>
            </div>
            <label className="filter-field">
              <span>Flight status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">All statuses</option>
                <option value="airborne">Airborne</option>
                <option value="ground">On ground</option>
                <option value="unknown">Unknown status</option>
              </select>
            </label>
            <div className="filter-two-column">
              <label className="filter-field">
                <span>Aircraft kind</span>
                <select value={aircraftKindFilter} onChange={(event) => setAircraftKindFilter(event.target.value as typeof aircraftKindFilter)}>
                  <option value="all">All kinds</option>
                  <option value="helicopter">Helicopters</option>
                  <option value="non-helicopter">Non-helicopters</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Aircraft type</span>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
                  <option value="all">Any type data</option>
                  <option value="known">Type known</option>
                  <option value="unknown">Type unknown</option>
                </select>
              </label>
            </div>
            <div className="filter-range-group">
              <span className="filter-range-title">Altitude (ft)</span>
              <div className="filter-two-column">
                <label className="filter-field"><span className="sr-only">Minimum altitude in feet</span><input type="number" min="0" placeholder="Min altitude" value={minAltitude} onChange={(event) => setMinAltitude(event.target.value)} /></label>
                <label className="filter-field"><span className="sr-only">Maximum altitude in feet</span><input type="number" min="0" placeholder="Max altitude" value={maxAltitude} onChange={(event) => setMaxAltitude(event.target.value)} /></label>
              </div>
            </div>
            <div className="filter-range-group">
              <span className="filter-range-title">Ground speed (kt)</span>
              <div className="filter-two-column">
                <label className="filter-field"><span className="sr-only">Minimum ground speed in knots</span><input type="number" min="0" placeholder="Min speed" value={minSpeed} onChange={(event) => setMinSpeed(event.target.value)} /></label>
                <label className="filter-field"><span className="sr-only">Maximum ground speed in knots</span><input type="number" min="0" placeholder="Max speed" value={maxSpeed} onChange={(event) => setMaxSpeed(event.target.value)} /></label>
              </div>
            </div>
          </section>

          <div className="section-heading">
            <span>DETECTED AIRCRAFT</span>
            <span className="count-chip">{filteredAircraft.length}</span>
          </div>

          <div className="aircraft-list">
            {loading && aircraft.length === 0 && (
              <div className="empty-state">
                <span className="loading-ring" />
                <strong>Scanning airspace</strong>
                <p>Loading aircraft positions…</p>
              </div>
            )}

            {!loading && !error && filteredAircraft.length === 0 && (
              <div className="empty-state">
                <span className="empty-symbol">⌕</span>
                <strong>No aircraft found</strong>
                <p>
                  Try changing your filters or move the map to another area.
                </p>
              </div>
            )}

            {error && aircraft.length === 0 && (
              <div className="empty-state error-state" role="alert">
                <strong>Feed unavailable</strong>
                <p>{error}</p>
                <small>Check that the API server is running on port 3000.</small>
              </div>
            )}

            {filteredAircraft.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`aircraft-row ${
                  selectedId === item.id ? 'selected' : ''
                }`}
                onClick={() => handleSelect(item.id)}
              >
                <span className="row-plane" aria-hidden="true">✈</span>
                <span className="row-main">
                  <span className="row-topline">
                    <strong>
                      {item.callsign || item.icao24.toUpperCase()}
                    </strong>
                  </span>
                  <span className="row-type">
                    {item.aircraftType ||
                      item.airline ||
                      item.originCountry ||
                      item.icao24.toUpperCase()}
                  </span>
                  <span className="row-bottomline">
                    <span>{formatAltitude(item.altitudeFt)}</span>
                    <span>{formatSpeed(item.speedKt)}</span>
                  </span>
                </span>
                <span className="row-chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>

          <div className="panel-section">
            <div className="section-heading section-heading-plain">
              <span>MAP DISPLAY</span>
            </div>

            <label className="toggle-row">
              <span>
                <span className="toggle-icon">Aa</span>
                <span>
                  <strong>Aircraft labels</strong>
                  <small>Show callsigns when hovering</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(event) => setShowLabels(event.target.checked)}
              />
            </label>

            <label className="toggle-row">
              <span>
                <span className="toggle-icon">⌁</span>
                <span>
                  <strong>Flight trails</strong>
                  <small>Show recorded movement</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={showTrails}
                onChange={(event) => setShowTrails(event.target.checked)}
              />
            </label>

            <label className="toggle-row">
              <span>
                <span className="toggle-icon">⊙</span>
                <span>
                  <strong>Airports</strong>
                  <small>Major airports and codes</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={showAirports}
                onChange={(event) => setShowAirports(event.target.checked)}
              />
            </label>
          </div>

          <footer className="panel-footer">
            <span className={`status-dot ${error ? 'status-error' : ''}`} />
            <span>{error ? 'Feed connection issue' : 'OpenSky data feed'}</span>
            <span className="footer-spacer" />
            <span>
              {loading ? 'Connecting…' : error ? 'Retrying…' : 'Connected'}
            </span>
          </footer>
        </aside>

        <aside
          className={`details-panel panel ${
            selectedAircraft ? 'has-selection' : ''
          } ${mobilePanel === 'details' ? 'mobile-panel-open' : ''}`}
          aria-label="Selected aircraft details"
        >
          <div className="panel-heading details-panel-heading">
            <div>
              <span className="eyebrow">FLIGHT INSPECTOR</span>
              <h2>Aircraft details</h2>
              <p>Live position and identification</p>
            </div>
            <button
              type="button"
              className="panel-close mobile-only"
              onClick={() => setMobilePanel(null)}
              aria-label="Close details panel"
            >
              ×
            </button>
          </div>

          {!selectedAircraft ? (
            <div className="details-empty">
              <div className="empty-plane" aria-hidden="true">✈</div>
              <strong>Select an aircraft</strong>
              <p>
                Choose an aircraft from the list or click a marker on the map
                to inspect its live data.
              </p>
            </div>
          ) : (
            <div className="details-content">
              <div className="selected-aircraft-title">
                <div className="selected-plane-icon" aria-hidden="true">✈</div>
                <div className="selected-title-text">
                  <h3>{selectedAircraft.callsign || 'Unknown callsign'}</h3>
                  <p>
                    {selectedDetails?.aircraftType ||
                      selectedAircraft.aircraftType ||
                      selectedDetails?.airline ||
                      selectedAircraft.airline ||
                      'Aircraft type unavailable'}
                  </p>
                </div>
              </div>

              <div className="details-badges">
                <span
                  className={`detail-badge ${
                    selectedAircraft.onGround === true
                      ? 'ground-badge'
                      : selectedAircraft.onGround === false
                        ? 'airborne-badge'
                        : ''
                  }`}
                >
                  <span className="badge-dot" />
                  {selectedAircraft.onGround === true
                    ? 'On ground'
                    : selectedAircraft.onGround === false
                      ? 'Airborne'
                      : 'Status unknown'}
                </span>
                <span className="detail-badge">
                  {selectedAircraft.category}
                </span>
              </div>

              <AircraftPhoto
                icao24={selectedAircraft.icao24}
                registration={
                  selectedDetails?.registration || selectedAircraft.registration
                }
              />

              <section className="detail-section">
                <div className="section-heading section-heading-plain">
                  <span>FLIGHT DATA</span>
                </div>
                <div className="detail-grid">
                  <div className="detail-metric">
                    <span>Altitude</span>
                    <strong>{formatAltitude(selectedAircraft.altitudeFt)}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>Ground speed</span>
                    <strong>{formatSpeed(selectedAircraft.speedKt)}</strong>
                  </div>
                  <div className="detail-metric">
                    <span>Heading</span>
                    <strong>
                      {selectedAircraft.heading == null
                        ? '—'
                        : `${formatNumber(selectedAircraft.heading)}°`}
                    </strong>
                  </div>
                  <div className="detail-metric">
                    <span>Vertical rate</span>
                    <strong>
                      {formatVerticalRate(selectedAircraft.verticalRateFpm)}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="detail-section">
                <div className="section-heading section-heading-plain">
                  <span>IDENTIFICATION</span>
                </div>
                <div className="detail-line">
                  <span>ICAO24</span>
                  <strong>{selectedAircraft.icao24.toUpperCase()}</strong>
                </div>
                <div className="detail-line">
                  <span>Registration</span>
                  <strong>
                    {selectedDetails?.registration ||
                      selectedAircraft.registration ||
                      'Unavailable'}
                  </strong>
                </div>
                <div className="detail-line">
                  <span>Aircraft type</span>
                  <strong>
                    {selectedDetails?.aircraftType ||
                      selectedAircraft.aircraftType ||
                      'Unavailable'}
                  </strong>
                </div>
                <div className="detail-line">
                  <span>Airline / operator</span>
                  <strong>
                    {selectedDetails?.airline ||
                      selectedAircraft.airline ||
                      'Unavailable'}
                  </strong>
                </div>
                <div className="detail-line">
                  <span>Country</span>
                  <strong>
                    {selectedAircraft.originCountry || 'Unavailable'}
                  </strong>
                </div>
                <div className="detail-line">
                  <span>Squawk</span>
                  <strong>{selectedAircraft.squawk || 'Unavailable'}</strong>
                </div>
                <div className="detail-line">
                  <span>Last contact</span>
                  <strong>
                    {formatLastSeen(selectedAircraft.lastSeenSeconds)}
                  </strong>
                </div>
              </section>

              <section className="detail-section">
                <div className="section-heading section-heading-plain">
                  <span>FLIGHT ROUTE</span>
                </div>

                <div style={routeCardStyle}>
                  <div style={routeEndpointStyle}>
                    <span style={routeLabelStyle}>DEPARTURE</span>
                    <strong style={routeCodeStyle}>
                      {origin || 'Unknown'}
                    </strong>
                  </div>

                  <div
                    aria-hidden="true"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      color: '#58A9FF',
                    }}
                  >
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>✈</span>
                    <span
                      style={{
                        width: '100%',
                        borderTop: '1px dashed rgba(88, 169, 255, 0.7)',
                      }}
                    />
                  </div>

                  <div
                    style={{
                      ...routeEndpointStyle,
                      alignItems: 'flex-end',
                      textAlign: 'right',
                    }}
                  >
                    <span style={routeLabelStyle}>DESTINATION</span>
                    <strong style={routeCodeStyle}>
                      {destination || 'Unknown'}
                    </strong>
                  </div>
                </div>

                <p className="data-disclaimer">
                  {detailsLoading
                    ? 'Looking up aircraft and route information…'
                    : detailsError
                      ? 'Route lookup is temporarily unavailable.'
                      : selectedDetails?.routeAvailable
                        ? 'Route supplied by an external metadata source. It may not represent the aircraft’s current clearance.'
                        : 'No route record found. The aircraft may still be in flight.'}
                </p>
              </section>

              <section className="detail-section">
                <div className="section-heading section-heading-plain">
                  <span>POSITION</span>
                </div>
                <div className="detail-line">
                  <span>Latitude</span>
                  <strong>{selectedAircraft.latitude.toFixed(5)}°</strong>
                </div>
                <div className="detail-line">
                  <span>Longitude</span>
                  <strong>{selectedAircraft.longitude.toFixed(5)}°</strong>
                </div>
              </section>

              <p className="data-disclaimer">
                The recorded trail begins when AeroTrace observes the aircraft.
                The blue line is a heading-based estimate, not a confirmed route.
                Registration, aircraft type, airline and route details may not
                be available in every response.
              </p>
            </div>
          )}

          <footer className="details-footer">
            <span>DATA SOURCE</span>
            <strong>{source}</strong>
            <span className="footer-spacer" />
            <span>
              {updatedAt
                ? new Date(updatedAt * 1000).toLocaleTimeString()
                : 'Waiting for data'}
            </span>
          </footer>
        </aside>

        <div className="map-top-label">
          <span className="map-top-label-icon">◎</span>
          <span>
            <strong>GLOBAL AIRSPACE</strong>
            <small>Worldwide coverage</small>
          </span>
        </div>

        <div className="map-legend">
          <span><i className="legend-dot airborne" /> Airborne</span>
          <span><i className="legend-dot grounded" /> On ground</span>
          <span><i className="legend-line projected" /> Projected path</span>
          <span><i className="legend-line historical" /> Recorded trail</span>
        </div>

        {loading && aircraft.length > 0 && (
          <div className="map-refresh-indicator">
            <span className="status-dot" />
            Connecting to aircraft feed…
          </div>
        )}

        {error && aircraft.length > 0 && (
          <div className="map-message" role="status">
            <span className="status-dot status-error" />
            Refresh failed: {error}
          </div>
        )}

        <button
          type="button"
          className="mobile-list-toggle"
          onClick={() =>
            setMobilePanel((current) =>
              current === 'list' ? null : 'list',
            )
          }
        >
          Aircraft <span>{filteredAircraft.length}</span>
        </button>

        {selectedAircraft && (
          <button
            type="button"
            className="mobile-details-toggle"
            onClick={() =>
              setMobilePanel((current) =>
                current === 'details' ? null : 'details',
              )
            }
          >
            Selected: {selectedAircraft.callsign || selectedAircraft.icao24}
          </button>
        )}

        <div className="map-attribution">
          <span>Source: {source}</span>
          <span>•</span>
          <span>
            {updatedAt
              ? `Updated ${new Date(updatedAt * 1000).toLocaleTimeString()}`
              : 'Waiting for first update'}
          </span>
          <span>•</span>
          <span>Positions may be delayed</span>
        </div>
      </section>
    </main>
  )
}
