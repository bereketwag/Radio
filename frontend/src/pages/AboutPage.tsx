import { Globe2, Headphones, Radio, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStation } from '../lib/useStation'

export function AboutPage() {
  const station = useStation()

  const values = [
    {
      icon: Radio,
      title: 'One broadcast, one timeline',
      body: 'Every listener hears the same continuous stream. There is no per-user playlist — when you join, you join the song exactly where it is on air.',
    },
    {
      icon: Globe2,
      title: 'Global by default',
      body: 'Broadcast from a single origin to listeners in every timezone, with times shown in UTC and your local clock side by side.',
    },
    {
      icon: Headphones,
      title: 'Curated, not algorithmic',
      body: 'Our rotation is programmed by humans and scheduled by our broadcast engine — deliberate pacing instead of endless shuffle.',
    },
    {
      icon: ShieldCheck,
      title: 'Licensed music',
      body: 'We keep licensing records for every track and respect territorial restrictions, so airtime stays fair for artists and labels.',
    },
  ]

  return (
    <div className="shell py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">About {station?.name ?? 'Aurora Radio'}</h1>
        <div className="mt-4 space-y-4 text-muted">
          <p>
            {station?.name ?? 'Aurora Radio'} is a 24/7 global internet radio station. One live stream,
            continuous music, and a real broadcast timeline — the same song, at the same moment,
            for everyone listening.
          </p>
          <p>
            The station runs on a dedicated broadcast engine (Liquidsoap) feeding an Icecast
            streaming server, completely independent of this website. What you see here — the
            now-playing card, the history, the ad rotations — is read directly from that engine,
            never simulated.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {values.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-5">
              <Icon size={18} className="text-accent" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>

        <div className="card mt-10 p-6">
          <h2 className="text-sm font-semibold">Contact</h2>
          <p className="mt-2 text-sm text-muted">
            General enquiries:{' '}
            {station?.contact_email ? (
              <a className="underline-offset-4 hover:text-ink hover:underline" href={`mailto:${station.contact_email}`}>
                {station.contact_email}
              </a>
            ) : (
              '—'
            )}
          </p>
          {station?.contact_address && <p className="mt-1 text-sm text-muted">{station.contact_address}</p>}
          <p className="mt-3 text-sm text-muted">
            Interested in sponsoring the station?{' '}
            <Link to="/advertise" className="font-medium text-accent underline-offset-4 hover:underline">
              Advertise with us
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
