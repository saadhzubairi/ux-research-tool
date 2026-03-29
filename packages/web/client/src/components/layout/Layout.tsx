import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useAppStore } from '../../store/appStore'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { sidebarOpen } = useAppStore()

  return (
    <div className="min-h-screen bg-surface-950">
      <Sidebar />
      <div
        className={`transition-all duration-200 ${
          sidebarOpen ? 'ml-56' : 'ml-16'
        }`}
      >
        <TopBar />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
