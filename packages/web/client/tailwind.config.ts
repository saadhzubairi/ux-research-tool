import type { Config } from 'tailwindcss'

// ismap sticker theme — light cream surfaces, logo blue + pink accents.
// The surface scale keeps its old semantics (900 = background-most,
// 100 = text-most) so existing `text-surface-*` / `bg-surface-*` usage
// re-lights automatically.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#232949',
          100: '#2e3560',
          200: '#3f477a',
          300: '#5b638f',
          400: '#6a7195',
          500: '#9297b8',
          600: '#c3c7de',
          700: '#dcdff0',
          800: '#f3edde',
          900: '#fffdf8',
          950: '#f9f1df',
        },
        accent: {
          DEFAULT: '#4a63c8',
          50: '#eef1fc',
          100: '#dfe5f9',
          200: '#c3cdf2',
          300: '#9dade8',
          400: '#7288d9',
          500: '#5570cf',
          600: '#4a63c8',
          700: '#3d51a8',
          800: '#334488',
          900: '#2b3a6e',
        },
        pink: {
          DEFAULT: '#e87a90',
          50: '#fdf0f3',
          100: '#fbe1e7',
          200: '#f6c4cf',
          300: '#f2a9b8',
          400: '#ed8ca0',
          500: '#e87a90',
          600: '#d55f78',
          700: '#b44560',
          800: '#8f3850',
          900: '#6f2e41',
        },
        success: '#34b877',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        display: ['"Baloo 2"', 'Nunito', 'sans-serif'],
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        sticker: '0 3px 0 0 rgba(74, 99, 200, 0.18)',
        'sticker-lg': '0 5px 0 0 rgba(74, 99, 200, 0.18)',
        'sticker-pink': '0 3px 0 0 rgba(212, 95, 120, 0.45)',
        'sticker-blue': '0 3px 0 0 rgba(61, 81, 168, 0.55)',
      },
      keyframes: {
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
      },
      animation: {
        bob: 'bob 3s ease-in-out infinite',
        wiggle: 'wiggle 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
}

export default config
