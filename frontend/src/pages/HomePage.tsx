import { NowPlayingSection } from '../components/NowPlayingSection'
import { RadioPlayer } from '../components/RadioPlayer'
import { SponsorPanel } from '../components/SponsorPanel'

export function HomePage() {
  return (
    <div className="shell py-6 sm:py-10">
      {/* Player and sponsor share the row equally on desktop — the ad gets
          half the screen so poster creatives stay large and readable. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <RadioPlayer />
        </div>
        <div className="min-w-0 lg:pt-1">
          <SponsorPanel placement="sidebar" />
        </div>
      </div>

      <div className="mt-10">
        <NowPlayingSection />
      </div>
    </div>
  )
}
