import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  while (Date.now() < until) {
    if (startupError) throw startupError
    if (server.exitCode !== null) throw new Error(`Preview exited before readiness (${server.exitCode}). ${startupLog}`)
    // Require readiness from our own strict-port preview, not an unrelated service.
    if (/Local:.*5173/.test(startupLog)) {
      try {
        const response = await fetch(appUrl, { signal: AbortSignal.timeout(1000) })
        const html = await response.text()
        const module = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)
        if (response.ok && module?.[1]?.startsWith('/assets/')) {
          const asset = await fetch(new URL(module[1], appUrl), { signal: AbortSignal.timeout(1000) })
          const source = await asset.text()
          if (asset.ok && (setupSmoke || source.includes('demo-inventario'))) return
        }
      } catch { /* Retry only while the preview is still starting. */ }
    }
    await pause(100)
  }
  throw new Error('Built emulator application did not become ready. Run npm run build -- --mode emulator before this command.')
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
