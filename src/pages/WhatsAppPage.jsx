import { useCallback, useEffect, useMemo, useState } from 'react'
import Layout from '../components/layout/Layout'
import Card, { CardTitle } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useToast } from '../contexts/ToastContext'
import { MessageCircle, Copy, Check, Bot, RefreshCw } from 'lucide-react'
import { fillTemplate, listWhatsAppTemplates, normalizePhone, templateVariables } from '../services/whatsappService'
import { enqueueAutomationJob, isJobOpen, listAutomationJobs } from '../services/automationService'
import { isSupabaseConfigured } from '../supabase/client'

// CRM-12: the CRM never sends WhatsApp itself. "Send via agent" enqueues a
// whatsapp_send job that the Hermes agent processes; this page shows its status.
const JOB_STATUS_UI = {
  pending: { label: 'Waiting for agent', className: 'bg-amber-100 text-amber-700' },
  claimed: { label: 'Agent working', className: 'bg-blue-100 text-blue-700' },
  done: { label: 'Sent by agent', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
}
const POLL_MS = 5000

const nairobiTime = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export default function WhatsAppPage() {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [templatesDemo, setTemplatesDemo] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [recipientPhone, setRecipientPhone] = useState('')
  const [variables, setVariables] = useState({})
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [jobs, setJobs] = useState([])

  useEffect(() => {
    let active = true
    listWhatsAppTemplates()
      .then(({ templates: rows, demo }) => {
        if (!active) return
        setTemplates(rows)
        setTemplatesDemo(demo)
      })
      .catch(() => toast.error('Failed to load message templates'))
      .finally(() => { if (active) setLoadingTemplates(false) })
    return () => { active = false }
  }, [toast])

  const refreshJobs = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      setJobs(await listAutomationJobs({ jobType: 'whatsapp_send', limit: 10 }))
    } catch {
      // keep the last known list; the next poll retries
    }
  }, [])

  useEffect(() => { refreshJobs() }, [refreshJobs])

  const hasOpenJobs = jobs.some(isJobOpen)
  useEffect(() => {
    if (!hasOpenJobs) return undefined
    const timer = setInterval(refreshJobs, POLL_MS)
    return () => clearInterval(timer)
  }, [hasOpenJobs, refreshJobs])

  const variableNames = useMemo(
    () => (selectedTemplate ? templateVariables(selectedTemplate.message) : []),
    [selectedTemplate]
  )
  const message = selectedTemplate ? fillTemplate(selectedTemplate.message, variables) : ''
  const phoneDigits = normalizePhone(recipientPhone)
  const missingVariables = variableNames.filter((name) => !String(variables[name] || '').trim())

  function selectTemplate(template) {
    setSelectedTemplate(template)
    setVariables({})
  }

  function copyMessage() {
    navigator.clipboard.writeText(message)
    setCopied(true)
    toast.success('Message copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  async function sendViaAgent() {
    if (!phoneDigits) return toast.error('Enter a valid recipient phone number')
    if (missingVariables.length) return toast.error(`Fill in: ${missingVariables.join(', ')}`)
    setSending(true)
    try {
      const job = await enqueueAutomationJob('whatsapp_send', {
        to: phoneDigits,
        message,
        template_key: selectedTemplate.key,
        variables,
        candidate_id: null,
      })
      setJobs((current) => [job, ...current].slice(0, 10))
      toast.success('Queued for the Hermes agent')
    } catch (error) {
      toast.error(error.message || 'Failed to queue message')
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title="WhatsApp Integration">
      <div className="space-y-6 animate-fade-in">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Message Templates</CardTitle>
            {templatesDemo && (
              <span className="rounded-full border border-red-300 bg-red-50 px-3 py-0.5 text-xs font-bold uppercase text-red-700">Demo data</span>
            )}
          </div>
          {loadingTemplates ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-cream" />)}
            </div>
          ) : templates.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No active templates. An admin can add them in the whatsapp_templates table.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selectedTemplate?.id === t.id}
                  onClick={() => selectTemplate(t)}
                  className={`rounded-lg border p-3 text-left transition-colors ${selectedTemplate?.id === t.id ? 'border-primary bg-primary/5' : 'border-cream hover:bg-cream'}`}
                >
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{t.message.substring(0, 80)}...</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        {selectedTemplate && (
          <>
            <Card>
              <CardTitle>Fill in Variables</CardTitle>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Recipient Phone" type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="+254700000000" />
                {variableNames.map((v) => (
                  <Input key={v} label={v.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())} value={variables[v] || ''} onChange={(e) => setVariables({ ...variables, [v]: e.target.value })} />
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Preview Message</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={copyMessage}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy
                  </Button>
                  {phoneDigits && (
                    <Button variant="outline" size="sm" onClick={() => window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`, '_blank', 'noopener')}>
                      <MessageCircle className="h-4 w-4" /> Open in WhatsApp
                    </Button>
                  )}
                  <Button size="sm" onClick={sendViaAgent} loading={sending} disabled={!isSupabaseConfigured}>
                    <Bot className="h-4 w-4" /> Send via agent
                  </Button>
                </div>
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-lg border border-cream bg-cream-light p-4 text-sm text-text-primary">
                {message || 'Select a template and fill in the variables above.'}
              </div>
              {!isSupabaseConfigured && (
                <p className="mt-2 text-xs text-red-600">Demo mode: sending via agent needs a live Supabase connection.</p>
              )}
            </Card>
          </>
        )}

        {isSupabaseConfigured && (
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Agent Queue</CardTitle>
              <Button variant="ghost" size="sm" onClick={refreshJobs} aria-label="Refresh agent queue">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {jobs.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">No messages sent via the agent yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-cream">
                {jobs.map((job) => {
                  const ui = JOB_STATUS_UI[job.status] || JOB_STATUS_UI.pending
                  return (
                    <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-text-primary">+{job.payload?.to} · {job.payload?.template_key || 'custom'}</p>
                        <p className="text-xs text-text-muted">
                          {job.created_at ? nairobiTime.format(new Date(job.created_at)) : ''}
                          {job.status === 'failed' && job.result?.error ? ` · ${job.result.error}` : ''}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ui.className}`}>{ui.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )}
      </div>
    </Layout>
  )
}
