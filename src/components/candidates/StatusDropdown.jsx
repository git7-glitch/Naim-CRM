import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { CANDIDATE_STAGES, STAGE_COLORS, STAGE_DOTS, normalizeStage } from '../../utils/constants'

// CRM-6: the dropdown offers exactly the canonical stages, so the Candidates
// page, the edit form and the CV Builder can never drift from the DB.
export const CANDIDATE_STATUSES = CANDIDATE_STAGES.map((label) => ({
  label,
  dot: STAGE_DOTS[label],
  badge: STAGE_COLORS[label],
}))

export default function StatusDropdown({ value, onChange, size = 'sm' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const normalized = normalizeStage(value)
  const current = CANDIDATE_STATUSES.find((s) => s.label === normalized) || CANDIDATE_STATUSES[0]
  const pad = size === 'xs' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Stage: ${current.label}. Change stage`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`flex items-center gap-1 rounded-full font-medium transition-colors ${pad} ${current.badge}`}
      >
        {current.label}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Candidate stages"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-44 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl animate-scale-in"
        >
          {CANDIDATE_STATUSES.map((s) => (
            <button
              key={s.label}
              type="button"
              role="option"
              aria-selected={s.label === current.label}
              onClick={(e) => { e.stopPropagation(); onChange(s.label); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-cream-warm transition-colors"
            >
              <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
