// Alle E2E-Schritte. Läuft mit dem run-code-Werkzeug von Playwright oder per `make e2e`.
// Vorher: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
// Einzelne Features: Seite vorher auf about:blank#f3,f4 stellen.
async page => {
  const BASE = globalThis.SPUR_URL || 'http://localhost:8080'
  const PASSWORT = 'spur-e2e-Passwort-1'
  const FIXTURES =
    globalThis.SPUR_FIXTURES || 'services/web/modules/spur/test/fixtures'
  const nur = new URL(page.url()).hash.slice(1).split(',').filter(Boolean)
  const konsolenFehler = []
  page.removeAllListeners('response')
  page.removeAllListeners('pageerror')
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
    await page.waitForURL(/\/project/, { waitUntil: 'commit' })
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

  const DATEIBAUM = /^(Dateibaum|File tree)$/
  const railTab = name => page.getByRole('tab', { name, exact: true })

  async function panelOeffnen(name) {
    const titel = page.locator('.rail-panel-title', { hasText: name })
    if (!(await titel.first().isVisible())) await railTab(name).click()
    await titel.first().waitFor()
  }

  async function sichtbar(text, timeout = 20000) {
    await page.getByText(text).first().waitFor({ timeout })
  }

  async function hochladen(datei) {
    await page
      .locator('.spur-panel input[type=file]')
      .setInputFiles(`${FIXTURES}/${datei}`)
    await page.getByRole('button', { name: datei }).waitFor({ timeout: 30000 })
  }

  async function suchen(begriff) {
    const feld = page.getByRole('searchbox', { name: 'Quellen durchsuchen' })
    await feld.fill(begriff)
    if (begriff) await feld.press('Enter')
  }

  async function quelleHolen(projekt) {
    await page.getByRole('button', { name: 'Aus anderem Projekt holen' }).click()
    await page.getByLabel('Projekt').selectOption({ label: projekt })
    await page.locator('.modal').getByRole('button', { name: 'Holen', exact: true }).click()
    await page.locator('.modal').waitFor({ state: 'detached' })
  }

  async function textMarkieren(text) {
    await page.locator('.spur-seitentext').evaluate((el, gesucht) => {
      const knoten = el.firstChild
      const start = knoten.textContent.indexOf(gesucht)
      const bereich = document.createRange()
      bereich.setStart(knoten, start)
      bereich.setEnd(knoten, start + gesucht.length)
      const auswahl = document.getSelection()
      auswahl.removeAllRanges()
      auswahl.addRange(bereich)
    }, text)
  }

  async function editorAnsEnde() {
    await page.evaluate(() => {
      const view = window.overleaf.unstable.store.get('editor.view')
      const ende = view.state.doc.length
      view.dispatch({ selection: { anchor: ende } })
    })
  }

  async function bibText(name) {
    const eintrag = page.locator('.file-tree').getByRole('treeitem', { name })
    if (!(await eintrag.isVisible())) await railTab(DATEIBAUM).click()
    await eintrag.click()
    await page.locator('.cm-content', { hasText: '@article{' }).waitFor()
    return await page.evaluate(() =>
      window.overleaf.unstable.store.get('editor.view').state.doc.toString()
    )
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

    async f3() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('E2E Quellen')
      await panelOeffnen('Quellen')
      await sichtbar('Noch keine Quellen')

      await hochladen('smith2024.pdf')
      await sichtbar('8 Seiten · Text erkannt')
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await sichtbar('Seite 345 von 8')
      await page.locator('img.spur-seitenbild').waitFor()
      ok(
        await page
          .locator('img.spur-seitenbild')
          .evaluate(async img => {
            await img.decode()
            return img.naturalWidth > 100
          }),
        'Seitenbild fehlt'
      )
      await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()

      await hochladen('interview.vtt')
      await sichtbar('3 Abschnitte · Text erkannt')
      await suchen('declarative memory')
      await sichtbar('00:00:12')
      await suchen('')

      await hochladen('scan.pdf')
      await sichtbar('Kein Text, nicht prüfbar')

      await page.evaluate(() => {
        const feld = document.querySelector('.spur-panel input[type=file]')
        const liste = new DataTransfer()
        liste.items.add(
          new File([new ArrayBuffer(51 * 1024 * 1024)], 'gross.pdf', {
            type: 'application/pdf',
          })
        )
        feld.files = liste.files
        feld.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await sichtbar('Datei ist größer als 50 MB. Bitte verkleinern.')
      ok(
        (await page.getByRole('button', { name: 'gross.pdf' }).count()) === 0,
        'Zu große Datei wurde gespeichert'
      )

      const projektId = page.url().split('/').pop()
      const baum = await page.request.get(`${BASE}/project/${projektId}/entities`)
      ok(!(await baum.text()).includes('smith2024'), 'Quelle liegt im Projektbaum')
      await kompilieren()

      const liste = await (
        await page.request.get(`${BASE}/spur/project/${projektId}/quellen`)
      ).json()
      const smith = liste.quellen.find(q => q.dateiname === 'smith2024.pdf')
      const datei = `${BASE}/spur/project/${projektId}/quellen/${smith.id}/datei`
      ok((await page.request.get(datei)).status() === 200, 'Besitzer lädt nicht')

      await anmelden('e2e-leser@example.org')
      await page.goto(`${BASE}/project/${projektId}`)
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: 'smith2024.pdf' }).waitFor()
      ok(
        (await page.getByRole('button', { name: 'Hochladen' }).count()) === 0,
        'read-Mitglied sieht Hochladen'
      )
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.locator('img.spur-seitenbild').waitFor()
      ok(
        (await page.getByRole('button', { name: 'Quelle löschen' }).count()) === 0,
        'read-Mitglied sieht Löschen'
      )

      await anmelden('e2e-link@example.org')
      const verboten = await page.request.get(datei)
      ok(verboten.status() === 403, `Edit-Link lädt: ${verboten.status()}`)
      ok(
        (await verboten.json()).type === 'urn:spur:problem:nur_mitglieder',
        'Fehler nicht nach RFC 9457'
      )
    },

    async f4() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('E2E Quellen')
      await panelOeffnen('Quellen')
      await suchen('declarative memory')
      await sichtbar('S. 347')
      await page.locator('.spur-liste').getByText('smith2024.pdf').first().waitFor()
      await suchen('xyzzy')
      await sichtbar('Keine Treffer')
      await suchen('')

      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByLabel('Fassung').fill('Preprint v1')
      await page.getByRole('button', { name: 'Speichern' }).click()
      await sichtbar('Gespeichert')
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
      await sichtbar('Preprint v1')

      await projektOeffnen('E2E Viele')
      await panelOeffnen('Quellen')
      await sichtbar('100 von 300 angezeigt')
      const start = Date.now()
      await suchen('seltene Wortfolge')
      await page.locator('.spur-zeile-auszug', { hasText: 'seltene Wortfolge' }).waitFor()
      const dauer = Date.now() - start
      ok(dauer < 2000, `Suche dauerte ${dauer} ms`)
      ok(
        await page.evaluate(() => {
          const r = document.documentElement
          return r.scrollWidth <= r.clientWidth
        }),
        'Liste scrollt horizontal'
      )
    },

    async f5() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('E2E APA')
      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: 'Aus anderem Projekt holen' }).click()
      await page.getByLabel('Projekt').selectOption({ label: 'Demo' })
      await page.getByRole('button', { name: 'Holen', exact: true }).click()
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      await page
        .locator('.spur-zitate li', { hasText: 'Sleep supports the consolidation' })
        .waitFor()
      await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: 'Quellen exportieren' }).click(),
      ])
      ok(download.suggestedFilename() === 'quellen.zip', 'ZIP-Name falsch')

      await projektOeffnen('Demo')
      const demoId = page.url().split('/').pop()
      const klon = await page.evaluate(
        async ([basis, id]) => {
          const token = document.querySelector('meta[name="ol-csrfToken"]').content
          const r = await fetch(`${basis}/project/${id}/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token },
            body: JSON.stringify({ projectName: 'E2E Klon', tags: [] }),
          })
          return await r.json()
        },
        [BASE, demoId]
      )
      await page.goto(`${BASE}/project/${klon.project_id}`)
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
      await sichtbar('Quellen wurden nicht mitkopiert')
      await page.getByRole('button', { name: 'Holen', exact: true }).click()
      await page.locator('.modal').getByRole('button', { name: 'Holen', exact: true }).click()
      await page.getByRole('button', { name: 'smith2024.pdf' }).waitFor()

      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Quelle löschen' }).click()
      await page.locator('.modal').getByText('1 Zitat nutzt diese Quelle').waitFor()
      await page.getByRole('button', { name: 'Endgültig löschen' }).click()
      await sichtbar('Noch keine Quellen')
      await panelOeffnen('Prüfbericht')
      await sichtbar('Quelle fehlt')
    },

    async f6() {
      const SATZ = 'Sleep supports the consolidation of declarative memory.'
      await anmelden('e2e-a@example.org')
      for (const [projekt, erwartet] of [
        ['E2E APA', String.raw`\enquote{${SATZ}} \autocite[347]{smith2024}`],
        ['E2E natbib', String.raw`\enquote{${SATZ}} \citep[S.~347]{smith2024}`],
      ]) {
        await projektOeffnen(projekt)
        await panelOeffnen('Quellen')
        await quelleHolen('Demo')
        await page.getByRole('button', { name: 'smith2024.pdf' }).click()
        await page.getByRole('button', { name: 'Weiter' }).click()
        await page.getByRole('button', { name: 'Weiter' }).click()
        await sichtbar('Seite 347 von 8')
        await textMarkieren(SATZ)
        await page.getByRole('button', { name: 'Zitat speichern' }).click()
        const zeile = page.locator('.spur-zitate li', { hasText: SATZ }).first()
        await zeile.waitFor()
        await editorAnsEnde()
        await zeile.getByRole('button', { name: 'Einfügen' }).click()
        await page.waitForFunction(
          text => window.overleaf.unstable.store.get('editor.view').state.doc.toString().includes(text),
          erwartet
        )
        await editorAnsEnde()
        await zeile.getByRole('button', { name: 'Einfügen' }).click()
        await page.waitForTimeout(1500)
        const bib = await bibText('references.bib')
        ok((bib.match(/@article\{smith2024,/g) ?? []).length === 1, `bib: ${bib}`)
        ok(bib.includes('title = {Sleep and Memory}'), 'Titel aus Crossref fehlt')
        ok(bib.includes('doi = {10.5555/spur.2024.001}'), 'DOI fehlt')
      }

      await anmelden('e2e-leser@example.org')
      await projektOeffnen('Demo')
      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      const knopf = page.locator('.spur-zitate li').first().getByRole('button', { name: 'Einfügen' })
      await knopf.waitFor()
      ok(await knopf.isDisabled(), 'Einfügen ist für read-Nutzer aktiv')
      await sichtbar('Keine Schreibrechte')
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
