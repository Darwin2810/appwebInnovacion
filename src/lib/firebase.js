import { initializeApp, getApps } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const settings = import.meta.env || globalThis.process?.env || {}
const useEmulators = settings.MODE === 'emulator' || settings.VITE_FIREBASE_MODE === 'emulator'
const emulatorHost = settings.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'
const companyId = settings.VITE_FIREBASE_COMPANY_ID || 'exlaider-jeans'

export const firebaseState = {
  configured: false, error: '', auth: null, db: null, useEmulators, companyId,
}

const config = useEmulators
  ? { apiKey: 'demo-inventario-key', authDomain: 'demo-inventario.firebaseapp.com', projectId: 'demo-inventario', appId: '1:123456789:web:demo-inventario' }
  : {
      apiKey: settings.VITE_FIREBASE_API_KEY,
      authDomain: settings.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: settings.VITE_FIREBASE_PROJECT_ID,
      appId: settings.VITE_FIREBASE_APP_ID,
      ...(settings.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: settings.VITE_FIREBASE_STORAGE_BUCKET } : {}),
      ...(settings.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: settings.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
    }

if (!/^[a-zA-Z0-9_-]{1,80}$/.test(companyId)) {
  firebaseState.error = 'VITE_FIREBASE_COMPANY_ID debe contener letras, números, guiones o guiones bajos.'
} else if (!Object.values(config).every(Boolean)) {
  firebaseState.error = 'Configura Firebase en .env.local para conectar el inventario de la empresa.'
} else {
  try {
    const app = getApps().find((item) => item.name === 'inventario') || initializeApp(config, 'inventario')
    const auth = getAuth(app)
    const db = getFirestore(app)
    if (useEmulators && !app._inventarioEmulatorsConnected) {
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`)
      connectFirestoreEmulator(db, emulatorHost, 8080)
      app._inventarioEmulatorsConnected = true
    }
    Object.assign(firebaseState, { auth, db, configured: true })
  } catch {
    firebaseState.error = 'No se pudo inicializar Firebase. Revisa la configuración del entorno.'
  }
}
