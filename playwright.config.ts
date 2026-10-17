import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // Tests run against the production build, with OpenRouter mocked in e2e/fixtures.ts
  // and Supabase faked in e2e/supabase.ts.
  webServer: {
    command: 'npm run build && npm run preview',
    env: { VITE_SUPABASE_URL: 'https://e2e.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e' },
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
