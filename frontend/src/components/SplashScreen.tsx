/**
 * First-paint splash: covers the app until station branding and the auth
 * session have resolved (with a safety timeout so a failed fetch can never
 * trap the user behind the overlay). Fades out via the `fading` prop.
 */
export function SplashScreen({ name, fading }: { name?: string; fading: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-page transition-opacity duration-500 ${
        fading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${name ?? 'Aurora Radio'}`}
    >
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-accent/50 animate-ping" aria-hidden />
        <span className="absolute inset-3 rounded-full bg-accent/10" aria-hidden />
        <span className="relative h-4 w-4 rounded-full bg-accent animate-live-pulse" aria-hidden />
      </div>
      <p className="mt-7 text-xl font-semibold tracking-tight">{name ?? 'Aurora Radio'}</p>
      <p className="mt-1 text-sm text-muted">Tuning in…</p>
    </div>
  )
}
