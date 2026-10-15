import { ChevronDown, ChevronUp, ListMusic, Plus, Trash2, X } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../lib/api'
import { AdminSection, EmptyState, ErrorState, Spinner, useAdminFetch } from './useAdminApi'

interface Entry {
  id: string
  position: number
  track: { id: string; title: string; artist: string; duration_seconds: number; audio_url: string | null }
}

interface Playlist {
  id: string
  name: string
  description: string
  is_default: boolean
  is_fallback: boolean
  enabled: boolean
  entries: Entry[]
}

interface TrackOption {
  id: string
  title: string
  artist: string
}

export function AdminPlaylists() {
  const { data, error, loading, reload } = useAdminFetch<Playlist[]>('/admin-panel/playlists/')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [trackSearch, setTrackSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_default: false, is_fallback: false })
  const { data: trackResults } = useAdminFetch<{ results: TrackOption[] }>(
    `/admin-panel/tracks/?search=${encodeURIComponent(trackSearch)}`,
    [trackSearch],
  )

  const playlists = data ?? []
  const selected = playlists.find((p) => p.id === selectedId) ?? null

  const move = async (entryId: string, direction: -1 | 1) => {
    if (!selected) return
    const ids = selected.entries.map((e) => e.id)
    const idx = ids.indexOf(entryId)
    const target = idx + direction
    if (idx < 0 || target < 0 || target >= ids.length) return
    ;[ids[idx], ids[target]] = [ids[target], ids[idx]]
    setBusy(true)
    try {
      await api.post(`/admin-panel/playlists/${selected.id}/reorder/`, { order: ids })
      reload()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entryId: string) => {
    if (!selected) return
    setBusy(true)
    try {
      await api.post(`/admin-panel/playlists/${selected.id}/remove_track/`, { entry_id: entryId })
      reload()
    } finally {
      setBusy(false)
    }
  }

  const add = async (trackId: string) => {
    if (!selected) return
    setBusy(true)
    try {
      await api.post(`/admin-panel/playlists/${selected.id}/add_track/`, { track_id: trackId })
      setAddOpen(false)
      setTrackSearch('')
      reload()
    } finally {
      setBusy(false)
    }
  }

  const createPlaylist = async (e: FormEvent) => {
    e.preventDefault()
    if (!createForm.name.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      const created = await api.post<Playlist>('/admin-panel/playlists/', createForm)
      setCreateForm({ name: '', description: '', is_default: false, is_fallback: false })
      setCreateOpen(false)
      setSelectedId(created.id)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create playlist')
    } finally {
      setBusy(false)
    }
  }

  const deletePlaylist = async (p: Playlist) => {
    if (!window.confirm(`Delete “${p.name}”?`)) return
    setBusy(true)
    setActionError(null)
    try {
      await api.del(`/admin-panel/playlists/${p.id}/`)
      if (selectedId === p.id) setSelectedId(null)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (p: Playlist, patch: { is_default?: boolean; is_fallback?: boolean }) => {
    setBusy(true)
    setActionError(null)
    try {
      await api.patch(`/admin-panel/playlists/${p.id}/`, patch)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update playlist')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminSection
      title="Playlists"
      description="The default playlist feeds the broadcast engine. Fallback plays if the main rotation can’t provide a track."
      actions={
        <button className="btn-primary" onClick={() => setCreateOpen((o) => !o)} disabled={busy}>
          <Plus size={15} /> New playlist
        </button>
      }
    >
      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {actionError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {createOpen && (
        <form onSubmit={createPlaylist} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              required
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </div>
          <div className="col-span-full flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createForm.is_default}
                onChange={(e) => setCreateForm({ ...createForm, is_default: e.target.checked })}
              />
              Main rotation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createForm.is_fallback}
                onChange={(e) => setCreateForm({ ...createForm, is_fallback: e.target.checked })}
              />
              Fallback
            </label>
          </div>
          <div className="col-span-full">
            <button className="btn-primary" type="submit" disabled={busy || !createForm.name.trim()}>
              <ListMusic size={15} /> Create playlist
            </button>
          </div>
        </form>
      )}

      {data && playlists.length === 0 && (
        <EmptyState>
          No playlists yet — create the main rotation to start feeding the broadcast engine.
        </EmptyState>
      )}

      {data && playlists.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="space-y-1">
            {playlists.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    selectedId === p.id ? 'bg-surface-2 font-medium' : 'hover:bg-surface-2/60'
                  }`}
                >
                  <span className="block truncate">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {p.entries.length} tracks
                    {p.is_default && ' · default'}
                    {p.is_fallback && ' · fallback'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="card min-w-0 p-5">
            {!selected && <EmptyState>Select a playlist to manage its tracks.</EmptyState>}

            {selected && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{selected.name}</h2>
                    {selected.description && <p className="text-sm text-muted">{selected.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn-ghost"
                      onClick={() => setRole(selected, { is_default: !selected.is_default })}
                      disabled={busy}
                      title="The engine pulls the main rotation from this playlist"
                    >
                      {selected.is_default ? 'Unset default' : 'Make default'}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setRole(selected, { is_fallback: !selected.is_fallback })}
                      disabled={busy}
                      title="Used when the main rotation can’t provide a track"
                    >
                      {selected.is_fallback ? 'Unset fallback' : 'Make fallback'}
                    </button>
                    <button className="btn-ghost" onClick={() => setAddOpen((o) => !o)} disabled={busy}>
                      <Plus size={15} /> Add track
                    </button>
                    <button
                      className="btn-ghost text-danger"
                      onClick={() => deletePlaylist(selected)}
                      disabled={busy}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </div>

                {addOpen && (
                  <div className="mb-4 rounded-xl bg-surface-2 p-4">
                    <input
                      className="input"
                      placeholder="Search the library…"
                      value={trackSearch}
                      onChange={(e) => setTrackSearch(e.target.value)}
                      aria-label="Search tracks to add"
                    />
                    <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                      {(trackResults?.results ?? []).map((t) => (
                        <li key={t.id}>
                          <button
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface"
                            onClick={() => add(t.id)}
                            disabled={busy}
                          >
                            <span className="truncate">{t.title} — {t.artist}</span>
                            <Plus size={14} className="shrink-0 text-accent" />
                          </button>
                        </li>
                      ))}
                      {trackResults && trackResults.results.length === 0 && (
                        <li className="px-3 py-2 text-sm text-muted">No matching tracks.</li>
                      )}
                    </ul>
                  </div>
                )}

                {selected.entries.length === 0 ? (
                  <EmptyState>This playlist is empty — the engine will fall back until tracks are added.</EmptyState>
                ) : (
                  <ol className="divide-y divide-line">
                    {selected.entries.map((e, i) => (
                      <li key={e.id} className="flex items-center gap-3 py-2.5">
                        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.track.title}</p>
                          <p className="truncate text-xs text-muted">{e.track.artist}</p>
                        </div>
                        {e.track.audio_url && (
                          <audio controls preload="none" src={e.track.audio_url} className="h-8 shrink-0" aria-label={`Preview ${e.track.title}`} />
                        )}
                        <div className="flex shrink-0 gap-1">
                          <button className="btn-ghost h-8 w-8 !rounded-full !px-0" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(e.id, -1)}>
                            <ChevronUp size={14} />
                          </button>
                          <button className="btn-ghost h-8 w-8 !rounded-full !px-0" aria-label="Move down" disabled={busy || i === selected.entries.length - 1} onClick={() => move(e.id, 1)}>
                            <ChevronDown size={14} />
                          </button>
                          <button className="btn-ghost h-8 w-8 !rounded-full !px-0 text-danger" aria-label="Remove from playlist" disabled={busy} onClick={() => remove(e.id)}>
                            <X size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  )
}
