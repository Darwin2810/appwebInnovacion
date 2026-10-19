// The development server stays free of service workers to avoid stale source.
// Production installation needs HTTPS or localhost. Cloud writes need network.
export function registerPwa() {
  if (!import.meta.env.PROD || !window.isSecureContext
    || !('serviceWorker' in navigator)) return

  function register() {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // An installation failure does not block the online application.
      })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
