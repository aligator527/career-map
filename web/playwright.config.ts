import { defineConfig, devices } from '@playwright/test'

// End-to-end checks of the built site (npm run build first). CI runs them before every deploy.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4180/', locale: 'ja-JP' },
  webServer: { command: 'npx vite preview --port 4180 --strictPort', port: 4180, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
