import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { loadEnv } from 'vite'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

const projectId = process.argv[2]
const config = loadEnv('production', process.cwd(), 'VITE_')
if (!projectId || projectId !== config.VITE_FIREBASE_PROJECT_ID || projectId.startsWith('demo-') ||
    config.VITE_FIREBASE_MODE === 'emulator' || !config.VITE_FIREBASE_API_KEY) {
  throw new Error('Indica el proyecto real configurado en .env.local y su API key pública.')
}
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Ejecuta el comando en una terminal interactiva de VS Code.')

let muted = false
const output = new Writable({
  write(chunk, encoding, next) {
    if (!muted) process.stdout.write(chunk, encoding)
    next()
  },
})
const prompt = createInterface({ input: process.stdin, output, terminal: true })
const app = initializeApp({ projectId, apiKey: config.VITE_FIREBASE_API_KEY, authDomain: config.VITE_FIREBASE_AUTH_DOMAIN })
try {
  console.log(`Proyecto Firebase: ${projectId} · Organización: exlaider-jeans`)
  const email = await prompt.question('Correo de administrador: ')
  process.stdout.write('Contraseña: ')
  muted = true
  const password = await prompt.question('')
  muted = false
  process.stdout.write('\n')
  await signInWithEmailAndPassword(getAuth(app), email.trim(), password)
  console.log('Esta acción reemplaza los datos operativos de EXLAIDER de forma permanente.')
  const confirmation = await prompt.question('Escribe REINICIALIZAR EXLAIDER-JEANS: ')
  const reset = httpsCallable(getFunctions(app, 'us-east1'), 'resetExlaider', { timeout: 540_000 })
  const { data } = await reset({ companyId: 'exlaider-jeans', confirmation })
  console.log(JSON.stringify(data, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  prompt.close()
  await deleteApp(app)
}
