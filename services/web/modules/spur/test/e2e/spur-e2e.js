// Alle E2E-Schritte. Läuft mit dem run-code-Werkzeug von Playwright oder per `make e2e`.
// Die Suite setzt ihre Daten vor dem ersten Feature selbst zurück (POST /spur/dev/e2e/vorbereiten, nur mit
// SPUR_DEV); spur-dev run modules/spur/test/e2e/vorbereiten.mjs macht dasselbe von außen.
// Einzelne Features: Seite vorher auf about:blank#f3,f4 stellen.
async page => {
  const BASE = globalThis.SPUR_URL || 'http://localhost:8080'
  const PASSWORT = 'spur-e2e-Passwort-1'
  const FIXTURES =
    globalThis.SPUR_FIXTURES || 'services/web/modules/spur/test/fixtures'
  const nur = new URL(page.url()).hash.slice(1).split(',').filter(Boolean)
  // Die Schritte gehen von 1280 px aus; ein Fenster aus einem früheren Lauf kann schmaler sein.
  await page.setViewportSize({ width: 1280, height: 720 })
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

  // Overleaf stellt nach dem Laden das zuletzt offene Panel wieder her, auf langsamen Rechnern erst nach Sekunden,
  // und überschreibt damit einen frühen Klick; manchmal bleibt die Leiste eingeklappt. Darum den Tab wählen, bis
  // `bereit` sichtbar ist. Ein schon gewählter Tab wird nur bei eingeklappter Leiste und erst nach 3 s erneut
  // geklickt; bei offener Leiste schlösse der Klick das Panel.
  async function panelSichern(tab, bereit, timeout = 30000) {
    const ende = Date.now() + timeout
    let geklickt = Date.now()
    while (!(await bereit.isVisible())) {
      ok(Date.now() < ende, `Panel ${tab}: nicht sichtbar nach ${timeout / 1000} s`)
      const gewaehlt = (await railTab(tab).getAttribute('aria-selected')) === 'true'
      const eingeklappt = !(await page.locator('.rail-panel-title').first().isVisible())
      if (!gewaehlt || (eingeklappt && Date.now() - geklickt > 3000)) {
        await railTab(tab).click()
        geklickt = Date.now()
      }
      await page.waitForTimeout(250)
    }
  }

  async function panelOeffnen(name) {
    await panelSichern(name, page.locator('.rail-panel-title', { hasText: name }).first())
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
    await page.getByLabel('Projekt', { exact: true }).selectOption({ label: projekt })
    await page.locator('.modal').getByRole('button', { name: 'Holen', exact: true }).click()
    await page.locator('.modal').waitFor({ state: 'detached' })
  }

  async function textMarkieren(text, bereich = page) {
    await bereich.locator('.spur-seitentext').evaluate((el, gesucht) => {
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
    await panelSichern(DATEIBAUM, eintrag)
    await eintrag.click()
    await page.locator('.cm-content', { hasText: '@article{' }).waitFor()
    return await page.evaluate(() =>
      window.overleaf.unstable.store.get('editor.view').state.doc.toString()
    )
  }

  async function texErsetzen(datei) {
    const name = datei.split('/').pop()
    await panelSichern(DATEIBAUM, page.locator('.file-tree').getByRole('treeitem', { name }))
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
    const { status, daten } = await mcp(token, 'tools/call', { name, arguments: args })
    ok(daten?.result, `${name}: HTTP ${status} ${JSON.stringify(daten).slice(0, 200)}`)
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
      await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Demo' })
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
      const befehl = page.locator('.spur-token-neu')
      await befehl.waitFor()
      const token = await befehl.getAttribute('data-spur-token')
      const text = await befehl.innerText()
      ok(text.includes(`token=${token}`), 'Token fehlt im Befehl')
      ok(text.includes('claude plugin install spur@spur'), 'Plugin-Befehl fehlt')
      ok(text.includes('mcp__plugin_spur_spur__doc_edit'), 'Allow-Regel fehlt')
      await sichtbar('Deinen Schlüssel siehst du nur jetzt')

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
      await page.locator('.spur-token-neu').waitFor()
      const erstes = await page.locator('.spur-token-neu').getAttribute('data-spur-token')
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
      // P2 ergänzt laut docs/mcp-contract.md Recherche, Aufnahme, Matrix und Compile.
      const P2 = [
        'paper_search', 'paper_citations', 'source_add', 'acquisition_add', 'matrix_suggest',
        'compile', 'job_status', 'compile_log', 'page_image',
      ]
      // P3: Vorschläge ins Panel.
      const P3 = ['suggest']
      const erwartet = [...P1, ...P2, ...P3].sort()
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
    const zahl = await seitenPost(`/spur/project/${demo}/claude/auftrag`, { text: 123 })
    ok(zahl.status === 422, `Auftrag mit Zahl: ${zahl.status}`)

    // Das Eingabefeld gibt es erst mit Verbindung (P3).
    await warteStarten(token)
    await sichtbar('Claude verbunden', 20000)
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
    await panelSichern('Review panel', page.locator('.review-panel-entry-user').first())
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
    // Die Liste lädt nach der Meldung neu; bis dahin zeigt der Link noch auf doi.org.
    const link = eintrag('Sleep and Memory').getByRole('link', { name: 'In der Bibliothek holen' })
    const BIB_LINK = 'https://bibliothek.example/?doi=10.5555/spur.2024.001'
    await link
      .and(page.locator(`[href="${BIB_LINK}"]`))
      .waitFor({ timeout: 10000 })
      .catch(async () => fail(`Link: ${await link.getAttribute('href')}`))

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
    await dialog.getByLabel('Modell (optional, wird nur genannt, wenn du es einträgst)').fill('Claude Opus 5.5')
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
      await page.locator('.spur-semantik').getByText('Ein Zitat belegen sie nicht.', { exact: false }).waitFor()
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
    await sichtbar('Markiere oben Text und speichere ihn als Zitat.')

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
        await sichtbar(/S\. 347 · von dir/)
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
        await sichtbar(`Ben Berater hat dir ein Zitat zugewiesen: „${SATZ_A}“ (smith2024.pdf, S. 347)`)
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
      'Transkripte gehen beim Lesen durch Claude an den KI-Anbieter. Pseudonymisiere Interviews am besten vor dem Hochladen.'
    // Die README ist englisch (spur_transkript_hinweis in en.json); die Oberfläche der E2E-Instanz bleibt deutsch.
    const README_HINWEIS =
      'Transcripts are sent to the AI provider when Claude reads them. Ideally, pseudonymise interviews before uploading them.'
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
    const abschnitt = readme.split('\n## ').find(teil => teil.startsWith('Claude and your data'))
    ok(abschnitt?.includes(README_HINWEIS), 'README nennt den Hinweis nicht im Abschnitt „Claude and your data“')
  }

  // P3: Ada (e2e-p3a) und Bo (e2e-p3b) haben je ein festes Test-Token aus vorbereiten.mjs.
  const ADA = 'spur_e2e_p3a'
  const BO = 'spur_e2e_p3b'
  const claudePanel = () => page.getByRole('tabpanel', { name: 'Claude' })
  const chatLog = () => claudePanel().getByRole('log', { name: 'Unterhaltung mit Claude' })

  async function verbinden(token) {
    // Wie eine Session, die ihre Inbox abgearbeitet hat: Offene Ereignisse früherer Schritte zuerst abholen.
    while ((await werkzeug(token, 'wait_for_event', { max_sekunden: 1 })).inhalt.ereignis);
    await warteStarten(token)
    await claudePanel().getByText('Claude verbunden').waitFor({ timeout: 20000 })
  }

  features.p3f1 = async () => {
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Chat')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    await claudePanel().getByText('Claude nicht verbunden').waitFor()
    await claudePanel().getByText(/claude --allowedTools/).waitFor()
    ok((await claudePanel().getByLabel('Auftrag an Claude').count()) === 0, 'Eingabefeld ohne Verbindung')

    await verbinden(ADA)
    const feld = claudePanel().getByLabel('Auftrag an Claude')
    await feld.fill('Fasse Abschnitt 2 zusammen')
    await feld.press('Control+Enter')
    await page.waitForFunction(() => window.__spur.log.some(e => e.msg?.result), null, { timeout: 5000 })
    await chatLog().getByText('Claude arbeitet …').waitFor()
    const seit = await ereignisseVon(ADA)
    ok(
      seit.some(e => e.project_id === pid && e.daten.text === 'Fasse Abschnitt 2 zusammen'),
      `events_since: ${JSON.stringify(seit).slice(0, 500)}`
    )

    const edit = await werkzeug(ADA, 'doc_edit', {
      project_id: pid,
      pfad: 'main.tex',
      alt: 'Zweiter Abschnitt über Schlaf und Gedächtnis.',
      neu: 'Zweiter Abschnitt über Schlaf und Gedächtnis, kurz gefasst.',
      idempotenz_schluessel: schluessel(),
    })
    ok(!edit.fehler, `doc_edit: ${JSON.stringify(edit.inhalt)}`)
    await chatLog().locator('.spur-lauf-karte').waitFor({ timeout: 15000 })
    await werkzeug(ADA, 'reply', { project_id: pid, text: 'Abschnitt 2: Schlaf stärkt das Gedächtnis.' })
    await chatLog().getByText('Abschnitt 2: Schlaf stärkt das Gedächtnis.').waitFor({ timeout: 10000 })
    const reihenfolge = await chatLog().locator('.spur-chat-nachricht .spur-nachricht-text').allInnerTexts()
    ok(
      reihenfolge.indexOf('Fasse Abschnitt 2 zusammen') < reihenfolge.indexOf('Abschnitt 2: Schlaf stärkt das Gedächtnis.'),
      `Reihenfolge: ${reihenfolge}`
    )
    await chatLog().getByText('Claude arbeitet …').waitFor({ state: 'detached' })

    // Lange Unterhaltung: 100 weitere Antworten, dann neu laden.
    for (let i = 0; i < 100; i += 20) {
      await Promise.all(
        Array.from({ length: 20 }, (_, j) =>
          werkzeug(ADA, 'reply', { project_id: pid, text: `Antwort ${String(i + j + 1).padStart(3, '0')}` })
        )
      )
    }
    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Claude')
    const geladen = Date.now()
    await chatLog().getByText('Antwort 100').waitFor({ timeout: 15000 })
    const ladezeit = Date.now() - geladen
    ok(ladezeit < 3000, `Verlauf mit 100 Nachrichten nach ${ladezeit} ms`)
    // Vollständig: die erste Frage, ihre Antwort und alle 100 weiteren Antworten.
    const anzahl = await chatLog().locator('.spur-chat-nachricht').count()
    ok(anzahl === 102, `Nach dem Neuladen ${anzahl} statt 102 Nachrichten`)
    await chatLog().getByText('Fasse Abschnitt 2 zusammen', { exact: true }).waitFor()
    ok((await claudePanel().getByText(/Ältere Nachrichten/).count()) === 0, 'Hinweis auf ältere Nachrichten bei 102')
    // Die 100 Antworten kommen je 20 parallel; die neueste ist die letzte im Verlauf, nicht unbedingt „Antwort 100“.
    const neueste = chatLog().locator('.spur-chat-nachricht').last()
    ok(
      await neueste.evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.bottom <= window.innerHeight && r.top >= 0
      }),
      `Neueste Nachricht nach dem Laden nicht sichtbar: ${await neueste.innerText()}`
    )
    await verbinden(ADA)
    const tippen = Date.now()
    await claudePanel().getByLabel('Auftrag an Claude').pressSequentially('Danke, weiter mit Abschnitt 3')
    const tippzeit = Date.now() - tippen
    ok(tippzeit < 3000, `Tippen bei 100 Nachrichten dauerte ${tippzeit} ms`)
    await claudePanel().getByLabel('Auftrag an Claude').press('Control+Enter')
    await chatLog().getByText('Danke, weiter mit Abschnitt 3').waitFor({ timeout: 10000 })
    await page.evaluate(() => window.__spur.abbruch.abort())
  }

  const AUSSAGE = 'Schlaf verdoppelt die Gedächtnisleistung.'

  // Mit der Maus wie ein Mensch: Overleafs Menü „Kommentar hinzufügen“ erscheint erst nach dem Loslassen.
  async function zeileAuswaehlen(text) {
    const zeile = page.locator('.cm-line', { hasText: text })
    const box = await zeile.boundingBox()
    const breite = await zeile.evaluate(el => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r.getBoundingClientRect().width
    })
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + breite + 10, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
  }

  // events_since liefert höchstens 100 Ereignisse je Seite; dem Cursor bis zum Ende folgen.
  async function ereignisseVon(token, typ) {
    const alle = []
    for (let cursor; ; ) {
      const { inhalt } = await werkzeug(token, 'events_since', cursor ? { cursor } : {})
      alle.push(...inhalt.ereignisse)
      if (inhalt.ereignisse.length < 100 || !inhalt.cursor || inhalt.cursor === cursor) break
      cursor = inhalt.cursor
    }
    return alle.filter(e => !typ || e.typ === typ)
  }

  async function bisEreignisse(token, typ, anzahl, timeout = 20000) {
    const ende = Date.now() + timeout
    let liste = []
    while (Date.now() < ende) {
      liste = await ereignisseVon(token, typ)
      if (liste.length >= anzahl) return liste
      await page.waitForTimeout(500)
    }
    fail(`${typ}: ${liste.length} statt ${anzahl} Ereignisse`)
  }

  // Bei eingeklappter Leiste zeigt Overleaf den Eintrag nur als Marke am Rand (.review-panel-entry, ohne Text);
  // bereit ist das Panel erst, wenn der Kommentartext selbst sichtbar ist.
  async function reviewEintrag(text) {
    const eintrag = page.locator('.review-panel-entry', { hasText: text })
    await panelSichern('Review panel', eintrag.getByText(text).first())
    return eintrag
  }

  features.p3f2 = async () => {
    await anmelden('e2e-p3b@example.org')
    await projektOeffnen('E2E Kommentar')
    const pid = page.url().split('/').pop()
    await zeileAuswaehlen(AUSSAGE)
    await page.getByRole('button', { name: /^(Kommentar hinzufügen|Add comment)$/ }).click()
    const eingabe = page.locator('.review-panel-add-comment-editor .cm-content').first()
    await eingabe.waitFor()
    await eingabe.click()
    await page.keyboard.type('Bo meint: Das ist zu stark.')
    const [gesendet] = await Promise.all([
      page.waitForResponse(r => /\/thread\/[0-9a-f]{24}\/messages$/.test(r.url()) && r.request().method() === 'POST'),
      page.getByRole('button', { name: /^(Kommentar|Comment)$/ }).click(),
    ])
    ok(gesendet.status() === 204, `Kommentar von Bo: ${gesendet.status()}`)
    // Overleaf schickt die Kommentar-Op gesammelt, etwa 2 s nach dem Thread-Text; wer vorher die Seite verlässt,
    // verliert sie. Darum warten, bis der Server den Kommentar kennt.
    const gespeichert = async () =>
      (await (await page.request.get(`${BASE}/project/${pid}/ranges`)).json()).some(doc => doc.ranges.comments?.length)
    for (let ende = Date.now() + 20000; !(await gespeichert()); await page.waitForTimeout(250)) {
      ok(Date.now() < ende, 'Kommentar von Bo nach 20 s nicht beim Server')
    }
    const thread = await reviewEintrag('Bo meint: Das ist zu stark.')

    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Kommentar')
    await reviewEintrag('Bo meint: Das ist zu stark.')
    await thread.locator('.review-panel-comment-input .cm-content').click()
    await page.keyboard.type('@claude prüfe diese Aussage')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await thread.getByText('@claude prüfe diese Aussage').waitFor()

    const [erwaehnung] = await bisEreignisse(ADA, 'comment_mention', 1)
    const d = erwaehnung.daten
    ok(erwaehnung.project_id === pid, `Projekt: ${erwaehnung.project_id}`)
    ok(
      d.text === '@claude prüfe diese Aussage' && d.pfad === 'main.tex' && /^[0-9a-f]{24}$/.test(d.doc_id) &&
        /^[0-9a-f]{24}$/.test(d.kommentar_id) && d.stelle?.zeile === 3 && d.stelle.markiert.startsWith('Schlaf verdoppelt die Gedächtnisleistung'),
      `comment_mention: ${JSON.stringify(d)}`
    )
    ok(d.andere_nachrichten.length === 1, `Andere Nachrichten: ${JSON.stringify(d.andere_nachrichten)}`)
    ok(!JSON.stringify(erwaehnung).includes('Bo meint'), 'Kommentartext von Bo im Ereignis')
    const beiBo = await ereignisseVon(BO)
    ok(beiBo.length === 0, `Bot von Bo erhielt: ${JSON.stringify(beiBo)}`)

    const antwort = await werkzeug(ADA, 'reply', {
      project_id: pid,
      kommentar_id: d.kommentar_id,
      text: 'Die Verdopplung ist in den Quellen nicht belegt.',
    })
    ok(!antwort.fehler, `reply: ${JSON.stringify(antwort.inhalt)}`)
    await thread.getByText('Die Verdopplung ist in den Quellen nicht belegt.').waitFor({ timeout: 10000 })
    await thread.locator('.review-panel-entry-user', { hasText: 'Claude (Ada)' }).first().waitFor()
    const fremd = await werkzeug(ADA, 'reply', { project_id: pid, kommentar_id: 'ffffffffffffffffffffffff', text: 'x' })
    ok(fremd.inhalt.fehler === 'kommentar_fehlt', `Fremder Thread: ${JSON.stringify(fremd.inhalt)}`)
  }

  const vorschlaegePanel = () => page.getByRole('tabpanel', { name: 'Vorschläge' })
  const auswahlText = async label =>
    await vorschlaegePanel().getByLabel(label, { exact: true }).evaluate(el => el.selectedOptions[0].textContent)

  // Das Panel lädt nach dem Speichern neu; bis dahin zeigt die Auswahl noch den alten Stand.
  async function auswahlIst(label, erwartet) {
    try {
      await page.waitForFunction(
        ([id, text]) => document.getElementById(id)?.selectedOptions[0]?.textContent === text,
        [label === 'Compile-Fehler' ? 'spur-schalter-compile_fehler' : 'spur-schalter-belegloses_argument', erwartet],
        { timeout: 10000 }
      )
    } catch {
      fail(`${label}: „${await auswahlText(label)}“ statt „${erwartet}“`)
    }
  }

  async function aufAntwort(pfadEnde, handlung) {
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith(pfadEnde) && r.request().method() !== 'GET'),
      handlung(),
    ])
  }

  async function fehlerKompilieren() {
    await Promise.all([
      page.waitForResponse(r => /\/compile\?/.test(r.url()) && r.request().method() === 'POST', { timeout: 120000 }),
      page.getByRole('button', { name: KOMPILIEREN }).first().click(),
    ])
  }

  features.p3f3 = async () => {
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Vorschläge')
    await panelOeffnen('Vorschläge')
    await auswahlIst('Compile-Fehler', 'Projekt: Aus')
    await auswahlIst('Belegloses Argument', 'Projekt: Aus')
    await aufAntwort('/vorschlaege/projekt', () =>
      vorschlaegePanel().getByLabel('Compile-Fehler (Projekt)').selectOption('vorschlag')
    )

    await anmelden('e2e-p3b@example.org')
    await projektOeffnen('E2E Vorschläge')
    await panelOeffnen('Vorschläge')
    await auswahlIst('Compile-Fehler', 'Projekt: Vorschlag')
    ok((await vorschlaegePanel().getByText('Projekt-Standard für alle Mitglieder').count()) === 1, 'Bo darf schreiben')
    await aufAntwort('/vorschlaege/eigene', () => vorschlaegePanel().getByLabel('Compile-Fehler', { exact: true }).selectOption('aus'))
    await auswahlIst('Compile-Fehler', 'Aus')

    await fehlerKompilieren()
    await page.waitForTimeout(4000)
    const aus = await ereignisseVon(BO, 'suggest_trigger')
    ok(aus.length === 0, `Mit Aus: ${JSON.stringify(aus)}`)

    await aufAntwort('/vorschlaege/eigene', () =>
      vorschlaegePanel().getByLabel('Compile-Fehler', { exact: true }).selectOption('vorschlag')
    )
    await auswahlIst('Compile-Fehler', 'Vorschlag')
    await fehlerKompilieren()
    const [ausgeloest] = await bisEreignisse(BO, 'suggest_trigger', 1)
    await page.waitForTimeout(3000)
    const alle = await ereignisseVon(BO, 'suggest_trigger')
    ok(alle.length === 1, `Mit Vorschlag ${alle.length} Ereignisse`)
    ok(
      ausgeloest.daten.art === 'compile_fehler' && ausgeloest.daten.fehler.some(f => /Undefined control sequence/.test(f.meldung)),
      `suggest_trigger: ${JSON.stringify(ausgeloest.daten)}`
    )
    ok((await ereignisseVon(ADA, 'suggest_trigger')).length === 0, 'Compile von Bo löste bei Ada aus')
  }

  features.p3f4 = async () => {
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Vorschläge')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Vorschläge')
    await aufAntwort('/vorschlaege/eigene', () =>
      vorschlaegePanel().getByLabel('Belegloses Argument', { exact: true }).selectOption('vorschlag')
    )
    const vorher = (await werkzeug(ADA, 'doc_read', { project_id: pid, pfad: 'main.tex' })).inhalt.text
    const BELEG = 'Für die Verdopplung der Gedächtnisleistung fehlt eine Quelle; Diekelmann und Born (2010) belegen nur eine Verbesserung.'
    const s1 = await werkzeug(ADA, 'suggest', {
      project_id: pid, art: 'belegloses_argument', titel: 'Beleg fehlt', text: BELEG, pfad: 'main.tex',
    })
    ok(!s1.fehler, `suggest: ${JSON.stringify(s1.inhalt)}`)
    const karte = vorschlaegePanel().locator('.spur-vorschlag-karte', { hasText: 'Beleg fehlt' })
    await karte.getByText(BELEG).waitFor({ timeout: 10000 })
    const nachher = (await werkzeug(ADA, 'doc_read', { project_id: pid, pfad: 'main.tex' })).inhalt.text
    ok(nachher === vorher, 'Vorschlag hat den Text verändert')

    await werkzeug(ADA, 'suggest', {
      project_id: pid, art: 'compile_fehler', titel: 'Makro unbekannt', text: '\\kaputtesmakro ist nicht definiert.',
    })
    const zweite = vorschlaegePanel().locator('.spur-vorschlag-karte', { hasText: 'Makro unbekannt' })
    await zweite.waitFor({ timeout: 10000 })
    await zweite.getByRole('button', { name: 'Verwerfen' }).click()
    await zweite.waitFor({ state: 'detached' })

    const vorAuftraegen = (await ereignisseVon(ADA, 'task_created')).length
    await karte.getByRole('button', { name: 'Übernehmen' }).click()
    await vorschlaegePanel().getByText('Claude hat den Auftrag. Den Lauf siehst du im Claude-Panel.').waitFor()
    await karte.waitFor({ state: 'detached' })
    const auftraege = await bisEreignisse(ADA, 'task_created', vorAuftraegen + 1)
    ok(auftraege.at(-1).daten.text.includes(BELEG), `Auftrag: ${JSON.stringify(auftraege.at(-1).daten)}`)
    const edit = await werkzeug(ADA, 'doc_edit', {
      project_id: pid, pfad: 'main.tex', alt: AUSSAGE,
      neu: 'Schlaf verbessert die Gedächtnisleistung \\autocite{diekelmann2010}.', idempotenz_schluessel: schluessel(),
    })
    ok(!edit.fehler, `doc_edit nach Übernehmen: ${JSON.stringify(edit.inhalt)}`)
    await panelOeffnen('Claude')
    await chatLog().locator('.spur-lauf-karte').waitFor({ timeout: 15000 })

    // Tageslimit 2 an einem festen Tag: der dritte Auslöser erzeugt nichts.
    await panelOeffnen('Vorschläge')
    await vorschlaegePanel().getByLabel('Tageslimit, für alle Projekte').fill('2')
    await aufAntwort('/spur/vorschlaege/limit', () => vorschlaegePanel().getByRole('button', { name: 'Limit speichern' }).click())
    const docId = (await werkzeug(ADA, 'doc_list', { project_id: pid })).inhalt.eintraege.find(e => e.pfad === 'main.tex').id
    const vorLimit = (await ereignisseVon(ADA, 'suggest_trigger')).length
    await zeitSetzen('2026-11-20T09:00:00.000Z')
    const antworten = []
    try {
      for (let i = 0; i < 3; i++) {
        antworten.push((await seitenPost(`/spur/project/${pid}/vorschlaege/tipp-pause`, { doc_id: docId })).daten)
      }
      await vorschlaegePanel().getByText('Tageslimit erreicht').waitFor({ timeout: 10000 })
    } finally {
      await zeitSetzen(null)
    }
    ok(
      JSON.stringify(antworten) ===
        JSON.stringify([{ ausgeloest: true }, { ausgeloest: true }, { ausgeloest: false, grund: 'limit' }]),
      `Auslöser mit Limit 2: ${JSON.stringify(antworten)}`
    )
    ok((await ereignisseVon(ADA, 'suggest_trigger')).length === vorLimit + 2, 'Dritter Auslöser erzeugte ein Ereignis')
    // Eine erfundene Dokument-ID lehnt der Server ab, bevor er zählt (D4).
    const fremd = await seitenPost(`/spur/project/${pid}/vorschlaege/tipp-pause`, { doc_id: 'a'.repeat(24) })
    ok(fremd.status === 404 && fremd.daten?.title === 'doc_fehlt', `Tipp-Pause mit unbekanntem Dokument: ${JSON.stringify(fremd)}`)
    await vorschlaegePanel().getByLabel('Tageslimit, für alle Projekte').fill('50')
    await aufAntwort('/spur/vorschlaege/limit', () => vorschlaegePanel().getByRole('button', { name: 'Limit speichern' }).click())
    await vorschlaegePanel().getByText('Tageslimit erreicht').waitFor({ state: 'detached', timeout: 10000 })

    // 60 Sekunden Tipp-Pause: vorher nichts, danach genau ein Ereignis.
    const vorPause = (await ereignisseVon(ADA, 'suggest_trigger')).length
    for (const wort of [' Erstens', ' zweitens', ' drittens.']) {
      await editorEinfuegen('\\kaputtesmakro', wort)
      await page.waitForTimeout(1000)
    }
    const getippt = Date.now()
    await page.waitForTimeout(50000)
    ok((await ereignisseVon(ADA, 'suggest_trigger')).length === vorPause, 'Ereignis vor Ablauf der Minute')
    const [, ...rest] = (await bisEreignisse(ADA, 'suggest_trigger', vorPause + 1, 25000)).slice(vorPause)
    const nach = (Date.now() - getippt) / 1000
    ok(nach >= 59, `Ereignis nach ${nach} s`)
    await page.waitForTimeout(5000)
    const pause = (await ereignisseVon(ADA, 'suggest_trigger')).slice(vorPause)
    ok(pause.length === 1 && rest.length === 0, `Tipp-Pause: ${pause.length} Ereignisse`)
    ok(pause[0].daten.art === 'belegloses_argument' && pause[0].daten.doc_id === docId, `Tipp-Pause: ${JSON.stringify(pause[0].daten)}`)
  }

  const WORKFLOWS = ['literaturueberblick', 'methodenteil', 'folien', 'quellen_sammeln']
  const promptText = async (name, args = name === 'quellen_sammeln' ? { thema: 'Schlaf' } : {}) =>
    (await mcp(ADA, 'prompts/get', { name, arguments: args })).daten.result.messages[0].content.text

  // Klickt im Claude-Panel einen Workflow und liefert das Ereignis, das der wartende Fake-Client erhält.
  async function workflowKlicken(projekt, titel) {
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen(projekt)
    await panelOeffnen('Claude')
    await verbinden(ADA)
    await claudePanel().getByText('Workflows', { exact: true }).click()
    await claudePanel().getByRole('button', { name: titel, exact: true }).click()
    await page.waitForFunction(() => window.__spur.log.some(e => e.msg?.result), null, { timeout: 5000 })
    await chatLog().getByText(`Workflow: ${titel}`).waitFor()
    const { ereignis } = await page.evaluate(() =>
      JSON.parse(window.__spur.log.find(e => e.msg?.result).msg.result.content[0].text)
    )
    await page.evaluate(() => window.__spur.abbruch.abort())
    return ereignis
  }

  async function adminWorkflowText(titel, aktion) {
    await anmelden('e2e-admin@example.org')
    await page.goto(`${BASE}/spur/admin/workflows`)
    const abschnitt = page.locator('section', { has: page.getByRole('heading', { name: titel, exact: true }) })
    await abschnitt.getByLabel(`Text für „${titel}“`).waitFor()
    await aktion(abschnitt)
  }

  features.p3f5 = async () => {
    const { daten } = await mcp(ADA, 'prompts/list')
    const prompts = daten.result.prompts
    ok(JSON.stringify(prompts.map(p => p.name)) === JSON.stringify(WORKFLOWS), `prompts/list: ${prompts.map(p => p.name)}`)
    const pflicht = prompts.flatMap(p => p.arguments.filter(a => a.required).map(a => `${p.name}.${a.name}`))
    ok(JSON.stringify(pflicht) === '["quellen_sammeln.thema"]', `Pflichtargumente: ${pflicht}`)
    const texte = {}
    for (const name of WORKFLOWS) {
      texte[name] = await promptText(name)
      ok(texte[name].length > 300 && texte[name].includes('run_finish'), `prompts/get ${name}: ${texte[name].slice(0, 80)}`)
    }
    // Über ein Plugin heißen MCP-Prompts in Claude Code /plugin:<Plugin>:<Server>:<Prompt> (MCP);
    // Plugin und Server heißen „spur“ (Entscheidung D3).
    const plugin = `${FIXTURES}/../../../../../../plugins/spur`
    const mcpJson = JSON.parse(await repoDatei(`${plugin}/.mcp.json`))
    ok(Object.keys(mcpJson.mcpServers ?? mcpJson).includes('spur'), `Server im Plugin: ${JSON.stringify(mcpJson)}`)
    const pluginJson = JSON.parse(await repoDatei(`${plugin}/.claude-plugin/plugin.json`))
    ok(pluginJson.name === 'spur', `Plugin-Name: ${pluginJson.name}`)
    const BEFEHLE = WORKFLOWS.map(n => `/plugin:${pluginJson.name}:spur:${n}`)

    const titel = {
      literaturueberblick: 'Literaturüberblick',
      methodenteil: 'Methodenteil',
      folien: 'Folien aus Paper',
      quellen_sammeln: 'Quellen sammeln',
    }
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Workflows')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    await verbinden(ADA)
    await claudePanel().getByText('Workflows', { exact: true }).click()
    const knoepfe = await claudePanel().locator('.spur-workflow > button').allInnerTexts()
    ok(JSON.stringify(knoepfe) === JSON.stringify(WORKFLOWS.map(n => titel[n])), `Panel: ${knoepfe}`)
    const hilfe = await claudePanel().getByRole('list', { name: 'Befehle in Claude Code' }).getByRole('listitem').allInnerTexts()
    ok(JSON.stringify(hilfe) === JSON.stringify(BEFEHLE), `Hilfe im Panel: ${hilfe}`)
    ok(!/(^|[^:])\/spur:\w/.test(await claudePanel().innerText()), 'Panel nennt noch /spur:<name>')
    await page.evaluate(() => window.__spur.abbruch.abort())
    const nichtAdmin = await page.request.get(`${BASE}/spur/admin/workflows.json`, { maxRedirects: 0 })
    ok(nichtAdmin.status() !== 200, `Workflows-Admin ohne Admin-Recht: ${nichtAdmin.status()}`)

    const auftrag = await workflowKlicken('E2E Workflows', 'Literaturüberblick')
    ok(
      auftrag?.typ === 'task_created' && auftrag.project_id === pid && auftrag.daten.workflow === 'literaturueberblick' &&
        auftrag.daten.text === texte.literaturueberblick,
      `Auftrag aus dem Panel: ${JSON.stringify(auftrag).slice(0, 300)}`
    )

    const NEU = 'Workflow „Methodenteil“ (angepasst): Schreibe den Methodenteil in höchstens 600 Wörtern und beende mit run_finish.'
    await adminWorkflowText('Methodenteil', async abschnitt => {
      await abschnitt.getByText(BEFEHLE[1], { exact: true }).waitFor()
      await abschnitt.getByLabel('Text für „Methodenteil“').fill(NEU)
      await abschnitt.getByRole('button', { name: 'Speichern' }).click()
      await abschnitt.getByText('Gespeichert. Der neue Text gilt ab sofort.').waitFor()
    })
    try {
      ok((await promptText('methodenteil')) === NEU, 'prompts/get liefert den alten Text')
      const geaendert = await workflowKlicken('E2E Workflows', 'Methodenteil')
      ok(geaendert?.daten.text === NEU, `Panel liefert: ${geaendert?.daten.text.slice(0, 80)}`)
    } finally {
      await adminWorkflowText('Methodenteil', async abschnitt => {
        await abschnitt.getByRole('button', { name: 'Standard wiederherstellen' }).click()
        await abschnitt.getByText('Standardtext wiederhergestellt.').waitFor()
      })
    }
    ok((await promptText('methodenteil')) === texte.methodenteil, 'Standardtext nicht wiederhergestellt')
  }

  // P5: Nachbesserungen aus der Abnahme.
  async function breite(px) {
    await page.setViewportSize({ width: px, height: px < 400 ? 740 : 690 })
  }

  async function ohneSeitlichesRollen(wo) {
    const masse = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    ok(masse[0] <= masse[1], `${wo}: Seite rollt seitlich (${masse})`)
  }

  // Kontrast nach WCAG zwischen Textfarbe und dem ersten nicht durchsichtigen Hintergrund darunter.
  async function kontrast(locator) {
    return await locator.evaluate(el => {
      const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number)
      const kanal = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      const hell = ([r, g, b]) => 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b)
      let hinten = 'rgb(255, 255, 255)'
      for (let e = el; e; e = e.parentElement) {
        const farbe = getComputedStyle(e).backgroundColor
        if (!/^rgba\(.*, 0\)$|transparent/.test(farbe)) {
          hinten = farbe
          break
        }
      }
      const [a, b] = [hell(rgb(getComputedStyle(el).color)), hell(rgb(hinten))]
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    })
  }

  // Alle sichtbaren, bedienbaren Texte eines Bereichs mit Kontrast unter 4,5:1.
  async function unlesbar(bereich) {
    return await bereich.evaluate(wurzel => {
      const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number)
      const kanal = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      const hell = ([r, g, b]) => 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b)
      const hinten = el => {
        for (let e = el; e; e = e.parentElement) {
          const farbe = getComputedStyle(e).backgroundColor
          if (!/^rgba\(.*, 0\)$|transparent/.test(farbe)) return farbe
        }
        return 'rgb(255, 255, 255)'
      }
      const schlecht = []
      for (const el of wurzel.querySelectorAll('*')) {
        if (!el.offsetParent || el.closest('[disabled], .disabled, [aria-disabled=true]')) continue
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
        const [a, b] = [hell(rgb(getComputedStyle(el).color)), hell(rgb(hinten(el)))]
        const k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        if (k < 4.5) schlecht.push(`${el.textContent.trim().slice(0, 40)} (${k.toFixed(2)})`)
      }
      return [...new Set(schlecht)]
    })
  }

  features.p5f1 = async () => {
    const logos = []
    const merken = r => /overleaf-o[-.]/.test(r.url()) && logos.push(r.url())
    page.on('request', merken)
    try {
      await breite(1280)
      await anmelden('e2e-a@example.org')
      const kopf = page.locator('.navbar-title')
      ok((await kopf.innerText()).trim() === 'spur', `Projektliste: ${await kopf.innerText()}`)
      ok((await page.locator('.navbar-logo').count()) === 0, 'Projektliste zeigt .navbar-logo')
      await page.goto(`${BASE}/user/settings`)
      ok((await page.locator('.navbar-title').innerText()).trim() === 'spur', 'Einstellungen ohne Schriftzug')
      ok((await page.locator('.navbar-logo').count()) === 0, 'Einstellungen zeigen .navbar-logo')

      await projektOeffnen('E2E APA')
      const vorher = await page.evaluate(() => JSON.parse(document.querySelector('meta[name="ol-userSettings"]').content).overallTheme)
      try {
        for (const thema of ['light-', '']) {
          await seitenPost('/user/settings', { overallTheme: thema })
          for (const px of [1280, 360]) {
            await breite(px)
            await projektOeffnen('E2E APA')
            const link = page.getByRole('link', { name: 'spur, zur Projektliste' })
            ok((await link.innerText()).trim() === 'spur', `Editor: ${await link.innerText()}`)
            const k = await kontrast(link.locator('.toolbar-spur-schriftzug'))
            ok(k >= 4.5, `Kontrast ${k.toFixed(2)} bei ${px} px, Thema „${thema}“`)
            ok(await link.evaluate(a => a.scrollWidth <= a.clientWidth && a.getBoundingClientRect().right <= innerWidth), `Schriftzug läuft über bei ${px} px`)
            await ohneSeitlichesRollen(`Editor ${px} px`)
          }
        }
      } finally {
        await seitenPost('/user/settings', { overallTheme: vorher })
      }
      await breite(1280)
      await projektOeffnen('E2E APA')
      await page.getByRole('link', { name: 'spur, zur Projektliste' }).click()
      await page.waitForURL(`${BASE}/project`)
      await projektOeffnen('E2E APA')
      // Vom Seitenanfang aus; im Editor würde Tab einrücken.
      await page.evaluate(() => document.activeElement?.blur())
      let gefunden = false
      for (let i = 0; i < 40 && !gefunden; i++) {
        await page.keyboard.press('Tab')
        gefunden = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'spur, zur Projektliste')
      }
      ok(gefunden, 'Schriftzug per Tab nicht erreichbar')
      await page.keyboard.press('Enter')
      await page.waitForURL(`${BASE}/project`)
      ok(logos.length === 0, `Overleaf-Logo geladen: ${logos.join(', ')}`)
    } finally {
      page.off('request', merken)
      await breite(1280)
    }
  }

  features.p5f2 = async () => {
    await page.setViewportSize({ width: 1280, height: 690 })
    await anmelden('e2e-a@example.org')
    const seite = page.locator('.project-list-sidebar-scroll')
    await seite.getByText('Stichwörter', { exact: true }).waitFor()
    ok(!(await page.locator('body').innerText()).includes('Stichwörter organisieren'), '„Stichwörter organisieren“ steht noch da')
    const masse = await seite.evaluate(el => [el.scrollWidth, el.clientWidth])
    ok(masse[0] <= masse[1], `Seitenmenü rollt seitlich: ${masse}`)
    const unten = (await page.locator('.ds-nav-ds-name').textContent()).trim()
    ok(unten === 'Overleaf CE+ · spur', `Unterste Zeile: ${unten}`)

    await page.goto(`${BASE}/user/settings`)
    const github = page.getByRole('link', { name: 'spur @ GitHub' })
    ok((await github.getAttribute('href')) === 'https://github.com/ahlerjam/spur', `Fußzeile: ${await github.getAttribute('href')}`)
    ok(!(await page.locator('body').innerText()).includes('spur auf GitHub'), '„spur auf GitHub“ steht noch da')

    await page.goto(`${BASE}/project`)
    await seite.getByRole('button', { name: 'Neues Stichwort' }).click()
    const modal = page.locator('.modal')
    await modal.getByLabel('Neuer Stichwortname').fill('Diss')
    await modal.getByRole('button', { name: 'Erstellen' }).click()
    await modal.waitFor({ state: 'detached' })
    try {
      await page.getByPlaceholder('Suche in allen Projekten…').filter({ visible: true }).first().fill('E2E APA')
      await page.getByRole('checkbox', { name: 'E2E APA auswählen' }).check()
      await page.getByRole('button', { name: 'Stichworte' }).click()
      await page.locator('.dropdown-menu.show').getByRole('menuitem', { name: 'Diss' }).click()
      await page.keyboard.press('Escape')
      await page.getByPlaceholder('Suche in allen Projekten…').filter({ visible: true }).first().fill('')
      await seite.getByRole('button', { name: 'Diss (1)' }).click()
      await page.waitForURL(/\/project\/tags\//)
      const zeilen = page.locator('table tbody tr').filter({ visible: true })
      await zeilen.first().getByRole('link', { name: 'E2E APA' }).waitFor()
      ok((await zeilen.count()) === 1, `Stichwort zeigt ${await zeilen.count()} Projekte`)
      await breite(360)
      await ohneSeitlichesRollen('Projektliste 360 px')
      await breite(1280)
    } finally {
      await page.getByRole('button', { name: 'Aktionsmenü für Diss öffnen' }).click()
      await page.locator('.dropdown-menu.show').getByRole('menuitem', { name: 'Löschen' }).click()
      await modal.getByRole('button', { name: 'Löschen', exact: true }).click()
      await modal.waitFor({ state: 'detached' })
    }
    ok(!(await seite.innerText()).includes('Diss'), 'Stichwort nicht gelöscht')
  }

  const ANLEITUNG = [
    ['spur bei Claude Code bekannt machen', 'Das brauchst du nur einmal pro Rechner.'],
    ['spur mit deinem Konto verbinden', 'Der Befehl enthält deinen persönlichen Schlüssel. Gib ihn nicht weiter.'],
    [
      'Claude Code starten',
      'Starte damit Claude Code im Terminal. Claude darf dann in spur schreiben, ohne bei jedem Schritt nachzufragen. Den Befehl brauchst du bei jedem Start; er steht auch im Claude-Panel deines Projekts.',
    ],
  ]
  const SCHREIBWERKZEUGE = ['quote_mark', 'doc_edit', 'doc_create', 'reply', 'run_finish', 'wait_for_event']
  const START = `claude --allowedTools "${SCHREIBWERKZEUGE.map(w => `mcp__plugin_spur_spur__${w}`).join(' ')}"`

  // Kein Kasten ist breiter als sein Container, kein Befehl wird abgeschnitten.
  async function kaestenGanz(wo) {
    const falsch = await page.locator('.spur-befehl-kasten').evaluateAll(kaesten =>
      kaesten
        .map(k => {
          const pre = k.querySelector('pre')
          const eltern = k.parentElement.getBoundingClientRect()
          return pre.scrollWidth > pre.clientWidth || pre.scrollHeight > pre.clientHeight + 1 || k.getBoundingClientRect().right > eltern.right + 1
            ? pre.textContent.slice(0, 40)
            : null
        })
        .filter(Boolean)
    )
    ok(falsch.length === 0, `${wo}: abgeschnitten oder zu breit: ${falsch}`)
  }

  features.p5f3 = async () => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await page.goto(`${BASE}/user/settings`)
    await page.getByRole('button', { name: 'Token erzeugen' }).click()
    const neu = page.locator('.spur-token-neu')
    await neu.getByRole('heading', { name: 'So verbindest du Claude Code' }).waitFor()
    await neu.getByText('Deinen Schlüssel siehst du nur jetzt. Kopiere die Befehle, bevor du die Seite verlässt.', { exact: true }).waitFor()
    const token = await neu.getAttribute('data-spur-token')
    const schritte = neu.locator('ol > li')
    ok((await schritte.count()) === 3, `Schritte: ${await schritte.count()}`)
    const befehle = [
      'claude plugin marketplace add ahlerjam/spur',
      `claude plugin install spur@spur --config server_url=${BASE}/spur/mcp --config token=${token}`,
      START,
    ]
    for (const [i, [titel, text]] of ANLEITUNG.entries()) {
      const schritt = schritte.nth(i)
      ok((await schritt.getByRole('heading').innerText()) === titel, `Schritt ${i + 1}: ${await schritt.getByRole('heading').innerText()}`)
      await schritt.getByText(text, { exact: true }).waitFor()
      ok((await schritt.locator('pre').textContent()) === befehle[i], `Befehl ${i + 1}: ${await schritt.locator('pre').textContent()}`)
      ok((await schritt.getByRole('button', { name: 'Kopieren' }).count()) === 1, `Schritt ${i + 1} ohne Kopierknopf`)
    }
    await schritte.nth(1).getByRole('button', { name: 'Kopieren' }).click()
    await schritte.nth(1).getByRole('button', { name: 'Kopiert' }).waitFor()
    const kopiert = await page.evaluate(() => navigator.clipboard.readText())
    ok(kopiert === befehle[1], `Zwischenablage: ${kopiert}`)
    ok((await neu.getByRole('button', { name: 'Kopieren' }).count()) === 2, 'Andere Knöpfe zeigen nicht mehr „Kopieren“')
    await kaestenGanz('Token-Dialog 1280 px')
    await breite(360)
    await kaestenGanz('Token-Dialog 360 px')
    await ohneSeitlichesRollen('Kontoeinstellungen 360 px')
    await breite(1280)

    await projektOeffnen('Demo')
    await panelOeffnen('Claude')
    await claudePanel().getByText('Claude nicht verbunden').waitFor()
    const kasten = claudePanel().locator('.spur-befehl-kasten')
    ok((await kasten.locator('pre').textContent()) === START, `Startbefehl im Panel: ${await kasten.locator('pre').textContent()}`)
    await kaestenGanz('Claude-Panel')
    await kasten.getByRole('button', { name: 'Kopieren' }).click()
    await kasten.getByRole('button', { name: 'Kopiert' }).waitFor()
    ok((await page.evaluate(() => navigator.clipboard.readText())) === START, 'Panel kopiert nicht den Startbefehl')
    // Der Befehl muss in beiden Designs des Editors lesbar sein (Abnahme: im dunklen Design 1:1).
    const vorher = await page.evaluate(() => JSON.parse(document.querySelector('meta[name="ol-userSettings"]').content).overallTheme)
    try {
      for (const thema of ['', 'light-']) {
        await seitenPost('/user/settings', { overallTheme: thema })
        await projektOeffnen('Demo')
        await panelOeffnen('Claude')
        const pre = claudePanel().locator('.spur-befehl-kasten pre')
        await pre.waitFor()
        const k = await kontrast(pre)
        ok(k >= 4.5, `Startbefehl im Design „${thema || 'dunkel'}“: Kontrast ${k.toFixed(2)}`)
      }
    } finally {
      await seitenPost('/user/settings', { overallTheme: vorher })
    }
  }

  features.p5f4 = async () => {
    await anmelden('e2e-a@example.org')
    // Ein neues Projekt (vorbereiten.mjs) hat noch keine Quellen und, nach dem Hochladen, eine leere Zitatliste.
    try {
      for (const px of [1280, 360]) {
        await breite(px)
        await page.goto(`${BASE}/user/settings`)
        const text = await page.locator('.spur-claude-verbinden p.small').first().innerText()
        ok(text.startsWith('Verbinde dein eigenes Claude Code.'), `Claude verbinden: ${text}`)
        await ohneSeitlichesRollen(`Einstellungen ${px} px`)

        await projektOeffnen('E2E Leer P5')
        await panelOeffnen('Quellen')
        if (px === 1280) {
          await sichtbar('Noch keine Quellen')
          await hochladen('smith2024.pdf')
        }
        await page.getByRole('button', { name: 'smith2024.pdf' }).click()
        await sichtbar('Markiere oben Text und speichere ihn als Zitat.')
        await panelOeffnen('Recherche')
        await sichtbar('Suche nach einem Thema, einem Titel oder einer DOI.')
        await panelOeffnen('Vorschläge')
        await sichtbar('Vorschläge sind aus. Stell oben einen Auslöser auf „Vorschlag“.')
        for (const name of ['Quellen', 'Recherche', 'Vorschläge', 'Claude']) {
          const panel = page.getByRole('tabpanel', { name })
          await panelSichern(name, panel)
          ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), `${name} läuft über bei ${px} px`)
          ok(!/\b(Sie|Ihr|Ihre|Ihnen)\b/.test(await panel.innerText()), `${name} siezt: ${await panel.innerText()}`)
          const schlecht = await unlesbar(panel)
          ok(schlecht.length === 0, `${name} bei ${px} px schlecht lesbar: ${schlecht.join(' | ')}`)
        }
        await ohneSeitlichesRollen(`Editor ${px} px`)
      }
    } finally {
      await breite(1280)
    }
  }

  features.p5f5 = async () => {
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Chat')
    const pid = page.url().split('/').pop()
    const antwort = await seitenPost(`/spur/project/${pid}/vorschlaege/tipp-pause`, { doc_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' })
    ok(
      antwort.status === 404 && antwort.daten.title === 'doc_fehlt' && antwort.daten.detail === 'Das Dokument gibt es nicht (mehr).',
      `tipp-pause: ${antwort.status} ${JSON.stringify(antwort.daten)}`
    )
    const falsch = await werkzeug(ADA, 'doc_edit', {
      project_id: pid, pfad: 'main.tex', alt: 'Diesen Text gibt es nicht.', neu: 'x', idempotenz_schluessel: 'p5f5-falsch',
    })
    ok(
      falsch.fehler && falsch.inhalt.fehler === 'konflikt' &&
        falsch.inhalt.detail === 'Der erwartete Alttext steht nicht im Dokument. Bitte neu lesen.',
      `doc_edit: ${JSON.stringify(falsch.inhalt)}`
    )

    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Scan')
    await panelOeffnen('Quellen')
    await page.route(/\/seiten\/1\/bild$/, route => route.continue({ url: route.request().url().replace(/\/1\/bild$/, '/999/bild') }))
    try {
      await page.getByRole('button', { name: 'scan.pdf' }).click()
      await page.locator('.spur-panel .notification', { hasText: 'Diese Seite gibt es in der Quelle nicht.' }).waitFor()
      ok((await page.locator('img.spur-seitenbild').count()) === 0, 'Kaputtes Seitenbild statt Hinweis')
    } finally {
      await page.unroute(/\/seiten\/1\/bild$/)
    }
  }

  async function grossOeffnen() {
    const knopf = page.getByRole('button', { name: 'Groß öffnen' })
    await knopf.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    return { knopf, dialog }
  }

  features.p5f6 = async () => {
    const SATZ = 'Sleep supports the consolidation of declarative memory.'
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Quellen')
    await panelOeffnen('Quellen')
    if (!(await page.getByRole('button', { name: 'smith2024.pdf' }).isVisible())) await hochladen('smith2024.pdf')
    await page.getByRole('button', { name: 'smith2024.pdf' }).click()
    await page.locator('img.spur-seitenbild').waitFor()
    const leiste = page.locator('.spur-panel-werkzeuge')
    const kanten = await Promise.all(
      [leiste.getByRole('button', { name: 'Zurück' }), leiste.locator('.spur-seitenzahl'), leiste.getByRole('button', { name: 'Vorherige Seite' }), leiste.getByRole('button', { name: 'Nächste Seite' })].map(
        async l => Math.round((await l.boundingBox()).y + (await l.boundingBox()).height / 2)
      )
    )
    ok(Math.max(...kanten) - Math.min(...kanten) <= 4, `Werkzeugleiste nicht in einer Zeile: ${kanten}`)
    const panelBreite = (await page.locator('img.spur-seitenbild').boundingBox()).width

    const { knopf, dialog } = await grossOeffnen()
    await dialog.getByRole('heading', { name: 'smith2024.pdf' }).waitFor()
    // Die Seitenbeschriftung hängt vom Versatz ab, den frühere Features bestätigen.
    const SEITE = n => new RegExp(`^Seite (\\S+ \\(PDF-Seite ${n} von 8\\)|${n} von 8)$`)
    await dialog.getByText(SEITE(1)).waitFor()
    const bild = dialog.locator('img.spur-seitenbild')
    await bild.waitFor()
    const grossBreite = (await bild.boundingBox()).width
    ok(grossBreite >= 2 * panelBreite, `Seitenbild ${grossBreite} px, im Panel ${panelBreite} px`)
    const vorige = dialog.getByRole('button', { name: 'Vorherige Seite' })
    ok(await vorige.isDisabled(), 'Vorherige Seite auf Seite 1 aktiv')
    await dialog.getByRole('button', { name: 'Nächste Seite' }).click()
    await dialog.getByText(SEITE(2)).waitFor()
    await vorige.click()
    await dialog.getByText(SEITE(1)).waitFor()

    const groesser = dialog.getByRole('button', { name: 'Vergrößern' })
    const kleiner = dialog.getByRole('button', { name: 'Verkleinern' })
    await dialog.getByText('100 %', { exact: true }).waitFor()
    await groesser.click()
    await dialog.getByText('125 %', { exact: true }).waitFor()
    await groesser.click()
    await dialog.getByText('150 %', { exact: true }).waitFor()
    await kleiner.click()
    await dialog.getByText('125 %', { exact: true }).waitFor()
    await groesser.click()
    await groesser.click()
    await dialog.getByText('200 %', { exact: true }).waitFor()
    ok(await groesser.isDisabled(), 'Vergrößern bei 200 % aktiv')
    const flaeche = dialog.locator('.spur-gross-bild')
    ok(await flaeche.evaluate(el => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight), 'Seite bei 200 % nicht rollbar')
    await ohneSeitlichesRollen('Große Ansicht 200 %')
    for (let i = 0; i < 4; i++) await kleiner.click()
    await dialog.getByText('75 %', { exact: true }).waitFor()
    ok(await kleiner.isDisabled(), 'Verkleinern bei 75 % aktiv')

    await dialog.getByRole('button', { name: 'Nächste Seite' }).click()
    await dialog.getByRole('button', { name: 'Nächste Seite' }).click()
    await dialog.locator('.spur-seitentext', { hasText: SATZ }).waitFor()
    await textMarkieren(SATZ, dialog)
    await dialog.getByRole('button', { name: 'Zitat speichern' }).click()
    await dialog.locator('.spur-zitate li', { hasText: SATZ }).waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    ok(await knopf.evaluate(el => el === document.activeElement), 'Fokus nach Esc nicht auf „Groß öffnen“')
    await page.getByRole('tabpanel', { name: 'Quellen' }).locator('.spur-zitate li', { hasText: SATZ }).waitFor()
    const zweiter = await grossOeffnen()
    await zweiter.dialog.getByRole('button', { name: 'Schließen', exact: true }).click()
    await zweiter.dialog.waitFor({ state: 'detached' })
    ok(await knopf.evaluate(el => el === document.activeElement), 'Fokus nach „Schließen“ nicht auf „Groß öffnen“')

    await breite(360)
    const klein = await grossOeffnen()
    const box = await klein.dialog.locator('.modal-content').boundingBox()
    ok(box.width >= 355 && box.x <= 1, `Große Ansicht bei 360 px: ${JSON.stringify(box)}`)
    const zuKlein = await klein.dialog.getByRole('button').evaluateAll(knoepfe =>
      knoepfe.filter(k => k.offsetParent).map(k => [k.textContent.trim() || k.getAttribute('aria-label'), k.getBoundingClientRect()]).filter(([, r]) => r.width < 24 || r.height < 24).map(([n]) => n)
    )
    ok(zuKlein.length === 0, `Knöpfe unter 24 px: ${zuKlein}`)
    await ohneSeitlichesRollen('Große Ansicht 360 px')
    await page.keyboard.press('Escape')
    await klein.dialog.waitFor({ state: 'detached' })
    await breite(1280)

    for (const [projekt, quelle] of [['E2E Scan', 'scan.pdf']]) {
      await projektOeffnen(projekt)
      await panelOeffnen('Quellen')
      await page.getByRole('button', { name: quelle }).click()
      const { dialog: d } = await grossOeffnen()
      await d.getByRole('heading', { name: quelle }).waitFor()
      await d.locator('img.spur-seitenbild').waitFor()
      await page.keyboard.press('Escape')
      await d.waitFor({ state: 'detached' })
    }
    await projektOeffnen('E2E Web')
    await panelOeffnen('Quellen')
    const web = page.getByRole('button', { name: 'Schlafhygiene im Schichtdienst' })
    if (!(await web.isVisible())) {
      await page.getByRole('button', { name: 'Webseite aufnehmen' }).click()
      await page.getByLabel('Adresse der Webseite').fill('http://127.0.0.1/spur/dev/web/testseite')
      await page.getByRole('button', { name: 'Aufnehmen', exact: true }).click()
    }
    await web.click()
    const { dialog: w } = await grossOeffnen()
    await w.locator('.spur-seitentext', { hasText: 'Regular sleep times' }).waitFor()
    await page.keyboard.press('Escape')
    await w.waitFor({ state: 'detached' })
  }

  features.p5f7 = async () => {
    await breite(1280)
    await anmelden('e2e-p3a@example.org')
    await projektOeffnen('E2E Workflows')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    await verbinden(ADA)
    await claudePanel().getByText('Workflows', { exact: true }).click()
    const knoepfe = await claudePanel().locator('.spur-workflow > button').allInnerTexts()
    ok(
      JSON.stringify(knoepfe) === JSON.stringify(['Literaturüberblick', 'Methodenteil', 'Folien aus Paper', 'Quellen sammeln']),
      `Workflows: ${knoepfe}`
    )
    const hilfe = await claudePanel().getByRole('list', { name: 'Befehle in Claude Code' }).getByRole('listitem').allInnerTexts()
    ok(hilfe[3] === '/plugin:spur:spur:quellen_sammeln', `Befehl: ${hilfe[3]}`)

    await claudePanel().getByRole('button', { name: 'Quellen sammeln', exact: true }).click()
    const thema = claudePanel().getByLabel('Thema')
    const anzahl = claudePanel().getByLabel('Anzahl')
    ok((await anzahl.inputValue()) === '20', `Anzahl vorbelegt: ${await anzahl.inputValue()}`)
    const starten = claudePanel().getByRole('button', { name: 'Sammeln starten' })
    const beschreibung = async feld => page.locator(`#${await feld.getAttribute('aria-describedby')}`).innerText()
    await starten.click()
    await claudePanel().getByText('Gib ein Thema an.').waitFor()
    ok((await thema.getAttribute('aria-invalid')) === 'true' && (await beschreibung(thema)).includes('Gib ein Thema an.'), 'Themenfehler nicht am Feld')
    await thema.fill('Schlaf und Gedächtnis')
    for (const wert of ['abc', '0']) {
      await anzahl.fill(wert)
      await starten.click()
      await claudePanel().getByText('Gib eine Zahl ab 1 oder „max“ an.').waitFor()
      ok((await anzahl.getAttribute('aria-invalid')) === 'true' && (await beschreibung(anzahl)).includes('Gib eine Zahl ab 1 oder „max“ an.'), `Anzahl „${wert}“ nicht am Feld gemeldet`)
    }
    for (const px of [360, 1280]) {
      await breite(px)
      await ohneSeitlichesRollen(`Formular ${px} px`)
      ok(await claudePanel().evaluate(el => el.scrollWidth <= el.clientWidth), `Claude-Panel läuft über bei ${px} px`)
    }
    await breite(1280)
    // Formular samt Fehlern und Befehlsliste im dunklen Design lesbar (die Abnahme fand dort Kontrast 1:1).
    const design = await page.evaluate(() => JSON.parse(document.querySelector('meta[name="ol-userSettings"]').content).overallTheme)
    await page.evaluate(() => window.__spur.abbruch.abort())
    try {
      await seitenPost('/user/settings', { overallTheme: '' })
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Claude')
      await verbinden(ADA)
      const workflows = claudePanel().locator('details.spur-workflows')
      if (!(await workflows.evaluate(el => el.open))) await workflows.locator('summary').click()
      await claudePanel().getByRole('button', { name: 'Quellen sammeln', exact: true }).click()
      await claudePanel().getByLabel('Anzahl').fill('abc')
      await claudePanel().getByRole('button', { name: 'Sammeln starten' }).click()
      await claudePanel().getByText('Gib ein Thema an.').waitFor()
      const schlecht = await unlesbar(claudePanel())
      ok(schlecht.length === 0, `Formular im dunklen Design schlecht lesbar: ${schlecht.join(' | ')}`)
      await page.evaluate(() => window.__spur.abbruch.abort())
    } finally {
      await seitenPost('/user/settings', { overallTheme: design })
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Claude')
    }
    await verbinden(ADA)
    await claudePanel().getByText('Workflows', { exact: true }).click()
    await claudePanel().getByRole('button', { name: 'Quellen sammeln', exact: true }).click()
    await thema.fill('Schlaf und Gedächtnis')
    await anzahl.fill('30')
    await starten.click()
    await page.waitForFunction(() => window.__spur.log.some(e => e.msg?.result), null, { timeout: 5000 })
    const { ereignis } = await page.evaluate(() => JSON.parse(window.__spur.log.find(e => e.msg?.result).msg.result.content[0].text))
    await page.evaluate(() => window.__spur.abbruch.abort())
    const text = ereignis?.daten.text ?? ''
    ok(ereignis?.typ === 'task_created' && ereignis.project_id === pid && ereignis.daten.workflow === 'quellen_sammeln', `Auftrag: ${JSON.stringify(ereignis).slice(0, 200)}`)
    ok(text.includes('Thema: Schlaf und Gedächtnis') && text.includes('Anzahl: 30'), `Thema oder Anzahl fehlen: ${text.slice(-200)}`)
    for (const teil of ['paper_citations', 'Zitationszahl', 'Abstract', '„wichtig“ oder „nicht wichtig“', 'acquisition_add', 'run_finish', 'Literaturüberblick']) {
      ok(text.includes(teil), `Workflow-Text ohne „${teil}“`)
    }

    const { daten } = await mcp(ADA, 'prompts/list')
    const prompt = daten.result.prompts.find(p => p.name === 'quellen_sammeln')
    ok(
      JSON.stringify(prompt?.arguments.map(a => [a.name, Boolean(a.required)])) === '[["thema",true],["anzahl",false]]',
      `prompts/list: ${JSON.stringify(prompt)}`
    )
    const viaMcp = await promptText('quellen_sammeln', { thema: 'Schlaf' })
    ok(viaMcp === text.replace('Thema: Schlaf und Gedächtnis', 'Thema: Schlaf').replace('Anzahl: 30', 'Anzahl: 20'), 'prompts/get liefert einen anderen Text als das Panel')
    ok(/Anzahl: max\. Es gibt keine Obergrenze; arbeite in Etappen\./.test(await promptText('quellen_sammeln', { thema: 'Schlaf', anzahl: 'max' })), 'max ohne Hinweis auf Etappen')

    // Ablauf wie Claude mit dem Paper-Fake: suchen, frei aufnehmen, nicht frei beschaffen, Duplikat erkennen.
    const suche = await werkzeug(ADA, 'paper_search', { project_id: pid, anfrage: 'sleep memory' })
    const treffer = suche.inhalt.treffer
    ok(treffer.length > 0 && treffer.every(t => typeof t.abstract === 'string'), `Abstracts: ${JSON.stringify(treffer.map(t => t.abstract)).slice(0, 200)}`)
    const frei = treffer.find(t => t.frei && t.abstract)
    const unfrei = treffer.find(t => t.frei === false && t.abstract)
    ok(frei && unfrei && treffer.some(t => t.abstract === ''), `Treffer: ${JSON.stringify(treffer.map(t => [t.doi, t.frei, t.abstract.length]))}`)
    const aufgenommen = await werkzeug(ADA, 'source_add', { project_id: pid, doi: frei.doi })
    ok(!aufgenommen.fehler, `source_add: ${JSON.stringify(aufgenommen.inhalt)}`)
    const doppelt = await werkzeug(ADA, 'source_add', { project_id: pid, doi: frei.doi })
    ok(doppelt.fehler && doppelt.inhalt.fehler === 'quelle_vorhanden', `Duplikat: ${JSON.stringify(doppelt.inhalt)}`)
    const beschafft = await werkzeug(ADA, 'acquisition_add', { project_id: pid, doi: unfrei.doi })
    ok(!beschafft.fehler, `acquisition_add: ${JSON.stringify(beschafft.inhalt)}`)
    await panelOeffnen('Quellen')
    await page.getByRole('button', { name: aufgenommen.inhalt.dateiname }).waitFor()
    await panelOeffnen('Recherche')
    await page.getByRole('tab', { name: 'Beschaffung' }).click()
    await page.getByRole('tabpanel', { name: 'Recherche' }).getByText(unfrei.titel).first().waitFor()

    await adminWorkflowText('Quellen sammeln', async abschnitt => {
      await abschnitt.getByText('/plugin:spur:spur:quellen_sammeln', { exact: true }).waitFor()
      await abschnitt.getByLabel('Text für „Quellen sammeln“').fill('Workflow „Quellen sammeln“ (angepasst).')
      await abschnitt.getByRole('button', { name: 'Speichern' }).click()
      await abschnitt.getByText('Gespeichert. Der neue Text gilt ab sofort.').waitFor()
    })
    try {
      ok((await promptText('quellen_sammeln', { thema: 'Schlaf' })).startsWith('Workflow „Quellen sammeln“ (angepasst).'), 'Änderung gilt nicht')
    } finally {
      await adminWorkflowText('Quellen sammeln', async abschnitt => {
        await abschnitt.getByRole('button', { name: 'Standard wiederherstellen' }).click()
        await abschnitt.getByText('Standardtext wiederhergestellt.').waitFor()
      })
    }
    ok((await promptText('quellen_sammeln', { thema: 'Schlaf' })) === viaMcp, 'Standardtext nicht wiederhergestellt')
  }

  features.p5f8 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const readme = await repoDatei(`${REPO}/README.md`)
    const teile = ['### Prerequisites', 'make start', '### First admin account', '/launchpad', '### Settings', 'SPUR_URL', 'SPUR_PORT', 'SPUR_IMAGE', 'OVERLEAF_SITE_LANGUAGE', '### Public operation', 'docker-compose.sandbox.yml', '#### HTTPS', 'reverse_proxy', '### Backup']
    const stellen = teile.map(t => readme.indexOf(t))
    ok(stellen.every((x, i) => x > 0 && (i === 0 || x > stellen[i - 1])), `Installation in falscher Reihenfolge: ${JSON.stringify(teile.map((t, i) => [t, stellen[i]]))}`)
    ok(/MongoDB 8/.test(readme) && readme.includes('git clone'), 'Voraussetzungen oder git clone fehlen')
    for (const name of ['literaturueberblick', 'methodenteil', 'folien', 'quellen_sammeln']) {
      ok(readme.includes(`/plugin:spur:spur:${name}`), `README ohne /plugin:spur:spur:${name}`)
    }
    for (const befehl of ['claude plugin marketplace add ahlerjam/spur', 'claude plugin install spur@spur', START]) {
      ok(readme.includes(befehl), `README ohne Schritt: ${befehl.slice(0, 40)}`)
    }
    for (const datei of ['README.md', 'CLAUDE.md', 'docs/backlog.md', 'docs/mcp-contract.md', 'plugins/spur/skills/spur/SKILL.md']) {
      const text = await repoDatei(`${REPO}/${datei}`)
      ok(!/[–—]/.test(text), `${datei} enthält Gedankenstriche`)
      const deutsch = (text.replace(/`[^`]*`|„[^“]*“|"[^"]*"/g, '').match(/\b(und|nicht|oder|wird|werden|Sie)\b/g) ?? []).length
      ok(deutsch === 0, `${datei}: ${deutsch} deutsche Wörter außerhalb von Code und Zitaten`)
    }
    const backlog = await repoDatei(`${REPO}/docs/backlog.md`)
    const eintraege = backlog.split('\n').filter(z => z.startsWith('- ')).length
    ok(eintraege === 35, `Backlog hat ${eintraege} Einträge statt 35`)
    ok(/transformers/i.test(backlog) && /tesseract/i.test(backlog) && /1616/.test(backlog), 'Backlog ohne Transformers, Tesseract oder 1616 Übersetzungen')
  }

  // Jeder Lauf beginnt auf denselben Daten, auch nach einem früheren Lauf.
  const bereit = await page.request.post(`${BASE}/spur/dev/e2e/vorbereiten`, { timeout: 300000 })
  if (bereit.status() !== 204) return `vorbereiten FEHLER: ${bereit.status()} ${await bereit.text()}`
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
