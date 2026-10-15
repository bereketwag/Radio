/**
 * Shared Web Audio analysis graph for the visualizers.
 *
 * createMediaElementSource() may only ever be called once per media element
 * (a second call throws), so the background and the player-card visualizers
 * must share one graph: the first caller builds it, everyone else reads the
 * same AnalyserNode. The graph is app-lifetime — components never close it.
 */

interface Graph {
  ctx: AudioContext
  analyser: AnalyserNode
  freq: Uint8Array<ArrayBuffer>
}

let graph: Graph | null = null
let failed = false

/** Lazily attaches the shared <audio> element to an analyser. */
export function ensureAudioGraph(el: HTMLAudioElement | null): Graph | null {
  if (graph) return graph
  if (failed || !el) return null
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      failed = true
      return null
    }
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(el)
    const analyser = ctx.createAnalyser()
    // 64 bins: plenty for a smooth curve, cheap to read every frame.
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.85
    // Route through the analyser back to the speakers — without this the page
    // would go silent once the element is attached to the graph.
    source.connect(analyser)
    analyser.connect(ctx.destination)
    graph = { ctx, analyser, freq: new Uint8Array(analyser.frequencyBinCount) }
    return graph
  } catch {
    // Web Audio unavailable or the element is already connected elsewhere —
    // never break playback over a visualization, and never retry in a loop.
    failed = true
    return null
  }
}

/** Reads the current spectrum (0..255 per bin); null until the graph exists. */
export function readSpectrum(): Uint8Array<ArrayBuffer> | null {
  if (!graph) return null
  const { ctx, analyser, freq } = graph
  if (ctx.state === 'suspended') void ctx.resume()
  analyser.getByteFrequencyData(freq)
  return freq
}
