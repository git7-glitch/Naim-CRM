// Phase 2 activity log UI: who changed what, and when, for one candidate.
import { useCallback, useEffect, useState } from 'react'
import { History, ArrowRightLeft, FileText, ClipboardList, CalendarClock, UserPlus, Trash2, RotateCcw, Bot, Pencil } from 'lucide-react'
import { SkeletonText } from '../ui/Skeleton'
import { isSupabaseConfigured } from '../../supabase/client'
import { getCandidateActivity } from '../../services/activityService'

const ICONS = {
  created: UserPlus,
  updated: Pencil,
  stage_change: ArrowRightLeft,
  deleted: Trash2,
  restored: RotateCcw,
  document_uploaded: FileText,
  document_updated: FileText,
  document_deleted: Trash2,
  document_restored: RotateCcw,
  task_created: ClipboardList,
  task_updated: ClipboardList,
  appointment_booked: CalendarClock,
  appointment_updated: CalendarClock,
  automation_job_enqueued: Bot,
}

const when = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export default function ActivityTimeline({ candidateId, refreshKey = 0 }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    try {
      setRows(await getCandidateActivity(candidateId))
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => { load() }, [load, refreshKey])

  if (!isSupabaseConfigured) {
    return <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Demo mode: history is recorded once the CRM is connected to Supabase.</p>
  }
  if (loading) return <SkeletonText lines={6} />
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Couldn't load history. <button type="button" onClick={load} className="font-medium underline">Retry</button>
      </div>
    )
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center py-10 text-center text-sm text-gray-500">
        <History className="mb-2 h-8 w-8 text-gray-300" aria-hidden="true" />
        No recorded activity yet. Changes from now on appear here.
      </div>
    )
  }

  return (
    <ol className="relative space-y-4 border-l border-gray-200 pl-6" aria-label="Candidate history">
      {rows.map((r) => {
        const Icon = ICONS[r.action] || History
        return (
          <li key={r.id} className="relative">
            <span className="absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-primary">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className="text-sm text-text-primary">{r.summary || r.action.replaceAll('_', ' ')}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              <span className="font-medium text-gray-500">{r.actor_name || 'Someone'}</span>
              {' · '}
              <time dateTime={r.created_at} title={when.format(new Date(r.created_at))}>{ago(r.created_at)}</time>
            </p>
          </li>
        )
      })}
    </ol>
  )
}
