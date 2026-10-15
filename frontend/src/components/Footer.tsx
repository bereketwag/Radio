import { Link } from 'react-router-dom'
import { useStation } from '../lib/useStation'

const socialLabels: Record<string, string> = {
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube',
  facebook: 'Facebook',
  tiktok: 'TikTok',
}

export function Footer() {
  const station = useStation()
  const social = station?.social ?? {}

  return (
    <footer className="mt-16 border-t border-line">
      <div className="shell flex flex-col gap-6 py-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <p className="text-sm font-semibold">{station?.name ?? 'Aurora Radio'}</p>
          {station?.tagline && <p className="mt-1 text-sm text-muted">{station.tagline}</p>}
          {station?.contact_email && (
            <a
              className="mt-3 inline-block text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
              href={`mailto:${station.contact_email}`}
            >
              {station.contact_email}
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Station</span>
            <Link to="/advertise" className="text-muted hover:text-ink">Advertise With Us</Link>
            <Link to="/about" className="text-muted hover:text-ink">About</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Legal</span>
            <Link to="/legal/privacy" className="text-muted hover:text-ink">Privacy Policy</Link>
            <Link to="/legal/terms" className="text-muted hover:text-ink">Terms of Service</Link>
            <Link to="/legal/copyright" className="text-muted hover:text-ink">Music & Copyright</Link>
          </div>
          {Object.keys(social).length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Follow</span>
              {Object.entries(social).map(([key, url]) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-ink"
                >
                  {socialLabels[key] ?? key}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shell pb-8">
        <p className="text-xs text-muted">
          © {new Date().getFullYear()} {station?.name ?? 'Aurora Radio'}. All music played on this station is
          licensed for broadcast in accordance with applicable performing-rights agreements.
        </p>
      </div>
    </footer>
  )
}
