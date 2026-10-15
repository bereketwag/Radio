import { useEffect, useState } from 'react'
import { api, HistoryItem } from '../lib/api'
import { useNowPlaying } from '../lib/useNowPlaying'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff) || diff < 0) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

/** Now playing + recently aired, straight from the engine's broadcast log. */
export function NowPlayingSection() {
  const { data } = useNowPlaying()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get<{ results: HistoryItem[] }>('/broadcast/history/?limit=12')
      .then((res) => alive && setItems(res.results))
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [data?.started_at]) // refetch when the current track changes

  return (
    <section aria-label="Recently played">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Recently played</h2>
        <span className="text-xs text-muted">From the live broadcast log</span>
      </div>

      {!loaded && (
        <div className="space-y-2" aria-hidden>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      )}

      {loaded && items.length === 0 && (
        <div className="card p-6 text-sm text-muted">
          Nothing has aired yet. Once the broadcast engine connects, every played
          track will appear here automatically.
        </div>
      )}

      {loaded && items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-center gap-4 px-4 py-3 ${item.is_current ? 'bg-accent/[0.06]' : ''}`}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {item.artwork_url && (
                  <img src={item.artwork_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.title}
                  {item.artist && <span className="text-muted"> — {item.artist}</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {new Date(item.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  {timeAgo(item.started_at) && ` · ${timeAgo(item.started_at)}`}
                </p>
              </div>
              {item.is_current &&
                (item.kind === 'advert' ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger animate-live-pulse" aria-hidden />
                    ADVERT
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-live-pulse" aria-hidden />
                    LIVE
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
