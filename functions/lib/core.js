import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

export class AppError extends Error {
  constructor(code, message) { super(message); this.name = 'AppError'; this.code = code }
}
export const fail = (code, message) => { throw new AppError(code, message) }
export function text(value, label, max = 100, required = true) {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') fail('invalid-argument', `${label}: escribe un texto.`)
  const clean = value.normalize('NFKC').trim()
  const controls = [...clean].some(char => { const n = char.charCodeAt(0); return n < 32 && ![9, 10, 13].includes(n) })
  if ((required && !clean) || clean.length > max || controls) fail('invalid-argument', `${label}: revisa el contenido (máximo ${max} caracteres).`)
  return clean
}
export function integer(value, label, min = 0, max = 1e9) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid-argument', `${label}: debe ser un entero entre ${min} y ${max}.`)
  return value
}
export const money = (value, label = 'Importe') => integer(value, label, 0, 1e14)
export function key(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('invalid-argument', `${label}: identificador inválido.`)
  return value
}
export function codeKey(value) {
  const code = text(value, 'Referencia', 60)
  if (!/^[A-Za-z0-9._-]+$/.test(code)) fail('invalid-argument', 'La referencia sólo admite letras, números, punto, guion y guion bajo.')
  return `r_${code.toLowerCase()}`
}
export const nameKey = value => text(value, 'Nombre', 100).toLocaleLowerCase('es').replace(/\s+/gu, ' ')
export const ref = (ctx, collection, id) => id === undefined ? ctx.org.collection(collection).doc() : ctx.org.collection(collection).doc(id)
export const meta = ctx => ({ updatedAt: ctx.now, updatedBy: ctx.uid })
export const created = ctx => ({ createdAt: ctx.now, createdBy: ctx.uid, ...meta(ctx) })
export function mulCents(cents, qty) {
  money(cents); integer(qty, 'Cantidad')
  const result = BigInt(cents) * BigInt(qty)
  if (result > 100000000000000n) fail('invalid-argument', 'El valor supera el límite permitido.')
  return Number(result)
}
export function proportion(total, part, whole) {
  money(total); integer(part, 'Parte'); integer(whole, 'Total', 1)
  if (part > whole) fail('invalid-argument', 'La parte no puede superar el total.')
  return Number((BigInt(total) * BigInt(part) + BigInt(whole) / 2n) / BigInt(whole))
}
const accounts = new Set(['1105', '1305', '1405', '1430', '1435', '2205', '2505', '2365', '3105', '4135', '6135', '5105', '5195', '4205'])
export function businessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail('invalid-argument', 'Fecha inválida (AAAA-MM-DD).')
  return value
}
export function journal(tx, ctx, input) {
  const sourceType = text(input.sourceType, 'Origen', 60)
  const sourceId = key(input.sourceId, 'Documento de origen')
  if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 80) fail('invalid-argument', 'El asiento necesita entre 2 y 80 líneas.')
  let debitCents = 0, creditCents = 0
  const lines = input.lines.map(line => {
    const account = String(line.account)
    if (!accounts.has(account)) fail('invalid-argument', 'Cuenta contable no admitida.')
    const debit = money(line.debitCents ?? 0, 'Débito'), credit = money(line.creditCents ?? 0, 'Crédito')
    if ((debit > 0) === (credit > 0)) fail('invalid-argument', 'Cada línea debe tener un débito o un crédito positivo.')
    debitCents += debit; creditCents += credit
    money(debitCents, 'Total débito'); money(creditCents, 'Total crédito')
    return { account, debitCents: debit, creditCents: credit }
  })
  if (debitCents !== creditCents || debitCents === 0) fail('failed-precondition', 'El asiento debe cuadrar en débito y crédito.')
  const target = ref(ctx, 'journals')
  tx.create(target, { sourceType, sourceId, note: text(input.note || '', 'Detalle del asiento', 1000, false), date: input.date ? businessDate(input.date) : ctx.now.toDate().toISOString().slice(0, 10), lines, debitCents, creditCents, ...created(ctx) })
  return target.id
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
function authorize(snapshot, roles) {
  const member = snapshot.data()
  if (!snapshot.exists || member.active !== true || !['admin', 'operator', 'viewer'].includes(member.role) || !roles.includes(member.role)) fail('permission-denied', 'Tu cuenta no tiene permiso para esta operación.')
  return member.role
}
export async function withCommand(db, uid, input, handlers) {
  if (!uid) fail('unauthenticated', 'Inicia sesión para continuar.')
  key(uid, 'Usuario')
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-argument', 'Solicitud inválida.')
  const companyId = key(input.companyId, 'Empresa')
  const action = text(input.action, 'Acción', 80)
  const commandId = key(input.requestId, 'Identificador de solicitud')
  const handler = Object.hasOwn(handlers, action) ? handlers[action] : null
  if (!handler) fail('invalid-argument', 'Operación desconocida.')
  const payload = input.payload ?? {}
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid-argument', 'Datos inválidos.')
  const serialized = JSON.stringify(canonical(payload))
  if (serialized.length > 80000) fail('invalid-argument', 'Demasiados datos en una solicitud.')
  const hash = createHash('sha256').update(serialized).digest('hex')
  const org = db.collection('organizations').doc(companyId)
  const memberRef = org.collection('members').doc(uid)
  if (handler.prepare) {
    const role = authorize(await memberRef.get(), handler.roles)
    await handler.prepare({ db, uid, role, companyId, org }, payload)
  }
  return db.runTransaction(async tx => {
    const [memberSnapshot, command] = await tx.getAll(memberRef, org.collection('commands').doc(commandId))
    const role = authorize(memberSnapshot, handler.roles)
    if (command.exists) {
      const old = command.data()
      if (old.uid !== uid || old.action !== action || old.payloadHash !== hash) fail('already-exists', 'Esta solicitud ya se utilizó con otros datos. Inicia una operación nueva.')
      return { ...old.result, replayed: true }
    }
    const ctx = { db, uid, role, companyId, org, now: Timestamp.now(), commandId, action }
    const result = await handler.run(tx, ctx, payload)
    if (!result || typeof result !== 'object') fail('internal', 'La operación no devolvió un resultado.')
    tx.create(org.collection('commands').doc(commandId), { uid, action, payloadHash: hash, result, ...created(ctx) })
    tx.create(ref(ctx, 'audit'), { action, entityId: result.id || result.variantId || result.referenceKey || '', actor: uid, role, commandId, ...created(ctx) })
    return result
  }, { maxAttempts: 10 })
}
