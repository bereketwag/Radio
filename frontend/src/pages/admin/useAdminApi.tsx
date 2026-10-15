import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'

/** Small helper hook: fetch JSON, expose reload + error state. */
export function useAdminFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<T>(path)
      .then((res) => {
        if (alive) {
          setData(res)
          setError(null)
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, error, loading, reload }
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-accent/10 text-accent',
    approved: 'bg-accent/10 text-accent',
    paid: 'bg-accent/10 text-accent',
    played: 'bg-accent/10 text-accent',
    pending: 'bg-warning/10 text-warning',
    draft: 'bg-surface-2 text-muted',
    paused: 'bg-warning/10 text-warning',
    rejected: 'bg-danger/10 text-danger',
    unpaid: 'bg-danger/10 text-danger',
    missed: 'bg-danger/10 text-danger',
    expired: 'bg-surface-2 text-muted',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[status] ?? 'bg-surface-2 text-muted'}`}>
      {status}
    </span>
  )
}

export function AdminSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-muted">{children}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-danger/40 p-6 text-sm">
      <p className="font-medium text-danger">Couldn’t load this section</p>
      <p className="mt-1 text-muted">{message}</p>
      {onRetry && (
        <button className="btn-ghost mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Loading" />
    </div>
  )
}
