import { AlertTriangle, RefreshCw } from 'lucide-react'
import { AdminSection, EmptyState, ErrorState, Spinner, StatusBadge, useAdminFetch } from './useAdminApi'

interface AuditRow {
  id: string
  actor_email: string
  action: string
  object_type: string
  object_id: string
  summary: string
  created_at: string
}

interface HealthRow {
  id: string
  source: string
  severity: string
  code: string
  message: string
  resolved: boolean
  created_at: string
}

export function AdminLogs() {
  const audit = useAdminFetch<{ results: AuditRow[] }>('/admin-panel/audit-logs/')
  const health = useAdminFetch<{ results: HealthRow[] }>('/admin-panel/health-events/')

  return (
    <AdminSection
      title="System log"
      description="Audit trail of administrative changes and broadcast health events."
      actions={
        <button className="btn-ghost" onClick={() => { audit.reload(); health.reload() }}>
          <RefreshCw size={14} /> Refresh
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold">Health events</h2>
          {health.loading && <Spinner />}
          {health.error && <ErrorState message={health.error} onRetry={health.reload} />}
          {health.data && health.data.results.length === 0 && (
            <EmptyState>No health events — the engine is reporting normally.</EmptyState>
          )}
          {health.data && health.data.results.length > 0 && (
            <ul className="space-y-2">
              {health.data.results.map((h) => (
                <li key={h.id} className="card flex items-start gap-3 p-4">
                  {h.severity === 'error' || h.severity === 'warning' ? (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{h.code}</span>
                      <span className="ml-2 text-xs text-muted">{h.source}</span>
                      {h.resolved && <StatusBadge status="played" />}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-muted">{h.message}</p>
                    <p className="mt-0.5 text-xs text-muted">{new Date(h.created_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Audit trail</h2>
          {audit.loading && <Spinner />}
          {audit.error && <ErrorState message={audit.error} onRetry={audit.reload} />}
          {audit.data && audit.data.results.length === 0 && <EmptyState>No administrative changes recorded yet.</EmptyState>}
          {audit.data && audit.data.results.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-4 py-2.5">Who</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {audit.data.results.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted">
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{a.actor_email || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{a.action}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{a.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminSection>
  )
}
