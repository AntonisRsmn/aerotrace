# AeroTrace

Dark-themed worldwide aircraft tracking dashboard with **live**, **hybrid**, and **demo replay** modes. Demo mode replays archived ADS-B flight tracks with real recorded callsigns, aircraft identity, route geometry, and available movement samples; it does not display live aircraft positions.

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
AEROTRACE_MODE=demo
DEMO_AIRCRAFT_COUNT=1000
```

Start the API and frontend in **two separate terminals**:

```bash
npm run dev:api
```

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Demo mode downloads a cached batch of historical tracks from adsb.aero on the server, then replays those records as demo traffic. It does not query live aircraft-position providers. Basemap tiles still require network access.

## Production build

```bash
npm run build
npm run preview
```

## Current features

- Dark, responsive aviation dashboard
- Interactive MapLibre map that replays recorded ADS-B flight paths, including route bends rather than generated straight-line routes
- Recorded callsigns, aircraft registrations/types, departure and arrival airport identifiers, and observed altitude/track/speed samples when supplied by the archive
- Replay markers move along historical recorded routes; displayed positions are playback positions, not live positions
- Explicit `DEMO REPLAY` labeling so historical replay is not mistaken for live traffic
- `AEROTRACE_MODE=live` for provider-reported aircraft, `hybrid` for live aircraft plus historical replay, or `demo` for historical replay only
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

- `hybrid`: live provider-reported aircraft plus historical replay tracks; the interface shows live and replay counts separately.
- `live`: only provider-reported real aircraft.
- `demo` (or `dev`): historical recorded tracks replayed as demo traffic; no live aircraft-position provider calls.

`real` is accepted as a live-mode alias. If `DEMO_AIRCRAFT_COUNT` is omitted, the default is 1000; the server clamps the value to 100–3000. Historical replay traffic is clearly labeled and must not be mistaken for actual live positions. Keep `.env` local and do not commit provider credentials.

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

Demo mode uses the public historical archive API at https://adsb.aero/api/docs. The server caches successful track batches in memory and refreshes periodically. Verify the archive's current terms, attribution, and redistribution permissions before commercial/public launch.

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

Set these under the Render service's **Environment** settings; do not rely on a local `.env` file being present in Render. Save the changes and redeploy. To switch to provider-backed data, change `AEROTRACE_MODE` to `real` and redeploy/restart. Demo mode does not call live aircraft-position or aircraft-detail providers, but it does need access to the historical archive API and basemap network access.

## Aircraft photographs

AeroTrace uses a no-key photo lookup pipeline. It first queries Planespotters.net by exact aircraft registration and then ICAO24. If no exact provider photo is available, it searches the documented Wikimedia Commons API using the available registration, callsign, airline/operator, and aircraft model/type metadata.

The fallback order degrades deliberately from exact-aircraft identity to representative imagery: registration, registration + model, callsign + model, airline + model, then model. Representative images are labeled as such in the UI and are never presented as a confirmed photograph of the selected airframe. Wikimedia attribution/license metadata is retained when the API supplies it. Successful photo results are cached server-side for 24 hours; misses are cached briefly to avoid hammering providers.

No Google Programmable Search key or search-engine ID is required.
