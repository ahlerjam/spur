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

  async function anmelden(email, versuch = 1) {
    // Erst die alte Seite verlassen: Ihre Polls würden sonst nach dem Löschen eine neue Session
    // setzen, und das CSRF-Token des Login-Formulars passte nicht mehr.
    await page.goto('about:blank')
    await page.context().clearCookies()
    await page.goto(`${BASE}/login`)
    await page.getByLabel(/e-?mail/i).fill(email)
    await page.getByLabel(/passwort|password/i).fill(PASSWORT)
    const [antwort] = await Promise.all([
      page.waitForResponse(r => r.url() === `${BASE}/login` && r.request().method() === 'POST'),
      page.getByRole('button', { name: /^(anmelden|log ?in)$/i }).click(),
    ])
    // Eine noch laufende Antwort der verlassenen Seite kann trotzdem eine Session setzen (403 CSRF).
    // Dann genau einmal neu; ein echter Login-Fehler scheitert auch beim zweiten Mal.
    if (antwort.status() === 403 && versuch === 1) return await anmelden(email, 2)
    // Overleaf erlaubt je IP 20 Anmeldungen in 60 s (router.mjs, overleafLoginRateLimiter); auf einem
    // schnellen Rechner meldet die Suite sich öfter an. Dann das Fenster abwarten, ohne Retry-After.
    if (antwort.status() === 429 && versuch <= 2) {
      await page.waitForTimeout(61000)
      return await anmelden(email, versuch + 1)
    }
    await page.waitForURL(/\/project/, { waitUntil: 'commit' })
  }

  const KOMPILIEREN = /^(aktualisieren|recompile)$/i

  async function projektOeffnen(name) {
    await page.goto(`${BASE}/project`)
    // Die Liste zeigt nur 20 Projekte; e2e-a hat mehr. Wie ein Mensch über die Suche filtern.
    await page
      .getByPlaceholder(/^(Suche in allen Projekten|Search in all projects)…$/)
      .filter({ visible: true })
      .first()
      .fill(name)
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

  // Wartet im Browser wie der Fake-Client; Fortschritt und Ergebnis landen in window.__spur.
  async function warteStarten(token) {
    await page.evaluate(t => {
      const start = Date.now()
      const zustand = { log: [], abbruch: new AbortController() }
      window.__spur = zustand
      fetch('/spur/mcp', {
        method: 'POST',
        signal: zustand.abbruch.signal,
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'wait_for_event', arguments: { max_sekunden: 300 }, _meta: { progressToken: 'e2e' } },
        }),
      })
        .then(async r => {
          const leser = r.body.getReader()
          const dekodierer = new TextDecoder()
          let puffer = ''
          for (;;) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekodierer.decode(value, { stream: true })
            for (let i = puffer.indexOf('\n\n'); i >= 0; i = puffer.indexOf('\n\n')) {
              const daten = puffer.slice(0, i).split('\n').filter(z => z.startsWith('data:')).map(z => z.slice(5)).join('')
              puffer = puffer.slice(i + 2)
              if (daten) zustand.log.push({ t: Date.now() - start, msg: JSON.parse(daten) })
            }
          }
        })
        .catch(e => zustand.log.push({ t: Date.now() - start, fehler: e.name }))
    }, token)
  }

  async function editorEinfuegen(vor, text) {
    await page.evaluate(
      ([anker, neu]) => {
        const view = window.overleaf.unstable.store.get('editor.view')
        const pos = view.state.doc.toString().indexOf(anker)
        view.dispatch({ changes: { from: pos, insert: neu }, userEvent: 'input.type' })
      },
      [vor, text]
    )
  }

  // Wartet, bis eine Eingabe im Editor auf dem Server angekommen ist.
  async function gespeichert(token, pid, text) {
    for (let i = 0; i < 40; i++) {
      const { inhalt } = await werkzeug(token, 'doc_read', { project_id: pid, pfad: 'main.tex' })
      if (inhalt.text?.includes(text)) return
      await page.waitForTimeout(250)
    }
    fail(`Nicht gespeichert: ${text}`)
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

  const FAKE = `${BASE}/spur/dev/crossref`

  async function fakeSteuern(einstellung) {
    const r = await page.request.post(`${FAKE}/_steuerung`, { data: einstellung })
    ok(r.status() === 204, `Fake-Steuerung: ${r.status()}`)
  }

  async function paperSuchen(anfrage) {
    await page.getByRole('searchbox', { name: 'Paper suchen' }).fill(anfrage)
    await page.getByRole('button', { name: 'Suchen', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.spur-panel-inhalt[aria-busy="true"]'), null, { timeout: 30000 })
  }

  const paperTreffer = titel => page.locator('.spur-paper', { has: page.getByText(titel, { exact: true }) }).first()

  async function trefferDois() {
    return await page.locator('.spur-paper-doi').allTextContents()
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
      await sichtbar('Seite 345 (PDF-Seite 1 von 8)')
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
      const ohneFeld = await page.evaluate(async url => {
        const formular = new FormData()
        formular.append('falsch', new Blob(['x']), 'x.pdf')
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'X-Csrf-Token': document.querySelector('meta[name="ol-csrfToken"]').content },
          body: formular,
        })
        return { status: r.status, typ: r.headers.get('content-type'), body: await r.json().catch(() => null) }
      }, `${BASE}/spur/project/${projektId}/quellen`)
      ok(
        ohneFeld.status === 400 &&
          ohneFeld.typ.startsWith('application/problem+json') &&
          ohneFeld.body?.type === 'urn:spur:problem:datei_fehlt',
        `Upload ohne Feld: ${JSON.stringify(ohneFeld)}`
      )

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
      await page.getByRole('button', { name: 'Speichern', exact: true }).click()
      await sichtbar('Gespeichert')
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
      await sichtbar('Preprint v1')
      const versatz = await page.evaluate(async basis => {
        const t = document.querySelector('meta[name="ol-csrfToken"]').content
        const id = location.pathname.split('/').pop()
        const { quellen } = await (await fetch(`${basis}/spur/project/${id}/quellen`)).json()
        const pdf = quellen.find(q => q.dateiname === 'smith2024.pdf')
        const setzen = async wert =>
          (await fetch(`${basis}/spur/project/${id}/quellen/${pdf.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': t },
            body: JSON.stringify({ versatz: wert }),
          })).status
        return [await setzen(1e9), await setzen(-1e9), await setzen(null)]
      }, BASE)
      ok(JSON.stringify(versatz) === '[422,422,200]', `Versatz-Grenzen: ${versatz}`)

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
      // Die Liste zeigt nur 100 von 300 und verweist auf die Suche: Die findet auch Dateinamen.
      await suchen('quelle-250')
      const imNamen = page.locator('.spur-zeile', { hasText: 'Treffer im Dateinamen' })
      await imNamen.getByRole('button', { name: 'quelle-250.pdf' }).waitFor()
      await imNamen.getByRole('button', { name: 'quelle-250.pdf' }).click()
      await page.locator('.rail-panel-title', { hasText: 'quelle-250.pdf' }).waitFor()
    },

    async f5() {
      await anmelden('e2e-a@example.org')
      await projektOeffnen('E2E APA')
      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: 'Aus anderem Projekt holen' }).click()
      await page.getByLabel('Projekt').selectOption({ label: 'Demo' })
      await page.getByRole('button', { name: 'Holen', exact: true }).click()
      await sichtbar('1 Quelle geholt')
      await quelleHolen('Demo')
      await sichtbar('Nichts zu holen: Alle Quellen aus diesem Projekt sind schon da.')
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
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
      ok(
        await page.locator('.spur-panel-hinweis').evaluate(hinweis => {
          const karte = hinweis.querySelector('.notification').getBoundingClientRect()
          const knopf = hinweis.querySelector('.notification-cta button').getBoundingClientRect()
          return knopf.right <= karte.right + 0.5 && knopf.left >= karte.left - 0.5
        }),
        '„Holen“ ragt aus dem Klon-Hinweis'
      )
      await page.getByRole('button', { name: 'Holen', exact: true }).click()
      await page.locator('.modal').getByRole('button', { name: 'Holen', exact: true }).click()
      await page.getByRole('button', { name: 'smith2024.pdf' }).waitFor()

      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Quelle löschen' }).click()
      await page.locator('.modal').getByText('1 Zitat nutzt diese Quelle').waitFor()
      await page.getByRole('button', { name: 'Endgültig löschen' }).click()
      await sichtbar('Noch keine Quellen')
      await page.waitForFunction(() => document.activeElement?.closest('.spur-panel'))
      ok(
        await page.evaluate(() => document.activeElement?.matches('input[type="search"]')),
        'Fokus nach dem Löschen nicht im Panel'
      )
      await panelOeffnen('Prüfbericht')
      await sichtbar('Quelle fehlt')
    },

    async f6() {
      const SATZ = 'Sleep supports the consolidation of declarative memory.'
      await anmelden('e2e-a@example.org')
      for (const [projekt, erwartet] of [
        ['E2E APA', String.raw`\enquote{${SATZ}} \autocite[347]{smith2024}`],
        ['E2E natbib', String.raw`\enquote{${SATZ}} \citep[S.~347]{smith2024}`],
        // Ohne .bib: Die neue references.bib muss ohne Neuladen im Dateibaum erscheinen.
        ['E2E Ohne Bib', String.raw`\enquote{${SATZ}} \autocite[347]{smith2024}`],
      ]) {
        await projektOeffnen(projekt)
        await panelOeffnen('Quellen')
        await quelleHolen('Demo')
        await page.getByRole('button', { name: 'smith2024.pdf' }).click()
        await page.getByRole('button', { name: 'Nächste Seite' }).click()
        await page.getByRole('button', { name: 'Nächste Seite' }).click()
        await sichtbar('Seite 347 (PDF-Seite 3 von 8)')
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
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
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
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
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

      // Das allererste Token eines neuen Kontos legt den Bot an und muss sofort wirken.
      await anmelden('e2e-neu@example.org')
      await page.goto(`${BASE}/user/settings`)
      await page
        .getByRole('button', { name: 'Token erzeugen' })
        .click({ timeout: 15000 })
        .catch(async error => {
          const text = (await page.locator('body').innerText()).slice(0, 400).replace(/\s+/g, ' ')
          fail(`Token erzeugen fehlt auf ${page.url()}: ${text} (${error.message.split('\n')[0]})`)
        })
      await page.locator('.spur-befehl').waitFor()
      const erstes = await page.locator('.spur-befehl').getAttribute('data-spur-token')
      const neuPid = await projektId(erstes, 'E2E Neu')
      const angefuegt = await werkzeug(erstes, 'doc_edit', {
        project_id: neuPid, pfad: 'main.tex', neu: 'Von Claude angefügt.', idempotenz_schluessel: 'e2e-neu-1',
      })
      ok(!angefuegt.fehler && angefuegt.inhalt.aenderung, `doc_edit mit erstem Token: ${JSON.stringify(angefuegt.inhalt)}`)
      const lesen = await werkzeug(erstes, 'doc_read', { project_id: neuPid, pfad: 'main.tex' })
      ok(lesen.inhalt.text.endsWith('Von Claude angefügt.'), `Ohne Alttext nicht angefügt: ${lesen.inhalt.text}`)
      await werkzeug(erstes, 'wait_for_event', { max_sekunden: 1 })
      const verbindung = await (await page.request.get(`${BASE}/spur/project/${neuPid}/claude`)).json()
      ok(verbindung.verbunden === true, `Erstes Token: Panel nicht verbunden: ${JSON.stringify(verbindung.verbunden)}`)
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
      ]
      // P2 ergänzt laut docs/mcp-vertrag.md Recherche, Aufnahme, Matrix und Compile.
      const P2 = [
        'paper_search', 'paper_citations', 'source_add', 'acquisition_add', 'matrix_suggest',
        'compile', 'job_status', 'compile_log', 'page_image',
      ]
      const erwartet = [...P1, ...P2].sort()
      ok(JSON.stringify(namen) === JSON.stringify(erwartet), `Tools: ${namen}`)
      const rollen = (await werkzeug(token, 'project_list')).inhalt.eintraege.map(p => p.rolle)
      ok(rollen.length && rollen.every(r => ['read', 'review', 'write', 'owner'].includes(r)), `Rollen laut Vertrag: ${rollen}`)

      ok((await mcp(null, 'tools/list')).status === 401, 'Ohne Token kein 401')
      const origin = await mcp(token, 'tools/list', {}, { Origin: 'https://evil.example' })
      ok(origin.status === 403, `Origin: ${origin.status}`)

      const fremdLesen = await werkzeug(token, 'doc_read', { project_id: fremd, pfad: 'main.tex' })
      ok(fremdLesen.fehler && fremdLesen.inhalt.fehler === 'keine_rechte', 'Fremdes Projekt lesbar')
      const unbekannt = await werkzeug(token, 'doc_read', { project_id: 'ffffffffffffffffffffffff', pfad: 'main.tex' })
      ok(unbekannt.inhalt.fehler === 'keine_rechte', `Unbekanntes Projekt: ${JSON.stringify(unbekannt.inhalt)}`)
      // Ein Site-Admin darf im Web jedes Projekt öffnen; sein Claude bekommt dieses Sonderrecht nicht.
      for (const [was, pid] of [['unbekannt', 'ffffffffffffffffffffffff'], ['fremd', fremd]]) {
        const admin = await werkzeug('spur_e2e_admin', 'doc_read', { project_id: pid, pfad: 'main.tex' })
        ok(admin.inhalt.fehler === 'keine_rechte', `Admin-Token, Projekt ${was}: ${JSON.stringify(admin.inhalt)}`)
      }

      const editSchema = liste.daten.result.tools.find(w => w.name === 'doc_edit').inputSchema
      ok(!(editSchema.required ?? []).includes('alt'), `doc_edit verlangt alt: ${editSchema.required}`)

      const ausbruch = await mcp(token, 'tools/call', {
        name: 'doc_create',
        arguments: { project_id: await projektId(token, 'E2E Schreiben'), pfad: '../../etc/x.tex', inhalt: 'x', idempotenz_schluessel: 'e2e-pfad' },
      })
      const ausbruchText = JSON.stringify(ausbruch.daten)
      ok(
        !ausbruchText.includes('interner_fehler') && (ausbruch.daten.error || ausbruch.daten.result?.isError),
        `doc_create mit ../: ${ausbruchText}`
      )

      const kaputt = await page.request.post(`${BASE}/spur/mcp`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        data: '{"jsonrpc": "2.0", kaputt',
      })
      const kaputtBody = await kaputt.json().catch(() => null)
      ok(
        kaputt.status() === 400 &&
          kaputt.headers()['content-type']?.startsWith('application/problem+json') &&
          kaputtBody?.type === 'urn:spur:problem:json_kaputt',
        `Kaputtes JSON: ${kaputt.status()} ${JSON.stringify(kaputtBody)}`
      )

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

  features.f10 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('Demo')
    const demo = page.url().split('/').pop()
    const token = await neuesToken()
    await panelOeffnen('Claude')
    await sichtbar('Claude nicht verbunden')
    await sichtbar('claude --allowedTools')
    await page.getByRole('button', { name: 'Senden' }).click()
    await sichtbar('Bitte zuerst einen Auftrag schreiben.')
    ok(
      await page.locator('#spur-auftrag-leer').evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      }),
      'Meldung zum leeren Auftrag liegt außer Sicht'
    )
    ok(
      (await page.getByLabel('Auftrag an Claude').getAttribute('aria-invalid')) === 'true',
      'Leeres Auftragsfeld nicht als ungültig markiert'
    )
    const zahl = await seitenPost(`/spur/project/${demo}/claude/auftrag`, { text: 123 })
    ok(zahl.status === 422, `Auftrag mit Zahl: ${zahl.status}`)

    await warteStarten(token)
    await sichtbar('Claude verbunden', 20000)
    await page.evaluate(() => window.__spur.abbruch.abort())
    const abgebrochen = Date.now()
    await sichtbar('Claude nicht verbunden', 65000)
    const sekunden = (Date.now() - abgebrochen) / 1000
    ok(sekunden <= 60, `Rückfall nach ${sekunden} s`)

    await warteStarten(token)
    await page.waitForFunction(
      () => window.__spur.log.some(e => e.msg?.method === 'notifications/progress'),
      null,
      { timeout: 40000 }
    )
    const fortschritt = await page.evaluate(() => window.__spur.log.find(e => e.msg?.method).t)
    ok(fortschritt >= 25000 && fortschritt <= 35000, `Fortschritt nach ${fortschritt} ms`)
    await page.getByLabel('Auftrag an Claude').fill('Bitte Kapitel 2 prüfen')
    const gesendet = Date.now()
    await page.getByRole('button', { name: 'Senden' }).click()
    await page.waitForFunction(
      () => window.__spur.log.some(e => e.msg?.result),
      null,
      { timeout: 5000 }
    )
    const dauer = Date.now() - gesendet
    ok(dauer < 2000, `Auftrag kam nach ${dauer} ms`)
    const ergebnis = await page.evaluate(() =>
      JSON.parse(window.__spur.log.find(e => e.msg?.result).msg.result.content[0].text)
    )
    ok(ergebnis.ereignis?.typ === 'task_created', `Ergebnis: ${JSON.stringify(ergebnis)}`)

    const erste = await werkzeug(token, 'events_since')
    ok(
      erste.inhalt.ereignisse.length === 1 && erste.inhalt.ereignisse[0].typ === 'task_created',
      `events_since: ${JSON.stringify(erste.inhalt)}`
    )
    const zweite = await werkzeug(token, 'events_since', { cursor: erste.inhalt.cursor })
    ok(zweite.inhalt.ereignisse.length === 0, 'Zweiter Abruf liefert Ereignisse')

    await werkzeug(token, 'reply', { project_id: demo, text: 'Kapitel 2 ist geprüft.' })
    await sichtbar('Kapitel 2 ist geprüft.', 10000)

    await anmelden('e2e-leser@example.org')
    await page.goto(`${BASE}/project`)
    const fremd = await werkzeug(await neuesToken(), 'events_since')
    ok(fremd.inhalt.ereignisse.length === 0, 'Bot sieht fremde Ereignisse')
  }

  const schluessel = () => `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const docText = () =>
    page.evaluate(() => window.overleaf.unstable.store.get('editor.view').state.doc.toString())
  const imEditor = (text, timeout = 15000) =>
    page.waitForFunction(
      t => window.overleaf.unstable.store.get('editor.view').state.doc.toString().includes(t),
      text,
      { timeout }
    )
  const jsonVon = async pfad => (await page.request.get(`${BASE}${pfad}`)).json()

  async function schreibProjekt() {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Schreiben')
    const pid = page.url().split('/').pop()
    const token = await neuesToken()
    const edit = (args, key = schluessel()) =>
      werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', idempotenz_schluessel: key, ...args })
    return { pid, token, edit }
  }

  features.f11 = async () => {
    const { pid, token, edit } = await schreibProjekt()
    const erster = schluessel()
    const r1 = await edit({ alt: 'Erster Absatz.', neu: 'Erster Absatz. Ergänzt von Claude.' }, erster)
    ok(!r1.fehler, `doc_edit: ${JSON.stringify(r1.inhalt)}`)
    await imEditor('Ergänzt von Claude.')
    ok((await page.locator('.modal').count()) === 0, 'Modal erschienen')
    // Ohne Neuladen: Das Review-Panel nennt Claude, nicht „Deleted user“ (Bot ist kein Mitglied).
    await railTab('Review panel').click()
    await page
      .locator('.review-panel-entry-user', { hasText: 'Claude (e2e-a)' })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(async () =>
        fail(`Review-Panel: ${(await page.locator('.review-panel-entry-user').allInnerTexts()).join(' | ')}`)
      )
    await railTab('Review panel').click()
    const bots = await jsonVon(`/project/${pid}/changes/users`)
    ok(bots.some(u => u.first_name === 'Claude' && u.last_name === '(e2e-a)'), `Autoren: ${JSON.stringify(bots)}`)
    const ranges = await jsonVon(`/project/${pid}/ranges`)
    const changes = ranges.flatMap(d => d.ranges?.changes ?? [])
    ok(changes.some(c => c.op.i?.includes('Ergänzt von Claude')), 'Kein Track Change')

    const parallel = edit({ alt: 'Zweiter Absatz.', neu: 'Zweiter Absatz. Von Claude.' })
    await editorErsetzen('Erster Absatz.', 'Erster Absatz, getippt.')
    ok(!(await parallel).fehler, 'Paralleles doc_edit scheiterte')
    await imEditor('Zweiter Absatz. Von Claude.')
    await imEditor('Erster Absatz, getippt.')

    const konflikt = await edit({ alt: 'Gibt es nicht.', neu: 'x' })
    ok(konflikt.inhalt.fehler === 'konflikt', `Konflikt: ${JSON.stringify(konflikt.inhalt)}`)

    const nochmal = await edit({ alt: 'Erster Absatz.', neu: 'Erster Absatz. Ergänzt von Claude.' }, erster)
    ok(nochmal.inhalt.wiederholt === true, 'Idempotenz greift nicht')
    const andererInhalt = await edit({ alt: 'Erster Absatz.', neu: 'Erster Absatz. Etwas anderes.' }, erster)
    ok(andererInhalt.inhalt.fehler === 'konflikt', `Gleicher Schlüssel, anderer Inhalt: ${JSON.stringify(andererInhalt.inhalt)}`)
    ok((await docText()).split('Ergänzt von Claude.').length === 2, 'Doppelte Änderung')

    const labels = await jsonVon(`/project/${pid}/labels`)
    ok(labels.some(l => l.comment === 'Claude: Lauf'), 'Label fehlt')
    let herkunft = false
    for (let i = 0; i < 20 && !herkunft; i++) {
      const { updates } = await jsonVon(`/project/${pid}/updates?min_count=10`)
      herkunft = updates.some(u => u.meta.users.some(n => n?.first_name === 'Claude'))
      if (!herkunft) await page.waitForTimeout(1000)
    }
    ok(herkunft, 'History zeigt keine Herkunft Claude')

    const docs = (await werkzeug(token, 'doc_list', { project_id: pid })).inhalt.eintraege
    const weg = docs.find(d => d.pfad === 'weg.tex').id
    const geloescht = await page.evaluate(
      async ([p, d]) => {
        const t = document.querySelector('meta[name="ol-csrfToken"]').content
        return (await fetch(`/project/${p}/doc/${d}`, { method: 'DELETE', headers: { 'X-Csrf-Token': t } })).status
      },
      [pid, weg]
    )
    ok(geloescht < 300, `Löschen: ${geloescht}`)
    const fehlt = await werkzeug(token, 'doc_edit', {
      project_id: pid, doc_id: weg, alt: 'Wird gelöscht.', neu: 'x', idempotenz_schluessel: schluessel(),
    })
    ok(fehlt.inhalt.fehler === 'doc_fehlt', `doc_fehlt: ${JSON.stringify(fehlt.inhalt)}`)

    const voll = await edit({ pfad: 'voll.tex', alt: '', neu: 'b' })
    ok(voll.inhalt.fehler === 'grenze_changes', `Grenze: ${JSON.stringify(voll.inhalt)}`)
    await editorErsetzen('Erster Absatz, getippt.', 'Erster Absatz, weiter getippt.')
    await imEditor('weiter getippt')
    ok(
      !(await page.getByText(/Verbindung.*(verloren|getrennt)|disconnected/i).count()),
      'Client getrennt'
    )

    const neu = await werkzeug(token, 'doc_create', {
      project_id: pid, pfad: 'claude.tex', inhalt: 'Neuer Inhalt von Claude.', idempotenz_schluessel: schluessel(),
    })
    ok(!neu.fehler, `doc_create: ${JSON.stringify(neu.inhalt)}`)
    const nachher = (await jsonVon(`/project/${pid}/ranges`)).find(d => d.id === neu.inhalt.doc_id)
    ok(
      nachher?.ranges?.changes?.some(c => c.op.i === 'Neuer Inhalt von Claude.'),
      'Inhalt von doc_create ist kein Track Change'
    )
    const belegt = await werkzeug(token, 'doc_create', {
      project_id: pid, pfad: 'claude.tex', inhalt: 'Überschreiben?', idempotenz_schluessel: schluessel(),
    })
    ok(belegt.inhalt.fehler === 'konflikt', `doc_create auf vorhandenen Pfad: ${JSON.stringify(belegt.inhalt)}`)
    // Wie im Web: ein Dateiname mit 304 Zeichen wird abgelehnt, sonst scheiterte danach jeder Compile.
    const langerName = `${'a'.repeat(300)}.tex`
    const zuLang = await werkzeug(token, 'doc_create', {
      project_id: pid, pfad: langerName, inhalt: 'x', idempotenz_schluessel: schluessel(),
    })
    ok(zuLang.inhalt.fehler === 'pfad_ungueltig', `doc_create mit ${langerName.length} Zeichen: ${JSON.stringify(zuLang.inhalt)}`)
    const zuLangEdit = await edit({ pfad: langerName, alt: '', neu: 'x' })
    ok(zuLangEdit.inhalt.fehler === 'pfad_ungueltig', `doc_edit mit langem Pfad: ${JSON.stringify(zuLangEdit.inhalt)}`)
    ok(
      !(await werkzeug(token, 'doc_list', { project_id: pid })).inhalt.eintraege.some(d => d.pfad === langerName),
      'Datei mit zu langem Namen angelegt'
    )
    ok((await jsonVon(`/project/${pid}/ranges`)).find(d => d.id === neu.inhalt.doc_id)?.ranges?.changes?.length, 'Vorhandene Datei geleert')
  }

  features.f12 = async () => {
    const { token, pid, edit } = await schreibProjekt()
    const SATZ = 'Sleep supports the consolidation of declarative memory.'
    const echt = await edit({
      alt: '\\section{Zwei}',
      neu: `\\enquote{${SATZ}} \\autocite[347]{smith2024}\n\\section{Zwei}`,
    })
    ok(!echt.fehler, `Echtes Zitat abgewiesen: ${JSON.stringify(echt.inhalt)}`)
    await imEditor(`\\enquote{${SATZ}}`)

    const vorher = await docText()
    const erfunden = await edit({ alt: 'Erster', neu: 'Erster \\enquote{Sleep erases all memory.} \\autocite[347]{smith2024}' })
    ok(erfunden.inhalt.fehler === 'zitat_abweichend', `Erfunden: ${JSON.stringify(erfunden.inhalt)}`)
    await page.waitForTimeout(1000)
    ok((await docText()) === vorher, 'Dokument wurde verändert')

    const erfundenNeu = await werkzeug(token, 'doc_create', {
      project_id: pid, pfad: 'erfunden.tex', inhalt: '\\enquote{Sleep erases all memory.} \\autocite[347]{smith2024}', idempotenz_schluessel: `erfunden-${Date.now()}`,
    })
    ok(erfundenNeu.inhalt.fehler === 'zitat_abweichend', `doc_create erfunden: ${JSON.stringify(erfundenNeu.inhalt)}`)
    const nachDocs = (await werkzeug(token, 'doc_list', { project_id: pid })).inhalt.eintraege
    ok(!nachDocs.some(d => d.pfad === 'erfunden.tex'), 'doc_create ließ eine leere Datei zurück')

    const ohneQuelle = await edit({ alt: 'Erster', neu: 'Erster \\enquote{Ein Satz.} \\autocite[1]{neuerkey2025}' })
    ok(ohneQuelle.inhalt.fehler === 'quelle_fehlt', `Ohne Quelle: ${JSON.stringify(ohneQuelle.inhalt)}`)

    const unbekannt = await edit({ alt: 'Erster', neu: 'Erster \\footfullcite{smith2024}' })
    ok(!unbekannt.fehler && unbekannt.inhalt.rot.length === 1, `Unbekannt: ${JSON.stringify(unbekannt.inhalt)}`)
    const { lauf } = (await werkzeug(token, 'run_status', { project_id: pid })).inhalt
    ok(lauf.rot.length >= 1, 'Lauf nicht rot')
    await panelOeffnen('Claude')
    await page.locator('.spur-lauf-rot').first().waitFor()
  }

  async function laufProjekt(email = 'e2e-a@example.org') {
    await anmelden(email)
    await projektOeffnen('E2E Lauf')
    const pid = page.url().split('/').pop()
    const token = await neuesToken()
    const edit = (args, pfad = 'main.tex') =>
      werkzeug(token, 'doc_edit', { project_id: pid, pfad, idempotenz_schluessel: schluessel(), ...args })
    const fertig = zusammenfassung =>
      werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung })
    const lauf = async () => (await werkzeug(token, 'run_status', { project_id: pid })).inhalt.lauf
    const changesVonClaude = async () =>
      (await jsonVon(`/project/${pid}/ranges`)).flatMap(d => d.ranges?.changes ?? [])
    await panelOeffnen('Claude')
    return { pid, token, edit, fertig, lauf, changesVonClaude }
  }

  const laufAktion = (pid, laufId, aktion, body = {}) =>
    seitenPost(`/spur/project/${pid}/laeufe/${laufId}/${aktion}`, body)

  const karte = () => page.locator('.spur-lauf-karte')

  features.f13 = async () => {
    const { pid, token, edit, fertig, lauf, changesVonClaude } = await laufProjekt()
    ok(!(await edit({ alt: 'Alpha Satz.', neu: 'Alpha Satz. Von Claude eins.' })).fehler, 'Edit 1')
    ok(!(await edit({ alt: 'Gamma Satz.', neu: 'Gamma Satz. Von Claude zwei.' })).fehler, 'Edit 2')
    await fertig('Zwei Sätze ergänzt')
    await karte().getByText('Dateien: 1 · Änderungen: 2').waitFor({ timeout: 20000 })
    await karte().getByText('Zwei Sätze ergänzt').waitFor()

    await karte().getByRole('button', { name: 'Alle annehmen' }).click()
    await karte().getByText('Angenommen', { exact: true }).waitFor({ timeout: 20000 })
    await imEditor('Von Claude zwei.')
    ok((await changesVonClaude()).length === 0, 'Nach Annahme bleiben Changes')
    // Ohne Neuladen: Der offene Editor nimmt die Marken der angenommenen Einschübe weg.
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.cm-content .ol-cm-change-i')].some(e => e.textContent.includes('Von Claude')),
      null,
      { timeout: 10000 }
    )
    const angenommenerLauf = await lauf()
    const zweimal = await laufAktion(pid, angenommenerLauf.id, 'ablehnen')
    ok(zweimal.status === 409, `Abgeschlossener Lauf lässt sich ablehnen: ${zweimal.status}`)

    ok(!(await edit({ alt: 'Delta Satz.', neu: 'Delta Satz. Claude schreibt hier etwas.' })).fehler, 'Edit 3')
    ok(!(await edit({ alt: 'Alpha Satz.', neu: 'Alpha Satz. Und noch etwas.' })).fehler, 'Edit 4')
    await imEditor('Claude schreibt hier etwas.')
    await editorErsetzen('schreibt hier', 'schreibt nun hier')
    const zeilen = karte().locator('.spur-lauf-aenderung')
    await page.waitForFunction(() => document.querySelectorAll('.spur-lauf-aenderung').length >= 2, null, { timeout: 20000 })
    const vorher = await zeilen.count()
    await zeilen.filter({ hasText: 'Und noch etwas' }).getByRole('button', { name: 'Annehmen' }).click()
    await page.waitForFunction(n => document.querySelectorAll('.spur-lauf-aenderung').length === n - 1, vorher, { timeout: 20000 })
    ok((await zeilen.filter({ hasText: 'Und noch etwas' }).count()) === 0, 'Angenommene Zeile steht noch da')
    await imEditor('schreibt nun hier')

    const aktuell = await lauf()
    await anmelden('e2e-leser@example.org')
    await page.goto(`${BASE}/project/${pid}`)
    await page.locator('.cm-content').first().waitFor()
    const lesen = await laufAktion(pid, aktuell.id, 'annehmen')
    ok(lesen.status === 403, `read darf annehmen: ${lesen.status}`)

    await anmelden('e2e-review@example.org')
    const pruefer = await laufProjekt('e2e-review@example.org')
    ok(!(await pruefer.edit({ alt: 'Beta Satz', neu: 'Beta Satz, geprüft,' })).fehler, 'review kann nicht schreiben')
    await karte().waitFor({ timeout: 20000 })
    await karte().locator('.spur-lauf-aenderung').first().waitFor({ timeout: 20000 })
    ok(
      (await karte().getByRole('button', { name: /^(Annehmen|Alle annehmen)$/ }).count()) === 0,
      'review sieht Annehmen'
    )
    const anlegen = await werkzeug(pruefer.token, 'doc_create', {
      project_id: pruefer.pid, pfad: 'review.tex', inhalt: 'x', idempotenz_schluessel: schluessel(),
    })
    ok(anlegen.inhalt.fehler === 'keine_rechte', `review legt Dateien an: ${JSON.stringify(anlegen.inhalt)}`)

    const namen = (await mcp(token, 'tools/list')).daten.result.tools.map(w => w.name)
    ok(!namen.some(n => /annehm|accept/i.test(n)), `Annahme-Tool: ${namen}`)

    await anmelden('e2e-a@example.org')
    const extra = await laufProjekt()
    ok(!(await extra.edit({ alt: 'Extra Satz.', neu: 'Extra Satz von Claude.' }, 'extra.tex')).fehler, 'Edit extra')
    const docs = (await werkzeug(extra.token, 'doc_list', { project_id: pid })).inhalt.eintraege
    const extraId = docs.find(d => d.pfad === 'extra.tex').id
    await page.evaluate(
      async ([p, d]) => {
        const t = document.querySelector('meta[name="ol-csrfToken"]').content
        await fetch(`/project/${p}/doc/${d}`, { method: 'DELETE', headers: { 'X-Csrf-Token': t } })
      },
      [pid, extraId]
    )
    await karte().getByText('Datei gelöscht').waitFor({ timeout: 20000 })
  }

  features.f14 = async () => {
    await anmelden('e2e-a@example.org')
    const { pid, token, edit, lauf, changesVonClaude } = await laufProjekt()
    const offen = await lauf()
    if (offen?.status === 'offen') await laufAktion(pid, offen.id, 'ablehnen')

    ok(!(await edit({ alt: 'mit altem Wort', neu: 'mit neuem Wort' })).fehler, 'Ersetzung')
    ok(!(await edit({ alt: 'Gamma Satz.', neu: 'Gamma Satz. Ein langer Einschub von Claude.' })).fehler, 'Einschub')
    await imEditor('Ein langer Einschub von Claude.')
    await editorEinfuegen('Einschub von Claude', 'NUTZER ')
    await gespeichert(token, pid, 'NUTZER')
    const id = (await lauf()).id

    // Ein Stück des gespaltenen Einschubs abgelehnt: der ganze Einschub geht, der Nutzertext bleibt.
    const stueck = (await changesVonClaude()).find(c => c.op.i?.includes('Ein langer'))
    const einzeln = await laufAktion(pid, id, 'ablehnen', { change_ids: [stueck.id] })
    ok(einzeln.status === 200, `Einzeln ablehnen: ${einzeln.status}`)
    ok(
      !(await changesVonClaude()).some(c => /langer|Einschub von Claude/.test(c.op.i ?? '')),
      'Gespaltener Einschub nur teilweise abgelehnt'
    )
    await gespeichert(token, pid, 'Gamma Satz.NUTZER ')

    await page.goto(`${BASE}/project`)
    const veraltet = await laufAktion(pid, id, 'ablehnen', { change_ids: ['ffffffffffffffffffffffff'] })
    ok(veraltet.status === 200 && veraltet.daten.abgelehnt === 0, `Veraltete ID: ${JSON.stringify(veraltet)}`)
    const abgelehnt = await laufAktion(pid, id, 'ablehnen')
    ok(abgelehnt.status === 200, `Ablehnen: ${abgelehnt.status}`)

    await projektOeffnen('E2E Lauf')
    await imEditor('mit altem Wort')
    const text = await docText()
    ok(!text.includes('neuem'), 'Einschub nicht zurückgesetzt')
    ok(text.split('mit altem Wort').length === 2, 'Doppeltext nach Ablehnen')
    ok(text.includes('Gamma Satz.NUTZER ') && !text.includes('langer'), `Gespaltener Einschub: ${text}`)
    ok(
      !(await changesVonClaude()).some(c => /neuem|Einschub|altem/.test(c.op.i ?? c.op.d)),
      'Changes des Laufs bleiben nach Ablehnen'
    )

    const pruefer = await laufProjekt('e2e-review@example.org')
    ok(!(await pruefer.edit({ alt: 'Delta', neu: 'Delta vom Prüfer-Bot' })).fehler, 'review-Edit')
    const eigen = await laufAktion(pid, (await pruefer.lauf()).id, 'ablehnen')
    ok(eigen.status === 200, `review lehnt eigenen ab: ${eigen.status}`)

    const a = await laufProjekt()
    ok(!(await a.edit({ alt: 'Alpha', neu: 'Alpha fremd' })).fehler, 'Fremder Edit')
    const fremdId = (await a.lauf()).id
    await anmelden('e2e-review@example.org')
    await page.goto(`${BASE}/project/${pid}`)
    await page.locator('.cm-content').first().waitFor()
    const fremd = await laufAktion(pid, fremdId, 'ablehnen')
    ok(fremd.status >= 400, `review lehnt fremden ab: ${fremd.status}`)
  }

  features.f15 = async () => {
    const { pid, token, edit, fertig, lauf, changesVonClaude } = await laufProjekt()
    const offen = await lauf()
    if (offen?.status === 'offen') await laufAktion(pid, offen.id, 'ablehnen')
    ok(!(await edit({ alt: 'Gamma', neu: 'Gamma eins' })).fehler, 'Start')
    await karte().waitFor({ timeout: 20000 })
    // Erst auf die Antwort warten, dann klicken: sonst kann sie vor dem Warten schon da sein.
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/claude/automatik')),
      page.getByLabel('Automatisch annehmen, wenn ein Lauf ohne Probleme endet').check(),
    ])
    await fertig('Grüner Lauf')
    ok((await lauf()).status === 'angenommen', 'Grüner Lauf nicht angenommen')
    ok(!(await changesVonClaude()).some(c => c.op.i?.includes(' eins')), 'Changes nach Automatik')

    ok(!(await edit({ alt: 'Delta', neu: 'Delta \\footfullcite{x}' })).fehler, 'Roter Edit')
    await fertig('Roter Lauf')
    ok((await lauf()).status === 'fertig', 'Roter Lauf wurde angenommen')
    await karte().getByText('Bitte prüfen').waitFor({ timeout: 20000 })
    await laufAktion(pid, (await lauf()).id, 'ablehnen')

    const namen = (await mcp(token, 'tools/list')).daten.result.tools.map(w => w.name)
    ok(!namen.some(n => /automat|auto_accept/i.test(n)), 'Automatik per Token')
    const perToken = await page.request.put(`${BASE}/spur/project/${pid}/claude/automatik`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { an: false },
    })
    ok(perToken.status() === 403, `PUT ohne CSRF: ${perToken.status()}`)

    ok(!(await edit({ alt: 'Alpha', neu: 'Alpha rueck' })).fehler, 'Edit für Rücknahme')
    await fertig('Zum Zurücknehmen')
    ok((await lauf()).status === 'angenommen', 'Nicht angenommen')
    await karte().getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte().getByText('Zurückgenommen', { exact: true }).waitFor({ timeout: 20000 })
    ok(
      (await changesVonClaude()).some(c => c.op.d?.includes('rueck')),
      'Rücknahme erzeugt keine Track Changes'
    )
    await karte().getByText('Letzter Ausweg: Die Wiederherstellung').waitFor()

    ok(!(await edit({ alt: 'Beta', neu: 'Beta konflikt' })).fehler, 'Edit für Konflikt')
    await fertig('Konfliktlauf')
    await imEditor('Beta konflikt')
    await editorErsetzen('Beta konflikt', 'Beta Konflikt')
    await gespeichert(token, pid, 'Beta Konflikt')
    const vorher = await docText()
    await karte().getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte().getByText(/Konflikt in Zeile \d+/).waitFor({ timeout: 20000 })
    ok((await docText()) === vorher, 'Konflikt änderte Text')

    // Angenommene Löschung, danach eine Handänderung weiter oben: Die Rücknahme setzt die
    // Zeile an ihre alte Stelle, nicht an die alte Zeichenposition.
    const original = await docText()
    const zeile = original.split('\n').find(z => z.startsWith('Delta'))
    ok(!(await edit({ alt: `${zeile}\n`, neu: '' })).fehler, 'Löschung')
    await fertig('Zeile gelöscht')
    ok((await lauf()).status === 'angenommen', 'Löschung nicht angenommen')
    await page.waitForFunction(
      z => !window.overleaf.unstable.store.get('editor.view').state.doc.toString().includes(z),
      zeile,
      { timeout: 15000 }
    )
    await editorEinfuegen('Alpha', 'Ganz oben neu. ')
    await gespeichert(token, pid, 'Ganz oben neu. ')
    // Die Karte lädt alle 5 Sekunden: erst klicken, wenn sie den neuen Lauf zeigt.
    await karte().getByText('Zeile gelöscht').waitFor({ timeout: 20000 })
    await karte().getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte().getByText('Zurückgenommen', { exact: true }).waitFor({ timeout: 20000 })
    const erwartet = original.replace('Alpha', 'Ganz oben neu. Alpha')
    await page
      .waitForFunction(
        t => window.overleaf.unstable.store.get('editor.view').state.doc.toString() === t,
        erwartet,
        { timeout: 15000 }
      )
      .catch(() => {})
    ok((await docText()) === erwartet, `Rücknahme an falscher Stelle:\n${await docText()}\nerwartet:\n${erwartet}`)

    await anmelden('e2e-review@example.org')
    await laufProjekt('e2e-review@example.org')
    ok(
      (await page.getByLabel('Automatisch annehmen, wenn ein Lauf ohne Probleme endet').count()) === 0,
      'review sieht Automatik'
    )
    const reviewPut = await page.evaluate(async p => {
      const t = document.querySelector('meta[name="ol-csrfToken"]').content
      return (await fetch(`/spur/project/${p}/claude/automatik`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': t },
        body: JSON.stringify({ an: true }),
      })).status
    }, pid)
    ok(reviewPut === 403, `review setzt Automatik: ${reviewPut}`)
  }

  // P2: Recherche und Design
  features.p2f1 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Recherche')
    await panelOeffnen('Recherche')
    await paperSuchen('sleep memory consolidation')
    const treffer = paperTreffer('The memory function of sleep')
    await treffer.waitFor({ timeout: 30000 })
    await treffer.getByText('Susanne Diekelmann, Jan Born · 2010').waitFor()
    await treffer.getByText('Gefunden über OpenAlex, Crossref, Semantic Scholar').waitFor()
    const imPanel = await trefferDois()
    ok(imPanel.length >= 10, `Treffer auf Seite 1: ${imPanel.length}`)

    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Recherche')
    const { inhalt } = await werkzeug(token, 'paper_search', { project_id: pid, anfrage: 'sleep memory consolidation' })
    const perTool = inhalt.treffer.map(t => t.doi)
    ok(JSON.stringify(perTool) === JSON.stringify(imPanel), `paper_search: ${perTool} statt ${imPanel}`)

    await page.getByRole('button', { name: 'Nächste Seite' }).click()
    await sichtbar('Seite 2')
    await page.waitForFunction(() => !document.querySelector('.spur-panel-inhalt[aria-busy="true"]'))
    ok(!(await trefferDois()).includes(imPanel[0]), 'Seite 2 zeigt Seite 1')

    await fakeSteuern({ ausfall: ['s2'] })
    try {
      await paperSuchen('memory consolidation during sleep')
      await sichtbar('Semantic Scholar nicht erreichbar', 30000)
      await paperTreffer('The memory function of sleep').waitFor()
    } finally {
      await fakeSteuern({ ausfall: [] })
    }

    await fakeSteuern({ ausfall: [], protokollLeeren: true })
    await Promise.all(
      ['sleep replay', 'sleep spindles'].map(anfrage =>
        werkzeug(token, 'paper_search', { project_id: pid, anfrage })
      )
    )
    const abrufe = (await (await page.request.get(`${FAKE}/_protokoll`)).json()).abrufe
    const arxiv = abrufe.filter(a => a.dienst === 'arxiv').map(a => a.zeit)
    ok(arxiv.length === 2, `arXiv-Abrufe: ${arxiv.length}`)
    ok(Math.abs(arxiv[1] - arxiv[0]) >= 3000, `arXiv-Abstand ${Math.abs(arxiv[1] - arxiv[0])} ms`)

    await paperSuchen('xyzzy')
    await page.locator('.spur-panel-inhalt').getByText('Keine Treffer', { exact: true }).waitFor()
  }

  features.p2f2 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Recherche')
    await panelOeffnen('Recherche')
    await page.getByRole('tab', { name: 'Treffer' }).click()
    await paperSuchen('sleep memory consolidation')
    const treffer = paperTreffer('The memory function of sleep')
    await treffer.getByRole('button', { name: 'Zitiert von', exact: true }).click()
    const zitiertVon = treffer.getByRole('region', { name: 'Zitiert von' })
    await zitiertVon.getByText('Sleep spindles predict overnight memory consolidation').waitFor()
    await treffer.getByRole('button', { name: 'Zitiert', exact: true }).click()
    const zitiert = treffer.getByRole('region', { name: 'Zitiert', exact: true })
    await zitiert.getByText('Sleep and Memory', { exact: true }).waitFor()
    const imPanel = await zitiertVon.locator('.spur-paper-doi').allTextContents()
    ok(imPanel.length === 3, `Zitiert von: ${imPanel}`)

    const token = 'spur_e2e_fake'
    const { inhalt } = await werkzeug(token, 'paper_citations', { doi: '10.1038/nrn2762', richtung: 'zitiert_von' })
    const perTool = inhalt.treffer.map(t => t.doi)
    ok(JSON.stringify(perTool) === JSON.stringify(imPanel), `paper_citations: ${perTool} statt ${imPanel}`)
    const referenzen = (await werkzeug(token, 'paper_citations', { doi: '10.1038/nrn2762', richtung: 'zitiert' })).inhalt
    ok(referenzen.treffer.map(t => t.doi).join() === '10.5555/spur.2024.001', `zitiert: ${JSON.stringify(referenzen)}`)

    await page.getByRole('tab', { name: 'Suchprotokoll' }).click()
    const eintrag = page.locator('.spur-protokoll .spur-zeile', { hasText: 'sleep memory consolidation' }).filter({ hasText: 'OpenAlex' }).first()
    await eintrag.waitFor()
    ok(/OpenAlex · \d+ Treffer · \d/.test(await eintrag.textContent()), `Protokolleintrag: ${await eintrag.textContent()}`)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Protokoll exportieren' }).click(),
    ])
    ok(download.suggestedFilename() === 'suchprotokoll.csv', `Datei: ${download.suggestedFilename()}`)
    const csv = await (await page.request.get(download.url())).text()
    const zeilen = csv.trim().split('\n')
    ok(zeilen[0] === 'Datum,Datenbank,Anfrage,Trefferzahl', `Kopf: ${zeilen[0]}`)
    ok(zeilen.some(z => /^\d{4}-\d\d-\d\dT[^,]+,OpenAlex,sleep memory consolidation,\d+$/.test(z)), `CSV:\n${csv}`)
  }

  features.p2f3 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Recherche')
    await panelOeffnen('Recherche')
    await page.getByRole('tab', { name: 'Treffer' }).click()
    await paperSuchen('sleep memory consolidation')
    const keller = paperTreffer('Sleep spindles predict overnight memory consolidation')
    await keller.getByRole('button', { name: 'Aufnehmen' }).click()
    await keller.getByText('Aufgenommen als „keller2014“: Quelle mit PDF und Eintrag in der .bib').waitFor({ timeout: 30000 })
    await keller.getByRole('button', { name: 'Aufnehmen' }).click()
    await keller.getByText('Bereits vorhanden', { exact: true }).waitFor()

    const arxiv = paperTreffer('Sleep-like replay improves memory consolidation in artificial neural networks')
    await arxiv.getByRole('button', { name: 'Aufnehmen' }).click()
    await arxiv.getByText('Aufgenommen als „smith2024“', { exact: false }).waitFor({ timeout: 30000 })

    await panelOeffnen('Quellen')
    const zeile = name => page.locator('.spur-panel .spur-zeile', { hasText: name })
    await zeile('keller2014.pdf').getByText('2 Seiten · Text erkannt').waitFor()
    await zeile('smith2024.pdf').getByText('Volltext nur in diesem Projekt').waitFor()
    ok((await zeile('keller2014.pdf').getByText('Volltext nur in diesem Projekt').count()) === 0, 'keller nur im Projekt')

    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Recherche')
    const bib = (await werkzeug(token, 'doc_read', { project_id: pid, pfad: 'references.bib' })).inhalt.text
    ok(bib.includes('@article{keller2014,') && bib.includes('doi = {10.1371/journal.pone.0099999}'), `.bib:\n${bib}`)
    ok(bib.includes('title = {Sleep spindles predict overnight memory consolidation}'), `.bib-Titel:\n${bib}`)
    ok(bib.includes('@article{smith2024,') && bib.includes('author = {Smith, Alice and Lee, Ben}'), `.bib arXiv:\n${bib}`)

    // Der arXiv-Volltext ohne Lizenz bleibt im Projekt: „Holen“ in ein anderes Projekt nimmt nur keller2014 mit.
    await projektOeffnen('E2E Recherche Ziel')
    await panelOeffnen('Quellen')
    await quelleHolen('E2E Recherche')
    await sichtbar('1 Quelle geholt')
    await zeile('keller2014.pdf').waitFor()
    ok((await zeile('smith2024.pdf').count()) === 0, 'arXiv-Volltext wurde mitkopiert')

    const unbekannt = await werkzeug(token, 'source_add', { project_id: pid, doi: '10.9999/gibt.es.nicht' })
    ok(unbekannt.fehler && unbekannt.inhalt.fehler === 'doi_nicht_gefunden' && unbekannt.inhalt.detail === 'DOI nicht gefunden', `source_add: ${JSON.stringify(unbekannt.inhalt)}`)
  }

  features.p2f4 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Beschaffung')
    await panelOeffnen('Recherche')
    await page.getByRole('tab', { name: 'Treffer' }).click()
    await paperSuchen('sleep memory consolidation')
    for (const titel of ['Sleep and Memory', 'The memory function of sleep']) {
      const treffer = paperTreffer(titel)
      ok((await treffer.getByRole('button', { name: 'Aufnehmen' }).count()) === 0, `${titel} wäre frei`)
      await treffer.getByRole('button', { name: 'Auf die Beschaffungsliste' }).click()
      await treffer.getByText('Steht jetzt auf der Beschaffungsliste').waitFor()
    }

    await page.getByRole('tab', { name: 'Beschaffung' }).click()
    const eintrag = titel => page.locator('.spur-panel-inhalt .spur-paper', { has: page.getByText(titel, { exact: true }) })
    await eintrag('Sleep and Memory').getByText('Offen', { exact: true }).waitFor()
    await sichtbar('Offen: 2 · Beschafft: 0')

    await page.getByLabel('Link zur Bibliothek').fill('https://bibliothek.example/?doi={doi}')
    await page.getByRole('button', { name: 'Speichern' }).click()
    await sichtbar('Link zur Bibliothek gespeichert')
    const link = eintrag('Sleep and Memory').getByRole('link', { name: 'In der Bibliothek holen' })
    ok((await link.getAttribute('href')) === 'https://bibliothek.example/?doi=10.5555/spur.2024.001', `Link: ${await link.getAttribute('href')}`)

    const dois = text => [...text.matchAll(/10\.\d{4,9}\/[^\s},"]+/g)].map(t => t[0]).sort().join()
    const erwartet = '10.1038/nrn2762,10.5555/spur.2024.001'
    for (const format of ['.bib', '.ris', 'CSV']) {
      const knopf = page.getByRole('link', { name: `Als ${format} exportieren` })
      const [download] = await Promise.all([page.waitForEvent('download'), knopf.click()])
      const text = await (await page.request.get(download.url())).text()
      ok(dois(text) === erwartet, `${format}: ${dois(text)}`)
    }

    await page.getByLabel('Beschafftes PDF wählen').setInputFiles(`${FIXTURES}/smith2024.pdf`)
    await sichtbar('„smith2024.pdf“ ist zugeordnet: beschafft', 30000)
    await eintrag('Sleep and Memory').getByText('Beschafft', { exact: true }).waitFor()

    await page.getByLabel('Beschafftes PDF wählen').setInputFiles(`${FIXTURES}/scan.pdf`)
    await sichtbar('In „scan.pdf“ steht keine bekannte DOI. Zu welchem Eintrag gehört das PDF?', 30000)
    await page.getByLabel('Eintrag', { exact: true }).selectOption({ label: 'The memory function of sleep' })
    await page.getByRole('button', { name: 'Zuordnen' }).click()
    await sichtbar('„scan.pdf“ ist zugeordnet: beschafft')
    await eintrag('The memory function of sleep').getByText('Beschafft', { exact: true }).waitFor()
    await sichtbar('Offen: 0 · Beschafft: 2')
  }

  features.p2f5 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Import')
    await panelOeffnen('Quellen')
    const dialog = page.locator('.modal')
    const zotero = async () => {
      await page.getByRole('button', { name: 'Importieren', exact: true }).click()
      await dialog.getByLabel('Sammlung').selectOption({ label: 'Schlaf und Gedächtnis' })
      await dialog.getByRole('button', { name: 'Aus Zotero importieren' }).click()
    }
    const dateien = async () =>
      await dialog.getByLabel('PDFs wählen (mehrere möglich)').setInputFiles(
        ['smith2024.pdf', 'retracted.pdf', 'ersetzen/kapitel.tex'].map(d => `${FIXTURES}/${d}`)
      )
    const zeile = name => dialog.locator('.spur-import-liste li', { hasText: name })

    await zotero()
    await dialog.getByText('Neu in der .bib: 2 · Schon vorhanden: 0').waitFor({ timeout: 20000 })
    await zeile('diekelmann_memory_2010').getByText('neu in der .bib').waitFor()
    await zeile('keller_spindles_2014').getByText('neu in der .bib').waitFor()

    await dateien()
    await zeile('smith2024.pdf').getByText('aufgenommen', { exact: true }).waitFor({ timeout: 30000 })
    await zeile('retracted.pdf').getByText('aufgenommen', { exact: true }).waitFor({ timeout: 30000 })
    await zeile('kapitel.tex').getByText('Dieser Dateityp wird nicht unterstützt', { exact: false }).waitFor({ timeout: 30000 })
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    await dialog.waitFor({ state: 'detached' })
    const quellen = page.locator('.spur-panel .spur-liste .spur-zeile-link')
    await page.locator('.spur-panel').getByRole('button', { name: 'retracted.pdf' }).waitFor()
    ok((await quellen.count()) === 2, `Quellen: ${await quellen.allTextContents()}`)

    await zotero()
    await dialog.getByText('Neu in der .bib: 0 · Schon vorhanden: 2').waitFor({ timeout: 20000 })
    await dateien()
    await zeile('smith2024.pdf').getByText('schon vorhanden').waitFor({ timeout: 30000 })
    await zeile('retracted.pdf').getByText('schon vorhanden').waitFor({ timeout: 30000 })
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    ok((await quellen.count()) === 2, `Dubletten: ${await quellen.allTextContents()}`)

    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Import')
    const bib = (await werkzeug(token, 'doc_read', { project_id: pid, pfad: 'references.bib' })).inhalt.text
    ok(bib.split('@article{diekelmann_memory_2010,').length === 2, `.bib:\n${bib}`)
    ok(bib.split('@article{keller_spindles_2014,').length === 2, `.bib:\n${bib}`)
  }

  features.p2f6 = async () => {
    const SATZ = 'Sleep supports the consolidation of declarative memory.'
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Literatur')
    await panelOeffnen('Quellen')
    await hochladen('smith2024.pdf')
    const vorschauOeffnen = async () => {
      await page.getByRole('button', { name: 'smith2024.pdf' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
      await page.getByRole('button', { name: 'Nächste Seite' }).click()
      await sichtbar('Seite 347 (PDF-Seite 3 von 8)')
    }
    await vorschauOeffnen()
    await textMarkieren(SATZ)
    await page.getByRole('button', { name: 'Zitat speichern' }).click()
    const zitat = page.locator('.spur-zitate li', { hasText: SATZ }).first()
    await zitat.waitFor()
    const notizQuelle = page.getByLabel('Notiz zur Quelle')
    await notizQuelle.fill('Gute Methodik, kleine Stichprobe')
    await page.locator('.spur-notiz', { has: notizQuelle }).getByRole('button', { name: 'Notiz speichern' }).click()
    await page.locator('.spur-notiz', { has: notizQuelle }).getByText('Gespeichert').waitFor()
    await zitat.getByLabel('Notiz zum Zitat').fill('Kernaussage für Kapitel 2')
    await zitat.getByRole('button', { name: 'Notiz speichern' }).click()
    await zitat.getByText('Gespeichert').waitFor()

    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Quellen')
    await vorschauOeffnen()
    await page.waitForFunction(() => document.querySelector('.spur-notiz textarea')?.value)
    ok((await page.getByLabel('Notiz zur Quelle').inputValue()) === 'Gute Methodik, kleine Stichprobe', 'Quellennotiz weg')
    const zitatNachher = page.locator('.spur-zitate li', { hasText: SATZ }).first()
    ok((await zitatNachher.getByLabel('Notiz zum Zitat').inputValue()) === 'Kernaussage für Kapitel 2', 'Zitatnotiz weg')
    await page.getByRole('button', { name: 'Zurück' }).first().click()

    const dialog = page.locator('.modal')
    const matrixOeffnen = async () => {
      await page.getByRole('button', { name: 'Literaturmatrix' }).click()
      await dialog.locator('caption').waitFor({ timeout: 10000 })
    }
    await matrixOeffnen()
    await dialog.getByPlaceholder('Neue Spalte, etwa „Methode“').fill('Methode')
    await dialog.getByRole('button', { name: 'Spalte hinzufügen' }).click()
    await dialog.getByRole('columnheader', { name: 'Methode' }).waitFor()
    await dialog.getByRole('rowheader', { name: 'smith2024.pdf' }).waitFor()

    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Literatur')
    const quelle = (await werkzeug(token, 'sources_list', { project_id: pid })).inhalt.eintraege[0]
    const VORSCHLAG = 'Zwei Nächte, gemischte Modelle'
    const vorschlag = await werkzeug(token, 'matrix_suggest', { project_id: pid, source_id: quelle.id, spalte: 'Methode', text: VORSCHLAG })
    ok(!vorschlag.fehler, `matrix_suggest: ${JSON.stringify(vorschlag.inhalt)}`)
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    await matrixOeffnen()
    const zelle = dialog.locator('.spur-matrix-zelle', { has: page.getByLabel('Methode: smith2024.pdf') })
    await zelle.getByText(VORSCHLAG).waitFor()
    ok((await zelle.getByLabel('Methode: smith2024.pdf').inputValue()) === '', 'Vorschlag ohne Bestätigung übernommen')
    await zelle.getByRole('button', { name: 'Übernehmen' }).click()
    await page.waitForFunction(t => document.querySelector('.spur-matrix-zelle input')?.value === t, VORSCHLAG)
    ok((await zelle.getByText('Vorschlag von Claude:').count()) === 0, 'Vorschlag bleibt stehen')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('link', { name: 'Als CSV exportieren' }).click(),
    ])
    const csv = await (await page.request.get(download.url())).text()
    ok(csv.startsWith('Quelle,Key,Methode\n') && csv.includes(`smith2024.pdf,smith2024,"${VORSCHLAG}"`), `CSV:\n${csv}`)
    await dialog.getByRole('button', { name: 'Schließen' }).click()

    // 300 Zeilen: seitenweise, Eingaben wirken auch auf späteren Seiten.
    await projektOeffnen('E2E Viele')
    await panelOeffnen('Quellen')
    const start = Date.now()
    await matrixOeffnen()
    await dialog.getByText('Zeilen 1–50 von 300').waitFor()
    ok(Date.now() - start < 5000, `Matrix öffnet in ${Date.now() - start} ms`)
    await dialog.getByPlaceholder('Neue Spalte, etwa „Methode“').fill('Ergebnis')
    await dialog.getByRole('button', { name: 'Spalte hinzufügen' }).click()
    await dialog.getByRole('columnheader', { name: 'Ergebnis' }).waitFor()
    await dialog.getByRole('button', { name: 'Nächste Seite' }).click()
    await dialog.getByText('Zeilen 51–100 von 300').waitFor()
    const feld = dialog.getByLabel('Ergebnis: quelle-077.pdf')
    await feld.fill('signifikant')
    await feld.blur()
    await page.waitForResponse(r => r.url().includes('/matrix') && r.request().method() === 'GET')
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    const viele = await projektId(token, 'E2E Viele')
    const export300 = await (await page.request.get(`${BASE}/spur/project/${viele}/matrix.csv`)).text()
    const zeilen = export300.trim().split('\n')
    ok(zeilen.length === 301, `CSV mit ${zeilen.length} Zeilen`)
    ok(zeilen.includes('quelle-077.pdf,quelle-77,signifikant'), `Zelle fehlt: ${zeilen.find(z => z.startsWith('quelle-077'))}`)
  }

  async function kompiliertBeiClaude(token, pid) {
    const start = await werkzeug(token, 'compile', { project_id: pid })
    ok(!start.fehler && start.inhalt.job_id && start.inhalt.status === 'laeuft', `compile: ${JSON.stringify(start.inhalt)}`)
    for (let i = 0; i < 240; i++) {
      const { inhalt } = await werkzeug(token, 'job_status', { job_id: start.inhalt.job_id })
      if (inhalt.status !== 'laeuft') return inhalt
      await page.waitForTimeout(500)
    }
    fail('Compile wurde nicht fertig')
  }

  async function seitenPng(token, pid, seite) {
    const { daten } = await mcp(token, 'tools/call', { name: 'page_image', arguments: { project_id: pid, seite } })
    const [inhalt] = daten.result.content
    ok(!daten.result.isError && inhalt.type === 'image' && inhalt.mimeType === 'image/png', `page_image: ${JSON.stringify(daten.result).slice(0, 300)}`)
    const png = Buffer.from(inhalt.data, 'base64')
    ok(png.subarray(1, 4).toString() === 'PNG', 'Kein PNG')
    return { breite: png.readUInt32BE(16), hoehe: png.readUInt32BE(20) }
  }

  features.p2f7 = async () => {
    await anmelden('e2e-a@example.org')
    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Compile')
    const job = await kompiliertBeiClaude(token, pid)
    ok(job.status === 'fertig' && job.ergebnis.compile === 'success', `job_status: ${JSON.stringify(job)}`)
    const seite = await seitenPng(token, pid, 2)
    ok(seite.hoehe > seite.breite, `Artikelseite ${seite.breite}×${seite.hoehe}`)
    const zuWeit = await werkzeug(token, 'page_image', { project_id: pid, seite: 3 })
    ok(zuWeit.fehler && zuWeit.inhalt.fehler === 'seite_fehlt', `Seite 3: ${JSON.stringify(zuWeit.inhalt)}`)

    const kaputt = await projektId(token, 'E2E Kaputt')
    ok((await kompiliertBeiClaude(token, kaputt)).status === 'fertig', 'Kaputtes Dokument nicht fertig')
    const { inhalt: log } = await werkzeug(token, 'compile_log', { project_id: kaputt })
    const fehler = log.fehler.find(f => f.meldung === 'Undefined control sequence.')
    ok(fehler?.zeile === 4 && fehler.kontext.includes('\\kaputtesmakro'), `compile_log: ${JSON.stringify(log.fehler)}`)

    const folien = await projektId(token, 'E2E Folien')
    const BEAMER = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Schlaf und Gedächtnis}
Slow-wave sleep stabilisiert Gedächtnisspuren.
\end{frame}
\begin{frame}{Ergebnisse}
\begin{itemize}
\item Zwei Nächte
\item Gemischte Modelle
\end{itemize}
\end{frame}
\end{document}
`
    const edit = await werkzeug(token, 'doc_edit', { project_id: folien, pfad: 'main.tex', alt: 'Folien folgen.\n', neu: BEAMER, idempotenz_schluessel: `folien-${Date.now()}` })
    ok(!edit.fehler, `doc_edit: ${JSON.stringify(edit.inhalt)}`)
    const quelltext = (await werkzeug(token, 'doc_read', { project_id: folien, pfad: 'main.tex' })).inhalt.text
    ok(quelltext.includes('\\begin{frame}{Ergebnisse}'), `Quelltext: ${quelltext}`)
    const folienJob = await kompiliertBeiClaude(token, folien)
    ok(folienJob.ergebnis.compile === 'success', `Beamer: ${JSON.stringify(folienJob)}`)
    const folie = await seitenPng(token, folien, 2)
    ok(folie.breite > folie.hoehe, `Folie ${folie.breite}×${folie.hoehe} ist kein Querformat`)
  }

  features.p2f8 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Zahlen')
    const pid = page.url().split('/').pop()
    const token = await neuesToken()
    const aufruf = (name, args) => werkzeug(token, name, { project_id: pid, idempotenz_schluessel: schluessel(), ...args })
    await panelOeffnen('Claude')

    const anlegen = await aufruf('doc_create', { pfad: 'ergebnisse.tex', inhalt: '\\newcommand{\\nGesamt}{412}\n' })
    ok(!anlegen.fehler && anlegen.inhalt.zahlen_ohne_beleg.length === 0, `doc_create: ${JSON.stringify(anlegen.inhalt)}`)
    const changes = (await jsonVon(`/project/${pid}/ranges`)).flatMap(d => d.ranges?.changes ?? [])
    ok(changes.some(c => c.op.i?.includes('\\newcommand{\\nGesamt}{412}')), `Kein Track Change: ${JSON.stringify(changes)}`)

    const einbinden = await aufruf('doc_edit', {
      pfad: 'main.tex',
      alt: 'Platzhalter.',
      neu: '\\input{ergebnisse}\nInsgesamt nahmen \\nGesamt{} Personen teil.',
    })
    ok(!einbinden.fehler && einbinden.inhalt.zahlen_ohne_beleg.length === 0, `Makro: ${JSON.stringify(einbinden.inhalt)}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Zahlen eingebunden' })
    await karte().getByText('Zahlen eingebunden').waitFor({ timeout: 20000 })
    ok((await karte().getByText('Zahl ohne Beleg').count()) === 0, 'Warnung trotz Makro')

    await kompilieren()
    await page.waitForFunction(
      () => [...document.querySelectorAll('.pdf-viewer .textLayer')].some(e => /Insgesamt nahmen\s*412\s*Personen/.test(e.textContent)),
      null,
      { timeout: 60000 }
    )

    const frei = await aufruf('doc_edit', { pfad: 'main.tex', alt: 'Personen teil.', neu: 'Personen teil. Davon waren 412 Personen erwachsen.' })
    ok(JSON.stringify(frei.inhalt.zahlen_ohne_beleg) === '["412"]', `Fließtext: ${JSON.stringify(frei.inhalt)}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Satz mit Zahl' })
    await karte().getByText('Satz mit Zahl').waitFor({ timeout: 20000 })
    await karte().getByText('Zahl ohne Beleg', { exact: true }).waitFor()
    await karte().getByText('„412“ in main.tex: Bitte als Makro aus ergebnisse.tex einsetzen.').waitFor()

    const erlaubt = await aufruf('doc_edit', {
      pfad: 'main.tex',
      alt: 'erwachsen.',
      neu: 'erwachsen. Seit 2019 belegen das Studien \\autocite[S.~12]{smith2024} auf Seite 5 mit $n = 30$.',
    })
    ok(erlaubt.inhalt.zahlen_ohne_beleg.length === 0, `Jahr, Seite, Mathe: ${JSON.stringify(erlaubt.inhalt)}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Nur Jahr, Seite und Mathe' })
    await karte().getByText('Nur Jahr, Seite und Mathe').waitFor({ timeout: 20000 })
    ok((await karte().getByText('Zahl ohne Beleg').count()) === 0, 'Warnung für Jahr, Seite oder Mathe')
  }

  features.p2f9 = async () => {
    await anmelden('e2e-a@example.org')
    const dialog = page.locator('.modal')
    const offenlegungOeffnen = async () => {
      await panelOeffnen('Claude')
      await page.getByRole('button', { name: 'KI-Offenlegung' }).click()
      await dialog.locator('.spur-offenlegung-text').waitFor({ timeout: 20000 })
    }
    await projektOeffnen('E2E Recherche')
    await offenlegungOeffnen()
    await dialog.getByText('Keine KI-Nutzung protokolliert.').waitFor()
    ok(await dialog.getByRole('button', { name: 'Als .tex-Abschnitt einfügen' }).isDisabled(), 'Einfügen ohne Läufe')
    await dialog.getByRole('button', { name: 'Schließen' }).click()

    await projektOeffnen('E2E Offenlegung')
    const pid = page.url().split('/').pop()
    const token = await neuesToken()
    const edit = (alt, neu) => werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', alt, neu, idempotenz_schluessel: schluessel() })
    ok(!(await edit('Alpha.', 'Alpha, klarer.')).fehler, 'Edit 1')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Einleitung überarbeitet' })
    const erster = (await werkzeug(token, 'run_status', { project_id: pid })).inhalt.lauf
    ok((await laufAktion(pid, erster.id, 'annehmen')).status < 300, 'Annehmen')
    ok(!(await edit('Omega.', 'Omega mit Fazit.')).fehler, 'Edit 2')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Fazit ergänzt' })

    await offenlegungOeffnen()
    const text = await dialog.locator('.spur-offenlegung-text').textContent()
    for (const teil of [
      'Protokolliert sind 2 Läufe am',
      'Zweck: Einleitung überarbeitet; Fazit ergänzt.',
      'Betroffene Dateien: main.tex.',
      'Angenommen wurden 1 von 1 abgeschlossenen Läufen (100 %).',
      '1 Lauf wartet noch auf eine Entscheidung.',
    ]) {
      ok(text.includes(teil), `Offenlegung ohne „${teil}“:\n${text}`)
    }
    ok(!text.includes('Modell'), 'Modell ohne Angabe genannt')
    await dialog.getByLabel('Modell (optional, wird nur genannt, wenn Sie es eintragen)').fill('Claude Opus 5.5')
    await dialog.getByText('Modell: Claude Opus 5.5.', { exact: false }).waitFor()

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await dialog.getByRole('button', { name: 'Text kopieren' }).click()
    await dialog.getByText('Kopiert', { exact: true }).waitFor()
    const kopiert = await page.evaluate(() => navigator.clipboard.readText())
    ok(kopiert.includes('Zweck: Einleitung überarbeitet; Fazit ergänzt.'), `Zwischenablage: ${kopiert}`)

    await dialog.getByRole('button', { name: 'Als .tex-Abschnitt einfügen' }).click()
    await dialog.getByText('In ki-offenlegung.tex eingefügt.', { exact: false }).waitFor()
    const tex = (await werkzeug(token, 'doc_read', { project_id: pid, pfad: 'ki-offenlegung.tex' })).inhalt.text
    ok(tex.startsWith('\\section*{Nutzung von KI-Werkzeugen}\n') && tex.includes('Modell: Claude Opus 5.5.'), `.tex:\n${tex}`)
    await dialog.getByRole('button', { name: 'Schließen' }).click()
  }

  features.p2f10 = async () => {
    const AUS = { ausfall: [], schalter: {} }
    const modellVorhanden = async () => (await (await page.request.get(`${FAKE}/_semantik`)).json()).modellVorhanden
    const stichworte = async () => {
      await suchen('consolidation')
      const liste = page.locator('.spur-panel-inhalt > .spur-liste .spur-zeile')
      // Die Quellenliste hat dieselbe Klasse: erst lesen, wenn ein Suchtreffer mit Seite da ist.
      await liste.filter({ hasText: 'S. 347' }).first().waitFor()
      return await liste.allTextContents()
    }
    const panelNeu = async () => {
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
    }
    await fakeSteuern(AUS)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Semantik')
    await panelOeffnen('Quellen')
    await hochladen('smith2024.pdf')
    ok((await page.getByText('Sinngemäß suchen').count()) === 0, 'Hinweis auf semantische Suche ohne Schalter')
    ok(!(await modellVorhanden()), 'Modell im Volume ohne Schalter')
    const vorher = await stichworte()
    const token = 'spur_e2e_fake'
    const pid = await projektId(token, 'E2E Semantik')
    const bericht = async () => JSON.stringify((await werkzeug(token, 'check_report', { project_id: pid })).inhalt.eintraege)
    const berichtVorher = await bericht()
    ok(berichtVorher.includes('exakt'), `Prüfbericht ohne Status: ${berichtVorher}`)

    try {
      await fakeSteuern({ ausfall: [], schalter: { SPUR_SEMANTIC_SEARCH: 'true', SPUR_FAKE_EMBEDDINGS: '1' } })
      await panelNeu()
      await sichtbar('Indexiert 3 von 8 Seiten', 30000)
      await sichtbar('Bereit: 8 Seiten indexiert', 30000)
      ok(!(await modellVorhanden()), 'Fake-Einbettung legt ein Modell ab')
      await page.getByRole('searchbox', { name: 'Sinngemäß suchen' }).fill('memories get stronger in deep slow wave sleep')
      await page.locator('.spur-semantik').getByRole('button', { name: 'Suchen' }).click()
      const erster = page.locator('.spur-semantik .spur-zeile').first()
      await erster.waitFor()
      const text = await erster.textContent()
      ok(text.includes('smith2024.pdf') && text.includes('S. 347') && text.includes('Sleep supports the consolidation'), `Erster Treffer: ${text}`)
      await page.locator('.spur-semantik').getByText('Sie belegen kein Zitat.', { exact: false }).waitFor()
      ok((await bericht()) === berichtVorher, 'Semantische Treffer ändern den Prüfbericht')
    } finally {
      await fakeSteuern(AUS)
    }

    await panelNeu()
    await page.getByRole('searchbox', { name: 'Quellen durchsuchen' }).waitFor()
    ok((await page.getByText('Sinngemäß suchen').count()) === 0, 'Semantik nach dem Ausschalten sichtbar')
    const nachher = await stichworte()
    ok(JSON.stringify(nachher) === JSON.stringify(vorher), `Stichwortsuche verändert:\n${vorher}\n${nachher}`)
  }

  // P4: Mehr Quellen und Team. Schlüssel p4f1 … p4f4, damit sie neben P1 stehen können.

  // Führt Schritte auf einer zweiten Seite aus (eigene Sitzung); die Helfer arbeiten dann dort.
  async function alsSeite(andere, schritte) {
    const vorher = page
    page = andere
    try {
      return await schritte()
    } finally {
      page = vorher
    }
  }

  async function zweiteSeite() {
    const kontext = await page.context().browser().newContext()
    const neu = await kontext.newPage()
    neu.on('pageerror', beiFehler)
    await neu.addInitScript(() => {
      window.addEventListener('beforeunload', e => e.stopImmediatePropagation(), true)
    })
    return { seite: neu, schliessen: () => kontext.close() }
  }

  async function quelleSeite3(datei) {
    await page.getByRole('button', { name: datei }).click()
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Nächste Seite' }).click()
    await sichtbar('Seite 347 (PDF-Seite 3 von 8)')
    await page.locator('.spur-seitentext', { hasText: 'Sleep supports' }).waitFor()
  }

  features.p4f1 = async () => {
    const SATZ_A = 'Sleep supports the consolidation of declarative memory.'
    const SATZ_B = 'Memory traces are strengthened during slow-wave sleep'
    // B wartet mit offener Quelle; A markiert in einer zweiten Sitzung.
    await anmelden('e2e-team-b@example.org')
    await projektOeffnen('E2E Team')
    await panelOeffnen('Quellen')
    await quelleSeite3('smith2024.pdf')
    await sichtbar('Markieren Sie oben Text und speichern Sie ihn als Zitat.')

    const a = await zweiteSeite()
    try {
      await alsSeite(a.seite, async () => {
        await anmelden('e2e-team-a@example.org')
        await projektOeffnen('E2E Team')
        await panelOeffnen('Quellen')
        await quelleSeite3('smith2024.pdf')
        await textMarkieren(SATZ_A)
        await page.getByRole('button', { name: 'Zitat speichern' }).click()
        await sichtbar(`„${SATZ_A}“`)
        await sichtbar(/S\. 347 · von Ihnen/)
        // Zurück zur Liste: Dort erscheint gleich der Hinweis auf die Zuweisung.
        await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
        await page.getByRole('button', { name: 'smith2024.pdf' }).waitFor()
      })

      // Live bei B, ohne Neuladen.
      await sichtbar(/S\. 347 · von Anna Autor/)
      const zeile = page.locator('.spur-zitate li', { hasText: SATZ_A })
      await zeile.getByRole('button', { name: 'Kommentieren' }).click()
      await zeile.getByLabel('Kommentar').fill('Bitte die Seitenzahl prüfen.')
      await zeile.getByLabel('Zuweisen an').selectOption({ label: 'Anna Autor' })
      await zeile.getByRole('button', { name: 'Kommentar senden' }).click()
      await zeile.getByText('Zugewiesen an Anna Autor').waitFor()
      await zeile.getByText('Bitte die Seitenzahl prüfen.').waitFor()

      await alsSeite(a.seite, async () => {
        await sichtbar(`Ben Berater hat Ihnen ein Zitat zugewiesen: „${SATZ_A}“ (smith2024.pdf, S. 347)`)
        await page.getByRole('button', { name: 'Öffnen', exact: true }).click()
        await sichtbar('Seite 347 (PDF-Seite 3 von 8)')
        await sichtbar('Zugewiesen an Anna Autor')
        await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
        await page.getByRole('button', { name: 'Erledigt' }).click()
        await page.getByRole('button', { name: 'Erledigt' }).waitFor({ state: 'detached' })
      })
    } finally {
      await a.schliessen()
    }

    // Filter „Von mir“: B markiert selbst, sieht dann nur das eigene Zitat.
    await textMarkieren(SATZ_B)
    await page.getByRole('button', { name: 'Zitat speichern' }).click()
    await sichtbar(`„${SATZ_B}“`)
    await page.getByText('Von mir', { exact: true }).click()
    await page.getByText(`„${SATZ_A}“`).waitFor({ state: 'detached' })
    ok(await page.getByText(`„${SATZ_B}“`).isVisible(), 'Eigenes Zitat fehlt im Filter')
    await page.getByText('Alle', { exact: true }).click()
    await sichtbar(`„${SATZ_A}“`)

    // Leserin: sieht die Markierungen, legt keine an.
    await anmelden('e2e-leser@example.org')
    await projektOeffnen('E2E Team')
    await panelOeffnen('Quellen')
    await quelleSeite3('smith2024.pdf')
    await sichtbar(/S\. 347 · von Anna Autor/)
    await sichtbar(/S\. 347 · von Ben Berater/)
    ok(
      (await page.getByRole('button', { name: 'Zitat speichern' }).count()) === 0,
      'Leserin sieht „Zitat speichern“'
    )
    const pid = page.url().split('/project/')[1]
    const quelleId = await page.evaluate(async p => {
      const r = await fetch(`/spur/project/${p}/quellen`)
      return (await r.json()).quellen[0].id
    }, pid)
    const versuch = await seitenPost(`/spur/project/${pid}/quellen/${quelleId}/zitate`, {
      seite: 3,
      text: SATZ_A,
    })
    ok(versuch.status === 403, `Leserin markiert: ${versuch.status}`)
  }

  // Fügt ein gespeichertes Zitat vor \printbibliography ein und wartet auf den Text im Editor.
  async function vorBibliographieEinfuegen(zitat, erwartet) {
    await page.evaluate(() => {
      const view = window.overleaf.unstable.store.get('editor.view')
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('\\printbibliography') } })
    })
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/einfuegen') && r.ok()),
      zitat.getByRole('button', { name: 'Einfügen' }).click(),
    ])
    await page.waitForFunction(
      text => window.overleaf.unstable.store.get('editor.view').state.doc.toString().includes(text),
      erwartet
    )
  }

  features.p4f2 = async () => {
    const SATZ = 'Short naps restore attention in night shift workers.'
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Scan')
    await panelOeffnen('Quellen')
    const zeile = page.locator('.spur-liste li', { hasText: 'scan.pdf' })
    await zeile.getByText('2 Seiten · Kein Text, nicht prüfbar').waitFor()
    await zeile.getByRole('button', { name: 'Text erkennen' }).click()
    await zeile.getByText(/Text wird erkannt: Seite \d von 2/).waitFor()
    await zeile.getByText('2 Seiten · OCR, Sichtprüfung nötig').waitFor({ timeout: 120000 })
    ok((await zeile.getByRole('button', { name: 'Text erkennen' }).count()) === 0, 'Knopf nach OCR')

    await suchen('restore attention')
    await page.locator('.spur-panel').getByText(/Short naps restore attention/).first().waitFor()
    await page.getByRole('button', { name: /scan\.pdf/ }).first().click()
    await sichtbar('Text dieser Seite per OCR erkannt. Bitte mit dem Bild vergleichen.')
    await page.locator('.spur-seitentext', { hasText: SATZ }).waitFor()
    await textMarkieren(SATZ)
    await page.getByRole('button', { name: 'Zitat speichern' }).click()
    const zitat = page
      .getByRole('tabpanel', { name: 'Quellen' })
      .locator('.spur-zitate li', { hasText: SATZ })
    await zitat.getByText('Wortlaut: OCR, nicht bestätigt').waitFor()

    await vorBibliographieEinfuegen(zitat, `\\enquote{${SATZ}} \\autocite[1]{scan}`)
    await panelOeffnen('Prüfbericht')
    const bericht = page
      .getByRole('tabpanel', { name: 'Prüfbericht' })
      .locator('.spur-zeile', { hasText: 'Short naps' })
    await bericht.getByText('Wortlaut: OCR, nicht bestätigt').waitFor()
    ok((await bericht.getByText('Wortlaut: exakt').count()) === 0, 'OCR-Zitat als exakt')

    // Das Quellen-Panel steht noch auf der Vorschau von scan.pdf.
    await railTab('Quellen').click()
    await zitat.getByRole('button', { name: 'Stelle bestätigt' }).click()
    await zitat.getByText('Wortlaut: von Mensch bestätigt').waitFor()
    ok((await zitat.getByRole('button', { name: 'Stelle bestätigt' }).count()) === 0, 'Knopf nach Bestätigung')
    await panelOeffnen('Prüfbericht')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await bericht.getByText('Wortlaut: von Mensch bestätigt').waitFor()
  }

  // SPUR_NOW gilt nur für diesen Schritt; sonst hingen Herzschläge und Token an einer festen Zeit.
  async function zeitSetzen(jetzt) {
    const r = await page.request.post(`${BASE}/spur/dev/zeit`, { data: { jetzt } })
    ok(r.status() === 204, `SPUR_NOW setzen: ${r.status()}`)
  }

  features.p4f3 = async () => {
    const SATZ = 'Regular sleep times help shift workers recover.'
    const TESTSEITE = 'http://127.0.0.1/spur/dev/web/testseite'
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Web')
    await panelOeffnen('Quellen')
    await sichtbar('Noch keine Quellen')
    await zeitSetzen('2026-11-01T09:00:00.000Z')
    try {
      await page.getByRole('button', { name: 'Webseite aufnehmen' }).click()
      await page.getByLabel('Adresse der Webseite').fill(TESTSEITE)
      // Erst nach der Antwort freigeben: Der Server liest die Zeit beim Speichern.
      await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/quellen/web')),
        page.getByRole('button', { name: 'Aufnehmen', exact: true }).click(),
      ])
    } finally {
      await zeitSetzen(null)
    }
    const zeile = page.locator('.spur-liste li', { hasText: 'Schlafhygiene im Schichtdienst' })
    await zeile.getByText('Webseite · abgerufen am 1. November 2026').waitFor()
    await zeile.getByText(TESTSEITE, { exact: true }).waitFor()

    await zeile.getByRole('button', { name: 'Schlafhygiene im Schichtdienst' }).click()
    await sichtbar(`Schnappschuss von ${TESTSEITE}.`)
    await sichtbar('abgerufen am 1. November 2026')
    await page.locator('.spur-seitentext', { hasText: SATZ }).waitFor()
    ok(!(await page.locator('.spur-seitentext').textContent()).includes('console.log'), 'Skript im Schnappschuss')
    await textMarkieren(SATZ)
    await page.getByRole('button', { name: 'Zitat speichern' }).click()
    const zitat = page.getByRole('tabpanel', { name: 'Quellen' }).locator('.spur-zitate li', { hasText: SATZ })
    await zitat.waitFor()
    await vorBibliographieEinfuegen(zitat, `\\enquote{${SATZ}} \\autocite{schlafhygiene-im-schichtdienst}`)
    await panelOeffnen('Prüfbericht')
    const bericht = page.getByRole('tabpanel', { name: 'Prüfbericht' })
    await bericht.locator('.spur-zeile', { hasText: 'Regular sleep' }).getByText('Wortlaut: exakt').waitFor()
    await editorErsetzen('{Regular sleep times', '{Irregular sleep times')
    await bericht.locator('.spur-zeile', { hasText: 'Irregular sleep' }).getByText('Wortlaut: abweichend').waitFor()

    // Nicht erreichbar: Meldung, keine neue Quelle.
    await railTab('Quellen').click()
    await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
    await page.getByRole('button', { name: 'Webseite aufnehmen' }).click()
    await page.getByLabel('Adresse der Webseite').fill('http://nicht-erreichbar.invalid/')
    await page.getByRole('button', { name: 'Aufnehmen', exact: true }).click()
    await sichtbar('Seite nicht erreichbar. Bitte die Adresse prüfen oder später erneut versuchen.')
    ok(
      (await page.getByLabel('Adresse der Webseite').inputValue()) === 'http://nicht-erreichbar.invalid/',
      'Adresse nach Fehler verloren'
    )
    const quellenListe = page.getByRole('tabpanel', { name: 'Quellen' }).locator('.spur-liste li')
    ok((await quellenListe.count()) === 1, `Nicht erreichbare Seite gespeichert: ${await quellenListe.count()}`)
  }

  // Liest eine Datei des Repos über ein Dateifeld (das run-code-Werkzeug hat kein fs).
  async function repoDatei(pfad) {
    await page.setContent('<input type="file">')
    await page.locator('input').setInputFiles(pfad)
    return await page.locator('input').evaluate(el => el.files[0].text())
  }

  features.p4f4 = async () => {
    const HINWEIS =
      'Transkripte gehen beim Lesen durch Claude an den KI-Anbieter. Pseudonymisieren Sie Interviews am besten vor dem Hochladen.'
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Transkript')
    await panelOeffnen('Quellen')
    await hochladen('interview.vtt')
    const hinweis = page.getByRole('tabpanel', { name: 'Quellen' }).getByText(HINWEIS)
    await hinweis.waitFor()
    // Der Hinweis steht unter dem Upload-Knopf.
    const [knopf, text] = await Promise.all([
      page.getByRole('button', { name: 'Hochladen', exact: true }).boundingBox(),
      hinweis.boundingBox(),
    ])
    ok(text.y > knopf.y, 'Hinweis steht nicht unter dem Upload')

    await hochladen('smith2024.pdf')
    await hinweis.waitFor({ state: 'detached' })

    const readme = await repoDatei(`${FIXTURES}/../../../../../../README.md`)
    const abschnitt = readme.split('\n## ').find(teil => teil.startsWith('Claude und Ihre Daten'))
    ok(abschnitt?.includes(HINWEIS), 'README nennt den Hinweis nicht im Abschnitt „Claude und Ihre Daten“')
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
  page.off('pageerror', beiFehler)
  return ergebnis.join('\n')
}
