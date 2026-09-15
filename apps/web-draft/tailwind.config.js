/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nkn: {
          dark: '#080511',
          card: '#120b22',
          purple: '#6d28d9',
          accent: '#8b5cf6',
          blue: '#0284c7',
          red: '#dc2626',
        }
      }
    },
  },
  plugins: [],
}
