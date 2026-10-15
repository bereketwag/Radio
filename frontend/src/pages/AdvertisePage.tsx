import { CalendarDays, CheckCircle2, Megaphone, Radio, Send } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api, ApiError } from '../lib/api'

interface FormState {
  business_name: string
  contact_name: string
  email: string
  phone: string
  website: string
  ad_format: 'banner' | 'audio' | 'modal' | 'both'
  start_date: string
  end_date: string
  target_audience: string
  estimated_budget: string
  message: string
}

const empty: FormState = {
  business_name: '',
  contact_name: '',
  email: '',
  phone: '',
  website: '',
  ad_format: 'banner',
  start_date: '',
  end_date: '',
  target_audience: '',
  estimated_budget: '',
  message: '',
}

const formats = [
  { value: 'banner', label: 'Side label banner', icon: Megaphone, desc: 'Large rotating poster beside the player — half the screen on desktop.' },
  { value: 'audio', label: 'Mid-break voice ad', icon: Radio, desc: '30–60s voice spot inserted into the live stream at scheduled times.' },
  { value: 'modal', label: 'Modal takeover', icon: CalendarDays, desc: 'Full-screen poster shown once per visit — high impact, time-limited.' },
  { value: 'both', label: 'Multiple formats', icon: CalendarDays, desc: 'Combine any of the above for full coverage.' },
] as const

export function AdvertisePage() {
  const [form, setForm] = useState<FormState>(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState<{ id: string } | null>(null)

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const validateClient = (): boolean => {
    const errs: Record<string, string> = {}
    if (!form.business_name.trim()) errs.business_name = 'Business name is required.'
    if (!form.contact_name.trim()) errs.contact_name = 'Contact name is required.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'A valid email is required.'
    if (form.website && !/^https?:\/\/.+\..+/.test(form.website)) errs.website = 'Include the full URL, e.g. https://example.com'
    if (form.start_date && form.end_date && form.end_date < form.start_date)
      errs.end_date = 'End date must be on or after the start date.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validateClient()) return
    setSubmitting(true)
    setErrors({})
    try {
      // Drop blank optional fields — an empty string is not a valid date for
      // the API, and "" for text optionals is just noise.
      const payload: Record<string, string> = {}
      for (const [k, v] of Object.entries(form)) {
        const trimmed = typeof v === 'string' ? v.trim() : v
        if (trimmed !== '') payload[k] = trimmed
      }
      const res = await api.post<{ id: string }>('/ads/requests/', payload)
      setConfirmation({ id: res.id })
      setForm(empty)
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === 'object') {
        const fieldErrors: Record<string, string> = {}
        for (const [k, v] of Object.entries(err.details as Record<string, unknown>)) {
          fieldErrors[k] = Array.isArray(v) ? v.join(' ') : String(v)
        }
        // Map server-level keys onto a visible banner so nothing fails silently.
        const banner = [fieldErrors.detail, fieldErrors.non_field, fieldErrors.non_field_errors]
          .filter(Boolean)
          .join(' ')
        if (banner) fieldErrors.non_field = banner
        setErrors(fieldErrors)
      } else {
        setErrors({ non_field: err instanceof Error ? err.message : 'Submission failed. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="shell py-10">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Advertise on Aurora Radio</h1>
        <p className="mt-3 text-muted">
          Put your brand in front of a worldwide audience listening 24/7. We offer
          rotating banner placements and scheduled audio spots woven naturally
          into the broadcast.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {formats.map(({ value, label, icon: Icon, desc }) => (
          <button
            key={value}
            type="button"
            onClick={() => setForm((f) => ({ ...f, ad_format: value }))}
            className={`card p-4 text-left transition-colors ${
              form.ad_format === value ? 'border-accent ring-1 ring-accent' : 'hover:border-muted/40'
            }`}
            aria-pressed={form.ad_format === value}
          >
            <Icon size={18} className="text-accent" />
            <p className="mt-2 text-sm font-medium">{label}</p>
            <p className="mt-1 text-xs text-muted">{desc}</p>
          </button>
        ))}
      </div>

      <div className="mx-auto mt-6 max-w-2xl">
        <div className="card grid gap-4 p-5 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium">Campaign durations</p>
            <p className="mt-1 text-muted">1, 2, 4, or 8-week flights. Longer commitments receive priority rotation.</p>
          </div>
          <div>
            <p className="font-medium">How it works</p>
            <p className="mt-1 text-muted">
              Submit the form → our team reviews it → we confirm scope, pricing, and
              dates by email. Nothing airs until both sides approve.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-2xl">
        {confirmation ? (
          <div className="card flex items-start gap-3 border-accent/40 p-6" role="status">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <p className="font-medium">Request received — thank you!</p>
              <p className="mt-1 text-sm text-muted">
                Your request (ref <span className="font-mono text-xs">{confirmation.id.slice(0, 8)}</span>) is pending
                review. Our advertising team will email you to confirm details. Nothing is
                booked or approved until you hear from us.
              </p>
              <button className="btn-ghost mt-4" onClick={() => setConfirmation(null)}>
                Submit another request
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card grid gap-4 p-6 sm:grid-cols-2" noValidate>
            <h2 className="col-span-full text-lg font-semibold">Request an advertisement</h2>

            {errors.non_field && (
              <p className="col-span-full rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {errors.non_field}
              </p>
            )}

            <Field label="Business name" error={errors.business_name} required>
              <input className="input" value={form.business_name} onChange={set('business_name')} autoComplete="organization" />
            </Field>
            <Field label="Contact person" error={errors.contact_name} required>
              <input className="input" value={form.contact_name} onChange={set('contact_name')} autoComplete="name" />
            </Field>
            <Field label="Email" error={errors.email} required>
              <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
            </Field>
            <Field label="Phone (optional)" error={errors.phone}>
              <input className="input" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
            </Field>
            <Field label="Website or social URL (optional)" error={errors.website} className="sm:col-span-2">
              <input className="input" type="url" placeholder="https://" value={form.website} onChange={set('website')} />
            </Field>
            <Field label="Campaign start (optional)" error={errors.start_date}>
              <input className="input" type="date" value={form.start_date} onChange={set('start_date')} />
            </Field>
            <Field label="Campaign end (optional)" error={errors.end_date}>
              <input className="input" type="date" value={form.end_date} onChange={set('end_date')} />
            </Field>
            <Field label="Target audience or geography (optional)" error={errors.target_audience}>
              <input className="input" placeholder="e.g. urban professionals, DACH region" value={form.target_audience} onChange={set('target_audience')} />
            </Field>
            <Field label="Estimated budget (optional)" error={errors.estimated_budget}>
              <input className="input" placeholder="e.g. €2,000 / month" value={form.estimated_budget} onChange={set('estimated_budget')} />
            </Field>
            <Field label="Anything else (optional)" error={errors.message} className="sm:col-span-2">
              <textarea className="input min-h-[96px]" value={form.message} onChange={set('message')} />
            </Field>

            <div className="col-span-full">
              <button type="submit" className="btn-primary w-full sm:w-auto" disabled={submitting}>
                {submitting ? 'Sending…' : (
                  <>
                    <Send size={15} />
                    Request an Advertisement
                  </>
                )}
              </button>
              <p className="hint mt-3">
                Submitting creates a <strong>request</strong>, not a booking. We’ll confirm
                availability, pricing, and approval by email.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  required,
  className = '',
  children,
}: {
  label: string
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="text-accent"> *</span>}
      </label>
      {children}
      {error && <p className="hint text-danger">{error}</p>}
    </div>
  )
}
