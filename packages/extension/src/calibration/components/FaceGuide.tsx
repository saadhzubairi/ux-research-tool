import React from 'react'

interface FaceGuideProps {
  faceDetected: boolean
  faceCentered: boolean
  goodLighting: boolean
  appropriateDistance: boolean
}

interface CheckItemProps {
  label: string
  checked: boolean
}

function CheckItem({ label, checked }: CheckItemProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
          checked ? 'bg-green-500' : 'bg-gray-200'
        }`}
      >
        {checked && (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span
        className={`text-sm ${
          checked ? 'text-green-700' : 'text-gray-500'
        }`}
      >
        {label}
      </span>
    </div>
  )
}

export function FaceGuide({
  faceDetected,
  faceCentered,
  goodLighting,
  appropriateDistance,
}: FaceGuideProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        <div
          className={`h-[200px] w-[260px] rounded-[40%] border-4 border-dashed transition-colors ${
            faceDetected && faceCentered
              ? 'border-green-400'
              : 'border-gray-300'
          }`}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-center text-sm text-gray-500">
            Center your face in the frame
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <CheckItem label="Face detected" checked={faceDetected} />
        <CheckItem label="Face centered" checked={faceCentered} />
        <CheckItem label="Good lighting" checked={goodLighting} />
        <CheckItem label="Appropriate distance" checked={appropriateDistance} />
      </div>
    </div>
  )
}
