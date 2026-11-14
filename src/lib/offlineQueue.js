const DB_NAME = 'exlaider-offline-operations'
const DB_VERSION = 1
const COMMANDS = 'commands'
const KEYS = 'keys'
const EVENT = 'exlaider-offline-queue-change'

const policies = {
  'stock.receive': ['admin', 'operator'],
  'stock.adjust': ['admin'],
  'sales.create': ['admin', 'seller'],
}

export function offlineActionAllowed(action, role) {
  return Boolean(policies[action]?.includes(role))
}

export function offlineActionLabel(action) {
  return { 'stock.receive': 'Ingreso de stock', 'stock.adjust': 'Ajuste de conteo', 'sales.create': 'Venta' }[action] || action
}

function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('Este navegador no permite guardar operaciones sin conexión.')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(COMMANDS)) db.createObjectStore(COMMANDS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const completed = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error || new Error('La base local canceló la operación.'))
})
const notify = () => globalThis.dispatchEvent?.(new Event(EVENT))
const scopeOf = ({ companyId, uid }) => `${companyId}:${uid}`

async function encryptionKey(db) {
  const read = db.transaction(KEYS, 'readonly')
  const existing = await result(read.objectStore(KEYS).get('device'))
  if (existing?.key) return existing.key
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const write = db.transaction(KEYS, 'readwrite')
  write.objectStore(KEYS).put({ id: 'device', key })
  await completed(write)
  return key
}

async function encryptPayload(db, payload) {
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  if (plain.byteLength > 250_000) throw new Error('La operación es demasiado grande para guardarla sin conexión.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(db), plain)
  return { iv, ciphertext }
}

async function decryptPayload(db, record) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, await encryptionKey(db), record.ciphertext)
  return JSON.parse(new TextDecoder().decode(plain))
}

export async function enqueueOfflineCommand(scope, action, payload, requestId) {
  if (!offlineActionAllowed(action, scope.role)) throw new Error('Esta operación requiere conexión a internet por seguridad.')
  const db = await openDatabase(), encrypted = await encryptPayload(db, payload)
  const tx = db.transaction(COMMANDS, 'readwrite')
  tx.objectStore(COMMANDS).put({ id: requestId, scope: scopeOf(scope), uid: scope.uid, companyId: scope.companyId, role: scope.role, action, ...encrypted, status: 'pending', attempts: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError: '' })
  await completed(tx); db.close(); notify()
  return { id: requestId, queued: true }
}

export async function listOfflineCommands(scope) {
  if (!scope?.uid) return []
  const db = await openDatabase(), tx = db.transaction(COMMANDS, 'readonly')
  const done = completed(tx)
  const records = await result(tx.objectStore(COMMANDS).getAll())
  await done; db.close()
  return records.filter(item => item.scope === scopeOf(scope)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function patchRecord(db, id, patch) {
  const tx = db.transaction(COMMANDS, 'readwrite'), store = tx.objectStore(COMMANDS)
  const current = await result(store.get(id))
  if (current) store.put({ ...current, ...patch, updatedAt: new Date().toISOString() })
  await completed(tx)
}

function connectionFailure(error) {
  return !navigator.onLine || ['functions/unavailable', 'functions/deadline-exceeded', 'auth/network-request-failed'].includes(error?.code)
}

let activeSync
export function syncOfflineCommands(scope, sender) {
  if (activeSync) return activeSync
  activeSync = (async () => {
    if (!navigator.onLine || !scope?.uid) return { synced: 0, failed: 0 }
    const db = await openDatabase(), read = db.transaction(COMMANDS, 'readonly')
    const readDone = completed(read)
    const all = await result(read.objectStore(COMMANDS).getAll())
    await readDone
    const records = all.filter(item => item.scope === scopeOf(scope) && ['pending', 'syncing'].includes(item.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let synced = 0, failed = 0
    for (const record of records) {
      if (!navigator.onLine) break
      await patchRecord(db, record.id, { status: 'syncing', attempts: Number(record.attempts || 0) + 1, lastError: '' }); notify()
      try {
        const payload = await decryptPayload(db, record)
        await sender(record.action, payload, record.id)
        await patchRecord(db, record.id, { status: 'synced', syncedAt: new Date().toISOString(), lastError: '' })
        synced++
      } catch (error) {
        if (connectionFailure(error)) {
          await patchRecord(db, record.id, { status: 'pending', lastError: 'Esperando conexión estable.' })
          break
        }
        await patchRecord(db, record.id, { status: 'failed', lastError: error?.message || 'El servidor rechazó la operación.' })
        failed++
      }
      notify()
    }
    const cleanupRead = db.transaction(COMMANDS, 'readonly'), cleanupDone = completed(cleanupRead)
    const latest = await result(cleanupRead.objectStore(COMMANDS).getAll())
    await cleanupDone
    const old = latest.filter(item => item.scope === scopeOf(scope) && item.status === 'synced').sort((a, b) => b.syncedAt.localeCompare(a.syncedAt)).slice(20)
    if (old.length) {
      const cleanup = db.transaction(COMMANDS, 'readwrite')
      old.forEach(item => cleanup.objectStore(COMMANDS).delete(item.id))
      await completed(cleanup)
    }
    db.close()
    return { synced, failed }
  })().finally(() => { activeSync = null; notify() })
  return activeSync
}

export async function retryOfflineCommand(id) {
  const db = await openDatabase(); await patchRecord(db, id, { status: 'pending', lastError: '' }); db.close(); notify()
}

export async function discardOfflineCommand(id) {
  const db = await openDatabase(), tx = db.transaction(COMMANDS, 'readwrite')
  tx.objectStore(COMMANDS).delete(id); await completed(tx); db.close(); notify()
}

export function subscribeOfflineQueue(listener) {
  globalThis.addEventListener?.(EVENT, listener)
  return () => globalThis.removeEventListener?.(EVENT, listener)
}
