import { Pencil, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../lib/api'
import { AdvertiserPicker } from './AdvertiserPicker'
import { AdminSection, EmptyState, ErrorState, Spinner, StatusBadge, useAdminFetch } from './useAdminApi'

interface VisualCampaign {
  id: string
  advertiser: string
  advertiser_name: string
  name: string
  banner_image: string | null
  destination_url: string
  placement: string
  priority: number
  status: string
  payment_status: string
  starts_at: string | null
  ends_at: string | null
  impressions: number
  clicks: number
  ctr: number | null
  eligible: boolean
}

const emptyForm = {
  advertiser: '',
  name: '',
  destination_url: '',
  placement: 'sidebar',
  priority: '5',
  starts_at: '',
  ends_at: '',
}

/** ISO timestamp → value for <input type="datetime-local"> (browser-local time). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AdminVisualAds() {
  const { data, error, loading, reload } = useAdminFetch<{ results: VisualCampaign[] }>(
    '/admin-panel/visual-campaigns/',
  )
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [file, setFile] = useState<File | null>(null)

  const refresh = () => reload()

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setFormError(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = (c: VisualCampaign, status: string) =>
    act(() => api.post(`/admin-panel/visual-campaigns/${c.id}/set_status/`, { status }))

  const setPayment = (c: VisualCampaign, payment_status: string) =>
    act(() => api.post(`/admin-panel/visual-campaigns/${c.id}/set_payment/`, { payment_status }))

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setFile(null)
    setFormError(null)
    setShowForm((s) => !s)
  }

  const openEdit = (c: VisualCampaign) => {
    setEditingId(c.id)
    setForm({
      advertiser: c.advertiser,
      name: c.name,
      destination_url: c.destination_url,
      placement: c.placement,
      priority: String(c.priority),
      starts_at: toLocalInput(c.starts_at),
      ends_at: toLocalInput(c.ends_at),
    })
    setFile(null)
    setFormError(null)
    setShowForm(true)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.advertiser) {
      setFormError('Choose an advertiser, or create one with “New advertiser”.')
      return
    }
    if (!editingId && !file) {
      setFormError('Choose a banner image to upload.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('advertiser', form.advertiser)
      fd.append('name', form.name)
      fd.append('destination_url', form.destination_url)
      fd.append('placement', form.placement)
      fd.append('priority', form.priority)
      fd.append('starts_at', form.starts_at ? new Date(form.starts_at).toISOString() : '')
      fd.append('ends_at', form.ends_at ? new Date(form.ends_at).toISOString() : '')
      // Only sent when chosen: an edit keeps the stored banner otherwise.
      if (file) fd.append('banner_image', file)

      if (editingId) {
        await api.patchForm(`/admin-panel/visual-campaigns/${editingId}/`, fd)
      } else {
        await api.upload('/admin-panel/visual-campaigns/', fd)
      }
      setShowForm(false)
      setEditingId(null)
      setForm({ ...emptyForm })
      setFile(null)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save campaign')
    } finally {
      setBusy(false)
    }
  }

  const remove = (c: VisualCampaign) => {
    if (!window.confirm(`Delete banner campaign “${c.name}”?`)) return
    act(async () => {
      await api.del(`/admin-panel/visual-campaigns/${c.id}/`)
      if (editingId === c.id) {
        setShowForm(false)
        setEditingId(null)
        setForm({ ...emptyForm })
        setFile(null)
      }
    })
  }

  const campaigns = data?.results ?? []

  return (
    <AdminSection
      title="Banner campaigns"
      description="Rotation serves only approved, in-window campaigns. Expired ones drop out automatically."
      actions={
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={15} />
          New campaign
        </button>
      }
    >
      {formError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>
      )}

      {showForm && (
        <form onSubmit={submit} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <p className="col-span-full text-sm font-medium">
            {editingId ? 'Edit banner campaign' : 'New banner campaign'}
          </p>
          <div>
            <label className="label">Advertiser</label>
            <AdvertiserPicker value={form.advertiser} onChange={(id) => setForm({ ...form, advertiser: id })} disabled={busy} />
          </div>
          <div>
            <label className="label">Campaign name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Destination URL</label>
            <input className="input" type="url" required placeholder="https://" value={form.destination_url} onChange={(e) => setForm({ ...form, destination_url: e.target.value })} />
          </div>
          <div>
            <label className="label">Banner image {editingId ? '' : '*'}</label>
            <input className="input" type="file" accept=".jpg,.jpeg,.png,.webp" required={!editingId} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="hint">
              {editingId ? 'Leave empty to keep the current banner. ' : ''}
              JPG/PNG/WebP, max 5&nbsp;MB.
            </p>
          </div>
          <div>
            <label className="label">Placement</label>
            <select className="input" value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
              <option value="sidebar">Side label (player panel)</option>
              <option value="below_player">Below player</option>
              <option value="modal">Modal takeover (full-screen)</option>
            </select>
            <p className="hint">Side label: 1280×320 landscape · Modal: 1080×1350 portrait poster.</p>
          </div>
          <div>
            <label className="label">Priority (1–10)</label>
            <input className="input" type="number" min={1} max={10} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Starts</label>
              <input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </div>
            <div>
              <label className="label">Ends</label>
              <input className="input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
          </div>
          <div className="col-span-full flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create campaign'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && campaigns.length === 0 && !showForm && (
        <EmptyState>No banner campaigns yet. Create one to start rotating ads.</EmptyState>
      )}

      {campaigns.length > 0 && (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li key={c.id} className="card p-5">
              <div className="flex flex-wrap items-start gap-4">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {c.banner_image && <img src={c.banner_image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    <StatusBadge status={c.status} />
                    <StatusBadge status={c.payment_status} />
                    {!c.eligible && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                        not serving
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {c.advertiser_name} · {c.placement.replace('_', ' ')} · priority {c.priority}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : 'no start'} →{' '}
                    {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : 'no end'} ·{' '}
                    {c.impressions.toLocaleString()} impressions · {c.clicks.toLocaleString()} clicks
                    {c.ctr !== null && ` · CTR ${c.ctr}%`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button className="btn-ghost h-8 !px-3" disabled={busy} onClick={() => openEdit(c)}>
                    <Pencil size={13} /> Edit
                  </button>
                  {c.status === 'active' || c.status === 'approved' ? (
                    <button className="btn-ghost h-8 !px-3" disabled={busy} onClick={() => setStatus(c, 'paused')}>
                      <Pause size={13} /> Pause
                    </button>
                  ) : (
                    <button className="btn-ghost h-8 !px-3" disabled={busy} onClick={() => setStatus(c, 'active')}>
                      <Play size={13} /> Activate
                    </button>
                  )}
                  <select
                    className="input !w-auto !py-1.5 text-xs"
                    value={c.payment_status}
                    disabled={busy}
                    onChange={(e) => setPayment(c, e.target.value)}
                    aria-label={`Payment status for ${c.name}`}
                  >
                    <option value="unpaid">unpaid</option>
                    <option value="pending">payment pending</option>
                    <option value="paid">paid</option>
                  </select>
                  <button
                    className="btn-ghost h-8 !px-3 text-danger"
                    disabled={busy}
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  )
}
