type LoadingBrandedTypes = {
  loadProgress: number // Percentage
  label?: string
  hasError?: boolean
}

export default function LoadingBranded({
  loadProgress,
  label,
  hasError = false,
}: LoadingBrandedTypes) {
  return (
    <>
      {/* spur: Grund und Füllung sind derselbe Schriftzug in derselben Box; die Füllung wird von unten freigelegt,
          damit beide Grundlinie, Höhe und linke Kante teilen. */}
      <div className="loading-screen-brand-container">
        <div className="loading-screen-brand" aria-hidden="true">
          <span className="loading-screen-brand-grund">spur</span>
          <span
            className="loading-screen-brand-fuellung"
            style={{ clipPath: `inset(${100 - loadProgress}% 0 0 0)` }}
          >
            spur
          </span>
        </div>
      </div>

      {!hasError && (
        <div className="h3 loading-screen-label" aria-live="polite">
          {label}
          <span className="loading-screen-ellip" aria-hidden="true">
            .
          </span>
          <span className="loading-screen-ellip" aria-hidden="true">
            .
          </span>
          <span className="loading-screen-ellip" aria-hidden="true">
            .
          </span>
        </div>
      )}
    </>
  )
}
