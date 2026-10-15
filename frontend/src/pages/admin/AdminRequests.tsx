import { Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { AdminSection, EmptyState, ErrorState, Spinner, StatusBadge, useAdminFetch } from './useAdminApi'

interface Advertiser {
  id: string
  name: string
}

interface AdRequest {
  id: string
  business_name: string
  contact_name: string
  email: string
  phone: string
  website: string
  ad_format: string
  start_date: string | null
  end_date: string | null
  target_audience: string
  estimated_budget: string
  message: string
  status: string
  status_note: string
  created_at: string
}

export function AdminRequests() {
  const [filter, setFilter] = useState('pending')
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAdminFetch<AdRequest[] | { results: AdRequest[] }>(
    `/admin-panel/ad-requests/${filter ? `?status=${filter}` : ''}`,
    [filter],
  )
  const rows = Array.isArray(data) ? data : (data?.results ?? [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id)
    try {
      await api.post(`/admin-panel/ad-requests/${id}/decide/`, { decision })
      reload()
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Turn an approved request into real campaign(s), pre-filling everything the
   * form already knows: the advertiser, the flight dates, and the request link.
   * Banner creatives still need uploading on the campaign page, so the shell is
   * created first and the operator is taken there.
   */
  const createCampaign = async (r: AdRequest) => {
    setBusyId(r.id)
    setNotice(null)
    try {
      // Reuse an advertiser with this name if one exists (a retry after an
      // interrupted first attempt must not create a duplicate).
      const existing = await api.get<Advertiser[] | { results: Advertiser[] }>('/admin-panel/advertisers/')
      const list = Array.isArray(existing) ? existing : (existing.results ?? [])
      const found = list.find((a) => a.name === r.business_name)
      const advertiser =
        found ??
        (await api.post<{ id: string }>('/admin-panel/advertisers/', {
          name: r.business_name,
          email: r.email,
          contact_name: r.contact_name,
          phone: r.phone,
          website: r.website,
        }))
      const base = {
        advertiser: advertiser.id,
        name: r.business_name,
        request: r.id,
        starts_at: r.start_date ? `${r.start_date}T00:00:00Z` : null,
        ends_at: r.end_date ? `${r.end_date}T23:59:59Z` : null,
      }
      if (r.ad_format === 'audio') {
        await api.post('/admin-panel/audio-campaigns/', { ...base, priority: 5 })
        setNotice(`Audio campaign created for ${r.business_name}. Upload the spot and schedule a break on Audio campaigns.`)
        navigate('/admin/audio')
      } else {
        const placement = r.ad_format === 'modal' ? 'modal' : 'sidebar'
        await api.post('/admin-panel/visual-campaigns/', {
          ...base,
          placement,
          priority: 5,
          destination_url: r.website || 'https://example.com',
        })
        setNotice(`Banner campaign created for ${r.business_name}. Upload the creative on Banner campaigns — it will not serve until a banner is attached and the campaign is approved.`)
        navigate('/admin/visual')
      }
      reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not create the campaign.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AdminSection title="Advertiser requests" description="Review and decide on submitted requests.">
      {notice && (
        <p className="mb-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent" role="status">{notice}</p>
      )}
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {['pending', 'approved', 'rejected', ''].map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              filter === f ? 'bg-surface-2 font-medium' : 'text-muted hover:text-ink'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && rows.length === 0 && <EmptyState>No requests in this view.</EmptyState>}

      {data && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.business_name}</p>
                  <p className="text-sm text-muted">
                    {r.contact_name} · <a className="underline-offset-2 hover:underline" href={`mailto:${r.email}`}>{r.email}</a>
                    {r.phone && ` · ${r.phone}`}
                  </p>
                  {r.website && (
                    <a className="text-sm text-accent underline-offset-2 hover:underline" href={r.website} target="_blank" rel="noreferrer">
                      {r.website}
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === 'pending' && (
                    <>
                      <button
                        className="btn-primary h-8 !px-3"
                        disabled={busyId === r.id}
                        onClick={() => decide(r.id, 'approved')}
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button
                        className="btn-ghost h-8 !px-3 text-danger"
                        disabled={busyId === r.id}
                        onClick={() => decide(r.id, 'rejected')}
                      >
                        <X size={14} /> Reject
                      </button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <button
                      className="btn-primary h-8 !px-3"
                      disabled={busyId === r.id}
                      onClick={() => createCampaign(r)}
                      title={`Create a ${r.ad_format === 'audio' ? 'n audio' : ' banner'} campaign from this request`}
                    >
                      <Plus size={14} /> {busyId === r.id ? 'Creating…' : 'Create campaign'}
                    </button>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Format</dt>
                  <dd>{r.ad_format}</dd>
                </div>
                {(r.start_date || r.end_date) && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Requested window</dt>
                    <dd>{r.start_date ?? '—'} → {r.end_date ?? '—'}</dd>
                  </div>
                )}
                {r.estimated_budget && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Budget</dt>
                    <dd>{r.estimated_budget}</dd>
                  </div>
                )}
                {r.target_audience && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs uppercase tracking-wide text-muted">Target audience</dt>
                    <dd>{r.target_audience}</dd>
                  </div>
                )}
                {r.message && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs uppercase tracking-wide text-muted">Message</dt>
                    <dd className="whitespace-pre-wrap text-muted">{r.message}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 text-xs text-muted">Submitted {new Date(r.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  )
}
