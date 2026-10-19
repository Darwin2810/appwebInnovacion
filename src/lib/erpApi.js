import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseState } from './firebase.js'

let functions
export function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  if (globalThis.crypto?.getRandomValues) return `req_${Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')}`
  throw new Error('El navegador no permite generar identificadores seguros. Abre la página HTTPS en un navegador actualizado.')
}
export async function erpCommand(action, payload, commandId = requestId()) {
  if (!firebaseState.auth?.currentUser) throw new Error('Inicia sesión para continuar.')
  if (!navigator.onLine) throw new Error('Conéctate a internet para confirmar la operación.')
  if (!functions) {
    functions = getFunctions(firebaseState.auth.app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-east1')
    if (firebaseState.useEmulators) connectFunctionsEmulator(functions, import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1', 5001)
  }
  const input = { action, payload, companyId: firebaseState.companyId, requestId: commandId }
  const invoke = httpsCallable(functions, 'erp', { timeout: 120000 })
  // A lost response must not duplicate stock, a payment, or a journal.
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return (await invoke(input)).data }
    catch (error) {
      if (attempt === 0 && ['functions/unavailable', 'functions/deadline-exceeded'].includes(error.code)) continue
      if (error.code === 'functions/not-found' && !error.message.includes('UID')) throw new Error('No se encontró la operación o su registro. Comprueba que el backend ERP esté publicado y los datos sigan vigentes.')
      if (error.code === 'functions/internal') throw new Error('El servidor no pudo confirmar la operación. Comprueba la conexión y que las Functions ERP estén publicadas; revisa el historial antes de repetirla.')
      throw error
    }
  }
}
