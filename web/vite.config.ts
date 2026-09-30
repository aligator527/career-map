/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same build works on GitHub Pages (/career-map/) and Vercel (/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // e2e/ holds Playwright tests (npm run test:e2e)
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
