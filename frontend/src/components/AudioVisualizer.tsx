import { useEffect, useRef } from 'react'
import { ensureAudioGraph, readSpectrum } from '../lib/audioGraph'
import { usePlayer } from '../lib/usePlayer'

/**
 * Audio visualizer.
 *
 * Two render modes, one shared Web Audio graph (see lib/audioGraph — the
 * <audio> element can only be attached to an analyser once):
 *
 * - "background": fixed full-viewport equalizer rising from the bottom edge,
 *   sitting behind all page content.
 * - "card": drawn inside the player card — a bass-driven glow, a smooth
 *   spectrum wave with gradient fill and faint strings — layered under the
 *   card's backdrop-blur glass.
 *
 * Both breathe at idle so the scene is never dead, and respect
 * prefers-reduced-motion (a single static frame instead of animation).
 *
 * The stream is same-origin (/live/radio), so no CORS tainting.
 */
type Variant = 'background' | 'card'

export function AudioVisualizer({ variant = 'background' }: { variant?: Variant }) {
  const { getAudioElement } = usePlayer()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const isCard = variant === 'card'
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let width = 0
    let height = 0
    let dpr = 1

    // Theme accent, refreshed periodically (cheap style read).
    let accent = '22, 145, 84'
    let accentTicks = 0
    const refreshAccent = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()
      const parts = raw.split(/\s+/).map((n) => Number(n))
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        accent = parts.join(', ')
      }
    }
    refreshAccent()

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (isCard) {
        // Fill the player card; CSS owns the element size (inset-0).
        const rect = canvas.getBoundingClientRect()
        width = Math.max(1, rect.width)
        height = Math.max(1, rect.height)
      } else {
        width = window.innerWidth
        height = window.innerHeight
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Track the element's box (card) or the viewport (background) and redraw.
    const observer = new ResizeObserver(() => {
      resize()
      if (reducedMotion) draw(0)
    })
    observer.observe(canvas)

    const BARS = isCard ? 56 : 48
    // Smoothed heights 0..1 per bar.
    const bars = new Array<number>(BARS).fill(0)

    const sampleTargets = (spec: Uint8Array<ArrayBuffer> | null, t: number): number[] => {
      const targets: number[] = []
      for (let i = 0; i < BARS; i++) {
        if (spec) {
          // Log-ish curve spreads low frequencies across the bars nicely.
          const idx = Math.min(spec.length - 1, Math.floor((i / BARS) ** 1.5 * spec.length))
          targets.push(spec[idx] / 255)
        } else if (isCard) {
          // Idle: two interfering slow waves so the card gently undulates.
          const phase = t / 2400
          targets.push(
            0.10 + 0.05 * Math.sin(phase + i * 0.31) ** 2 + 0.03 * Math.sin(phase * 0.6 - i * 0.11),
          )
        } else {
          // Idle: slow traveling sine so the page still feels alive.
          const phase = t / 1400
          targets.push(0.06 + 0.05 * Math.sin(phase + i * 0.35) ** 2)
        }
      }
      return targets
    }

    /** Shared attack/release smoothing — reads as "music", not noise. */
    const smooth = (targets: number[]) => {
      for (let i = 0; i < BARS; i++) {
        const target = targets[i]
        const current = bars[i]
        bars[i] =
          target > current
            ? current + (target - current) * 0.55
            : current + (target - current) * 0.12
      }
    }

    /** Background: rounded equalizer bars rising from the bottom edge. */
    const drawBackground = () => {
      const gap = 4
      const barW = Math.max(3, (width - gap * (BARS - 1)) / BARS)
      const maxH = height * 0.42
      const gradient = ctx.createLinearGradient(0, height - maxH, 0, height)
      gradient.addColorStop(0, `rgba(${accent}, 0)`)
      gradient.addColorStop(0.55, `rgba(${accent}, 0.18)`)
      gradient.addColorStop(1, `rgba(${accent}, 0.55)`)

      ctx.clearRect(0, 0, width, height)

      // Soft stage-light glow low on the page.
      const glow = ctx.createRadialGradient(
        width * 0.5, height, 0,
        width * 0.5, height, Math.max(width, height) * 0.5,
      )
      glow.addColorStop(0, `rgba(${accent}, 0.10)`)
      glow.addColorStop(1, `rgba(${accent}, 0)`)
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = gradient
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2, bars[i] * maxH)
        const x = i * (barW + gap)
        const y = height - h
        const r = Math.min(barW / 2, 4)
        ctx.beginPath()
        ctx.moveTo(x, height)
        ctx.lineTo(x, y + r)
        ctx.quadraticCurveTo(x, y, x + r, y)
        ctx.lineTo(x + barW - r, y)
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r)
        ctx.lineTo(x + barW, height)
        ctx.closePath()
        ctx.fill()
      }

      // Bright caps for a crisp, premium read.
      ctx.fillStyle = `rgba(${accent}, 0.9)`
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2, bars[i] * maxH)
        const x = i * (barW + gap)
        const y = height - h
        ctx.fillRect(x, y, barW, 2)
      }
    }

    /** Card: bass glow + smooth spectrum wave + faint strings, glass-layered. */
    const drawCard = (t: number) => {
      ctx.clearRect(0, 0, width, height)

      // Bass energy drives a soft radial bloom behind the artwork side.
      let bass = 0
      for (let i = 1; i < 7; i++) bass += bars[i]
      bass = Math.min(1, bass / 6)
      const bloom = ctx.createRadialGradient(
        width * 0.24, height * 0.44, 0,
        width * 0.24, height * 0.44, Math.max(width, height) * 0.6,
      )
      bloom.addColorStop(
        0,
        `rgba(${accent}, ${(0.05 + bass * 0.13 + 0.03 * Math.sin(t / 1800)).toFixed(3)})`,
      )
      bloom.addColorStop(1, `rgba(${accent}, 0)`)
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, width, height)

      // Sample points along the card floor.
      const baseY = height - 8
      const amp = Math.max(24, height * 0.40)
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < BARS; i++) {
        xs.push((i / (BARS - 1)) * width)
        ys.push(baseY - Math.max(2, bars[i] * amp))
      }

      const strokeWave = () => {
        ctx.beginPath()
        ctx.moveTo(xs[0], ys[0])
        for (let i = 1; i < BARS - 1; i++) {
          const mx = (xs[i] + xs[i + 1]) / 2
          const my = (ys[i] + ys[i + 1]) / 2
          ctx.quadraticCurveTo(xs[i], ys[i], mx, my)
        }
        ctx.lineTo(xs[BARS - 1], ys[BARS - 1])
      }

      // Area fill under the wave.
      ctx.beginPath()
      ctx.moveTo(xs[0], ys[0])
      for (let i = 1; i < BARS - 1; i++) {
        const mx = (xs[i] + xs[i + 1]) / 2
        const my = (ys[i] + ys[i + 1]) / 2
        ctx.quadraticCurveTo(xs[i], ys[i], mx, my)
      }
      ctx.lineTo(xs[BARS - 1], ys[BARS - 1])
      ctx.lineTo(width, height)
      ctx.lineTo(0, height)
      ctx.closePath()
      const fill = ctx.createLinearGradient(0, baseY - amp, 0, height)
      fill.addColorStop(0, `rgba(${accent}, 0.03)`)
      fill.addColorStop(1, `rgba(${accent}, 0.30)`)
      ctx.fillStyle = fill
      ctx.fill()

      // Faint strings from the wave down through the glass.
      ctx.strokeStyle = `rgba(${accent}, 0.12)`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < BARS; i += 2) {
        ctx.moveTo(xs[i], ys[i])
        ctx.lineTo(xs[i], height)
      }
      ctx.stroke()

      // The wave line itself.
      strokeWave()
      ctx.strokeStyle = `rgba(${accent}, 0.85)`
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    const draw = (t: number) => {
      const el = getAudioElement()
      const playing = !!el && !el.paused && !el.ended

      if (accentTicks++ % 120 === 0) refreshAccent()

      const spec = playing ? (ensureAudioGraph(el), readSpectrum()) : null
      smooth(sampleTargets(spec, t))

      if (isCard) drawCard(t)
      else drawBackground()

      if (!reducedMotion) raf = requestAnimationFrame(draw)
    }

    if (reducedMotion) draw(0)
    else raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      // The shared audio graph is app-lifetime — never closed here, other
      // visualizer instances (and playback itself) still depend on it.
    }
  }, [getAudioElement, variant])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={
        variant === 'card'
          ? 'pointer-events-none absolute inset-0 z-0 h-full w-full'
          : 'pointer-events-none fixed inset-0 -z-10 h-full w-full'
      }
    />
  )
}
