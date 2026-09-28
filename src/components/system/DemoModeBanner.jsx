// CRM-10: permanent, unmissable marker for dev demo mode. Rendered on every
// route whenever isDemoMode is true; there is no dismiss button on purpose.
export default function DemoModeBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] bg-red-600 px-4 py-1.5 text-center text-xs font-bold uppercase tracking-widest text-white shadow-[0_-2px_8px_rgba(0,0,0,0.25)]"
    >
      DEMO MODE — NOT PRODUCTION · sample data only, nothing is saved
    </div>
  )
}
