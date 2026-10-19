import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { createProductRepository } from '../src/lib/products.js'
import { normalizeProduct, skuDocumentKey } from '../src/lib/productModel.js'

const company = 'exlaider-jeans'
const productPath = `organizations/${company}/products`
const indexPath = `organizations/${company}/skuIndex`
const valid = (overrides = {}) => ({
  name: 'Jeans Slim Azul',
  sku: 'EX-SLIM-AZ-M',
  reference: 'EX-SLIM',
  size: 'M',
  color: 'Azul',
  lot: 'LOTE-01',
  description: 'Denim elástico',
  category: 'Jeans',
  price: 129900,
  stock: 8,
  minStock: 3,
  imageUrl: 'https://example.com/jeans.jpg',
  ...overrides,
})

function productData(uid, overrides = {}) {
  return {
    ...normalizeProduct(valid()),
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  }
}

function writeProduct(db, uid, id, overrides = {}) {
  const data = productData(uid, overrides)
  const batch = writeBatch(db)
  batch.set(doc(db, productPath, id), data)
  if (data.skuKey) {
    batch.set(doc(db, indexPath, skuDocumentKey(data.skuKey)), {
      productId: id,
      skuKey: data.skuKey,
      createdAt: serverTimestamp(),
    })
  }
  return batch.commit()
}

function waitForProducts(db, predicate) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('No se recibió la actualización en tiempo real en 10 segundos.'))
    }, 10000)

    unsubscribe = onSnapshot(
      collection(db, productPath),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        if (!predicate(rows)) return
        clearTimeout(timeout)
        unsubscribe()
        resolve(rows)
      },
      (error) => {
        clearTimeout(timeout)
        unsubscribe()
        reject(error)
      },
    )
  })
}

describe('Firestore: permisos, SKU únicos y sincronización entre dispositivos', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, () => {
  let environment
  let desktopDb
  let mobileDb
  let desktop
  let mobile
  let adminDb
  let admin
  let viewerDb
  let outsiderDb
  let inactiveDb

  before(async () => {
    const address = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`)
    environment = await initializeTestEnvironment({
      projectId: 'demo-inventario',
      firestore: {
        host: address.hostname,
        port: Number(address.port),
        rules: await readFile(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'),
      },
    })
    desktopDb = environment.authenticatedContext('desktop').firestore()
    mobileDb = environment.authenticatedContext('mobile').firestore()
    adminDb = environment.authenticatedContext('admin').firestore()
    viewerDb = environment.authenticatedContext('viewer').firestore()
    outsiderDb = environment.authenticatedContext('outsider').firestore()
    inactiveDb = environment.authenticatedContext('inactive').firestore()
    desktop = createProductRepository(desktopDb, company)
    mobile = createProductRepository(mobileDb, company)
    admin = createProductRepository(adminDb, company)
  })

  beforeEach(async () => {
    await environment.clearFirestore()
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        ...[
          ['desktop', 'operator'],
          ['mobile', 'operator'],
          ['admin', 'admin'],
          ['viewer', 'viewer'],
        ].map(([uid, role]) => setDoc(doc(db, `organizations/${company}/members/${uid}`), {
          role,
          active: true,
        })),
        setDoc(doc(db, `organizations/${company}/members/inactive`), {
          role: 'operator',
          active: false,
        }),
        setDoc(doc(db, 'organizations/otra-empresa/members/outsider'), {
          role: 'operator',
          active: true,
        }),
      ])
    })
  })

  after(async () => { await environment?.cleanup() })

  test('operadores comparten productos, sólo el administrador elimina y lectores sólo consultan', async () => {
    const id = await desktop.createProduct('desktop', valid())
    await assertSucceeds(getDoc(doc(mobileDb, productPath, id)))
    await assertSucceeds(getDocs(collection(viewerDb, productPath)))
    await assertSucceeds(getDoc(doc(adminDb, productPath, id)))
    await assertFails(updateDoc(doc(viewerDb, productPath, id), {
      name: 'Cambio no autorizado',
      updatedBy: 'viewer',
      updatedAt: serverTimestamp(),
    }))
    await assert.rejects(createProductRepository(viewerDb, company).createProduct('viewer', valid({ sku: 'VIEWER-01' })))
    await assert.rejects(desktop.deleteProduct('desktop', id))
  })

  test('deniega usuarios sin sesión, sin membresía, inactivos y de otra empresa', async () => {
    const id = await desktop.createProduct('desktop', valid())
    for (const db of [environment.unauthenticatedContext().firestore(), outsiderDb, inactiveDb]) {
      await assertFails(getDoc(doc(db, productPath, id)))
      await assertFails(getDocs(collection(db, productPath)))
    }
    await assert.rejects(createProductRepository(outsiderDb, company).createProduct('outsider', valid({ sku: 'OUTSIDER-01' })))
    await assertFails(getDocs(collection(desktopDb, 'organizations/otra-empresa/products')))
  })

  test('el cliente no puede darse membresía ni elevar su rol', async () => {
    await assertFails(setDoc(doc(outsiderDb, `organizations/${company}/members/outsider`), {
      role: 'admin',
      active: true,
    }))
    await assertFails(updateDoc(doc(desktopDb, `organizations/${company}/members/desktop`), {
      role: 'admin',
    }))
  })

  test('requiere un esquema válido, autor auténtico y timestamps de servidor', async () => {
    for (const [position, overrides] of [
      { stock: -1 },
      { stock: 1.5 },
      { minStock: -1 },
      { price: -1 },
      { currency: 'USD' },
      { createdBy: 'outsider' },
      { updatedBy: 'outsider' },
      { extra: true },
      { imageUrl: 'javascript:alert(1)' },
      { imageUrl: 'http://example.com/a.jpg' },
    ].entries()) {
      await assertFails(writeProduct(desktopDb, 'desktop', `invalid-${position}`, overrides))
    }
    const noTimestamps = productData('desktop', { sku: '', skuKey: '' })
    delete noTimestamps.createdAt
    delete noTimestamps.updatedAt
    await assertFails(setDoc(doc(desktopDb, productPath, 'missing-timestamps'), noTimestamps))
    await assert.rejects(desktop.createProduct('mobile', valid({ sku: 'FORGED-ACTOR' })))
    const id = await desktop.createProduct('desktop', valid())
    await assertFails(updateDoc(doc(desktopDb, productPath, id), {
      createdBy: 'mobile',
      updatedBy: 'desktop',
      updatedAt: serverTimestamp(),
    }))
  })

  test('un SKU sólo puede apuntar a un producto y el índice es obligatorio', async () => {
    const id = await desktop.createProduct('desktop', valid())
    const key = skuDocumentKey(valid().sku)
    const index = await getDoc(doc(desktopDb, indexPath, key))
    assert.equal(index.data().productId, id)
    await assert.rejects(mobile.createProduct('mobile', valid({ sku: 'ex-slim-az-m' })))
    await assertFails(setDoc(doc(desktopDb, productPath, 'without-index'), productData('desktop', {
      sku: 'NO-INDEX',
      skuKey: 'no-index',
    })))
    await assertFails(setDoc(doc(desktopDb, indexPath, 's_orphan'), {
      productId: 'absent',
      skuKey: 'orphan',
      createdAt: serverTimestamp(),
    }))
    await assertFails(setDoc(doc(desktopDb, productPath, 'bypass-key'), productData('desktop', {
      sku: 'UNIQUE-SKU',
      skuKey: '',
    })))
    assert.equal((await desktop.getProductBySku('desktop', '  EX-SLIM-AZ-M  ')).id, id)
  })

  test('editar conserva existencias y cambia el índice SKU de forma atómica', async () => {
    const id = await desktop.createProduct('desktop', valid())
    await mobile.updateProduct('mobile', id, valid({
      name: 'Jeans Slim actualizado',
      sku: 'EX-NUEVO-M',
      stock: 999,
    }))
    const product = (await getDoc(doc(desktopDb, productPath, id))).data()
    assert.equal(product.name, 'Jeans Slim actualizado')
    assert.equal(product.stock, 8)
    assert.equal(product.createdBy, 'desktop')
    assert.equal(product.updatedBy, 'mobile')
    assert.equal((await getDoc(doc(desktopDb, indexPath, skuDocumentKey(valid().sku)))).exists(), false)
    assert.equal((await getDoc(doc(desktopDb, indexPath, skuDocumentKey('EX-NUEVO-M')))).data().productId, id)
    await assertFails(updateDoc(doc(desktopDb, productPath, id), {
      sku: 'EX-ORPHAN',
      skuKey: 'ex-orphan',
      updatedBy: 'desktop',
      updatedAt: serverTimestamp(),
    }))
    const second = await desktop.createProduct('desktop', valid({ sku: 'OTHER-SKU' }))
    await assert.rejects(desktop.updateProduct('desktop', second, valid({ sku: 'EX-NUEVO-M' })))
  })

  test('el administrador elimina y libera el SKU para un nuevo producto', async () => {
    const id = await desktop.createProduct('desktop', valid())
    await admin.deleteProduct('admin', id)
    assert.equal((await getDoc(doc(desktopDb, productPath, id))).exists(), false)
    assert.equal((await getDoc(doc(desktopDb, indexPath, skuDocumentKey(valid().sku)))).exists(), false)
    const replacement = await mobile.createProduct('mobile', valid())
    assert.notEqual(replacement, id)
  })

  test('onSnapshot refleja crear, editar e ingresar desde celular en computador y eliminar por administrador', async () => {
    const created = waitForProducts(desktopDb, (rows) => rows.some((row) => row.skuKey === 'ex-slim-az-m'))
    const id = await mobile.createProduct('mobile', valid())
    assert.equal((await created).find((row) => row.id === id).stock, 8)
    const edited = waitForProducts(desktopDb, (rows) => rows.some((row) => row.id === id && row.name === 'Jeans cambiado'))
    await mobile.updateProduct('mobile', id, valid({ name: 'Jeans cambiado' }))
    await edited
    const received = waitForProducts(desktopDb, (rows) => rows.some((row) => row.id === id && row.stock === 10))
    assert.equal(await mobile.receiveProduct('mobile', id, 2), 10)
    await received
    const deleted = waitForProducts(mobileDb, (rows) => !rows.some((row) => row.id === id))
    await admin.deleteProduct('admin', id)
    await deleted
  })

  test('ingresos simultáneos y una edición no pierden unidades', async () => {
    const id = await desktop.createProduct('desktop', valid({ stock: 0 }))
    await Promise.all([
      desktop.receiveProduct('desktop', id, 2),
      mobile.receiveProduct('mobile', id, 3),
      desktop.receiveProduct('desktop', id, 4),
      mobile.receiveProduct('mobile', id, 5),
      desktop.updateProduct('desktop', id, valid({ name: 'Edición simultánea', stock: 999 })),
    ])
    const result = (await getDoc(doc(desktopDb, productPath, id))).data()
    assert.equal(result.stock, 14)
    assert.equal(result.name, 'Edición simultánea')
    for (const quantity of [0, -1, 1.5]) {
      await assert.rejects(mobile.receiveProduct('mobile', id, quantity))
    }
  })
})
