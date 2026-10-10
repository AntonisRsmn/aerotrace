# AeroTrace

Dark-themed worldwide aircraft tracking dashboard with **live**, **hybrid**, and **demo** aircraft feeds. Hybrid mode combines real aircraft from the existing provider pipeline with clearly labeled simulated traffic.

## Requirements

- Node.js 20.19+ or 22.12+ recommended
- npm

## Run locally

```bash
npm install
```

Create a `.env` file in the project root:

```dotenv
# Use simulated traffic without calling live aircraft-position providers
AEROTRACE_MODE=dev
DEMO_AIRCRAFT_COUNT=1000
```

Start the API and frontend in **two separate terminals**:

```bash
npm run dev:api
```

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Demo mode still uses the map tiles and airport dataset required to draw the basemap and airports; it does not call live aircraft-position or aircraft-detail providers.

## Production build

```bash
npm run build
npm run preview
```

## Current features

- Dark, responsive aviation dashboard
- Interactive MapLibre map with 1000 configurable, moving simulated aircraft across worldwide airport-to-airport routes in demo mode
- Select an aircraft to see its growing recent-position trail while it moves
- Real airline names and ICAO airline designators in realistic-format simulated callsigns; generated flight numbers and routes are not actual live flights
- Approximate takeoff/climb, cruise, and descent profiles with corresponding speed and altitude changes
- Explicit `DEMO DATA` and generated-count labels so simulated traffic is not mistaken for live traffic
- `AEROTRACE_MODE=live` for real aircraft only, `hybrid` for live aircraft plus simulated traffic, or `demo` for simulated traffic only
- `DEMO_AIRCRAFT_COUNT` to configure 100–3000 simulated aircraft in hybrid/demo mode
- Search by callsign, registration, aircraft type, or origin/destination
- Filter by aircraft category
- Select a map marker or list item to view details
- Sample aircraft list and count
- Data status clearly marked as DEMO DATA

## Switching aircraft data modes

Edit `.env` and restart `npm run dev:api` after changing the mode:

```dotenv
# Real aircraft plus simulated background traffic
AEROTRACE_MODE=hybrid
DEMO_AIRCRAFT_COUNT=1000
```

Available modes:

- `hybrid`: real aircraft from the live provider pipeline plus simulated flights filling out worldwide traffic. The interface shows live and simulated counts separately.
- `live`: only provider-reported real aircraft.
- `demo` (or `dev`): simulated traffic only; no live aircraft-position provider calls.

`real` is accepted as a live-mode alias. If `DEMO_AIRCRAFT_COUNT` is omitted, the default is 1000; the server clamps the value to 100–3000. Simulated traffic is clearly labeled and must not be mistaken for actual aircraft. Keep `.env` local and do not commit provider credentials.

## Architecture

```text
src/
  components/       Reusable UI components
  data/aircraft.ts  Fictional sample data
  types.ts          Shared aircraft domain type
  App.tsx           Dashboard state and composition
  main.tsx          React entry point
  styles.css        App styling
```

When live data is added, use a backend adapter and normalize provider responses into `Aircraft`. Keep provider credentials on the server, cache provider responses according to their terms, and distribute updates to browsers from the backend. Do not call a provider once per browser/client.

## Map tiles and attribution

The prototype uses OpenStreetMap's public dark raster tiles through an explicit MapLibre style:
`https://tile.openstreetmap.org/{z}/{x}/{y}.png` (darkened in the browser with CSS)

MapLibre GL JS is open-source, but map tile/style services have separate terms, attribution requirements, and usage limits. Review OpenStreetMap's current basemap terms before deploying publicly or relying on it for sustained traffic. Replace the style URL with a properly licensed provider or self-hosted tiles for production if required.

## Live aircraft API licensing decision

No live provider is selected or called in this prototype.

- **OpenSky Network:** its current terms say operational REST API integration into a live product/service/automated system requires prior written agreement, and commercial use requires written permission/license. Do not use it as the production source without written approval. See https://opensky-network.org/about/terms-of-use
- **ADS-B Exchange:** its API is a commercial product and its data-use policy restricts redistributing or publicly sharing data except where authorized. Not a fit for a free-only plan without explicit authorization. See https://www.adsbexchange.com/api/aircraft/v2/docs and https://support.adsbexchange.com/hc/en-us/articles/37364077703693-What-is-ADS-B-Exchange-s-data-use-policy
- Before choosing any free source, verify current API access, rate limits, attribution, public display/redistribution rights, commercial/advertising restrictions, and caching requirements.

A future live-data backend should be a separate service (for example, Node.js + Express) with provider credentials stored in server-side environment variables. Avoid scraping public tracking websites or republishing data without permission.

## Future vessel support

The shared application model can later be extended with a discriminated target type (`aircraft` / `vessel`) and an AIS provider adapter. Vessel positions and identity fields should remain clearly sourced and timestamped.

## Render deployment

The `npm start` command builds the Vite frontend and then starts the Node server, so the frontend and API are served by the same Render Web Service. Use these Render settings:

- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** `AEROTRACE_MODE=demo` and optionally `DEMO_AIRCRAFT_COUNT=1000`

Set these under the Render service's **Environment** settings; do not rely on a local `.env` file being present in Render. Save the changes and redeploy. To switch to provider-backed data, change `AEROTRACE_MODE` to `real` and redeploy/restart. Demo mode does not call live aircraft-position or aircraft-detail providers, but the basemap still needs network access.
