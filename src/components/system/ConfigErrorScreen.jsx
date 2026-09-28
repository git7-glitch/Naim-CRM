// CRM-10: a production build that cannot reach Supabase shows this and
// nothing else — no demo data, no silent admin session.
export default function ConfigErrorScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream-light p-6">
      <div role="alert" className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-red-600">Configuration error</p>
        <h1 className="mt-2 text-xl font-bold text-text-primary">Naim CRM is not connected to its database</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          This production build was deployed without its Supabase settings, so it is refusing to run.
          No data is shown and nobody is signed in.
        </p>
        <div className="mt-5 rounded-lg bg-cream-light p-4 text-sm text-text-primary">
          <p className="font-semibold">Administrator fix</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Netlify → Site configuration → Environment variables</li>
            <li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (anon key only)</li>
            <li>Deploys → Trigger deploy → Clear cache and deploy site</li>
          </ol>
        </div>
      </div>
    </main>
  )
}
