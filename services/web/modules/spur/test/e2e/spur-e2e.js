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
  const beiFehler = e => konsolenFehler.push(e.message)
  page.on('pageerror', beiFehler)
  // Overleaf fragt beim Verlassen mit noch nicht gesendeten Änderungen nach; der Test wechselt Seiten bewusst.
  await page.addInitScript(() => {
    window.addEventListener('beforeunload', e => e.stopImmediatePropagation(), true)
  })

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

  async function texErsetzen(datei) {
    const name = datei.split('/').pop()
    const eintrag = page.locator('.file-tree').getByRole('treeitem', { name })
    if (!(await eintrag.isVisible())) await railTab(DATEIBAUM).click()
    await page.locator('.file-tree').getByRole('button', { name: /Hochladen|Upload/ }).first().click()
    await page.locator('.modal input[type=file]').first().setInputFiles(`${FIXTURES}/${datei}`)
    await page.locator('.modal').getByRole('button', { name: /Overwrite|Überschreiben/ }).click()
    await page.locator('.modal').waitFor({ state: 'detached' })
  }

  async function mcp(token, method, params = {}, kopf = {}) {
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...kopf,
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const r = await page.request.post(`${BASE}/spur/mcp`, {
      headers,
      data: { jsonrpc: '2.0', id: 1, method, params },
    })
    const text = await r.text()
    const zeilen = text.split('\n').filter(z => z.startsWith('data:'))
    const daten = zeilen.length
      ? JSON.parse(zeilen.at(-1).slice(5))
      : text && JSON.parse(text)
    return { status: r.status(), daten }
  }

  async function werkzeug(token, name, args = {}) {
    const { daten } = await mcp(token, 'tools/call', { name, arguments: args })
    return {
      fehler: daten.result.isError === true,
      inhalt: JSON.parse(daten.result.content[0].text),
    }
  }

  async function seitenPost(pfad, body) {
    return await page.evaluate(
      async ([url, daten]) => {
        const token = document.querySelector('meta[name="ol-csrfToken"]').content
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token },
          body: JSON.stringify(daten),
        })
        return { status: r.status, daten: await r.json().catch(() => null) }
      },
      [`${BASE}${pfad}`, body]
    )
  }

  async function neuesToken() {
    return (await seitenPost('/spur/claude/tokens', {})).daten.token
  }

  async function projektId(token, name) {
    const { inhalt } = await werkzeug(token, 'project_list')
    return inhalt.eintraege.find(p => p.name === name).id
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
        await Promise.all([
          page.waitForResponse(r => r.url().endsWith('/einfuegen') && r.ok()),
          zeile.getByRole('button', { name: 'Einfügen' }).click(),
        ])
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

    async f7() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('E2E Bericht')
      await panelOeffnen('Prüfbericht')
      const zeile = text => page.locator('.spur-zeile', { hasText: text }).first()
      const zeigt = async (text, status) => {
        await zeile(text).getByText(status, { exact: true }).waitFor({ timeout: 30000 })
      }
      await zeigt('kapitel.tex', 'Wortlaut: exakt')
      await zeigt('Sleep supports […] declarative memory.', 'Wortlaut: exakt')
      await zeigt('Sleep strongly supports', 'Wortlaut: abweichend')
      await zeigt('hippocampus replays', 'Wortlaut: mit Trennungstoleranz')
      await zeigt('Sleep supports […] declarative memory.', 'Seite: stimmt')
      await zeigt('Memory traces', 'gefunden auf S. 347')
      await zeigt('Naps improve', 'Seite nicht prüfbar')
      await zeigt('Naps improve', 'Zurückgezogen')
      ok(
        await zeile('Naps improve')
          .getByText('Zurückgezogen', { exact: true })
          .evaluate(el => {
            const [r, g, b] = getComputedStyle(el.closest('.badge'))
              .backgroundColor.match(/\d+/g)
              .map(Number)
            return r > 150 && g < 100 && b < 100
          }),
        'Zurückgezogen ist nicht rot'
      )
      await zeigt('korrigiert', 'Korrektur vorhanden')
      await zeigt('Sleep supports […] declarative memory.', 'Keine Meldung in Crossref')
      await zeigt('unbekannt', 'Referenz nicht gefunden')
      await zeigt('footfullcite', 'Nicht prüfbar')

      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      await page.getByRole('button', { name: 'Weiter' }).click()
      await page.getByLabel('Gedruckte Seitenzahl dieser Seite').fill('347')
      await page.getByRole('button', { name: 'Seitenzahl bestätigen' }).click()
      await sichtbar('Seitenzahlen bestätigt')
      await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
      await panelOeffnen('Prüfbericht')
      await zeigt('Sleep supports […] declarative memory.', 'Seite: bestätigt')

      const alle = await page.locator('.spur-zeile').count()
      await page.getByLabel('Nur Probleme').check()
      const probleme = await page.locator('.spur-zeile').count()
      ok(probleme < alle, `Filter: ${probleme} von ${alle}`)
      ok(
        (await page.locator('.spur-zeile', { hasText: 'kapitel.tex' }).count()) === 0,
        'Grüne Zeile trotz Filter'
      )
      await page.getByLabel('Nur Probleme').uncheck()

      await editorErsetzen('\\section{Zwei}', '\\section{Zwei!}')
      await sichtbar('Abschnitte geprüft: 1, unverändert übernommen: 3')
      await editorErsetzen('\\section{Zwei!}', '\\section{Zwei}')

      await texErsetzen('ersetzen/kapitel.tex')
      await panelOeffnen('Prüfbericht')
      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      await zeigt('kapitel.tex', 'Wortlaut: abweichend')
    },

    async f8() {
      await anmelden('e2e-a@example.org')
      await page.goto(`${BASE}/user/settings`)
      await page.getByRole('heading', { name: 'Claude verbinden' }).waitFor()
      await page.getByRole('button', { name: 'Token erzeugen' }).click()
      const befehl = page.locator('.spur-befehl')
      await befehl.waitFor()
      const token = await befehl.getAttribute('data-spur-token')
      const text = await befehl.innerText()
      ok(text.includes(`token=${token}`), 'Token fehlt im Befehl')
      ok(text.includes('claude plugin install spur@spur'), 'Plugin-Befehl fehlt')
      ok(text.includes('mcp__plugin_spur_spur__doc_edit'), 'Allow-Regel fehlt')
      await sichtbar('Dieses Token erscheint nur einmal')

      const liste = (await (await page.request.get(`${BASE}/spur/claude/tokens`)).json()).tokens
      ok(!JSON.stringify(liste).includes(token), 'Token im Klartext gespeichert')
      const tage = (new Date(liste[0].ablauf) - new Date(liste[0].angelegt)) / 86400000
      ok(Math.round(tage) === 90, `Gültigkeit ${tage} Tage`)
      ok((await mcp(token, 'tools/list')).status === 200, 'Token wirkt nicht')

      await projektOeffnen('Demo')
      await page.getByRole('button', { name: /^(Teilen|Share)$/ }).first().click()
      await page.locator('.modal').getByText('e2e-a@example.org').first().waitFor()
      ok(!(await page.locator('.modal').innerText()).includes('Claude ('), 'Bot im Teilen-Dialog')
      await page.keyboard.press('Escape')

      await page.goto(`${BASE}/user/settings`)
      await page.locator('.spur-token').first().waitFor()
      await page.locator('.spur-token').first().getByRole('button', { name: 'Widerrufen' }).click()
      let status = 200
      for (let versuch = 0; versuch < 20 && status !== 401; versuch++) {
        await page.waitForTimeout(250)
        status = (await mcp(token, 'tools/list')).status
      }
      ok(status === 401, `Widerrufenes Token wirkt: ${status}`)

      await anmelden('e2e-leser@example.org')
      await page.goto(`${BASE}/user/settings`)
      await sichtbar('Token abgelaufen, bitte erneuern')

      ok((await mcp('spur_e2e_weg', 'tools/list')).status === 200, 'Test-Token fehlt')
      await anmelden('e2e-weg@example.org')
      const loeschen = await seitenPost('/user/delete', { password: PASSWORT })
      ok(loeschen.status === 200, `Konto löschen: ${loeschen.status}`)
      ok((await mcp('spur_e2e_weg', 'tools/list')).status === 401, 'Token überlebt Kontolöschung')
    },

    async f9() {
      await anmelden('e2e-link@example.org')
      await projektOeffnen('E2E Fremd')
      const fremd = page.url().split('/').pop()

      await anmelden('e2e-a@example.org')
      await page.goto(`${BASE}/project`)
      const token = await neuesToken()
      const liste = await mcp(token, 'tools/list')
      const namen = liste.daten.result.tools.map(w => w.name).sort()
      const P1 = [
        'project_list', 'doc_list', 'doc_read', 'sources_list', 'source_search', 'source_read',
        'quote_mark', 'check_report', 'bib_list', 'doc_edit', 'doc_create', 'run_status',
        'run_finish', 'wait_for_event', 'events_since', 'reply',
      ].sort()
      ok(JSON.stringify(namen) === JSON.stringify(P1), `Tools: ${namen}`)

      ok((await mcp(null, 'tools/list')).status === 401, 'Ohne Token kein 401')
      const origin = await mcp(token, 'tools/list', {}, { Origin: 'https://evil.example' })
      ok(origin.status === 403, `Origin: ${origin.status}`)

      const fremdLesen = await werkzeug(token, 'doc_read', { project_id: fremd, pfad: 'main.tex' })
      ok(fremdLesen.fehler && fremdLesen.inhalt.fehler === 'keine_rechte', 'Fremdes Projekt lesbar')

      const demo = await projektId(token, 'Demo')
      const suche = await werkzeug(token, 'source_search', { project_id: demo, query: 'declarative memory' })
      const [treffer] = suche.inhalt.treffer
      ok(
        JSON.stringify(Object.keys(treffer).sort()) ===
          JSON.stringify(['dateiname', 'pdf_seite', 'position', 'quelle_id', 'seite']),
        `Trefferfelder: ${Object.keys(treffer)}`
      )
      ok(treffer.seite === '347' && treffer.position >= 0, 'Seite oder Position falsch')

      const bericht = await werkzeug(token, 'check_report', { project_id: demo })
      const browser = await (await page.request.get(`${BASE}/spur/project/${demo}/pruefbericht`)).json()
      const kurz = zeilen => zeilen.map(z => [z.id, z.wortlaut, z.seite, z.referenz, z.retraction].join('|'))
      ok(
        JSON.stringify(kurz(bericht.inhalt.eintraege)) === JSON.stringify(kurz(browser.zeilen)),
        'check_report weicht vom Browser ab'
      )
    },
  }

  const OFFEN = {
    f10: 'Claude-Panel mit Status und Aufträgen fehlt; Inbox-Werkzeuge stehen, der Test über 11 Minuten ist nicht gebaut',
    f11: 'Schreibweg über document-updater (ADR 0002) fehlt, doc_edit antwortet nicht_verfuegbar',
    f12: 'hängt an doc_edit aus f11',
    f13: 'Lauf-Karte hängt an Läufen aus f11',
    f14: 'Ablehnen hängt an Läufen aus f11',
    f15: 'Automatisch annehmen und Rücknahme hängen an Läufen aus f11',
  }

  const ergebnis = []
  for (const [id, grund] of Object.entries(OFFEN)) {
    if (!nur.length || nur.includes(id)) ergebnis.push(`${id} übersprungen: ${grund}`)
  }
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
  page.off('pageerror', beiFehler)
  return ergebnis.join('\n')
}
