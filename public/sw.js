// Store only the public interface. Firebase, authentication and inventory
// traffic are deliberately left to the network and Firebase SDK.
const CACHE_PREFIX = 'exlaider-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const SHELL_URL = '/index.html'
const STATIC_URLS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]
const worker = self

function isApplicationAsset(url) {
  return url.origin === worker.location.origin
    && (STATIC_URLS.includes(url.pathname)
      || /^\/assets\/[\w.-]+\.(?:js|css|woff2?|svg|png|webp|jpg|jpeg|ico)$/.test(url.pathname))
}

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch(SHELL_URL, { cache: 'reload' })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Unable to load the application shell.')
    }
    const html = await response.clone().text()
    await cache.put(SHELL_URL, response)
    // Cache only the public, content-hashed entry files emitted by Vite.
    const entryAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], worker.location.origin))
      .filter(isApplicationAsset)
      .map((url) => url.href)
    await cache.addAll([...new Set([...STATIC_URLS, ...entryAssets])])
    await worker.skipWaiting()
  })())
})

worker.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await worker.clients.claim()
  })())
})

worker.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== worker.location.origin
    || request.headers.has('authorization')) return

  if (request.mode === 'navigate' && ['/', SHELL_URL].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(SHELL_URL, response.clone())
        }
        return response
      } catch {
        return (await caches.match(SHELL_URL)) || Response.error()
      }
    })())
    return
  }

  if (!isApplicationAsset(url)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone())
    }
    return response
  })())
})
