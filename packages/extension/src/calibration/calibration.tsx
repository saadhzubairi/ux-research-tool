import React from 'react'
import { createRoot } from 'react-dom/client'
import { CalibrationApp } from './CalibrationApp'
import './calibration.css'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<CalibrationApp />)
}
