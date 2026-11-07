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
    await page.getByLabel(/e-?mail/i).fill(email)
    await page.getByLabel(/passwort|password/i).fill(PASSWORT)
    await page.getByRole('button', { name: /^(anmelden|log ?in)$/i }).click()
    await page.waitForURL(/\/project/)
  }

  const KOMPILIEREN = /^(aktualisieren|recompile)$/i

  async function projektOeffnen(name) {
    await page.goto(`${BASE}/project`)
    await page.getByRole('link', { name, exact: true }).first().click()
    await page.waitForURL(/\/project\/[0-9a-f]{24}/)
    await page.getByRole('button', { name: KOMPILIEREN }).first().waitFor()
    await page.locator('.cm-content').first().waitFor()
  }

  async function kompilieren() {
    await page.getByRole('button', { name: KOMPILIEREN }).first().click()
    await page.locator('.pdf-viewer .page canvas').first().waitFor({ timeout: 120000 })
  }

  const railTab = name => page.getByRole('tab', { name, exact: true })

  async function panelOeffnen(name) {
    await railTab(name).click()
  }

  async function sichtbar(text, timeout = 20000) {
    await page.getByText(text).first().waitFor({ timeout })
  }

  async function editorErsetzen(alt, neu) {
    await page.evaluate(
      ([von, zu]) => {
        const view = window.overleaf.unstable.store.get('editor.view')
        const pos = view.state.doc.toString().indexOf(von)
        if (pos < 0) throw new Error(`Nicht im Editor: ${von}`)
        view.dispatch({
          changes: { from: pos, to: pos + von.length, insert: zu },
          userEvent: 'input.type',
        })
      },
      [alt, neu]
    )
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

    async f2() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('Demo')
      await panelOeffnen('Quellen')
      await sichtbar('smith2024.pdf')
      await panelOeffnen('Prüfbericht')
      await sichtbar('Wortlaut: exakt')
      await sichtbar('Seite: stimmt')
      await editorErsetzen('{Sleep supports', '{Rest supports')
      await sichtbar('Wortlaut: abweichend')
      await page.locator('.spur-marke-rot', { hasText: 'Rest supports' }).first().waitFor()
      await editorErsetzen('{Rest supports', '{Sleep supports')
      await sichtbar('Wortlaut: exakt')
      await kompilieren()
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
