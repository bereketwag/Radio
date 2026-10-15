import { Link, useParams } from 'react-router-dom'

const docs: Record<string, { title: string; updated: string; sections: { heading: string; body: string }[] }> = {
  privacy: {
    title: 'Privacy Policy',
    updated: 'October 2026',
    sections: [
      {
        heading: 'What we collect',
        body:
          'Account details if you register (email, optional display name, organization, phone). Advertising request form submissions.          Anonymous impression and click counts for advertising campaigns — stored as a salted hash, never raw IP addresses. Standard server logs.',
      },
      {
        heading: 'Listening is anonymous',
        body:
          'You do not need an account to listen. We do not build listening profiles or sell listener data. The listener count shown on the site is an aggregate measured by our streaming server.',
      },
      {
        heading: 'Cookies',
        body:
          'We use a session cookie for authenticated accounts and a theme preference stored in your browser’s local storage. No third-party advertising or tracking cookies are set.',
      },
      {
        heading: 'Your rights',
        body:
          'You can request access to, correction of, or deletion of your account data at any time by emailing the station contact address. Advertising request data is retained for up to 24 months for business records.',
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    updated: 'October 2026',
    sections: [
      {
        heading: 'Using the site',
        body:
          'The station is provided free of charge for personal listening. Do not attempt to disrupt the stream, scrape content at scale, or misuse the advertising request forms.',
      },
      {
        heading: 'Accounts',
        body:
          'You are responsible for keeping your credentials secure. We may suspend accounts that abuse the service or violate these terms.',
      },
      {
        heading: 'Advertising',
        body:
          'Submitting an advertising request does not create a booking. Campaigns become binding only after written confirmation, creative approval, and payment. Campaign start/end dates, placements, and priorities are as confirmed in writing.',
      },
      {
        heading: 'Availability',
        body:
          'We run the stream with automatic recovery and monitoring, but internet radio can be interrupted by network or infrastructure faults. We do not guarantee uninterrupted availability.',
      },
    ],
  },
  copyright: {
    title: 'Music & Copyright',
    updated: 'October 2026',
    sections: [
      {
        heading: 'Licensed broadcast',
        body:
          'All music played on the station is intended to be licensed for internet broadcast through the applicable performing-rights and mechanical licensing organizations in the territories where the station is distributed.',
      },
      {
        heading: 'Territorial restrictions',
        body:
          'The station records permitted territories per track. Where a track is restricted, it is excluded from rotation for listeners in those territories via playlist configuration.',
      },
      {
        heading: 'Takedown requests',
        body:
          'Rights holders who believe a work has been played without authorization can contact the station with proof of ownership; we will investigate and remove the work from rotation while we review.',
      },
      {
        heading: 'Advertiser content',
        body:
          'Advertisers warrant that they hold the rights to all creative material they supply. Advertisers are responsible for claims made in their advertisements.',
      },
    ],
  },
}

export function LegalPage() {
  const { doc } = useParams<{ doc: string }>()
  const entry = docs[doc ?? '']

  if (!entry) {
    return (
      <div className="shell py-24 text-center">
        <h1 className="text-2xl font-semibold">Document not found</h1>
        <Link to="/" className="btn-primary mt-6">Back home</Link>
      </div>
    )
  }

  return (
    <div className="shell py-10">
      <article className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">{entry.title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {entry.updated}</p>
        <div className="mt-8 space-y-8">
          {entry.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-base font-semibold">{s.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </section>
          ))}
        </div>
      </article>
    </div>
  )
}
