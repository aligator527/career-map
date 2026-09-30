// Offline support: the app shell and every data file the user has opened stay available without a network.
//  * navigations and data/*.json: network first (always fresh when online), cache as fallback
//  * hashed build assets (assets/*): cache first — their names change whenever their content does
const CACHE = 'career-map-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './favicon.svg', './manifest.webmanifest'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    if (request.mode === 'navigate') {
      const shell = await cache.match('./')
      if (shell) return shell
    }
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request))
  else event.respondWith(networkFirst(request))
})
