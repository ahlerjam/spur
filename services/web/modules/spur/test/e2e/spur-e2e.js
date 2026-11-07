// Alle E2E-Schritte. Läuft mit dem run-code-Werkzeug von Playwright oder per `make e2e`.
// Vorher: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
// Einzelne Features: Seite vorher auf about:blank#f3,f4 stellen.
async page => {
  const BASE = globalThis.SPUR_URL || 'http://localhost:8080'
  const PASSWORT = 'spur-e2e-Passwort-1'
  const nur = new URL(page.url()).hash.slice(1).split(',').filter(Boolean)
  const konsolenFehler = []
  page.on('pageerror', e => konsolenFehler.push(e.message))

  const fail = msg => {
    throw new Error(msg)
  }
  const ok = (bedingung, msg) => bedingung || fail(msg)

  async function anmelden(email) {
    await page.context().clearCookies()
    await page.goto(`${BASE}/login`)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(PASSWORT)
    await page.getByRole('button', { name: /^log ?in$/i }).click()
    await page.waitForURL(/\/project/)
  }

  async function projektOeffnen(name) {
    await page.goto(`${BASE}/project`)
    await page.getByRole('link', { name, exact: true }).first().click()
    await page.waitForURL(/\/project\/[0-9a-f]{24}/)
    await page.getByRole('button', { name: /recompile/i }).first().waitFor()
  }

  async function kompilieren() {
    await page.getByRole('button', { name: /^recompile$/i }).first().click()
    await page.locator('.pdf-viewer .page canvas').first().waitFor({ timeout: 120000 })
  }

  const features = {
    async f1() {
      await page.context().clearCookies()
      await page.goto(`${BASE}/login`)
      ok(/spur/.test(await page.title()), `Titel: ${await page.title()}`)
      ok(
        (await page.locator('.navbar-logo').count()) === 0,
        'Overleaf-Logo auf der Login-Seite'
      )
      ok(
        (await page
          .locator('footer a[href="https://github.com/ahlerjam/spur"]')
          .count()) === 1,
        'Footer-Link fehlt'
      )
      await anmelden('e2e-a@example.org')
      for (const name of ['E2E APA', 'E2E natbib']) {
        await projektOeffnen(name)
        await kompilieren()
        await page
          .locator('.pdf-viewer .textLayer', { hasText: 'Sleep and Memory' })
          .first()
          .waitFor({ timeout: 30000 })
      }
    },
  }

  const ergebnis = []
  for (const [id, lauf] of Object.entries(features)) {
    if (nur.length && !nur.includes(id)) continue
    konsolenFehler.length = 0
    try {
      await lauf()
      ok(konsolenFehler.length === 0, `Fehler: ${konsolenFehler.join(' | ')}`)
      ergebnis.push(`${id} ok`)
    } catch (error) {
      ergebnis.push(`${id} FEHLER: ${error.message}`)
    }
  }
  return ergebnis.join('\n')
}
