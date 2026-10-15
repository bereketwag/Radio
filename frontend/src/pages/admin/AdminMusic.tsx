import { Clock, Disc3, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../lib/api'
import { AdminSection, EmptyState, ErrorState, Spinner, useAdminFetch } from './useAdminApi'

interface MusicStats {
  total_songs: number
  enabled_songs: number
  total_seconds: number
  total_minutes: number
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = Math.round(total % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

interface Track {
  id: string
  title: string
  artist: string
  album: string
  audio_url: string | null
  duration_seconds: number
  artwork_url: string | null
  enabled: boolean
  isrc: string
  label: string
  licensing_notes: string
  permitted_territories: string[]
  territories_display: string
  explicit: boolean
}

interface TrackPage {
  count: number
  results: Track[]
}

const emptyForm = {
  title: '',
  artist: '',
  album: '',
  isrc: '',
  label: '',
  permitted_territories: '',
  licensing_notes: '',
  explicit: false,
}

export function AdminMusic() {
  const [search, setSearch] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')
  const [page, setPage] = useState(1)
  const query = new URLSearchParams()
  if (search) query.set('search', search)
  if (enabledFilter) query.set('enabled', enabledFilter)
  if (page > 1) query.set('page', String(page))
  const { data, error, loading, reload } = useAdminFetch<TrackPage>(
    `/admin-panel/tracks/?${query.toString()}`,
    [search, enabledFilter, page],
  )

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [artworkFile, setArtworkFile] = useState<File | null>(null)
  const { data: stats, reload: reloadStats } = useAdminFetch<MusicStats>('/admin-panel/tracks/stats/')

  const pageSize = 20
  const totalPages = data ? Math.max(1, Math.ceil(data.count / pageSize)) : 1

  const resetForm = () => {
    setForm({ ...emptyForm })
    setAudioFile(null)
    setArtworkFile(null)
    setEditingId(null)
    setFormError(null)
  }

  const openCreate = () => {
    resetForm()
    setShowForm((s) => !s || editingId !== null)
  }

  const openEdit = (t: Track) => {
    setForm({
      title: t.title,
      artist: t.artist,
      album: t.album,
      isrc: t.isrc,
      label: t.label,
      permitted_territories: t.permitted_territories?.join(', ') ?? '',
      licensing_notes: t.licensing_notes,
      explicit: t.explicit,
    })
    setAudioFile(null)
    setArtworkFile(null)
    setFormError(null)
    setEditingId(t.id)
    setShowForm(true)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!editingId && !audioFile) {
      setFormError('Choose an audio file to upload.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('title', form.title)
      fd.append('artist', form.artist)
      fd.append('album', form.album)
      fd.append('isrc', form.isrc)
      fd.append('label', form.label)
      fd.append('licensing_notes', form.licensing_notes)
      fd.append('explicit', String(form.explicit))
      fd.append(
        'permitted_territories',
        JSON.stringify(
          form.permitted_territories.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
        ),
      )
      // Files are only sent when chosen: an edit keeps the stored file otherwise.
      if (audioFile) fd.append('audio_file', audioFile)
      if (artworkFile) fd.append('artwork', artworkFile)

      if (editingId) {
        await api.patchForm(`/admin-panel/tracks/${editingId}/`, fd)
      } else {
        await api.upload('/admin-panel/tracks/', fd)
      }
      setShowForm(false)
      resetForm()
      reload()
      reloadStats()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (t: Track) => {
    setBusy(true)
    try {
      await api.post(`/admin-panel/tracks/${t.id}/toggle_enabled/`)
      reload()
      reloadStats()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not change status')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: Track) => {
    if (!window.confirm(`Delete “${t.title}”? The audio file is removed from the library.`)) return
    setBusy(true)
    try {
      await api.del(`/admin-panel/tracks/${t.id}/`)
      if (editingId === t.id) {
        setShowForm(false)
        resetForm()
      }
      reload()
      reloadStats()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const editTitle = editingId ? data?.results.find((t) => t.id === editingId)?.title ?? '' : ''

  return (
    <AdminSection
      title="Music library"
      description="Upload, tag, and license tracks. Only enabled tracks enter rotation."
      actions={
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={15} /> Upload track
        </button>
      }
    >
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="card flex items-center gap-3 p-4">
            <Disc3 size={18} className="shrink-0 text-accent" />
            <div>
              <p className="text-xl font-semibold tabular-nums">{stats.total_songs.toLocaleString()}</p>
              <p className="text-xs text-muted">Total songs</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <Clock size={18} className="shrink-0 text-accent" />
            <div>
              <p className="text-xl font-semibold tabular-nums">{formatMinutes(stats.total_minutes)}</p>
              <p className="text-xs text-muted">
                {stats.total_minutes.toLocaleString()} min total
              </p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <Disc3 size={18} className="shrink-0 text-muted" />
            <div>
              <p className="text-xl font-semibold tabular-nums">{stats.enabled_songs.toLocaleString()}</p>
              <p className="text-xs text-muted">In rotation</p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input !pl-9"
            placeholder="Search title, artist, album…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            aria-label="Search tracks"
          />
        </div>
        <select
          className="input !w-auto"
          value={enabledFilter}
          onChange={(e) => {
            setEnabledFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by status"
        >
          <option value="">All tracks</option>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </div>

      {formError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>
      )}

      {showForm && (
        <form onSubmit={submit} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <p className="col-span-full text-sm font-medium">
            {editingId ? `Edit track — ${editTitle}` : 'Upload a new track'}
          </p>
          <div>
            <label className="label">Title *</label>
            <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Artist</label>
            <input className="input" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} />
          </div>
          <div>
            <label className="label">Album</label>
            <input className="input" value={form.album} onChange={(e) => setForm({ ...form, album: e.target.value })} />
          </div>
          <div>
            <label className="label">ISRC</label>
            <input className="input" value={form.isrc} onChange={(e) => setForm({ ...form, isrc: e.target.value })} />
          </div>
          <div>
            <label className="label">Label</label>
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div>
            <label className="label">Permitted territories</label>
            <input className="input" placeholder="e.g. US, DE, FR (blank = worldwide)" value={form.permitted_territories} onChange={(e) => setForm({ ...form, permitted_territories: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Licensing notes</label>
            <input className="input" placeholder="e.g. cleared via GEMA until 2027" value={form.licensing_notes} onChange={(e) => setForm({ ...form, licensing_notes: e.target.value })} />
          </div>
          <div>
            <label className="label">Audio file {editingId ? '' : '*'}</label>
            <input
              className="input"
              type="file"
              accept=".mp3,.ogg,.opus,.flac,.m4a,.aac,.wav"
              required={!editingId}
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            <p className="hint">
              {editingId
                ? 'Leave empty to keep the current file. '
                : ''}
              MP3/OGG/Opus/FLAC/M4A/AAC/WAV, max 50&nbsp;MB.
            </p>
          </div>
          <div>
            <label className="label">Artwork {editingId ? '' : '(optional)'}</label>
            <input className="input" type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)} />
            <p className="hint">{editingId ? 'Leave empty to keep the current artwork.' : 'JPG/PNG/WebP, max 5 MB.'}</p>
          </div>
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[rgb(var(--c-accent))]"
              checked={form.explicit}
              onChange={(e) => setForm({ ...form, explicit: e.target.checked })}
            />
            Mark as explicit
          </label>
          <div className="col-span-full flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Upload track'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setShowForm(false)
                resetForm()
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.results.length === 0 && <EmptyState>No tracks found. Upload your first track to build the rotation.</EmptyState>}

      {data && data.results.length > 0 && (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Track</th>
                  <th className="px-4 py-2.5">Length</th>
                  <th className="px-4 py-2.5">Licensing</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.results.map((t) => (
                  <tr key={t.id} className={t.enabled ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-surface-2">
                          {t.artwork_url && <img src={t.artwork_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.title}{t.explicit && <span className="ml-1 text-xs text-muted">(explicit)</span>}</p>
                          <p className="truncate text-xs text-muted">{t.artist}{t.album && ` · ${t.album}`}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {t.duration_seconds ? `${Math.floor(t.duration_seconds / 60)}:${String(t.duration_seconds % 60).padStart(2, '0')}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {t.isrc && <span className="block">ISRC {t.isrc}</span>}
                      {t.label && <span className="block">{t.label}</span>}
                      <span>{t.territories_display}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.enabled ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-muted'}`}>
                        {t.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {t.audio_url && (
                          <audio controls preload="none" src={t.audio_url} className="h-8" aria-label={`Preview ${t.title}`} />
                        )}
                        <button className="btn-ghost h-8 !px-3" onClick={() => openEdit(t)} disabled={busy}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button className="btn-ghost h-8 !px-3" onClick={() => toggle(t)} disabled={busy}>
                          {t.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="btn-ghost h-8 !px-3 text-danger"
                          onClick={() => remove(t)}
                          disabled={busy}
                          aria-label={`Delete ${t.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <span>
                {data.count.toLocaleString()} tracks · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button className="btn-ghost h-8 !px-3" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button className="btn-ghost h-8 !px-3" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AdminSection>
  )
}
