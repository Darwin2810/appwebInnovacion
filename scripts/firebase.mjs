import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const local = path.join(root, '.firebase-local')
mkdirSync(local, { recursive: true })
const child = spawn(process.execPath, [path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(local, 'config'), FIREBASE_EMULATORS_PATH: process.env.FIREBASE_EMULATORS_PATH || path.join(local, 'emulators'), NO_UPDATE_NOTIFIER: '1' },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
