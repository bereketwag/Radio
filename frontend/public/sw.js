/*
 * Aurora Radio service worker.
 *
 * Strategy:
 * - App shell + hashed build assets: cache-first (they're immutable per build).
 * - Navigations: network-first with cached shell fallback (offline support).
 * - NEVER cached: /api/* (fresh metadata), /live/* (audio streams), /media/*
 *   (uploaded media can be large; artists expect fresh artwork).
 *
 * The live audio stream is never cached — it is a continuous realtime feed.
 */
const CACHE = 'aurora-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isStreamOrApi(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/live/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.endsWith('.m3u') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.ogg')
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isStreamOrApi(url)) return // network only — fresh data, no audio caching

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Static assets: cache-first, then network + cache fill.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})
