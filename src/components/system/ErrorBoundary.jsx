import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Phase 2 polish: one crashing page must never blank the whole CRM. The
// boundary resets itself when `resetKey` changes (the route path).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // A new deploy invalidates old lazy chunks; a reload fetches the new ones.
    const isChunkError = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(String(error?.message))

    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-cream-light p-6">
        <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-primary">
            {isChunkError ? 'A new version of the CRM is available' : 'This page hit a problem'}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {isChunkError
              ? 'Reload to get the latest version. Nothing you saved was lost.'
              : 'Your data is safe. Try again, or go back to the dashboard.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => (isChunkError ? window.location.reload() : this.setState({ error: null }))}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {isChunkError ? 'Reload' : 'Try again'}
            </button>
            <a href="/dashboard" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text-primary hover:bg-cream-warm">
              Dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
}
