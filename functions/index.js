import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { withCommand, AppError, key } from './lib/core.js'
import { handlers as catalog } from './lib/catalog.js'
import { handlers as operations } from './lib/operations.js'

initializeApp()
const db = getFirestore()
const handlers = { ...catalog, ...operations }
handlers['members.save'].prepare = async (_ctx, payload) => {
  try { await getAuth().getUser(key(payload.uid, 'UID')) }
  catch (error) {
    if (error instanceof AppError) throw error
    if (error.code === 'auth/user-not-found') throw new AppError('not-found', 'Ese UID no existe en Authentication. Crea primero la cuenta y copia su UID.')
    throw error
  }
}

export const erp = onCall({ region: 'us-east1', maxInstances: 5, timeoutSeconds: 120, memory: '256MiB', cors: true }, async request => {
  try { return await withCommand(db, request.auth?.uid, request.data, handlers) }
  catch (error) {
    if (error instanceof AppError) throw new HttpsError(error.code, error.message)
    logger.error('ERP command failed', { code: String(error.code || 'internal'), action: String(request.data?.action || '').slice(0, 80) })
    throw new HttpsError('internal', 'No se pudo confirmar la operación. Conserva los datos y vuelve a intentarlo.')
  }
})
