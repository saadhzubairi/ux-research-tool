import React from 'react'

interface ConfidenceMeterProps {
  confidence: number
}

function getConfidenceColor(confidence: number): {
  bar: string
  text: string
  label: string
} {
  if (confidence > 0.7) return { bar: 'bg-green-500', text: 'text-green-700', label: 'High' }
  if (confidence > 0.4) return { bar: 'bg-yellow-500', text: 'text-yellow-700', label: 'Medium' }
  return { bar: 'bg-red-500', text: 'text-red-700', label: 'Low' }
}

export function ConfidenceMeter({ confidence }: ConfidenceMeterProps) {
  const { bar, text, label } = getConfidenceColor(confidence)
  const percent = Math.round(confidence * 100)

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-500">Confidence</span>
        <span className={`text-xs font-medium ${text}`}>
          {label} ({percent}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-300 ${bar}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
