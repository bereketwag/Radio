import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Radio player state machine.
 *
 * One <audio> element owns the live stream. Every listener attaches to the
 * same continuous Icecast mount, so joining mid-song means hearing the song
 * at its current broadcast position — never from the beginning.
 *
 * Resilience:
 * - exponential backoff reconnection on stream errors (1s → 32s cap)
 * - honest status: never reports "playing" unless the element actually is
 * - autoplay-block detection with a clear user-facing message
 * - unsupported-format detection from MediaError codes
 */
export type PlaybackState =
  | 'idle' // never started
  | 'connecting' // request in flight / waiting for data
  | 'playing' // audio is audibly flowing
  | 'paused' // user paused
  | 'reconnecting' // dropped; retrying with backoff
  | 'error' // gave up or fatal error

export interface PlayerContextValue {
  state: PlaybackState
  errorMessage: string | null
  volume: number
  muted: boolean
  /** true once the browser blocked an autoplay attempt */
  needsUserGesture: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  setVolume: (v: number) => void
  setMuted: (m: boolean) => void
  /** The shared <audio> element — for the background audio visualizer. */
  getAudioElement: () => HTMLAudioElement | null
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const VOLUME_KEY = 'aurora.volume'
const MAX_BACKOFF_MS = 32000

/** Cache-buster so reconnects never reuse a dead connection. */
function streamUrlWithBuster(base: string): string {
  return base + (base.includes('?') ? '&' : '?') + 't=' + Date.now()
}

export function PlayerProvider({
  children,
  streamUrl,
}: {
  children: React.ReactNode
  streamUrl: string | null
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const userWantedRef = useRef(false)

  const [state, setState] = useState<PlaybackState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [needsUserGesture, setNeedsUserGesture] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [volume, setVolumeState] = useState(() => {
    try {
      const v = localStorage.getItem(VOLUME_KEY)
      return v !== null ? Number(v) : 0.85
    } catch {
      return 0.85
    }
  })

  // Create the audio element once. preload=none: we never download audio the
  // visitor did not ask for.
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'none'
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [])

  const clearRetry = useCallback(() => {
    if (retryRef.current) {
      clearTimeout(retryRef.current)
      retryRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !streamUrl) return
    clearRetry()
    setState('connecting')
    setErrorMessage(null)
    // Busting the URL forces a fresh ICY connection instead of a half-dead one.
    audio.src = streamUrlWithBuster(streamUrl)
    audio.load()
    const attempt = audio.play()
    if (attempt) {
      attempt
        .then(() => {
          attemptsRef.current = 0
        })
        .catch((err: DOMException) => {
          if (err.name === 'NotAllowedError') {
            // Autoplay policy blocked us; wait for the user's gesture.
            userWantedRef.current = false
            setState('idle')
            setNeedsUserGesture(true)
            setErrorMessage('Your browser blocked playback. Tap play to start listening.')
          } else if (err.name !== 'AbortError') {
            setState('error')
            setErrorMessage('Could not start the stream. It may be offline — retrying shortly.')
            scheduleRetry()
          }
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, clearRetry])

  const scheduleRetry = useCallback(() => {
    clearRetry()
    const attempt = attemptsRef.current
    const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)
    attemptsRef.current = attempt + 1
    setState('reconnecting')
    retryRef.current = setTimeout(() => {
      if (userWantedRef.current) connect()
    }, delay)
  }, [clearRetry, connect])

  // Wire media events once the element exists.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlaying = () => {
      attemptsRef.current = 0
      setNeedsUserGesture(false)
      setState('playing')
      setErrorMessage(null)
    }
    const onWaiting = () => {
      // Buffering on a live stream means we're effectively reconnecting.
      setState((s) => (s === 'playing' ? 'connecting' : s))
    }
    const onPause = () => {
      setState((s) => (s === 'paused' ? 'paused' : s))
    }
    const onError = () => {
      const code = audio.error?.code
      if (!userWantedRef.current) return
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setState('error')
        setErrorMessage(
          'This browser cannot play the station’s audio format. Try a recent version of Chrome, Firefox, Safari, or Edge.',
        )
        return
      }
      if (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code == null) {
        setErrorMessage('Stream interrupted — reconnecting…')
        scheduleRetry()
        return
      }
      if (code === MediaError.MEDIA_ERR_DECODE) {
        setErrorMessage('Audio decode error — reconnecting…')
        scheduleRetry()
      }
    }
    const onStalled = () => {
      if (userWantedRef.current && audio.paused) scheduleRetry()
    }

    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)
    audio.addEventListener('stalled', onStalled)
    return () => {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('stalled', onStalled)
    }
  }, [scheduleRetry])

  // Volume + mute sync.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = muted ? 0 : volume
    audio.muted = muted
  }, [volume, muted])

  // Pause reconnection work when the tab is hidden to save battery/data;
  // resume when visible again if the user wanted playback.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && userWantedRef.current && audioRef.current?.paused) {
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [connect])

  // Reconnect when the (possibly new) stream URL changes while we're already
  // mid-listen. Guarded by URL identity: reacting to every `state` change
  // here used to re-run connect() during 'connecting', aborting the in-flight
  // load with a fresh cache-buster and defeating the retry backoff.
  const lastUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!streamUrl || streamUrl === lastUrlRef.current) return
    lastUrlRef.current = streamUrl
    if (userWantedRef.current && audioRef.current?.paused && state !== 'idle') {
      connect()
    }
  }, [streamUrl, connect, state])

  useEffect(() => () => clearRetry(), [clearRetry])

  const play = useCallback(() => {
    userWantedRef.current = true
    setNeedsUserGesture(false)
    attemptsRef.current = 0
    connect()
  }, [connect])

  const pause = useCallback(() => {
    userWantedRef.current = false
    clearRetry()
    audioRef.current?.pause()
    setState('paused')
  }, [clearRetry])

  const toggle = useCallback(() => {
    if (state === 'playing' || state === 'connecting' || state === 'reconnecting') pause()
    else play()
  }, [state, play, pause])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    setVolumeState(clamped)
    setMutedState(false)
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  const setMuted = useCallback((m: boolean) => setMutedState(m), [])

  const getAudioElement = useCallback(() => audioRef.current, [])

  const value = useMemo(
    () => ({
      state,
      errorMessage,
      volume,
      muted,
      needsUserGesture,
      play,
      pause,
      toggle,
      setVolume,
      setMuted,
      getAudioElement,
    }),
    [state, errorMessage, volume, muted, needsUserGesture, play, pause, toggle, setVolume, setMuted, getAudioElement],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
