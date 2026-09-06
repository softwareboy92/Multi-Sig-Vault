/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        panel: 'var(--panel)',
        border: 'var(--border)',
        muted: 'var(--muted)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        'ease-out-motion': 'var(--ease-out)',
        'ease-in-motion': 'var(--ease-in)',
        'ease-spring': 'var(--ease-spring)',
      },
      keyframes: {
        'fade-in':        { from: { opacity: '0' },       to: { opacity: '1' } },
        'fade-out':       { from: { opacity: '1' },       to: { opacity: '0' } },
        'scale-in':       { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'scale-out':      { from: { opacity: '1', transform: 'scale(1)' },    to: { opacity: '0', transform: 'scale(0.95)' } },
        'slide-up':       { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-down':     { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'slide-out-right':{ from: { opacity: '1', transform: 'translateX(0)' },    to: { opacity: '0', transform: 'translateX(16px)' } },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%':      { transform: 'translateX(-4px)' },
          '75%':      { transform: 'translateX(4px)' },
        },

      },
      animation: {
        'fade-in':         'fade-in var(--duration-normal) var(--ease-out)',
        'fade-out':        'fade-out var(--duration-fast) var(--ease-in)',
        'scale-in':        'scale-in var(--duration-normal) var(--ease-out)',
        'scale-out':       'scale-out var(--duration-fast) var(--ease-in)',
        'slide-up':        'slide-up var(--duration-normal) var(--ease-out)',
        'slide-down':      'slide-down var(--duration-normal) var(--ease-out)',
        'slide-in-right':  'slide-in-right var(--duration-slow) var(--ease-out)',
        'slide-out-right': 'slide-out-right var(--duration-fast) var(--ease-in)',
        'shimmer':         'shimmer 1.5s infinite linear',
        'shake':           'shake 0.3s ease-in-out',
      },
    },
  },
  plugins: [],
};
