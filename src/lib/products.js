import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { firebaseState } from './firebase.js'
import { normalizeProduct, normalizeSku, skuDocumentKey } from './productModel.js'

function assertUser(uid) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('Inicia sesión para continuar.')
}

export function createProductRepository(db, companyId = 'exlaider-jeans') {
  const products = collection(db, 'organizations', companyId, 'products')
  const indices = collection(db, 'organizations', companyId, 'skuIndex')
  const productRef = (id) => {
    if (typeof id !== 'string' || !id || id.includes('/')) throw new Error('El producto no es válido.')
    return doc(products, id)
  }
  const indexRef = (sku) => doc(indices, skuDocumentKey(sku))

  async function createProduct(uid, input) {
    assertUser(uid)
    const product = normalizeProduct(input)
    const ref = doc(products)
    await runTransaction(db, async (transaction) => {
      if (product.skuKey) {
        const index = indexRef(product.sku)
        if ((await transaction.get(index)).exists()) throw new Error('Ya existe un producto con este código.')
        transaction.set(index, { productId: ref.id, skuKey: product.skuKey, createdAt: serverTimestamp() })
      }
      transaction.set(ref, { ...product, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: uid, updatedBy: uid })
    })
    return ref.id
  }

  async function updateProduct(uid, id, input) {
    assertUser(uid)
    const product = normalizeProduct(input)
    const ref = productRef(id)
    await runTransaction(db, async (transaction) => {
      const previous = await transaction.get(ref)
      if (!previous.exists()) throw new Error('El producto ya no existe. Actualiza la lista.')
      const current = previous.data()
      const changed = current.skuKey !== product.skuKey
      if (changed && product.skuKey) {
        const index = await transaction.get(indexRef(product.sku))
        if (index.exists()) throw new Error('Ya existe un producto con este código.')
      }
      if (changed && current.skuKey) transaction.delete(indexRef(current.sku))
      if (changed && product.skuKey) transaction.set(indexRef(product.sku), { productId: id, skuKey: product.skuKey, createdAt: serverTimestamp() })
      transaction.update(ref, { ...product, stock: current.stock, updatedBy: uid, updatedAt: serverTimestamp() })
    })
  }

  async function deleteProduct(uid, id) {
    assertUser(uid)
    const ref = productRef(id)
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists()) throw new Error('El producto ya no existe.')
      const product = snapshot.data()
      if (product.skuKey) transaction.delete(indexRef(product.sku))
      transaction.delete(ref)
    })
  }

  async function receiveProduct(uid, id, quantity = 1) {
    assertUser(uid)
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1e9) throw new Error('La cantidad de ingreso debe ser un entero positivo.')
    return runTransaction(db, async (transaction) => {
      const ref = productRef(id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists()) throw new Error('No se encontró el producto del código QR.')
      const stock = snapshot.data().stock + quantity
      if (!Number.isSafeInteger(stock) || stock > 1e9) throw new Error('El ingreso supera el stock máximo permitido.')
      transaction.update(ref, { stock, updatedAt: serverTimestamp(), updatedBy: uid })
      return stock
    })
  }

  async function getProductBySku(uid, sku) {
    assertUser(uid)
    if (!normalizeSku(sku)) return null
    const index = await getDoc(indexRef(sku))
    if (!index.exists()) return null
    const snapshot = await getDoc(productRef(index.data().productId))
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
  }

  return { createProduct, updateProduct, deleteProduct, receiveProduct, getProductBySku }
}

function repository() {
  if (!firebaseState.configured) throw new Error(firebaseState.error || 'Firebase no está configurado.')
  return createProductRepository(firebaseState.db, firebaseState.companyId)
}
export const createProduct = (...args) => repository().createProduct(...args)
export const updateProduct = (...args) => repository().updateProduct(...args)
export const deleteProduct = (...args) => repository().deleteProduct(...args)
export const receiveProduct = (...args) => repository().receiveProduct(...args)
export const getProductBySku = (...args) => repository().getProductBySku(...args)
