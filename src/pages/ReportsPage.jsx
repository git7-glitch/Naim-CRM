import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Printer, Search, RefreshCw, TriangleAlert, BarChart3 } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Button from '../components/ui/Button'
import CandidatesByStageCard from '../components/reports/CandidatesByStageCard'
import LivePerformanceDashboard from '../components/reports/LivePerformanceDashboard'
import PlacementHistoryTable from '../components/reports/PlacementHistoryTable'
import RecentSuccessfulPlacements from '../components/reports/RecentSuccessfulPlacements'
import ReportMetricCard from '../components/reports/ReportMetricCard'
import {
  filterReportRows,
  getDemoReportsSummary,
  sortReportRows,
  toExportRows,
} from '../components/reports/reportsData'
import { getReportsSummary } from '../services/reportsService'
import { isSupabaseConfigured } from '../supabase/client'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { useToast } from '../contexts/ToastContext'

const exportOptions = [
  { value: 'csv', label: 'CSV Format' },
  { value: 'xlsx', label: 'Excel Format' },
  { value: 'pdf', label: 'PDF Format' },
]

function ReportsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading reports" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-cream" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-cream" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl bg-cream" />
        <div className="h-64 animate-pulse rounded-xl bg-cream" />
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('csv')
  const [sort, setSort] = useState({ key: null, direction: null })
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    // Demo data only exists in dev builds without Supabase (CRM-9/10);
    // production without Supabase never reaches this page.
    if (!isSupabaseConfigured) {
      setState({ status: 'ready', data: getDemoReportsSummary(), error: null })
      return
    }
    try {
      setState({ status: 'ready', data: await getReportsSummary(), error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error?.message || 'Failed to load reports' })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const data = state.data

  const filteredPlacements = useMemo(
    () => filterReportRows(data?.recentPlacements || [], search),
    [data, search]
  )

  const visibleHistory = useMemo(
    () => sortReportRows(filterReportRows(data?.placements || [], search), sort),
    [data, search, sort]
  )

  function handleSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function handleExport() {
    const rows = toExportRows(visibleHistory)
    if (!rows.length) {
      toast.error('No report data to export')
      return
    }

    try {
      if (format === 'csv') exportToCSV(rows, 'placement-history-report.csv')
      else if (format === 'xlsx') exportToExcel(rows, 'placement-history-report.xlsx')
      else exportToPDF(rows, 'Placement History Report', 'placement-history-report.pdf')
      toast.success('Report exported!')
    } catch {
      toast.error('Failed to export report')
    }
  }

  return (
    <Layout title="Admin Dashboard">
      <section id="reports-print-area" className="min-w-0 space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-text-primary sm:text-3xl">
              Reports & Analytics
              {data?.demo && (
                <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
                  Demo data
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {data?.demo
                ? 'Sample figures for development. Connect Supabase to see live data.'
                : 'Live recruitment metrics from the CRM database'}
            </p>
          </div>
          {!data?.demo && (
            <Button type="button" variant="outline" onClick={load} disabled={state.status === 'loading'} className="reports-no-print min-h-10 bg-white">
              <RefreshCw className={`h-4 w-4 ${state.status === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          )}
        </div>

        <div className="reports-no-print flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative block w-full xl:max-w-md">
            <span className="sr-only">Search reports data</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search reports data"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reports..."
              className="w-full rounded-lg border border-cream bg-white py-2.5 pl-10 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <label className="block min-w-40">
              <span className="sr-only">Report export format</span>
              <select
                aria-label="Report export format"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
                className="w-full rounded-lg border border-cream bg-white px-3 py-2.5 text-sm text-text-primary transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {exportOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <Button type="button" onClick={handleExport} className="min-h-10" disabled={state.status !== 'ready'}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Export Report
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()} className="min-h-10 bg-white" disabled={state.status !== 'ready'}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Report
            </Button>
          </div>
        </div>

        {state.status === 'loading' && <ReportsSkeleton />}

        {state.status === 'error' && (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-700">
            <TriangleAlert className="h-8 w-8" aria-hidden="true" />
            <p className="font-semibold">Couldn't load live reports</p>
            <p className="text-sm">{state.error}</p>
            <Button type="button" onClick={load}>Try again</Button>
          </div>
        )}

        {state.status === 'ready' && data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {data.metrics.map((metric) => <ReportMetricCard key={metric.label} metric={metric} />)}
            </div>

            {data.isEmpty ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-cream bg-white p-10 text-center">
                <BarChart3 className="h-10 w-10 text-text-muted" aria-hidden="true" />
                <p className="font-semibold text-text-primary">No candidates yet</p>
                <p className="max-w-md text-sm text-text-secondary">
                  Stage breakdowns, country splits and placement history appear here as soon as candidates are added.
                </p>
              </div>
            ) : (
              <>
                <CandidatesByStageCard stages={data.stages} />

                <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
                  <RecentSuccessfulPlacements placements={filteredPlacements} />
                  <LivePerformanceDashboard
                    stages={data.stages}
                    countries={data.countries}
                    tasks={data.taskPerformance}
                  />
                </div>

                <PlacementHistoryTable rows={visibleHistory} sort={sort} onSort={handleSort} />
              </>
            )}
          </>
        )}
      </section>
    </Layout>
  )
}
