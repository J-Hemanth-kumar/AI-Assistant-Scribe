/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      colors: {
        accent: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f8f9fc',
          100: '#f1f3f9',
          200: '#e8ebf4',
          300: '#d4d9e8',
          400: '#9ba5c0',
          500: '#6b7594',
          600: '#4b5573',
          700: '#333d5c',
          800: '#1e2640',
          900: '#111827',
          950: '#080d1a',
        },
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'slide-in-left': 'slideInLeft 0.25s ease-out',
        'slide-in-right': 'slideInRight 0.25s ease-out',
        'typing': 'typing 1.2s steps(3) infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        typing: {
          '0%':   { content: '.' },
          '33%':  { content: '..' },
          '66%':  { content: '...' },
          '100%': { content: '.' },
        },
      },
      boxShadow: {
        'panel': '0 0 0 1px rgba(99,102,241,0.06), 0 4px 24px rgba(0,0,0,0.06)',
        'bubble': '0 2px 8px rgba(0,0,0,0.06)',
        'input':  '0 0 0 3px rgba(99,102,241,0.12)',
        'modal':  '0 24px 80px rgba(0,0,0,0.18)',
      },
    },
  },
  plugins: [],
}
