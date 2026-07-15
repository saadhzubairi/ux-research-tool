import { NavLink } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'

const navItems = [
  {
    to: '/sessions',
    label: 'Sessions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
      </svg>
    ),
  },
  {
    to: '/heatmaps',
    label: 'Heatmaps',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

function GooglyEyes({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const eye = size === 'md' ? 'w-5 h-5' : 'w-4 h-4'
  const pupil = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2'
  return (
    <div className="flex -space-x-0.5">
      <span className={`${eye} rounded-full bg-white flex items-end justify-end pr-0.5 pb-0.5 border border-surface-100/20`}>
        <span className={`${pupil} rounded-full bg-surface-50`} />
      </span>
      <span className={`${eye} rounded-full bg-white flex items-end justify-start pl-0.5 pb-0.5 border border-surface-100/20`}>
        <span className={`${pupil} rounded-full bg-surface-50`} />
      </span>
    </div>
  )
}

export default function Sidebar() {
  const { sidebarOpen } = useAppStore()

  return (
    <aside
      className={`fixed left-3 top-3 bottom-3 bg-accent-600 rounded-3xl shadow-sticker-blue z-30 transition-all duration-200 flex flex-col overflow-hidden ${
        sidebarOpen ? 'w-52' : 'w-16'
      }`}
    >
      <div className={`flex flex-col gap-0.5 pt-5 pb-4 ${sidebarOpen ? 'px-5' : 'items-center px-2'}`}>
        <GooglyEyes size={sidebarOpen ? 'md' : 'sm'} />
        {sidebarOpen && (
          <>
            <span className="font-display text-3xl font-extrabold text-pink-400 leading-none -mt-0.5 tracking-tight">
              ismap.
            </span>
            <span className="text-[9px] font-extrabold tracking-[0.25em] text-pink-300/90 uppercase">
              Eye Tracking
            </span>
          </>
        )}
      </div>

      <nav className={`flex-1 py-2 space-y-1.5 ${sidebarOpen ? 'px-3' : 'px-2'}`}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full text-sm font-bold transition-all ${
                sidebarOpen ? 'px-4 py-2.5' : 'justify-center p-2.5'
              } ${
                isActive
                  ? 'bg-surface-900 text-accent-700 shadow-sticker'
                  : 'text-accent-100 hover:bg-white/15 hover:text-white'
              }`
            }
            title={item.label}
          >
            {item.icon}
            {sidebarOpen && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-4">
        {sidebarOpen && (
          <p className="text-[10px] font-bold text-accent-200/80 tracking-wider">
            ismap v0.1.0 ☁️
          </p>
        )}
      </div>
    </aside>
  )
}
