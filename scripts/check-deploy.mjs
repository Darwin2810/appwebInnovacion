import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = loadEnv('production', root, 'VITE_')
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']
const missing = required.filter(name => !config[name] || /^(TU_|YOUR_|REEMPLAZA)/i.test(config[name]))
if (missing.length) throw new Error(`Completa .env.local antes de publicar: ${missing.join(', ')}. No se publicará una pantalla sin configurar.`)
if (config.VITE_FIREBASE_MODE === 'emulator' || config.VITE_FIREBASE_PROJECT_ID === 'demo-inventario') throw new Error('La configuración de emuladores no puede publicarse en Hosting.')
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== config.VITE_FIREBASE_PROJECT_ID) throw new Error('El proyecto seleccionado para publicar no coincide con VITE_FIREBASE_PROJECT_ID. Revisa .env.local y --project.')
const info = JSON.parse(await readFile(path.join(root, 'dist', 'build-info.json'), 'utf8'))
if (info.mode !== 'production' || info.emulators || info.projectId !== config.VITE_FIREBASE_PROJECT_ID) throw new Error('Esta compilación usa otro modo o proyecto. Ejecuta npm.cmd run build con tu .env.local de producción.')
const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
const asset = html.match(/<script\b[^>]*type="module"[^>]*src="(\/assets\/[^"/]+\.js)"/)
if (!asset) throw new Error('No hay una compilación Vite válida en dist. Ejecuta npm.cmd run build.')
const source = await readFile(path.join(root, 'dist', asset[1]), 'utf8')
if (!required.every(name => source.includes(config[name]))) throw new Error('dist no corresponde a la configuración actual de Firebase. Ejecuta npm.cmd run build antes de publicar.')
console.log('Configuración y compilación de producción verificadas para Hosting.')
