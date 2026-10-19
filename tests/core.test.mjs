import assert from 'node:assert/strict'
import { test } from 'node:test'
import { businessDate, codeKey, journal, money, mulCents, nameKey, proportion } from '../functions/lib/core.js'

test('centavos exactos: intermediarios grandes y reparto conservan el saldo', () => {
  assert.equal(mulCents(12345, 7), 86415)
  assert.equal(proportion(99999999999999, 999999999, 1000000000), 99999999899999)
  let value = 100, quantity = 3, consumed = 0
  while (quantity) { const part = proportion(value, 1, quantity); consumed += part; value -= part; quantity-- }
  assert.equal(consumed, 100); assert.equal(value, 0)
  for (const invalid of [NaN, Infinity, -1, 0.1, 1e14 + 1, '100']) assert.throws(() => money(invalid))
  assert.throws(() => mulCents(1e14, 2))
  assert.throws(() => proportion(100, 3, 2))
})
test('referencias normalizadas y fechas reales evitan claves y periodos ambiguos', () => {
  assert.equal(codeKey('  JEAN.01-A  '), 'r_jean.01-a')
  assert.equal(nameKey('  JEANS   Clásico  '), 'jeans clásico')
  assert.throws(() => codeKey('ref/otro'))
  assert.throws(() => codeKey(''))
  assert.equal(businessDate('2024-02-29'), '2024-02-29')
  for (const invalid of ['2025-02-29', '2026-02-31', '2026-13-01', 'ayer']) assert.throws(() => businessDate(invalid))
})
test('asientos sin contrapartida, cuentas desconocidas y lados dobles se rechazan antes de escribir', () => {
  const ctx = {}, tx = { create() { assert.fail('Un asiento inválido no puede escribir.') } }
  const base = { sourceType: 'test', sourceId: 'valid' }
  for (const lines of [
    [{ account: '1105', debitCents: 10 }, { account: '4135', creditCents: 9 }],
    [{ account: '1105', debitCents: 10, creditCents: 10 }, { account: '4135', creditCents: 10 }],
    [{ account: '9999', debitCents: 10 }, { account: '4135', creditCents: 10 }],
    [{ account: '1105', debitCents: 0 }, { account: '4135', creditCents: 0 }],
  ]) assert.throws(() => journal(tx, ctx, { ...base, lines }))
})
