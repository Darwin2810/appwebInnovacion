import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const appUrl = 'http://127.0.0.1:5173'
const setupSmoke = process.argv.includes('--setup-smoke')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let startupLog = ''
let startupError
let browserTest
server.on('error', error => { startupError = error })
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { startupLog += chunk.toString(); process.stdout.write(chunk) })

async function ready() {
  const until = Date.now() + 20000
  const observed = { ownPreviewAnnounced: false }
  while (Date.now() < until) {
    if (startupError) throw startupError
    if (server.exitCode !== null) throw new Error(`Preview exited before readiness (${server.exitCode}). ${startupLog}`)
    // Require readiness from our own strict-port preview, not an unrelated service.
    // Vite colors "Local" independently from ":" in CI output.
    observed.ownPreviewAnnounced = /Local:\s+http:\/\/127\.0\.0\.1:5173\//.test(stripVTControlCharacters(startupLog))
    if (observed.ownPreviewAnnounced) {
      try {
        const response = await fetch(appUrl, { signal: AbortSignal.timeout(1000) })
        observed.documentStatus = response.status
        const html = await response.text()
        const module = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)
        observed.compiledModule = module?.[1] || null
        if (response.ok && module?.[1]?.startsWith('/assets/')) {
          const asset = await fetch(new URL(module[1], appUrl), { signal: AbortSignal.timeout(1000) })
          observed.assetStatus = asset.status
          const source = await asset.text()
          observed.emulatorMarker = source.includes('demo-inventario')
          if (asset.ok && (setupSmoke || observed.emulatorMarker)) {
            console.log(`Preview ready: ${module[1]}${setupSmoke ? '' : ' (demo-inventario)'}`)
            return
          }
        }
      } catch (error) { observed.requestError = error.message }
    }
    await pause(100)
  }
  throw new Error(`Built emulator application did not become ready. Run npm run build -- --mode emulator before this command.\nReadiness diagnostics: ${JSON.stringify(observed)}\nPreview output:\n${stripVTControlCharacters(startupLog).slice(-4000)}`)
}
const stop = signal => { browserTest?.kill(signal); server.kill(signal) }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal))
try {
  await ready()
  browserTest = spawn(process.execPath, [path.join(root, 'scripts', 'browser-test.mjs'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: { ...process.env, APP_URL: appUrl } })
  process.exitCode = await new Promise((resolve, reject) => { browserTest.on('error', reject); browserTest.on('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1))) })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  server.kill('SIGTERM')
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), pause(3000)])
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
}
