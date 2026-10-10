
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

type AircraftPhoto = {
  src: string
  link: string
  photographer: string
}

type CachedPhoto = {
  photo: AircraftPhoto | null
  cachedAt: number
}

const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const PHOTO_MISS_CACHE_TTL_MS = 5 * 60 * 1000
const PHOTO_CACHE_MAX_SIZE = 2000

function aircraftPhotoApi(): Plugin {
  const cache = new Map<string, CachedPhoto>()

  async function lookupPhoto(
    icao24: string,
    registration: string,
  ): Promise<AircraftPhoto | null> {
    const urls = [
      `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24)}`,
      ...(registration
        ? [
            `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
          ]
        : []),
    ]

    for (const endpoint of urls) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'AeroTrace/1.0 aircraft-photo-lookup',
          },
          signal: AbortSignal.timeout(8000),
        })

        if (!response.ok) continue

        const payload: unknown = await response.json()

        if (
          !payload ||
          typeof payload !== 'object' ||
          !('photos' in payload) ||
          !Array.isArray(payload.photos)
        ) {
          continue
        }

        for (const item of payload.photos) {
          if (!item || typeof item !== 'object') continue

          const record = item as {
            thumbnail_large?: { src?: string } | string
            thumbnail?: { src?: string } | string
            thumbnail_small?: { src?: string } | string
            src?: string
            url?: string
            link?: string
            photographer?: string
          }

          const thumbnailSource = (value: unknown): string | null => {
            if (typeof value === 'string') return value
            if (
              value &&
              typeof value === 'object' &&
              'src' in value &&
              typeof value.src === 'string'
            ) {
              return value.src
            }
            return null
          }

          const src =
            thumbnailSource(record.thumbnail_large) ||
            thumbnailSource(record.thumbnail) ||
            thumbnailSource(record.thumbnail_small) ||
            record.src

          const link = record.link || record.url

          if (
            typeof src !== 'string' ||
            !src.startsWith('https://') ||
            typeof link !== 'string' ||
            !link.startsWith('https://')
          ) {
            continue
          }

          return {
            src,
            link,
            photographer:
              typeof record.photographer === 'string'
                ? record.photographer
                : 'Unknown photographer',
          }
        }
      } catch (error) {
        console.warn(
          '[AeroTrace photo lookup]',
          error instanceof Error ? error.message : error,
        )
      }
    }

    return null
  }

  return {
    name: 'aerotrace-aircraft-photo-api',

    configureServer(server) {
      // Register before Vite's normal middleware so this route is handled
      // locally, while other /api requests continue to the existing proxy.
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(
          request.url || '/',
          'http://localhost',
        )

        if (
          request.method !== 'GET' ||
          requestUrl.pathname !== '/api/aircraft-photo'
        ) {
          return next()
        }

        response.setHeader(
          'Content-Type',
          'application/json; charset=utf-8',
        )
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')

        const sendJson = (status: number, body: unknown) => {
          response.statusCode = status
          response.end(JSON.stringify(body))
        }

        const icao24 = (
          requestUrl.searchParams.get('icao24') || ''
        ).trim().toLowerCase()

        const registration = (
          requestUrl.searchParams.get('registration') || ''
        ).trim().toUpperCase()

        if (!/^[a-f0-9]{6}$/.test(icao24)) {
          return sendJson(400, {
            error: 'A valid six-character ICAO24 address is required.',
            photo: null,
          })
        }

        if (
          registration.length > 12 ||
          (registration && !/^[A-Z0-9-]+$/.test(registration))
        ) {
          return sendJson(400, {
            error: 'Invalid aircraft registration.',
            photo: null,
          })
        }

        const key = `${icao24}:${registration}`
        const cached = cache.get(key)

        if (
          cached &&
          Date.now() - cached.cachedAt <
            (cached.photo ? PHOTO_CACHE_TTL_MS : PHOTO_MISS_CACHE_TTL_MS)
        ) {
          return sendJson(200, {
            photo: cached.photo,
            cached: true,
          })
        }

        try {
          const photo = await lookupPhoto(icao24, registration)

          cache.delete(key)
          cache.set(key, {
            photo,
            cachedAt: Date.now(),
          })

          while (cache.size > PHOTO_CACHE_MAX_SIZE) {
            const oldestKey = cache.keys().next().value
            if (oldestKey === undefined) break
            cache.delete(oldestKey)
          }

          return sendJson(200, {
            photo,
            cached: false,
          })
        } catch (error) {
          console.error(
            '[AeroTrace photo API]',
            error instanceof Error ? error.message : error,
          )

          return sendJson(502, {
            error: 'The aircraft photo service is temporarily unavailable.',
            photo: null,
          })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), aircraftPhotoApi()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
