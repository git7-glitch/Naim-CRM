import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Layout from '../components/layout/Layout'
import { SkeletonCards, SkeletonText } from '../components/ui/Skeleton'
import StatusDropdown from '../components/candidates/StatusDropdown'
import {
  Search, Plus, UserPlus, Clock, Calendar, ClipboardEdit, Settings,
  FilePlus, FileUp, ChevronUp, ChevronDown, Users, Briefcase, CheckSquare,
  ArrowRight, Eye, BarChart3, SquareKanban,
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { isSupabaseConfigured } from '../supabase/client'
import { getCandidates, changeCandidateStage } from '../services/candidateService'
import { getJobs, updateJob } from '../services/jobService'
import { getTasks, getTaskCounts, updateTask } from '../services/taskService'
import { demoCandidates, demoTotalCandidates, demoJobs, demoTasks } from '../services/demoData'
import { normalizeStage } from '../utils/constants'
import { transitionError } from '../utils/stageTransitions'

// Recharts is heavy: the live KPI section is its own chunk so the rest of the
// dashboard paints immediately.
const DashboardInsights = lazy(() => import('../components/dashboard/DashboardInsights'))

const JOB_STATUSES = [
  { label: 'Active', dot: 'bg-green-500', badge: 'border-green-200 bg-green-100 text-green-700' },
  { label: 'Closed', dot: 'bg-gray-400', badge: 'border-gray-200 bg-gray-50 text-gray-900' },
  { label: 'Draft', dot: 'bg-yellow-400', badge: 'border-[#fde68a] bg-yellow-100 text-yellow-800' },
]

const TASK_STATUSES = [
  { label: 'Pending', dot: 'bg-yellow-400', badge: 'border-[#fde68a] bg-yellow-100 text-yellow-700' },
  { label: 'In Progress', dot: 'bg-blue-400', badge: 'border-blue-200 bg-blue-100 text-blue-700' },
  { label: 'Completed', dot: 'bg-green-500', badge: 'border-green-200 bg-green-100 text-green-700' },
  { label: 'Overdue', dot: 'bg-red-400', badge: 'border-red-200 bg-red-100 text-red-600' },
]

const QUICK_ACTIONS = [
  { label: 'Search Candidate', icon: Search, to: '/candidates' },
  { label: 'Add Candidate', icon: Plus, to: '/candidates?add=1' },
  { label: 'Pipeline Board', icon: SquareKanban, to: '/pipeline' },
  { label: 'Create CV', icon: UserPlus, to: '/cv-builder' },
  { label: 'View Jobs', icon: Eye, to: '/jobs' },
  { label: 'Jobs Generator', icon: FilePlus, to: '/job-generator' },
  { label: 'Upcoming Tasks', icon: Clock, to: '/tasks' },
  { label: 'View Appointments', icon: Calendar, to: '/appointments' },
  { label: 'Assign Tasks', icon: ClipboardEdit, to: '/tasks?add=1' },
  { label: 'Reports', icon: BarChart3, to: '/reports' },
  { label: 'Uploaded CVs', icon: FileUp, to: '/documents' },
  { label: 'Settings', icon: Settings, to: '/settings' },
]

function StatusMenu({ item, statuses, onChange, fallbackIndex = 0 }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = statuses.find((status) => status.label === item.status) || statuses[fallbackIndex]

  useEffect(() => {
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label={`Status for ${item.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className={`flex min-w-[76px] items-center justify-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${current.badge}`}
      >
        {current.label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" aria-label={`Status options for ${item.title}`} className="absolute right-0 top-full z-30 mt-1 w-[150px] overflow-hidden border border-gray-100 bg-white py-0.5 shadow-[0_8px_18px_rgba(0,0,0,0.10)] animate-scale-in">
          {statuses.map((status) => (
            <button
              key={status.label}
              type="button"
              role="menuitem"
              onClick={() => { onChange(status.label); setOpen(false) }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-gray-900 transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${status.label === current.label ? 'bg-gray-50' : 'bg-white'}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
              {status.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, count, linkLabel, onLink }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
        {title}
        {count && <span className="text-xs font-normal text-gray-400">{count}</span>}
      </h2>
      <button
        type="button"
        onClick={onLink}
        className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-primary shadow-sm transition-colors hover:border-primary hover:bg-cream-warm"
      >
        {linkLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [quickActionsVisible, setQuickActionsVisible] = useState(true)
  const [candidates, setCandidates] = useState([])
  const [totalCandidates, setTotalCandidates] = useState(0)
  const [jobs, setJobs] = useState([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [tasks, setTasks] = useState([])
  const [totalTasks, setTotalTasks] = useState(0)
  const [taskCounts, setTaskCounts] = useState({ Completed: 0, Pending: 0, 'In Progress': 0, Overdue: 0 })
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    if (!isSupabaseConfigured) {
      // Dev demo mode only (CRM-9/10): mirrors the approved template data.
      setCandidates(demoCandidates)
      setTotalCandidates(demoTotalCandidates)
      setJobs(demoJobs)
      setTotalJobs(demoJobs.length)
      setTasks(demoTasks)
      setTotalTasks(demoTasks.length)
      setTaskCounts({ Completed: 1, Pending: 0, 'In Progress': 1, Overdue: 0 })
      setLoading(false)
      return
    }
    try {
      const [candRes, jobRes, taskRes, counts] = await Promise.all([
        getCandidates({ pageSize: 5 }),
        getJobs({ pageSize: 2 }),
        getTasks({ pageSize: 2 }),
        getTaskCounts(),
      ])
      setCandidates(candRes.data || [])
      setTotalCandidates(candRes.count || 0)
      setJobs(jobRes.data || [])
      setTotalJobs(jobRes.count || 0)
      setTasks(taskRes.data || [])
      setTotalTasks(taskRes.count || 0)
      setTaskCounts({
        Completed: counts.Completed || 0,
        Pending: counts.Pending || 0,
        'In Progress': counts['In Progress'] || 0,
        Overdue: counts.Overdue || 0,
      })
      setLoadError(false)
    } catch (err) {
      console.error('Dashboard load error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleStageChange(candidate, next) {
    const from = normalizeStage(candidate.stage) || 'New'
    if (from === next) return
    const problem = transitionError(from, next)
    if (problem) { toast.error(problem); return }
    setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, stage: next } : c)))
    if (!isSupabaseConfigured) return
    try {
      await changeCandidateStage(candidate.id, next, from)
      toast.success(`${candidate.name} moved to ${next}`)
    } catch (err) {
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, stage: candidate.stage } : c)))
      toast.error(err?.message || 'Stage change failed')
    }
  }

  async function handleJobStatusChange(jobId, newStatus) {
    const previousStatus = jobs.find((job) => job.id === jobId)?.status
    if (!previousStatus || previousStatus === newStatus) return
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: newStatus } : job)))
    if (!isSupabaseConfigured) return
    try {
      await updateJob(jobId, { status: newStatus })
    } catch (err) {
      setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: previousStatus } : job)))
      toast.error('Job status update failed')
      console.error('Job status update error:', err)
    }
  }

  async function handleTaskStatusChange(taskId, newStatus) {
    const previousStatus = tasks.find((task) => task.id === taskId)?.status
    if (!previousStatus || previousStatus === newStatus) return
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, status: newStatus } : task)))
    setTaskCounts((c) => ({ ...c, [previousStatus]: Math.max(0, (c[previousStatus] || 0) - 1), [newStatus]: (c[newStatus] || 0) + 1 }))
    if (!isSupabaseConfigured) return
    try {
      await updateTask(taskId, { status: newStatus })
    } catch (err) {
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, status: previousStatus } : task)))
      setTaskCounts((c) => ({ ...c, [newStatus]: Math.max(0, (c[newStatus] || 0) - 1), [previousStatus]: (c[previousStatus] || 0) + 1 }))
      toast.error('Task status update failed')
      console.error('Task status update error:', err)
    }
  }

  const summaryCards = [
    { label: 'Completed', value: taskCounts.Completed, style: 'bg-green-50 border-green-200', text: 'text-green-700' },
    { label: 'Pending', value: taskCounts.Pending, style: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-600' },
    { label: 'In Progress', value: taskCounts['In Progress'], style: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    { label: 'Overdue', value: taskCounts.Overdue, style: 'bg-red-50 border-red-200', text: 'text-red-600' },
  ]

  return (
    <Layout title="Admin Dashboard">
      <div className="space-y-6 animate-fade-in">
        <Suspense fallback={<SkeletonCards />}>
          <DashboardInsights />
        </Suspense>

        {loadError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Some dashboard lists failed to load. <button type="button" onClick={() => { setLoading(true); loadDashboard() }} className="font-medium underline">Retry</button>
          </div>
        )}

        <section id="task-summary" className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-primary">
            <CheckSquare className="h-5 w-5" aria-hidden="true" />
            Task Summary
            <span className="text-xs font-normal text-gray-400">{isSupabaseConfigured ? '(Live Data)' : '(Demo data)'}</span>
          </h2>
          {loading ? <SkeletonCards /> : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className={`rounded-xl border p-4 text-center ${card.style}`}>
                  <p className={`text-2xl font-bold ${card.text}`}>{card.value}</p>
                  <p className={`mt-1 text-sm font-medium ${card.text}`}>{card.label}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="quick-actions" className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-primary">Quick Actions</h2>
              <p className="text-xs text-gray-400">Access key functions instantly</p>
            </div>
            <button
              type="button"
              onClick={() => setQuickActionsVisible(!quickActionsVisible)}
              aria-expanded={quickActionsVisible}
              className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-primary shadow-sm transition-colors hover:bg-cream-warm"
            >
              {quickActionsVisible ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              {quickActionsVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          {quickActionsVisible && (
            <div className="mt-4 flex flex-wrap gap-3">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => navigate(action.to)}
                    className="flex items-center gap-2 rounded-xl border border-cream bg-white px-4 py-2.5 text-[13px] font-medium text-primary shadow-sm transition-colors hover:border-gold-light hover:bg-cream-warm"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {action.label}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section id="recent-candidates" className="rounded-2xl bg-white p-5 shadow-sm">
          <SectionHeader icon={Users} title="Recent Candidates" count={`(1st ${candidates.length} of ${totalCandidates})`} linkLabel="View All Candidates" onLink={() => navigate('/candidates')} />
          {loading ? <SkeletonText lines={5} /> : (
            <div className="space-y-3">
              {candidates.map((c, i) => (
                <article key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm">
                  <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-gold-light/25 text-[13px] font-bold text-primary">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/candidates/${c.id}`} className="block truncate text-sm font-bold text-text-primary hover:text-primary hover:underline">{c.name}</Link>
                    <p className="truncate text-xs text-text-secondary">
                      {c.job_title || c.work_position || c.position || 'N/A'} <span className="mx-1 text-gray-300">•</span> {c.country_applying_to || c.company || 'No destination'}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {c.email} <span className="mx-1 text-gray-300">•</span> {c.phone}
                    </p>
                  </div>
                  <StatusDropdown value={c.stage} onChange={(s) => handleStageChange(c, s)} />
                </article>
              ))}
              {candidates.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No candidates yet</p>}
            </div>
          )}
        </section>

        <section id="recent-jobs" className="rounded-2xl bg-white p-5 shadow-sm">
          <SectionHeader icon={Briefcase} title="Recent Jobs" count={`(${jobs.length} of ${totalJobs})`} linkLabel="View All Jobs" onLink={() => navigate('/jobs')} />
          {loading ? <SkeletonText lines={3} /> : (
            <div className="space-y-3">
              {jobs.map((j, i) => (
                <article key={j.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm">
                  <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-gold-light/25 text-[13px] font-bold text-primary">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-text-primary">{j.title}</p>
                    <p className="truncate text-xs text-text-secondary">
                      {j.company} <span className="mx-1 text-gray-300">•</span> {j.location || j.city || j.country}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {j.salary_min === j.salary_max ? `${j.salary_min ?? ''} ${j.currency || ''}` : `${j.salary_min ?? ''} - ${j.salary_max ?? ''} ${j.currency || ''}`}
                      <span className="mx-1 text-gray-300">•</span>
                      Posted {new Date(j.posted_date || j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <StatusMenu item={j} statuses={JOB_STATUSES} fallbackIndex={1} onChange={(status) => handleJobStatusChange(j.id, status)} />
                </article>
              ))}
              {jobs.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No jobs yet</p>}
            </div>
          )}
        </section>

        <section id="recent-tasks" className="rounded-2xl bg-white p-5 shadow-sm">
          <SectionHeader icon={CheckSquare} title="Recent Tasks" count={`(${tasks.length} of ${totalTasks})`} linkLabel="View All Tasks" onLink={() => navigate('/tasks')} />
          {loading ? <SkeletonText lines={3} /> : (
            <div className="space-y-3">
              {tasks.map((t, i) => (
                <article key={t.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm">
                  <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-gold-light/25 text-[13px] font-bold text-primary">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-text-primary">{t.title}</p>
                    <p className="truncate text-xs text-text-secondary">
                      {t.assignee || 'Unassigned'} <span className="mx-1 text-gray-300">•</span> {(t.priority || '').toUpperCase()} Priority
                    </p>
                    <p className="truncate text-xs text-gray-400">Due: {t.due_date || 'Not set'}</p>
                  </div>
                  <StatusMenu item={t} statuses={TASK_STATUSES} onChange={(status) => handleTaskStatusChange(t.id, status)} />
                </article>
              ))}
              {tasks.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No tasks yet</p>}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
