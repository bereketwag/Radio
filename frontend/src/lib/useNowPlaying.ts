import { useCallback, useEffect, useRef, useState } from 'react'
import { api, NowPlaying } from './api'

export type StreamStatus = 'connecting' | 'live' | 'offline' | 'error'

interface NowPlayingState {
  data: NowPlaying | null
  status: StreamStatus
  /** server_time minus client time, ms — used to compute live position honestly */
  clockOffsetMs: number
  refresh: () => void
}

/**
 * Subscribes to broadcast metadata.
 *
 * Primary: SSE (`/api/broadcast/now-playing/stream/`). Fallback: polling every
 * 15s when SSE fails or is unavailable. The server clock offset is captured so
 * track progress is derived from server timestamps, never from page-load time.
 */
export function useNowPlaying(): NowPlayingState {
  const [data, setData] = useState<NowPlaying | null>(null)
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [nonce, setNonce] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const applyPayload = useCallback((payload: NowPlaying) => {
    const offset = new Date(payload.server_time).getTime() - Date.now()
    setClockOffsetMs(offset)
    setData(payload)
    setStatus(payload.live ? 'live' : 'offline')
  }, [])

  const pollOnce = useCallback(async () => {
    try {
      applyPayload(await api.get<NowPlaying>('/broadcast/now-playing/'))
    } catch {
      setStatus('error')
    }
  }, [applyPayload])

  useEffect(() => {
    let cancelled = false

    const startPolling = () => {
      if (pollRef.current) return
      pollOnce()
      pollRef.current = setInterval(pollOnce, 15000)
    }
    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    if (typeof EventSource === 'undefined') {
      startPolling()
    } else {
      const es = new EventSource('/api/broadcast/now-playing/stream/')
      esRef.current = es
      es.addEventListener('now-playing', (ev) => {
        if (cancelled) return
        try {
          applyPayload(JSON.parse((ev as MessageEvent).data))
        } catch {
          /* malformed frame — keep last known state */
        }
      })
      es.onopen = () => {
        if (!cancelled) {
          setStatus('live')
          stopPolling()
        }
      }
      es.onerror = () => {
        if (cancelled) return
        // EventSource retries automatically, but if the endpoint is down for
        // good we fall back to polling so metadata still updates.
        setStatus((s) => (s === 'live' ? 'connecting' : s))
        startPolling()
      }
    }

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
      stopPolling()
    }
  }, [nonce, applyPayload, pollOnce])

  const refresh = useCallback(() => {
    setNonce((n) => n + 1)
    void pollOnce()
  }, [pollOnce])

  return { data, status, clockOffsetMs, refresh }
}
