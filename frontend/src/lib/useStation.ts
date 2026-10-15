import { useEffect, useState } from 'react'
import { api, StationConfig } from './api'

let cached: StationConfig | null = null
const listeners = new Set<(c: StationConfig | null) => void>()

/** #rrggbb → "r g b" (the shape the CSS custom properties use). */
function hexToRgbTriplet(hex: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`
}

/** Mix a colour toward white so it stays legible on dark surfaces. */
function lighten(triplet: string, amount: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return triplet
    .split(' ')
    .map((c) => String(mix(Number(c))))
    .join(' ')
}

/** Ink (text) colour that reads on top of the accent. */
function inkFor(triplet: string): string {
  const [r, g, b] = triplet.split(' ').map(Number)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '18 20 18' : '255 255 255'
}

let accentStyle: HTMLStyleElement | null = null

/** Apply the station theme colour (set in /admin/settings) to the document. */
function applyAccent(hex: string | undefined) {
  const light = hex ? hexToRgbTriplet(hex) : null
  if (!light || typeof document === 'undefined') return
  if (!accentStyle) {
    accentStyle = document.createElement('style')
    accentStyle.setAttribute('data-station-accent', '')
    document.head.appendChild(accentStyle)
  }
  const dark = lighten(light, 0.28)
  accentStyle.textContent = [
    `:root{--c-accent:${light};--c-accent-ink:${inkFor(light)};}`,
    `.dark{--c-accent:${dark};--c-accent-ink:${inkFor(dark)};}`,
  ].join('')
}

/** Re-fetch station branding (called after the admin saves settings). */
export function refreshStation(): Promise<StationConfig | null> {
  return api
    .get<StationConfig>('/station/')
    .then((config) => {
      cached = config
      applyAccent(config.accent_color)
      listeners.forEach((fn) => fn(config))
      return config
    })
    .catch(() => null)
}

/** Loads station branding/config once and keeps it in sync across the app. */
export function useStation(): StationConfig | null {
  const [config, setConfig] = useState<StationConfig | null>(cached)

  useEffect(() => {
    let alive = true
    const onChange = (next: StationConfig | null) => {
      if (alive) setConfig(next)
    }
    listeners.add(onChange)
    if (cached) applyAccent(cached.accent_color)
    else refreshStation().then(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  return config
}
