import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

function SmileyCloud() {
  return (
    <svg viewBox="0 0 120 80" className="w-28 h-20" fill="none">
      <path
        d="M30 62c-11 0-20-8-20-18s8-17 17-18c3-10 12-17 23-17 10 0 19 6 22 15 2-1 4-1 6-1 12 0 22 9 22 20s-10 19-22 19H30z"
        fill="#fff"
        stroke="#dfe5f9"
        strokeWidth="3"
      />
      <circle cx="52" cy="44" r="3.2" fill="#2e3560" />
      <circle cx="72" cy="44" r="3.2" fill="#2e3560" />
      <path d="M56 53c2.5 2.5 9.5 2.5 12 0" stroke="#2e3560" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="44" cy="51" r="3.5" fill="#f6c4cf" />
      <circle cx="80" cy="51" r="3.5" fill="#f6c4cf" />
    </svg>
  )
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="mb-4 animate-bob">
        {icon ? (
          <div className="w-20 h-20 rounded-full bg-accent-100 flex items-center justify-center text-accent-500">
            {icon}
          </div>
        ) : (
          <SmileyCloud />
        )}
      </div>
      <h3 className="text-lg font-bold text-surface-100 mb-1">{title}</h3>
      <p className="text-sm font-semibold text-surface-400 max-w-sm mb-4">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-primary">
          {action.label}
        </button>
      )}
    </div>
  )
}
