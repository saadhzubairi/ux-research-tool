import SessionList from '../components/sessions/SessionList'

export default function SessionsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Sessions</h1>
          <p className="text-sm text-surface-400 mt-1">
            Browse and analyze eye tracking sessions
          </p>
        </div>
      </div>
      <SessionList />
    </div>
  )
}
