# AeroTrace

Dark-themed worldwide aircraft tracking UI prototype. Current aircraft are **fictional sample records**; this version does not fetch live aircraft data.

## Requirements

- Node.js 20.19+ or 22.12+ recommended
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

## Production build

```bash
npm run build
npm run preview
```

## Current features

- Dark, responsive aviation dashboard
- Interactive MapLibre map with sample aircraft markers
- Search by callsign, registration, aircraft type, or origin/destination
- Filter by aircraft category
- Select a map marker or list item to view details
- Sample aircraft list and count
- Data status clearly marked as DEMO DATA

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
