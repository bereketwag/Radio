import { AlertTriangle, CalendarPlus, Check, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../lib/api'
import { AdvertiserPicker } from './AdvertiserPicker'
import { AdminSection, EmptyState, ErrorState, Spinner, StatusBadge, useAdminFetch } from './useAdminApi'

interface Advert {
  id: string
  name: string
  audio_url: string | null
  duration_seconds: number
  approved: boolean
  active: boolean
}

interface Schedule {
  id: string
  recurrence: string
  starts_at: string
  local_time: string | null
  weekday: number | null
  max_break_seconds: number
  enabled: boolean
  conflicts: { with_schedule_id: string; overlap_start: string }[]
}

interface AudioCampaign {
  id: string
  advertiser: string
  advertiser_name: string
  name: string
  status: string
  payment_status: string
  priority: number
  starts_at: string | null
  ends_at: string | null
  eligible: boolean
  adverts: Advert[]
  schedules: Schedule[]
}

interface BreakLog {
  id: string
  campaign_name: string
  scheduled_for: string
  result: string
  seconds_played: number
  advert_names: string[]
  detail: string
}

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** ISO timestamp → value for <input type="datetime-local"> (browser-local time). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AdminAudioAds() {
  const { data, error, loading, reload } = useAdminFetch<{ results: AudioCampaign[] }>(
    '/admin-panel/audio-campaigns/',
  )
  const { data: logs } = useAdminFetch<BreakLog[] | { results: BreakLog[] }>('/admin-panel/ad-break-logs/')
  const { data: advertLibrary, reload: reloadAdverts } = useAdminFetch<Advert[]>('/admin-panel/audio-adverts/')

  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /* ---- advert library -------------------------------------------------- */
  const [showAdvertForm, setShowAdvertForm] = useState(false)
  const [editingAdvert, setEditingAdvert] = useState<Advert | null>(null)
  const [advertForm, setAdvertForm] = useState({ name: '', approved: false, active: true })
  const [advertFile, setAdvertFile] = useState<File | null>(null)

  /* ---- campaigns ------------------------------------------------------- */
  const [showForm, setShowForm] = useState(false)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [form, setForm] = useState({
    advertiser: '',
    name: '',
    priority: '5',
    starts_at: '',
    ends_at: '',
  })

  /* ---- schedules + attach --------------------------------------------- */
  const [showScheduleFor, setShowScheduleFor] = useState<string | null>(null)
  const [attachFor, setAttachFor] = useState<string | null>(null)
  const [selectedAdverts, setSelectedAdverts] = useState<string[]>([])
  const [scheduleForm, setScheduleForm] = useState({
    recurrence: 'daily',
    starts_at: '',
    local_time: '12:00',
    weekday: '0',
    max_break_seconds: '60',
  })
  const [conflicts, setConflicts] = useState<Record<string, { with_schedule_id: string; overlap_start: string }[]>>({})

  const refresh = () => {
    reload()
    reloadAdverts()
  }

  /** Run an admin mutation, surfacing API errors in the page-level banner. */
  const run = async (fn: () => Promise<unknown>) => {
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

  /* ------------------------- advert library ----------------------------- */
  const resetAdvertForm = () => {
    setAdvertForm({ name: '', approved: false, active: true })
    setAdvertFile(null)
    setEditingAdvert(null)
  }

  const submitAdvert = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!editingAdvert && !advertFile) {
      setFormError('Choose an audio file for the advert.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('name', advertForm.name)
      fd.append('approved', String(advertForm.approved))
      fd.append('active', String(advertForm.active))
      if (advertFile) fd.append('audio_file', advertFile)
      if (editingAdvert) {
        await api.patchForm(`/admin-panel/audio-adverts/${editingAdvert.id}/`, fd)
      } else {
        await api.upload('/admin-panel/audio-adverts/', fd)
      }
      setShowAdvertForm(false)
      resetAdvertForm()
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Advert upload failed')
    } finally {
      setBusy(false)
    }
  }

  const openAdvertEdit = (a: Advert) => {
    setAdvertForm({ name: a.name, approved: a.approved, active: a.active })
    setAdvertFile(null)
    setEditingAdvert(a)
    setShowAdvertForm(true)
    setFormError(null)
  }

  const deleteAdvert = (a: Advert) => {
    if (!window.confirm(`Delete advert “${a.name}”? It will also drop out of every campaign.`)) return
    run(async () => {
      await api.del(`/admin-panel/audio-adverts/${a.id}/`)
      if (editingAdvert?.id === a.id) {
        setShowAdvertForm(false)
        resetAdvertForm()
      }
    })
  }

  const patchAdvert = (a: Advert, patch: Partial<Advert>) =>
    run(() => api.patch(`/admin-panel/audio-adverts/${a.id}/`, patch))

  /* --------------------------- campaigns -------------------------------- */
  const setStatus = (c: AudioCampaign, status: string) =>
    run(() => api.post(`/admin-panel/audio-campaigns/${c.id}/set_status/`, { status }))

  const setPayment = (c: AudioCampaign, payment_status: string) =>
    run(() => api.post(`/admin-panel/audio-campaigns/${c.id}/set_payment/`, { payment_status }))

  const openCampaignCreate = () => {
    setEditingCampaignId(null)
    setForm({ advertiser: '', name: '', priority: '5', starts_at: '', ends_at: '' })
    setFormError(null)
    setShowForm((s) => !s)
  }

  const openCampaignEdit = (c: AudioCampaign) => {
    setEditingCampaignId(c.id)
    setForm({
      advertiser: c.advertiser,
      name: c.name,
      priority: String(c.priority),
      starts_at: toLocalInput(c.starts_at),
      ends_at: toLocalInput(c.ends_at),
    })
    setFormError(null)
    setShowForm(true)
  }

  const submitCampaign = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.advertiser) {
      setFormError('Choose an advertiser, or create one with “New advertiser”.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        advertiser: form.advertiser,
        name: form.name,
        priority: Number(form.priority),
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      }
      if (editingCampaignId) {
        await api.patch(`/admin-panel/audio-campaigns/${editingCampaignId}/`, payload)
      } else {
        await api.post('/admin-panel/audio-campaigns/', payload)
      }
      setShowForm(false)
      setEditingCampaignId(null)
      setForm({ advertiser: '', name: '', priority: '5', starts_at: '', ends_at: '' })
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save campaign')
    } finally {
      setBusy(false)
    }
  }

  const deleteCampaign = (c: AudioCampaign) => {
    if (!window.confirm(`Delete campaign “${c.name}” with its schedules? Break logs are kept.`)) return
    run(() => api.del(`/admin-panel/audio-campaigns/${c.id}/`))
  }

  /* ------------------- attaching adverts to a campaign ------------------ */
  const openAttach = (c: AudioCampaign) => {
    if (attachFor === c.id) {
      setAttachFor(null)
      return
    }
    setSelectedAdverts(c.adverts.map((a) => a.id))
    setAttachFor(c.id)
  }

  const toggleAdvertSelection = (id: string) =>
    setSelectedAdverts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const saveAttach = (c: AudioCampaign) =>
    run(async () => {
      await api.patch(`/admin-panel/audio-campaigns/${c.id}/`, { advert_ids: selectedAdverts })
      setAttachFor(null)
    })

  /* ---------------------------- schedules ------------------------------- */
  const submitSchedule = async (campaignId: string, e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      const payload: Record<string, unknown> = {
        recurrence: scheduleForm.recurrence,
        max_break_seconds: Number(scheduleForm.max_break_seconds),
      }
      if (scheduleForm.recurrence === 'once') {
        payload.starts_at = new Date(scheduleForm.starts_at).toISOString()
      } else {
        payload.local_time = scheduleForm.local_time
        payload.starts_at = new Date().toISOString()
        if (scheduleForm.recurrence === 'weekly') payload.weekday = Number(scheduleForm.weekday)
      }
      const res = await api.post<{ conflicts: { with_schedule_id: string; overlap_start: string }[] }>(
        `/admin-panel/audio-campaigns/${campaignId}/schedules/`,
        payload,
      )
      setConflicts((prev) => ({ ...prev, [campaignId]: res.conflicts }))
      setShowScheduleFor(null)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setBusy(false)
    }
  }

  const disableSchedule = (scheduleId: string) =>
    run(() => api.post(`/admin-panel/ad-schedules/${scheduleId}/disable/`))

  const deleteSchedule = (scheduleId: string) => {
    if (!window.confirm('Delete this break schedule?')) return
    run(() => api.del(`/admin-panel/ad-schedules/${scheduleId}/`))
  }

  const library = advertLibrary ?? []
  const campaigns = data?.results ?? []
  const logRows = Array.isArray(logs) ? logs : (logs?.results ?? [])

  return (
    <AdminSection
      title="Audio campaigns"
      description="Upload advert spots, attach them to a campaign, then schedule the breaks the engine inserts."
      actions={
        <button className="btn-primary" onClick={openCampaignCreate}>
          <Plus size={15} /> New campaign
        </button>
      }
    >
      {formError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Advert library                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="card mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Advert spots</h2>
            <p className="text-sm text-muted">
              Every spot lives here; attach them to campaigns below. Only approved + active spots air.
            </p>
          </div>
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              const opening = !showAdvertForm || editingAdvert !== null
              setShowAdvertForm(opening)
              if (opening) resetAdvertForm()
              setFormError(null)
            }}
          >
            <Plus size={15} /> Upload advert
          </button>
        </div>

        {showAdvertForm && (
          <form onSubmit={submitAdvert} className="mb-4 grid gap-4 rounded-xl bg-surface-2 p-4 sm:grid-cols-2">
            <p className="col-span-full text-sm font-medium">
              {editingAdvert ? `Edit advert — ${editingAdvert.name}` : 'Upload a new advert spot'}
            </p>
            <div>
              <label className="label">Spot name *</label>
              <input
                className="input"
                required
                value={advertForm.name}
                onChange={(e) => setAdvertForm({ ...advertForm, name: e.target.value })}
                placeholder="e.g. Northwind 30s"
              />
            </div>
            <div>
              <label className="label">Audio file {editingAdvert ? '' : '*'}</label>
              <input
                className="input"
                type="file"
                accept=".mp3,.ogg,.opus,.flac,.m4a,.aac,.wav"
                required={!editingAdvert}
                onChange={(e) => setAdvertFile(e.target.files?.[0] ?? null)}
              />
              <p className="hint">
                {editingAdvert ? 'Leave empty to keep the current file. ' : ''}
                MP3/OGG/Opus/FLAC/M4A/AAC/WAV, max 50&nbsp;MB.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                checked={advertForm.approved}
                onChange={(e) => setAdvertForm({ ...advertForm, approved: e.target.checked })}
              />
              Approved for broadcast
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                checked={advertForm.active}
                onChange={(e) => setAdvertForm({ ...advertForm, active: e.target.checked })}
              />
              Active (eligible to play)
            </label>
            <div className="col-span-full flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editingAdvert ? 'Save changes' : 'Upload advert'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  setShowAdvertForm(false)
                  resetAdvertForm()
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {!advertLibrary && <Spinner />}
        {advertLibrary && library.length === 0 && (
          <EmptyState>No advert spots yet — upload one to give campaigns something to play.</EmptyState>
        )}
        {advertLibrary && library.length > 0 && (
          <ul className="divide-y divide-line">
            {library.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                {a.audio_url && (
                  <audio controls preload="none" src={a.audio_url} className="h-8" aria-label={`Preview ${a.name}`} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted">
                    {a.duration_seconds ? `${a.duration_seconds}s` : 'length unknown'}
                  </p>
                </div>
                <StatusBadge status={a.approved ? 'approved' : 'pending'} />
                {!a.active && <StatusBadge status="paused" />}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-ghost h-8 !px-3"
                    disabled={busy}
                    onClick={() => patchAdvert(a, { approved: !a.approved })}
                  >
                    <Check size={13} /> {a.approved ? 'Unapprove' : 'Approve'}
                  </button>
                  <button
                    className="btn-ghost h-8 !px-3"
                    disabled={busy}
                    onClick={() => patchAdvert(a, { active: !a.active })}
                  >
                    {a.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="btn-ghost h-8 !px-3" disabled={busy} onClick={() => openAdvertEdit(a)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    className="btn-ghost h-8 !px-3 text-danger"
                    disabled={busy}
                    onClick={() => deleteAdvert(a)}
                    aria-label={`Delete ${a.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Campaigns                                                         */}
      {/* ---------------------------------------------------------------- */}
      {showForm && (
        <form onSubmit={submitCampaign} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <p className="col-span-full text-sm font-medium">
            {editingCampaignId ? 'Edit campaign' : 'New campaign'}
          </p>
          <div>
            <label className="label">Advertiser</label>
            <AdvertiserPicker value={form.advertiser} onChange={(id) => setForm({ ...form, advertiser: id })} disabled={busy} />
          </div>
          <div>
            <label className="label">Campaign name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editingCampaignId ? 'Save changes' : 'Create campaign'}</button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setShowForm(false)
                setEditingCampaignId(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && campaigns.length === 0 && !showForm && <EmptyState>No audio campaigns yet.</EmptyState>}

      {campaigns.length > 0 && (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li key={c.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    <StatusBadge status={c.status} />
                    <StatusBadge status={c.payment_status} />
                    {!c.eligible && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                        not eligible for breaks
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {c.advertiser_name} · priority {c.priority} ·{' '}
                    {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : 'no start'} →{' '}
                    {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : 'no end'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost h-8 !px-3" onClick={() => openAttach(c)} disabled={busy}>
                    {attachFor === c.id ? <X size={13} /> : <Plus size={13} />}
                    {attachFor === c.id ? 'Close' : 'Adverts'}
                  </button>
                  <button className="btn-ghost h-8 !px-3" onClick={() => setShowScheduleFor(showScheduleFor === c.id ? null : c.id)} disabled={busy}>
                    <CalendarPlus size={13} /> Schedule break
                  </button>
                  <button className="btn-ghost h-8 !px-3" onClick={() => openCampaignEdit(c)} disabled={busy}>
                    <Pencil size={13} /> Edit
                  </button>
                  {c.status === 'active' || c.status === 'approved' ? (
                    <button className="btn-ghost h-8 !px-3" disabled={busy} onClick={() => setStatus(c, 'paused')}>
                      Pause
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
                    onClick={() => deleteCampaign(c)}
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Attach adverts */}
              {attachFor === c.id && (
                <div className="mt-3 rounded-xl bg-surface-2 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Attach advert spots</p>
                  {library.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">No spots in the library yet — upload one above first.</p>
                  ) : (
                    <>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {library.map((a) => (
                          <li key={a.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                                checked={selectedAdverts.includes(a.id)}
                                onChange={() => toggleAdvertSelection(a.id)}
                              />
                              <span className="truncate">{a.name}</span>
                              <span className="ml-auto shrink-0 text-xs text-muted">{a.duration_seconds}s</span>
                              {!a.approved && <span className="shrink-0 text-xs text-warning">unapproved</span>}
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <button className="btn-primary" disabled={busy} onClick={() => saveAttach(c)}>
                          {busy ? 'Saving…' : `Save ${selectedAdverts.length} spot(s)`}
                        </button>
                        <button className="btn-ghost" disabled={busy} onClick={() => setAttachFor(null)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Adverts */}
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Adverts in this campaign</p>
                {c.adverts.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    No spots attached — use “Adverts” above to attach one from the library.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {c.adverts.map((a) => (
                      <li key={a.id} className="flex items-center gap-3">
                        {a.audio_url && (
                          <audio controls preload="none" src={a.audio_url} className="h-8" aria-label={`Preview ${a.name}`} />
                        )}
                        <span className="truncate">{a.name}</span>
                        <span className="text-xs text-muted">{a.duration_seconds}s</span>
                        <StatusBadge status={a.approved ? 'approved' : 'pending'} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Schedules */}
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Break schedules</p>
                {c.schedules.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No schedules — this campaign won’t insert breaks yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {c.schedules.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {s.recurrence}
                          {s.recurrence === 'daily' && s.local_time && ` at ${s.local_time}`}
                          {s.recurrence === 'weekly' && s.weekday !== null && ` ${weekdayNames[s.weekday]} at ${s.local_time}`}
                          {s.recurrence === 'once' && ` at ${new Date(s.starts_at).toLocaleString()}`}
                          {' '}· max {s.max_break_seconds}s
                        </span>
                        {!s.enabled && <StatusBadge status="paused" />}
                        {s.conflicts.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-warning">
                            <AlertTriangle size={12} /> overlap with another schedule
                          </span>
                        )}
                        {s.enabled && (
                          <button className="text-xs text-warning underline-offset-2 hover:underline" onClick={() => disableSchedule(s.id)} disabled={busy}>
                            disable now
                          </button>
                        )}
                        <button
                          className="text-xs text-danger underline-offset-2 hover:underline"
                          onClick={() => deleteSchedule(s.id)}
                          disabled={busy}
                        >
                          delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {showScheduleFor === c.id && (
                  <form onSubmit={(e) => submitSchedule(c.id, e)} className="mt-3 grid gap-3 rounded-xl bg-surface-2 p-4 sm:grid-cols-4">
                    <div>
                      <label className="label">Recurrence</label>
                      <select className="input" value={scheduleForm.recurrence} onChange={(e) => setScheduleForm({ ...scheduleForm, recurrence: e.target.value })}>
                        <option value="once">One-time</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    {scheduleForm.recurrence === 'once' ? (
                      <div className="sm:col-span-2">
                        <label className="label">Break time</label>
                        <input className="input" type="datetime-local" required value={scheduleForm.starts_at} onChange={(e) => setScheduleForm({ ...scheduleForm, starts_at: e.target.value })} />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="label">Station-local time</label>
                          <input className="input" type="time" required value={scheduleForm.local_time} onChange={(e) => setScheduleForm({ ...scheduleForm, local_time: e.target.value })} />
                        </div>
                        {scheduleForm.recurrence === 'weekly' && (
                          <div>
                            <label className="label">Weekday</label>
                            <select className="input" value={scheduleForm.weekday} onChange={(e) => setScheduleForm({ ...scheduleForm, weekday: e.target.value })}>
                              {weekdayNames.map((d, i) => (
                                <option key={d} value={i}>{d}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                    <div>
                      <label className="label">Max break (s)</label>
                      <input className="input" type="number" min={10} max={300} value={scheduleForm.max_break_seconds} onChange={(e) => setScheduleForm({ ...scheduleForm, max_break_seconds: e.target.value })} />
                    </div>
                    <div className="sm:col-span-4">
                      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save schedule'}</button>
                    </div>
                  </form>
                )}

                {conflicts[c.id] && conflicts[c.id].length > 0 && (
                  <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">
                    Saved, but this break overlaps another schedule. Overlapping breaks won’t both air —
                    the higher-priority campaign wins.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Broadcast logs */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Break broadcast log</h2>
        <p className="mb-3 text-sm text-muted">
          Written by the engine when it reports an actual play; scheduled breaks that never
          report are marked missed by the periodic sweep.
        </p>
        {!logs && <Spinner />}
        {logs && logRows.length === 0 && <EmptyState>No breaks have run yet.</EmptyState>}
        {logs && logRows.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Scheduled</th>
                  <th className="px-4 py-2.5">Campaign</th>
                  <th className="px-4 py-2.5">Result</th>
                  <th className="px-4 py-2.5">Aired</th>
                  <th className="px-4 py-2.5">Adverts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logRows.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 tabular-nums">{new Date(l.scheduled_for).toLocaleString()}</td>
                    <td className="px-4 py-2.5">{l.campaign_name}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={l.result} /></td>
                    <td className="px-4 py-2.5 tabular-nums">{l.seconds_played}s</td>
                    <td className="px-4 py-2.5 text-muted">{l.advert_names.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminSection>
  )
}
