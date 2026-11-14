import { useCallback, useEffect, useMemo, useState } from 'react'
import { erpCommand } from '../lib/erpApi.js'
import { discardOfflineCommand, enqueueOfflineCommand, listOfflineCommands, retryOfflineCommand, subscribeOfflineQueue, syncOfflineCommands } from '../lib/offlineQueue.js'
import { firebaseState } from '../lib/firebase.js'

export function useOfflineQueue(user, member) {
  const scope = useMemo(() => user && member ? { uid: user.uid, role: member.role, companyId: firebaseState.companyId } : null, [user, member])
  const [entries, setEntries] = useState([]), [syncing, setSyncing] = useState(false)
  const refresh = useCallback(async () => setEntries(scope ? await listOfflineCommands(scope) : []), [scope])
  const syncNow = useCallback(async () => {
    if (!scope || !navigator.onLine) return { synced: 0, failed: 0 }
    setSyncing(true)
    try { return await syncOfflineCommands(scope, erpCommand) }
    finally { setSyncing(false); await refresh() }
  }, [scope, refresh])
  useEffect(() => {
    refresh().catch(() => {})
    const unsubscribe = subscribeOfflineQueue(() => refresh().catch(() => {}))
    const online = () => syncNow().catch(() => {})
    window.addEventListener('online', online)
    if (navigator.onLine) online()
    return () => { unsubscribe(); window.removeEventListener('online', online) }
  }, [refresh, syncNow])
  const enqueue = useCallback((action, payload, id) => enqueueOfflineCommand(scope, action, payload, id), [scope])
  const retry = useCallback(async id => { await retryOfflineCommand(id); await syncNow() }, [syncNow])
  const discard = useCallback(async id => { await discardOfflineCommand(id); await refresh() }, [refresh])
  return { entries, enqueue, syncNow, retry, discard, syncing, pending: entries.filter(item => ['pending', 'syncing'].includes(item.status)).length, failed: entries.filter(item => item.status === 'failed').length }
}
