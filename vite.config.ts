
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

// Local AeroTrace development address.
// If Vite uses another port, update this value accordingly.
const AEROTRACE_ORIGIN = 'http://localhost:5173'

function aircraftPhotoApi(): Plugin {
  const cache = new Map<string, CachedPhoto>()

  async function lookupPhoto(
    icao24: string,
    registration: string,
  ): Promise<AircraftPhoto | null> {
    const urls: string[] = []

    if (/^[a-f0-9]{6}$/.test(icao24)) {
      urls.push(
        `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24)}`,
      )
    }

    if (registration) {
      urls.push(
        `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
      )
    }

    for (const endpoint of urls) {
      try {
        const upstream = await fetch(endpoint, {
          headers: {
            Accept: 'application/json',
            Origin: AEROTRACE_ORIGIN,
            Referer: `${AEROTRACE_ORIGIN}/`,
            'User-Agent': 'AeroTrace/1.0 aircraft-photo-lookup',
          },
          signal: AbortSignal.timeout(8000),
        })

        if (!upstream.ok) {
          console.warn(
            `[AeroTrace photo lookup] Provider returned HTTP ${upstream.status} for ${endpoint}`,
          )
          continue
        }

        const payload: unknown = await upstream.json()

        if (
          !payload ||
          typeof payload !== 'object' ||
          !('photos' in payload) ||
          !Array.isArray(payload.photos)
        ) {
          console.warn(
            '[AeroTrace photo lookup] Provider returned an unexpected response.',
          )
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
            src: `/api/aircraft-photo-image?url=${encodeURIComponent(src)}`,
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
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(
          request.url || '/',
          'http://localhost',
        )

        if (request.method !== 'GET') return next()

        // Proxy the actual image through Vite to avoid browser-side
        // cross-origin restrictions.
        if (requestUrl.pathname === '/api/aircraft-photo-image') {
          let photoUrl: URL

          try {
            photoUrl = new URL(
              requestUrl.searchParams.get('url') || '',
            )
          } catch {
            response.statusCode = 400
            response.end('Invalid photo URL.')
            return
          }

          if (
            photoUrl.protocol !== 'https:' ||
            !(
              photoUrl.hostname === 'planespotters.net' ||
              photoUrl.hostname.endsWith('.planespotters.net')
            )
          ) {
            response.statusCode = 400
            response.end('Unsupported photo host.')
            return
          }

          try {
            const upstream = await fetch(photoUrl, {
              headers: {
                Accept:
                  'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: 'https://www.planespotters.net/',
                'User-Agent':
                  'AeroTrace/1.0 (+https://github.com/AntonisRsmn/aerotrace)',
              },
              signal: AbortSignal.timeout(10000),
            })

            const contentType =
              upstream.headers.get('content-type') || ''

            if (
              !upstream.ok ||
              !contentType.toLowerCase().startsWith('image/')
            ) {
              response.statusCode = 502
              response.end(
                'Photo provider could not return this image.',
              )
              return
            }

            const bytes = Buffer.from(
              await upstream.arrayBuffer(),
            )

            if (
              bytes.length === 0 ||
              bytes.length > 12 * 1024 * 1024
            ) {
              response.statusCode = 502
              response.end('Photo image size is invalid.')
              return
            }

            response.statusCode = 200
            response.setHeader('Content-Type', contentType)
            response.setHeader(
              'Content-Length',
              String(bytes.length),
            )
            response.setHeader('Cache-Control', 'no-store')
            response.setHeader(
              'X-Content-Type-Options',
              'nosniff',
            )
            response.end(bytes)
          } catch (error) {
            console.warn(
              '[AeroTrace photo image proxy]',
              error instanceof Error ? error.message : error,
            )

            response.statusCode = 502
            response.end(
              'Aircraft photo image could not be loaded.',
            )
          }

          return
        }

        if (requestUrl.pathname !== '/api/aircraft-photo') {
          return next()
        }

        response.setHeader(
          'Content-Type',
          'application/json; charset=utf-8',
        )
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader(
          'X-Content-Type-Options',
          'nosniff',
        )

        const sendJson = (status: number, body: unknown) => {
          response.statusCode = status
          response.end(JSON.stringify(body))
        }

        const icao24 = (
          requestUrl.searchParams.get('icao24') || ''
        )
          .trim()
          .toLowerCase()

        const registration = (
          requestUrl.searchParams.get('registration') || ''
        )
          .trim()
          .toUpperCase()

        const validIcao24 = /^[a-f0-9]{6}$/.test(icao24)
        const validRegistration =
          registration.length > 0 &&
          registration.length <= 12 &&
          /^[A-Z0-9-]+$/.test(registration)

        // Either a valid ICAO24 or a registration is sufficient.
        if (!validIcao24 && !validRegistration) {
          return sendJson(400, {
            error:
              'Provide a valid six-character ICAO24 address or aircraft registration.',
            photo: null,
          })
        }

        if (
          registration &&
          !validRegistration
        ) {
          return sendJson(400, {
            error: 'Invalid aircraft registration.',
            photo: null,
          })
        }

        const key = `${validIcao24 ? icao24 : ''}:${registration}`
        const cached = cache.get(key)

        if (
          cached &&
          Date.now() - cached.cachedAt <
            (cached.photo
              ? PHOTO_CACHE_TTL_MS
              : PHOTO_MISS_CACHE_TTL_MS)
        ) {
          return sendJson(200, {
            photo: cached.photo,
            cached: true,
          })
        }

        try {
          const photo = await lookupPhoto(
            validIcao24 ? icao24 : '',
            registration,
          )

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
            error:
              'The aircraft photo service is temporarily unavailable.',
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
