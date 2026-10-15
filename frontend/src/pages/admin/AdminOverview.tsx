import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { AdminSection, ErrorState, Spinner, StatusBadge, useAdminFetch } from './useAdminApi'

interface Overview {
  broadcast: {
    live: boolean
    title: string | null
    artist: string | null
    kind: string
    listeners: number | null
    listeners_measured: boolean
    started_at: string | null
  }
  active_visual_campaigns: number
  active_audio_campaigns: number
  pending_ad_requests: number
  total_impressions: number
  total_clicks: number
  upcoming_breaks: {
    id: string
    campaign_name: string
    scheduled_for: string
    result: string
  }[]
  recent_errors: { code: string; message: string; severity: string; created_at: string }[]
  scheduled_vs_played: {
    window_days: number
    scheduled: number
    played: number
    missed: number
    seconds_played: number
  }
  music: {
    total_songs: number
    enabled_songs: number
    total_seconds: number
    total_minutes: number
  }
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function AdminOverview() {
  const { data, error, loading, reload } = useAdminFetch<Overview>('/admin-panel/overview/')

  if (loading) return <Spinner />
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />

  const ctr =
    data.total_impressions > 0
      ? `${((data.total_clicks / data.total_impressions) * 100).toFixed(2)}%`
      : '—'

  return (
    <AdminSection
      title="Dashboard"
      description="All figures come from the database and measured events — no estimates."
      actions={
        <button className="btn-ghost" onClick={reload}>
          Refresh
        </button>
      }
    >
      {/* Broadcast status */}
      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Broadcast</p>
            <div className="mt-1 flex items-center gap-2">
              {data.broadcast.live ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
                  <CheckCircle2 size={15} /> Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning">
                  <AlertTriangle size={15} /> Engine offline
                </span>
              )}
            </div>
            <p className="mt-1 text-sm">
              {data.broadcast.title
                ? `${data.broadcast.title}${data.broadcast.artist ? ` — ${data.broadcast.artist}` : ''}`
                : 'Nothing reported yet'}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted">Listeners</p>
            <p className="text-lg font-semibold tabular-nums">
              {data.broadcast.listeners_measured && data.broadcast.listeners !== null
                ? data.broadcast.listeners
                : '—'}
            </p>
            {data.broadcast.started_at && (
              <p className="text-xs text-muted">
                started {new Date(data.broadcast.started_at).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Songs in library" value={data.music.total_songs.toLocaleString()} hint={`${data.music.enabled_songs} in rotation`} />
        <Stat
          label="Total runtime"
          value={`${Math.floor(data.music.total_minutes / 60)}h ${Math.round(data.music.total_minutes % 60)}m`}
          hint={`${data.music.total_minutes.toLocaleString()} minutes (from audio files)`}
        />
        <Stat label="Active banner campaigns" value={data.active_visual_campaigns} />
        <Stat label="Active audio campaigns" value={data.active_audio_campaigns} />
        <Stat
          label="Pending ad requests"
          value={data.pending_ad_requests}
          hint={data.pending_ad_requests > 0 ? 'Needs review' : undefined}
        />
        <Stat
          label="Impressions / clicks"
          value={`${data.total_impressions.toLocaleString()} / ${data.total_clicks.toLocaleString()}`}
          hint={`CTR ${ctr} (measured)`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Scheduled vs played */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Ad breaks — last {data.scheduled_vs_played.window_days} days</h2>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2 text-muted">Scheduled</td>
                <td className="py-2 text-right tabular-nums">{data.scheduled_vs_played.scheduled}</td>
              </tr>
              <tr>
                <td className="py-2 text-muted">Confirmed played</td>
                <td className="py-2 text-right tabular-nums text-accent">{data.scheduled_vs_played.played}</td>
              </tr>
              <tr>
                <td className="py-2 text-muted">Missed</td>
                <td className="py-2 text-right tabular-nums text-danger">{data.scheduled_vs_played.missed}</td>
              </tr>
              <tr>
                <td className="py-2 text-muted">Seconds aired</td>
                <td className="py-2 text-right tabular-nums">{data.scheduled_vs_played.seconds_played}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Upcoming + errors */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Upcoming breaks</h2>
          {data.upcoming_breaks.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No breaks currently scheduled.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {data.upcoming_breaks.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate">
                    <Clock size={13} className="shrink-0 text-muted" />
                    {b.campaign_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-muted">
                      {new Date(b.scheduled_for).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <StatusBadge status={b.result} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-5 text-sm font-semibold">Recent errors</h2>
          {data.recent_errors.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No errors recorded. </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {data.recent_errors.map((e, i) => (
                <li key={i} className="text-danger">
                  <span className="font-medium">{e.code}</span>
                  <span className="block text-xs text-muted">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h2 className="text-sm font-semibold">Notes on measurement</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Listener counts are read from Icecast’s live stats — shown as “—” when the server can’t be reached.</li>
          <li>Impressions are deduplicated per session in a 5-minute window; clicks are recorded at click time.</li>
          <li>“Confirmed played” rows are written only when the broadcast engine reports an ad actually aired.</li>
        </ul>
      </div>
    </AdminSection>
  )
}
