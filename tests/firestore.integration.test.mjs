import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  setLogLevel,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

// Permission denials below are assertions, not application failures. Keep the
// runner's actual failing test diagnostics visible in CI's bounded log summary.
setLogLevel('silent')

const privateCollections = [
  'costs', 'journals', 'commands', 'audit', 'sales', 'purchases',
  'payments', 'productionBoms', 'productionOrders', 'employees',
  'attendance', 'payroll', 'financeEntries', 'contacts', 'migrations',
]

describe('Firestore ERP: aislamiento y permisos de lectura; backend exclusivo de escritura', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, () => {
  let environment
  let company
  let sequence = 0
  const clients = {}
  const path = (collectionName, id = 'fixture') => `organizations/${company}/${collectionName}/${id}`
  const dbFor = (role) => clients[role]

  before(async () => {
    const address = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`)
    environment = await initializeTestEnvironment({
      projectId: 'demo-inventario',
      firestore: {
        host: address.hostname,
        port: Number(address.port),
        rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      },
    })
    for (const uid of ['admin', 'operator', 'viewer', 'inactive', 'outsider', 'pending', 'invalid-role']) {
      clients[uid] = environment.authenticatedContext(uid).firestore()
    }
    clients.anonymous = environment.unauthenticatedContext().firestore()
  })

  beforeEach(async () => {
    company = `rules-${process.pid}-${Date.now()}-${++sequence}`
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      const batch = writeBatch(db)
      batch.set(doc(db, `organizations/${company}`), { name: 'EXLAIDER JEANS SAS' })
      for (const role of ['admin', 'operator', 'viewer']) {
        batch.set(doc(db, path('members', role)), { role, active: true })
      }
      batch.set(doc(db, path('members', 'inactive')), { role: 'operator', active: false })
      batch.set(doc(db, path('members', 'invalid-role')), { role: 'employee', active: true })
      batch.set(doc(db, `organizations/another-${company}/members/outsider`), { role: 'admin', active: true })
      for (const name of ['references', 'variants']) {
        batch.set(doc(db, path(name, 'finished')), { kind: 'finished', name: 'Jeans', stock: 5 })
        batch.set(doc(db, path(name, 'material')), { kind: 'material', name: 'Tela', stock: 100 })
      }
      for (const name of [...privateCollections, 'movements', 'products', 'variantSkuIndex', 'skuIndex']) {
        batch.set(doc(db, path(name)), { fixture: true, ...(name === 'costs' ? { stockValueCents: 100000 } : {}) })
      }
      await batch.commit()
    })
  })

  after(async () => { await environment?.cleanup() })

  test('admin y operador leen catálogo; viewer sólo productos terminados y consultas filtradas', async () => {
    for (const name of ['references', 'variants']) {
      const collectionPath = `organizations/${company}/${name}`
      for (const role of ['admin', 'operator']) {
        assert.equal((await assertSucceeds(getDocs(collection(dbFor(role), collectionPath)))).size, 2)
        await assertSucceeds(getDoc(doc(dbFor(role), path(name, 'material'))))
      }
      await assertSucceeds(getDoc(doc(dbFor('viewer'), path(name, 'finished'))))
      await assertFails(getDoc(doc(dbFor('viewer'), path(name, 'material'))))
      await assertFails(getDocs(collection(dbFor('viewer'), collectionPath)))
      const finished = query(collection(dbFor('viewer'), collectionPath), where('kind', '==', 'finished'))
      assert.equal((await assertSucceeds(getDocs(finished))).size, 1)
    }
    await assertSucceeds(getDocs(collection(dbFor('viewer'), `organizations/${company}/products`)))
    await assertSucceeds(getDocs(collection(dbFor('operator'), `organizations/${company}/movements`)))
    await assertFails(getDocs(collection(dbFor('viewer'), `organizations/${company}/movements`)))
  })

  test('costos, finanzas, ventas, producción y personal sólo los puede consultar el administrador', async () => {
    for (const name of privateCollections) {
      await assertSucceeds(getDoc(doc(dbFor('admin'), path(name))))
      await assertSucceeds(getDocs(collection(dbFor('admin'), `organizations/${company}/${name}`)))
      for (const role of ['operator', 'viewer']) {
        await assertFails(getDoc(doc(dbFor(role), path(name))))
        await assertFails(getDocs(collection(dbFor(role), `organizations/${company}/${name}`)))
      }
    }
    for (const name of ['skuIndex', 'variantSkuIndex', 'variantCombinationIndex', 'employeeDocumentIndex', 'payrollPeriodIndex']) {
      await assertFails(getDoc(doc(dbFor('admin'), path(name))))
    }
    for (const role of ['operator', 'viewer']) await assertFails(getDocs(collectionGroup(dbFor(role), 'costs')))
  })

  test('nadie escribe directamente, ni siquiera admin: conserva trazabilidad y operaciones atómicas', async () => {
    for (const role of ['admin', 'operator', 'viewer']) {
      for (const name of ['members', 'references', 'variants', 'products', 'costs', 'movements', 'journals', 'audit', 'sales', 'variantSkuIndex']) {
        const existing = name === 'members' ? role : name === 'variants' || name === 'references' ? 'finished' : 'fixture'
        await assertFails(setDoc(doc(dbFor(role), path(name, 'injected')), { role: 'admin', active: true }))
        await assertFails(updateDoc(doc(dbFor(role), path(name, existing)), { injected: true }))
        await assertFails(deleteDoc(doc(dbFor(role), path(name, existing))))
      }
    }
  })

  test('sesión, membresía activa y empresa coincidente son obligatorias', async () => {
    for (const role of ['anonymous', 'outsider', 'inactive', 'pending', 'invalid-role']) {
      for (const name of ['variants', 'references', 'products', 'costs', 'movements']) {
        await assertFails(getDoc(doc(dbFor(role), path(name, name === 'variants' || name === 'references' ? 'finished' : 'fixture'))))
        await assertFails(getDocs(collection(dbFor(role), `organizations/${company}/${name}`)))
      }
    }
    await assertFails(getDocs(collection(dbFor('admin'), `organizations/another-${company}/variants`)))
  })

  test('usuario pendiente lee su estado; sólo admin lista miembros y ve otros usuarios', async () => {
    await assertSucceeds(getDoc(doc(dbFor('pending'), path('members', 'pending'))))
    await assertSucceeds(getDoc(doc(dbFor('inactive'), path('members', 'inactive'))))
    await assertSucceeds(getDoc(doc(dbFor('operator'), path('members', 'operator'))))
    await assertSucceeds(getDoc(doc(dbFor('admin'), path('members', 'operator'))))
    await assertSucceeds(getDocs(collection(dbFor('admin'), `organizations/${company}/members`)))
    for (const role of ['operator', 'viewer', 'pending']) {
      await assertFails(getDoc(doc(dbFor(role), path('members', 'admin'))))
      await assertFails(getDocs(collection(dbFor(role), `organizations/${company}/members`)))
    }
  })

  test('una degradación de admin se aplica a lecturas futuras sin cambiar de sesión', async () => {
    const adminDb = dbFor('admin')
    await assertSucceeds(getDocFromServer(doc(adminDb, path('costs'))))
    await assertSucceeds(getDocFromServer(doc(adminDb, path('sales'))))
    await environment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), path('members', 'admin')), { role: 'operator' }))
    await assertFails(getDocFromServer(doc(adminDb, path('costs'))))
    await assertFails(getDocFromServer(doc(adminDb, path('sales'))))
    await assertFails(getDocs(collection(adminDb, `organizations/${company}/members`)))
    await assertSucceeds(getDocFromServer(doc(adminDb, path('variants', 'finished'))))
    await assertSucceeds(getDocFromServer(doc(adminDb, path('movements'))))
  })

  test('onSnapshot transmite a ambos dispositivos cambios autorizados realizados por el backend', async () => {
    const waitForStock = (db, expected) => new Promise((resolve, reject) => {
      let unsubscribe = () => {}
      const timer = setTimeout(() => { unsubscribe(); reject(new Error('Actualización en tiempo real no recibida')) }, 10000)
      unsubscribe = onSnapshot(doc(db, path('variants', 'finished')), (snapshot) => {
        if (snapshot.metadata.fromCache || snapshot.data()?.stock !== expected) return
        clearTimeout(timer)
        unsubscribe()
        resolve(snapshot.data().stock)
      }, (error) => { clearTimeout(timer); unsubscribe(); reject(error) })
    })
    const desktop = waitForStock(dbFor('admin'), 9)
    const mobile = waitForStock(dbFor('operator'), 9)
    await environment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), path('variants', 'finished')), { stock: 9 }))
    assert.deepEqual(await Promise.all([desktop, mobile]), [9, 9])
  })
})
