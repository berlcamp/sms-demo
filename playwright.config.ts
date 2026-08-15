import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the examinations scanning workspace.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PROJECT POINTS AT THE PRODUCTION DATABASE (see CLAUDE.md, Rule 0).
 * No test here may read or write a real learner record, and the design does not
 * rely on remembering to mock every call. There are two independent barriers:
 *
 *   1. The dev server under test is started with NEXT_PUBLIC_SUPABASE_URL
 *      pointing at a host that does not exist. Production credentials in
 *      .env.local are overridden — Next.js gives an already-set environment
 *      variable precedence over a .env file — so the app under test has no way
 *      to address the real project even if a route escaped interception.
 *   2. Every test installs a request interceptor that fulfils calls to that
 *      fake host from fixtures and aborts anything else.
 *
 * Barrier 1 is what makes the suite safe; barrier 2 is what makes it useful.
 * The port is deliberately not 3000, so a running dev server on the real
 * credentials is never reused as the server under test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PORT = 3123;

export const E2E_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://e2etest.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key-not-a-real-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key-not-a-real-key",
  STUDENT_PORTAL_JWT_SECRET: "e2e-jwt-secret-not-a-real-secret",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    // Never adopt an already-running server: it would be the one on the real
    // credentials, which is the single thing this config exists to prevent.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: E2E_ENV,
  },
});
