import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/jayma/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.2:3002'
const bundle = JSON.parse(readFileSync(new URL('../lib/api/core-snapshot.json', import.meta.url)))
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  let healthy = false, ready = false, healthCalls = 0, standingsCalls = 0
  const current = structuredClone(bundle.entries['/api/standings/?year=2026'].data)
  current.drivers[0].name = 'RECOVERED API DRIVER'
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url()), key = u.pathname + u.search
    if (u.pathname === '/api/health') {
      healthCalls++
      return healthy ? route.fulfill({ json: { status: 'ok' } }) : route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Render waking</html>' })
    }
    if (u.pathname.startsWith('/api/standings')) standingsCalls++
    if (ready && bundle.entries[key]) return route.fulfill({ json: key.includes('standings') ? current : bundle.entries[key].data })
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service waking' })
  })
  await page.goto(`${base}/standings`)
  const notice = page.getByRole('status').filter({ hasText: 'Saved snapshot' })
  await notice.waitFor()
  assert.match(await notice.innerText(), /2026 standings.*recorded.*UTC/)
  await page.getByText(bundle.entries['/api/standings/?year=2026'].data.drivers[0].name, { exact: true }).first().waitFor()
  await page.waitForTimeout(800)
  healthy = true
  await page.waitForFunction(() => !document.querySelector('[aria-label="Data connection"]'), { timeout: 20000 })
  assert.ok(await notice.isVisible(), 'health alone must not remove snapshot provenance')
  assert.ok(healthCalls >= 2)
  ready = true
  await page.getByText('RECOVERED API DRIVER', { exact: true }).first().waitFor({ timeout: 25000 })
  await notice.waitFor({ state: 'detached', timeout: 25000 })
  assert.ok(standingsCalls >= 2, 'live data retried automatically without reload')
  // Losing the API after success must retain the real response, not regress to static data.
  ready = false; healthy = false
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(1000)
  assert.equal(await notice.count(), 0)
  await page.getByText('RECOVERED API DRIVER', { exact: true }).first().waitFor()
  await page.goto(`${base}/dashboard`)
  await notice.waitFor()
  await page.getByText(bundle.entries['/api/standings/?year=2026'].data.drivers[0].name, { exact: true }).first().waitFor()
  await page.goto(`${base}/calendar`)
  await notice.waitFor()
  await page.getByText('Australian Grand Prix', { exact: false }).first().waitFor()
  await page.goto(`${base}/circuits/monza`)
  await notice.waitFor()
  assert.match(await notice.innerText(), /Circuit reference.*recorded.*UTC/)
  await page.setViewportSize({ width: 375, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'snapshot notice fits mobile')
  assert.deepEqual(errors, [])
  console.log('PASS browser: real snapshot render, HTML wake response, 503, partial recovery, automatic live replacement, retained live response, calendar/circuit fallback, mobile width')
} finally { await browser.close() }
