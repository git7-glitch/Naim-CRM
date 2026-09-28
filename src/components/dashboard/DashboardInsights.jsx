// Phase 2 Dashboard 2.0: live KPI cards + charts from Supabase.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Users, Trophy, CalendarCheck, RefreshCw, AlertTriangle } from 'lucide-react'
import { SkeletonCards } from '../ui/Skeleton'
import Skeleton from '../ui/Skeleton'
import { getDashboardKPIs } from '../../services/kpiService'

const GOLD = '#d7a42a'
const PIE_COLORS = ['#8b6914', '#d7a42a', '#e9c46a', '#2a9d8f', '#264653', '#e76f51', '#94a3b8']

function KpiCard({ icon: Icon, label, value, sub, tone = 'gold', to }) {
  const tones = {
    gold: 'bg-[#d7a42a]/10 text-[#8b6914]',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
  }
  const body = (
    <div className="h-full rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <span className={`rounded-lg p-1.5 ${tones[tone]}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      </div>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  )
  return to ? <Link to={to} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40">{body}</Link> : body
}

function ChartCard({ title, children, empty }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-primary">{title}</h3>
      {empty ? <p className="flex h-56 items-center justify-center text-sm text-gray-400">No data yet</p> : <div className="h-56">{children}</div>}
    </div>
  )
}

export default function DashboardInsights() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getDashboardKPIs())
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <section aria-busy="true" className="space-y-4">
        <SkeletonCards />
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      </section>
    )
  }

  if (error && !data) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /> Couldn't load live KPIs.
        <button type="button" onClick={load} className="ml-auto font-medium underline">Retry</button>
      </div>
    )
  }

  const { totals, funnel, byCountry, intake, placementsThisMonth, expiring, tasks } = data
  const urgentDocs = expiring.expired + expiring.critical
  const countries = byCountry.length > 6
    ? [...byCountry.slice(0, 6), { name: 'Other', value: byCountry.slice(6).reduce((s, c) => s + c.value, 0) }]
    : byCountry

  return (
    <section id="dashboard-insights" className="space-y-4" aria-label="Live KPIs">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-primary">
          Live overview
          {data.demo
            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Demo data</span>
            : <span className="text-xs font-normal text-gray-400">(Live Data)</span>}
        </h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-primary" aria-label="Refresh KPIs">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Users} label="Active candidates" value={totals.active} sub={`${totals.candidates} total on file`} to="/pipeline" />
        <KpiCard icon={Trophy} label="Placements" value={placementsThisMonth.count} sub={placementsThisMonth.month} tone="green" to="/reports" />
        <KpiCard icon={AlertTriangle} label="Expiring documents" value={urgentDocs} sub={`${expiring.expired} expired · ${expiring.critical} ≤30d · ${expiring.warning} ≤90d`} tone={urgentDocs ? 'red' : 'gold'} />
        <KpiCard icon={CalendarCheck} label="Tasks due today" value={tasks.dueToday.length} sub={tasks.overdue.length ? `${tasks.overdue.length} overdue` : 'Nothing overdue'} tone={tasks.overdue.length ? 'red' : 'blue'} to="/tasks" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Pipeline funnel" empty={!funnel.some((s) => s.count)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 10 }} interval={0} />
              <Tooltip />
              <Bar dataKey="count" name="Candidates" fill={GOLD} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="New candidates (6 months)" empty={!intake.some((m) => m.count)}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={intake} margin={{ left: -16, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="count" name="New candidates" stroke="#8b6914" fill={GOLD} fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Candidates by destination" empty={!countries.length}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={countries} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" paddingAngle={2}>
                {countries.map((c, i) => <Cell key={c.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-primary">Expiring documents (good conduct, medical, visa, passport)</h3>
          {expiring.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Nothing expires in the next 90 days.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {expiring.items.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link to={d.candidate_id ? `/candidates/${d.candidate_id}?tab=documents` : '/documents'} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{d.candidate_name || 'Candidate'}</span>
                      <span className="text-gray-500"> · {d.document_type}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${d.status === 'expired' ? 'bg-red-100 text-red-700' : d.status === 'critical' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-800'}`}>
                      {d.status === 'expired' ? `expired ${Math.abs(d.daysLeft)}d ago` : `${d.daysLeft}d left`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-primary">Tasks due today & overdue</h3>
          {tasks.dueToday.length + tasks.overdue.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No tasks due. Nice.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...tasks.overdue, ...tasks.dueToday].slice(0, 8).map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks?q=${encodeURIComponent(t.title || '')}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary">
                    <span className="min-w-0 truncate font-medium">{t.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${String(t.due_date).slice(0, 10) < data.today ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {String(t.due_date).slice(0, 10) < data.today ? `overdue · ${String(t.due_date).slice(0, 10)}` : 'today'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
