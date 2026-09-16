import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/jayma/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const start = Date.parse('2024-03-02T15:00:00Z'), end = start + 7200000
const session = { session_key: 9472, meeting_key: 1, year: 2024, session_name: 'Race', country_name: 'Bahrain', location: 'Sakhir', date_start: new Date(start).toISOString(), date_end: new Date(end).toISOString() }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  let fail = false; const windows = []
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.route('https://api.openf1.org/v1/**', async route => {
    const u = new URL(route.request().url()), endpoint = u.pathname.split('/').at(-1)
    if (endpoint === 'sessions') return route.fulfill({ json: [{ ...session, year: Number(u.searchParams.get('year')) }] })
    if (endpoint === 'drivers') return route.fulfill({ json: [{ driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER' }] })
    const from = Date.parse(u.searchParams.get('date>')) + 1
    if (endpoint === 'location') {
      windows.push(from)
      if (fail) return route.fulfill({ status: 500, body: 'Upstream failure' })
    }
    const rows = []
    if (from !== start + 1800000) for (let ms = 0; ms < 120000; ms += 1000) {
      const common = { driver_number: 1, session_key: 9472, date: new Date(from + ms).toISOString() }
      rows.push(endpoint === 'location' ? { ...common, x: 100 + ms / 1000, y: 100 } : endpoint === 'car_data' ? { ...common, speed: 250, throttle: 99, brake: 0 } : { ...common, interval: 1.2 })
    }
    return route.fulfill({ json: rows })
  })
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.2:3002'}/tactical`)
  await page.getByRole('combobox', { name: 'Race / session' }).locator('option[value="9472"]').waitFor({ state: 'attached' })
  await page.getByRole('spinbutton', { name: 'Replay starting minute' }).fill('5')
  await page.getByRole('button', { name: 'Load race', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Replay timeline' })
  await page.getByText('Sakhir · Race · 2024-03-02', { exact: true }).waitFor({ timeout: 25000 })
  assert.equal(Number(await slider.getAttribute('max')) - Number(await slider.getAttribute('min')), 7200000)
  assert.equal(Number(await slider.inputValue()), start + 300000, 'requested minute survives chunk alignment')
  const seek = async ms => slider.fill(String(start + ms))
  await page.getByRole('button', { name: /Max Verstappen/ }).click()
  await page.getByRole('button', { name: 'Chase', exact: true }).click()
  await seek(119800)
  await page.getByRole('button', { name: 'Play replay' }).click()
  await page.waitForFunction(s => Number(document.querySelector('[aria-label="Replay timeline"]').value) > s + 120100, start, { timeout: 25000 })
  await page.getByRole('button', { name: 'Pause replay' }).click()
  assert.ok(windows.includes(start + 120000), 'play crosses two-minute boundary')
  assert.equal(await page.getByRole('button', { name: 'Chase', exact: true }).getAttribute('aria-pressed'), 'true')
  fail = true; await seek(3600000)
  await page.getByRole('button', { name: 'Retry replay chunk' }).waitFor({ timeout: 25000 })
  fail = false; await page.getByRole('button', { name: 'Retry replay chunk' }).click()
  await page.getByRole('button', { name: /Max Verstappen/ }).waitFor({ timeout: 25000 })
  assert.ok(windows.includes(start + 3600000), 'seek to minute 60')
  await seek(1800000)
  await page.getByText('No recorded positions in this part of the session.', { exact: false }).waitFor({ timeout: 25000 })
  await seek(0)
  await page.getByRole('button', { name: /Max Verstappen/ }).waitFor({ timeout: 25000 })
  await seek(5000000)
  await page.getByRole('button', { name: 'Live session', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Past races', exact: true }).click()
  await page.getByRole('button', { name: 'Load synthetic demo' }).click()
  assert.equal(Number(await slider.getAttribute('max')) - Number(await slider.getAttribute('min')), 60000, 'demo leaves full-session mode')
  const command = page.getByRole('textbox', { name: 'Tactical command' })
  await command.fill('Engineer, track Max Verstappen'); await command.press('Enter')
  assert.equal(await page.getByRole('button', { name: /Max Verstappen/ }).getAttribute('aria-pressed'), 'true')
  await command.fill('chase cam'); await command.press('Enter')
  assert.equal(await page.getByRole('button', { name: 'Chase', exact: true }).getAttribute('aria-pressed'), 'true')
  await command.fill('display interval gaps'); await command.press('Enter')
  assert.equal(await page.getByRole('checkbox', { name: 'Show recorded interval gaps' }).isChecked(), true)
  await page.getByRole('button', { name: 'Thermal simulation (key 2)' }).click()
  assert.equal(await page.locator('[data-ops-mode]').getAttribute('data-ops-mode'), 'thermal')
  await page.setViewportSize({ width: 375, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('PASS browser: 120-minute timeline, automatic chunk transition, preserved chase, minute-60 seek, upstream failure/retry, empty interval, cached seek, cancellation on live switch, mobile')
} finally { await browser.close() }
