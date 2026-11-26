const colombianDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function movementDateText(movement) {
  if (movement.date) return movement.date.split('-').reverse().join('/')
  return movement.createdAt?.toDate?.().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) ?? '—'
}

function day(movement) {
  const date = movement.createdAt?.toDate?.()
  return movement.date || (date ? colombianDate.format(date) : '')
}

export function newestMovementFirst(a, b) {
  return day(b).localeCompare(day(a)) ||
    (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0) ||
    (a.stockBefore ?? 0) - (b.stockBefore ?? 0)
}
