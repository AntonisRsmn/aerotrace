import { useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowUpRight, ChevronDown, Crosshair, Filter,
  Globe2, Layers3, Menu, Plane, Radio, Search, Settings2, SlidersHorizontal,
  X, Zap,
} from 'lucide-react'
import MapView from './components/MapView'
import { sampleAircraft } from './data/aircraft'
import type { Aircraft } from './types'

const categories = ['All aircraft', 'Passenger', 'Cargo', 'Business', 'Military', 'General aviation'] as const
type CategoryFilter = typeof categories[number]

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function AircraftIcon({ className = '' }: { className?: string }) {
  return <Plane size={16} className={className} />
}

function App() {
  const [selectedId, setSelectedId] = useState(sampleAircraft[0].id)
  const [detailOpen, setDetailOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('All aircraft')
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const filteredAircraft = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sampleAircraft.filter((aircraft) => {
      const categoryMatch = category === 'All aircraft' || aircraft.category === category
      const searchMatch = !query || [
        aircraft.callsign, aircraft.registration, aircraft.aircraftType,
        aircraft.airline, aircraft.origin, aircraft.destination,
      ].some((value) => value.toLowerCase().includes(query))
      return categoryMatch && searchMatch
    })
  }, [search, category])

  const selectedAircraft = filteredAircraft.find((aircraft) => aircraft.id === selectedId)
    ?? filteredAircraft[0]
  const passengerCount = sampleAircraft.filter((item) => item.category === 'Passenger').length
  const cargoCount = sampleAircraft.filter((item) => item.category === 'Cargo').length

  function selectAircraft(aircraft: Aircraft) {
    setSelectedId(aircraft.id)
    setDetailOpen(true)
    setMobileListOpen(false)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="AeroTrace home">
          <span className="brand-mark"><Crosshair size={23} strokeWidth={1.8} /></span>
          <span className="brand-copy">
            <span className="brand-name">AERO<span>TRACE</span></span>
            <span className="brand-subtitle">GLOBAL TRAFFIC INTELLIGENCE</span>
          </span>
        </a>

        <div className="topbar-center">
          <span className="system-dot" />
          <span>TRACKING SYSTEM</span>
          <span className="topbar-divider" />
          <span className="muted">WORLDWIDE VIEW</span>
        </div>

        <div className="topbar-actions">
          <span className="demo-pill"><span /> DEMO DATA</span>
          <button className="icon-button" aria-label="Settings (coming soon)" title="Settings coming soon"><Settings2 size={18} /></button>
          <button className="avatar" aria-label="Profile">AT</button>
        </div>
      </header>

      <section className="workspace">
        <aside className={`traffic-sidebar ${mobileListOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-heading">
            <div>
              <div className="eyebrow">AIRSPACE OVERVIEW</div>
              <h1>Traffic explorer</h1>
            </div>
            <button className="icon-button close-mobile" onClick={() => setMobileListOpen(false)} aria-label="Close traffic list"><X size={18} /></button>
          </div>

          <div className="traffic-stats">
            <div className="stat-card">
              <div className="stat-icon blue"><Plane size={16} /></div>
              <div className="stat-value">{formatNumber(sampleAircraft.length)}</div>
              <div className="stat-label">AIRCRAFT IN VIEW</div>
              <div className="stat-foot"><span className="tiny-dot" /> Sample dataset</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon violet"><Activity size={16} /></div>
              <div className="stat-value">{passengerCount + cargoCount}</div>
              <div className="stat-label">AIRLINE TRAFFIC</div>
              <div className="stat-foot">Passenger & cargo</div>
            </div>
          </div>

          <div className="section-title-row">
            <div className="section-title">AIRCRAFT <span className="count-chip">{filteredAircraft.length}</span></div>
            <button className={`subtle-icon ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)} aria-label="Toggle filters"><SlidersHorizontal size={16} /></button>
          </div>

          <div className="search-box">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Callsign, flight, aircraft..." aria-label="Search aircraft" />
            {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
            {!search && <kbd>/</kbd>}
          </div>

          {showFilters && (
            <div className="filter-panel">
              <div className="filter-label"><Filter size={13} /> FILTER BY CATEGORY</div>
              <div className="category-chips">
                {categories.map((item) => (
                  <button key={item} className={`category-chip ${category === item ? 'selected' : ''}`} onClick={() => setCategory(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="aircraft-list">
            {filteredAircraft.map((aircraft) => (
              <button key={aircraft.id} className={`aircraft-row ${selectedAircraft?.id === aircraft.id ? 'selected' : ''}`} onClick={() => selectAircraft(aircraft)}>
                <span className="row-plane"><AircraftIcon /></span>
                <span className="row-main">
                  <span className="row-topline"><strong>{aircraft.callsign}</strong><span className="row-alt">{Math.round(aircraft.altitudeFt / 100)} <small>FL</small></span></span>
                  <span className="row-type">{aircraft.aircraftType}</span>
                  <span className="row-route">{aircraft.origin.split(' (')[0]} <span>→</span> {aircraft.destination.split(' (')[0]}</span>
                </span>
                <ChevronDown className="row-chevron" size={14} />
              </button>
            ))}
            {filteredAircraft.length === 0 && <div className="empty-state">No aircraft match your search.</div>}
          </div>

          <div className="sidebar-footer">
            <span><span className="tiny-dot" /> SAMPLE POSITIONS</span>
            <span>NOT LIVE</span>
          </div>
        </aside>

        <section className="map-section">
          <div className="map-top-controls">
            <div className="map-location">
              <span className="location-icon"><Globe2 size={16} /></span>
              <span><strong>WORLD</strong><small>Global airspace</small></span>
            </div>
            <div className="map-control-group">
              <button className="map-control" title="Layers (coming soon)"><Layers3 size={16} /><span>Layers</span><ChevronDown size={13} /></button>
              <button className="map-control" title="Map filters" onClick={() => setShowFilters(!showFilters)}><Filter size={16} /><span>Filters</span></button>
            </div>
          </div>

          <MapView aircraft={filteredAircraft} selectedId={selectedAircraft?.id ?? ''} onSelect={selectAircraft} />

          <div className="map-legend">
            <span className="legend-item"><i className="legend-plane passenger">✈</i> Passenger</span>
            <span className="legend-item"><i className="legend-plane cargo">✈</i> Cargo</span>
            <span className="legend-item"><i className="legend-plane other">✈</i> Other</span>
          </div>

          <div className="map-bottom-left">
            <span className="coords"><Crosshair size={13} /> GLOBAL VIEW</span>
            <span className="bottom-separator" />
            <span className="map-provider">MAPLIBRE</span>
          </div>

          <button className="mobile-list-toggle" onClick={() => setMobileListOpen(true)}><Menu size={17} /> Traffic list <span>{filteredAircraft.length}</span></button>

          {selectedAircraft && detailOpen && (
            <aside className="detail-panel">
              <div className="detail-header">
                <div>
                  <div className="eyebrow">SELECTED TARGET</div>
                  <h2>{selectedAircraft.callsign}</h2>
                  <div className="detail-registration">{selectedAircraft.registration} <span className="detail-dot" /> {selectedAircraft.category.toUpperCase()}</div>
                </div>
                <button className="icon-button" onClick={() => setDetailOpen(false)} aria-label="Close selected aircraft panel"><X size={17} /></button>
              </div>

              <div className="detail-aircraft-visual">
                <div className="aircraft-visual-glow" />
                <div className="big-plane" style={{ transform: `rotate(${selectedAircraft.heading}deg)` }}><Plane size={52} strokeWidth={1.1} /></div>
                <div className="visual-type">{selectedAircraft.aircraftType}</div>
                <div className="visual-airline">{selectedAircraft.airline}</div>
              </div>

              <div className="detail-metrics">
                <div className="metric">
                  <span className="metric-label">ALTITUDE</span>
                  <strong>{formatNumber(selectedAircraft.altitudeFt)} <small>FT</small></strong>
                  <span className="metric-note">FL{Math.round(selectedAircraft.altitudeFt / 100)}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">GROUND SPEED</span>
                  <strong>{selectedAircraft.speedKt} <small>KT</small></strong>
                  <span className="metric-note">{Math.round(selectedAircraft.speedKt * 1.852)} km/h</span>
                </div>
                <div className="metric">
                  <span className="metric-label">HEADING</span>
                  <strong>{String(selectedAircraft.heading).padStart(3, '0')}<small>°</small></strong>
                  <span className="metric-note">Magnetic-style demo</span>
                </div>
                <div className="metric">
                  <span className="metric-label">VERTICAL RATE</span>
                  <strong className="vertical-rate">{selectedAircraft.verticalRateFpm > 0 ? <ArrowUpRight size={17} /> : selectedAircraft.verticalRateFpm < 0 ? <ArrowDownRight size={17} /> : null}{selectedAircraft.verticalRateFpm > 0 ? '+' : ''}{selectedAircraft.verticalRateFpm} <small>FPM</small></strong>
                  <span className="metric-note">{selectedAircraft.verticalRateFpm > 0 ? 'Climbing' : selectedAircraft.verticalRateFpm < 0 ? 'Descending' : 'Level flight'}</span>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-heading">FLIGHT INFORMATION <span>01 / 02</span></div>
                <div className="route-visual">
                  <div className="route-point"><span className="route-ring" /><div><strong>{selectedAircraft.origin.split(' (')[0]}</strong><small>{selectedAircraft.origin.match(/\((.*?)\)/)?.[1] ?? '—'}</small></div></div>
                  <div className="route-line"><span /><span /><span /><span /><span /></div>
                  <div className="route-point destination"><span className="route-ring" /><div><strong>{selectedAircraft.destination.split(' (')[0]}</strong><small>{selectedAircraft.destination.match(/\((.*?)\)/)?.[1] ?? '—'}</small></div></div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-heading">AIRCRAFT DETAILS <span>02 / 02</span></div>
                <div className="info-grid">
                  <div><span>Operator</span><strong>{selectedAircraft.airline}</strong></div>
                  <div><span>Aircraft type</span><strong>{selectedAircraft.aircraftType}</strong></div>
                  <div><span>Transponder</span><strong>{selectedAircraft.squawk}</strong></div>
                  <div><span>Position age</span><strong>{selectedAircraft.lastSeenSeconds}s <small>ago</small></strong></div>
                  <div><span>Latitude</span><strong>{selectedAircraft.latitude.toFixed(4)}°</strong></div>
                  <div><span>Longitude</span><strong>{selectedAircraft.longitude.toFixed(4)}°</strong></div>
                </div>
              </div>

              <div className="detail-disclaimer"><Radio size={14} /><span>Fictional demonstration data. No live telemetry is connected.</span></div>
            </aside>
          )}

          <div className="map-statusbar">
            <span><span className="status-dot" /> SYSTEM READY</span>
            <span className="status-divider" />
            <span><Zap size={12} /> {filteredAircraft.length} TARGETS</span>
            <span className="status-spacer" />
            <span>DATA SOURCE: SIMULATED</span>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
