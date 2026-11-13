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
    dashboardAufrufe.push(Date.now())
  }

  const KOMPILIEREN = /^(aktualisieren|recompile)$/i

  // Overleaf erlaubt je Person 30 Aufrufe der Projektliste in 60 s (openDashboard). Die Suite bleibt mit Abstand darunter,
  // sonst scheitern Schritte je nach Tempo des Rechners an „Rate limit reached“ oder an einem 429 in der Konsole.
  const dashboardAufrufe = []
  async function dashboardAufruf() {
    const jetzt = Date.now()
    while (dashboardAufrufe.length && jetzt - dashboardAufrufe[0] > 60000) dashboardAufrufe.shift()
    if (dashboardAufrufe.length >= 18) await page.waitForTimeout(Math.max(0, 61000 - (jetzt - dashboardAufrufe[0])))
    dashboardAufrufe.push(Date.now())
  }

  async function projektOeffnen(name, versuch = 1) {
    await dashboardAufruf()
    await page.goto(`${BASE}/project`)
    // Die Liste zeigt nur 20 Projekte; e2e-a hat mehr. Wie ein Mensch über die Suche filtern.
    try {
      await page
        .getByPlaceholder(/^(Suche in allen Projekten|Search in all projects)…$/)
        .filter({ visible: true })
        .first()
        .fill(name, { timeout: versuch === 1 ? 10000 : 30000 })
    } catch (error) {
      const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      // Overleaf erlaubt je Person 30 Aufrufe der Projektliste in 60 s (openDashboard); die Suite ruft sie öfter auf.
      if (versuch === 1 && /Rate limit reached/.test(text)) {
        dashboardAufrufe.length = 0
        await page.waitForTimeout(61000)
        return await projektOeffnen(name, 2)
      }
      fail(`Projektliste für „${name}“ nicht bereit (${page.url()}): ${text} – ${error.message.split('\n')[0]}`)
    }
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

  // Filter des Prüfberichts („Alle“, „Markiert“, …); ohne Stellen gibt es keinen Filter.
  async function berichtFilter(name) {
    const knopf = page.locator('.spur-filter label', { hasText: new RegExp(`^${name}\\s+\\d+$`) })
    if (await knopf.isVisible()) await knopf.click()
  }

  // Seltene Aktionen des Quellen-Panels stehen im Menü „Weitere Aktionen“.
  async function quellenMenue(name) {
    await page.locator('.spur-panel').getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }

  async function quelleHolen(projekt) {
    await quellenMenue('Aus anderem Projekt holen')
    await page.getByLabel('Projekt', { exact: true }).selectOption({ label: projekt })
    await page.locator('.modal').getByRole('button', { name: 'Holen', exact: true }).click()
    await page.locator('.modal').waitFor({ state: 'detached' })
  }

  // Markiert `text` im Seitentext, auch über mehrere Zeilen der Textebene über dem Seitenbild.
  async function textMarkieren(text, bereich = page) {
    await bereich.locator('.spur-seitentext', { hasText: text.split(' ')[0] }).first().evaluate((el, gesucht) => {
      const knoten = []
      const gang = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (gang.nextNode()) knoten.push(gang.currentNode)
      const ganz = knoten.map(k => k.textContent).join('')
      const start = ganz.indexOf(gesucht)
      if (start < 0) throw new Error(`Nicht im Seitentext: ${gesucht}`)
      const stelle = ziel => {
        let rest = ziel
        for (const k of knoten) {
          if (rest <= k.textContent.length) return [k, rest]
          rest -= k.textContent.length
        }
      }
      const bereich = document.createRange()
      bereich.setStart(...stelle(start))
      bereich.setEnd(...stelle(start + gesucht.length))
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
    let cursor
    do {
      const { inhalt } = await werkzeug(token, 'project_list', cursor ? { cursor } : {})
      const treffer = inhalt.eintraege.find(p => p.name === name)
      if (treffer) return treffer.id
      cursor = inhalt.naechster_cursor
    } while (cursor)
    fail(`Projekt „${name}“ nicht in project_list`)
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

  // „Zitiert von“ und „Zitiert“ stehen je Treffer im Menü „Weitere Aktionen“.
  async function trefferMenue(treffer, name) {
    await treffer.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
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

  const KOPFZEILE_BERICHT = /^\d+ Stellen?, (\d+ markiert|keine markiert)/
  async function kopfzeileAbwarten(erwartet, timeout = 60000) {
    try {
      await page.getByText(erwartet, { exact: true }).waitFor({ timeout })
    } catch {
      const ist = await page.locator('p.spur-zeile-meta', { hasText: KOPFZEILE_BERICHT }).first().innerText({ timeout: 2000 }).catch(() => '-')
      fail(`Kopfzeile „${ist}“, erwartet „${erwartet}“`)
    }
  }

  const ZAEHLUNG_BERICHT = '9 Stellen, 6 markiert: 3 mit Befund, 2 ohne Quelle, 1 nicht prüfbar'

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
        (await page.getByRole('button', { name: 'Quelle hinzufügen' }).count()) === 0,
        'read-Mitglied sieht „Quelle hinzufügen“'
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
      await sichtbar('100 von 300')
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
      await quellenMenue('Aus anderem Projekt holen')
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
        quellenMenue('Quellen exportieren'),
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
      // P8 f2: Kopfzeile auf den frischen Testdaten, bevor dieser Schritt das Projekt ändert.
      await page.getByText(ZAEHLUNG_BERICHT, { exact: true }).waitFor({ timeout: 30000 })
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
      await zeigt('unbekannt', 'DOI nicht registriert')
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
      await berichtFilter('Markiert')
      const probleme = await page.locator('.spur-zeile').count()
      ok(probleme < alle, `Filter: ${probleme} von ${alle}`)
      ok(
        (await page.locator('.spur-zeile', { hasText: 'kapitel.tex' }).count()) === 0,
        'Grüne Zeile trotz Filter'
      )
      await berichtFilter('Alle')

      // P6: Der Cache von Abschnitten erscheint nicht mehr; die Zählung der Zitierstellen bleibt gleich.
      const zaehlung = await page.locator('p.spur-zeile-meta', { hasText: KOPFZEILE_BERICHT }).innerText()
      await editorErsetzen('\\section{Zwei}', '\\section{Zwei!}')
      await page.getByText(zaehlung, { exact: true }).waitFor()
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
      await page.locator('.modal').getByRole('button', { name: 'Widerrufen' }).click()
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
      // P7: Pakete pro Projekt.
      const P7 = ['tex_package_add', 'source_upload_link']
      const erwartet = [...P1, ...P2, ...P3, ...P7].sort()
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
    await panelSichern('Überprüfung', page.locator('.review-panel-entry-user').first())
    await page
      .locator('.review-panel-entry-user', { hasText: 'Claude (e2e-a)' })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(async () =>
        fail(`Review-Panel: ${(await page.locator('.review-panel-entry-user').allInnerTexts()).join(' | ')}`)
      )
    await railTab('Überprüfung').click()
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

  // Die neueste Lauf-Karte steht oben im Claude-Panel.
  const karte = () => page.locator('.spur-lauf-karte').first()
  const AUTOMATIK = { name: 'Alles von Claude automatisch annehmen' }

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
    // Der Schalter wirkt ab dem nächsten Schreiben (P9); erst auf die Antwort warten, dann schreiben.
    const schalter = page.getByRole('switch', AUTOMATIK)
    await schalter.waitFor({ timeout: 20000 })
    if (!(await schalter.isChecked())) {
      await Promise.all([page.waitForResponse(r => r.url().endsWith('/claude/automatik')), schalter.check()])
    }
    ok(!(await edit({ alt: 'Gamma', neu: 'Gamma eins' })).fehler, 'Start')
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
      (await page.getByRole('switch', AUTOMATIK).count()) === 0,
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
    await page.locator('.spur-panel-inhalt').getByText('Keine Treffer für „xyzzy“. Prüf die Schreibweise oder such nach der DOI.', { exact: true }).waitFor()
  }

  features.p2f2 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Recherche')
    await panelOeffnen('Recherche')
    await page.getByRole('tab', { name: 'Treffer' }).click()
    await paperSuchen('sleep memory consolidation')
    const treffer = paperTreffer('The memory function of sleep')
    await trefferMenue(treffer, 'Zitiert von')
    const zitiertVon = treffer.getByRole('region', { name: 'Zitiert von' })
    await zitiertVon.getByText('Sleep spindles predict overnight memory consolidation').waitFor()
    await trefferMenue(treffer, 'Zitiert')
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
      // P9: Die Exporte stehen im Menü „Liste exportieren“.
      await page.getByRole('button', { name: 'Liste exportieren' }).click()
      const knopf = page.getByRole('menuitem', { name: `Als ${format} exportieren` })
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
      await quellenMenue('Importieren')
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
    const quellen = page.locator('.spur-panel .spur-liste .spur-quelle-titel')
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
      await quellenMenue('Literaturmatrix')
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
    await karte().getByText('Zahl ohne Beleg: 412', { exact: true }).waitFor()

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
    await sichtbar('Markiere Text auf der Seite und speichere ihn als Zitat.')

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
      await quellenMenue('Webseite aufnehmen')
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
    await quellenMenue('Webseite aufnehmen')
    await page.getByLabel('Adresse der Webseite').fill('http://nicht-erreichbar.invalid/')
    await page.getByRole('button', { name: 'Aufnehmen', exact: true }).click()
    await sichtbar('Seite nicht erreichbar. Bitte die Adresse prüfen oder später erneut versuchen.')
    ok(
      (await page.getByLabel('Adresse der Webseite').inputValue()) === 'http://nicht-erreichbar.invalid/',
      'Adresse nach Fehler verloren'
    )
    const quellenListe = page.getByRole('tabpanel', { name: 'Quellen' }).locator('.spur-liste li')
    ok((await quellenListe.count()) === 1, `Nicht erreichbare Seite gespeichert: ${await quellenListe.count()}`)
    await page.keyboard.press('Escape')
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
      page.getByRole('button', { name: 'Quelle hinzufügen', exact: true }).first().boundingBox(),
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
    await startbefehlZeigen()
    await claudePanel().getByText(/claude --allowedTools/).waitFor()
    ok(await claudePanel().getByLabel('Auftrag an Claude').isDisabled(), 'Eingabefeld ohne Verbindung bedienbar')
    await claudePanel().getByText('Verbinde zuerst Claude').waitFor()

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
    await claudePanel().locator('.spur-lauf-karte').waitFor({ timeout: 15000 })
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
        // P9: Der Verlauf rollt in eigenem Bereich unter den Läufen; dort steht die neueste Nachricht unten.
        const r = el.getBoundingClientRect()
        const bereich = el.closest('.spur-chat-verlauf').getBoundingClientRect()
        return r.bottom <= bereich.bottom + 1 && r.top >= bereich.top - 1
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
    await panelSichern('Überprüfung', eintrag.getByText(text).first())
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
    ok((await vorschlaegePanel().getByText('Standard für alle im Projekt', { exact: true }).count()) === 1, 'Bo darf schreiben')
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
    await claudePanel().locator('.spur-lauf-karte').waitFor({ timeout: 15000 })

    // Tageslimit 2 an einem festen Tag: der dritte Auslöser erzeugt nichts.
    await panelOeffnen('Vorschläge')
    await vorschlaegePanel().getByLabel('Tageslimit, für alle Projekte').fill('2')
    await aufAntwort('/spur/vorschlaege/limit', () => vorschlaegePanel().locator('.spur-vorschlag-limit').getByRole('button', { name: 'Speichern' }).click())
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
    await aufAntwort('/spur/vorschlaege/limit', () => vorschlaegePanel().locator('.spur-vorschlag-limit').getByRole('button', { name: 'Speichern' }).click())
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

  // Der Fokus liegt (spätestens nach `timeout`) auf dem Element; sonst nennt die Meldung, wo er gelandet ist. Der Locator
  // wird bei jeder Abfrage neu aufgelöst und sieht auch in Shadow-DOMs (Kommentarfelder des Review-Panels).
  async function fokusAuf(element, wann, timeout = 5000) {
    const da = await element.and(page.locator(':focus')).first().waitFor({ state: 'attached', timeout }).then(() => true, () => false)
    if (da) return
    // Das tiefste fokussierte Element, auch hinter Shadow-Hosts.
    const wo = await page.evaluate(() => {
      let a = document.activeElement
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
      return a ? `${a.tagName}.${a.className}` : 'nichts'
    })
    ok(false, `Fokus ${wann} auf ${wo}`)
  }

  async function ohneSeitlichesRollen(wo) {
    const masse = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    ok(masse[0] <= masse[1], `${wo}: Seite rollt seitlich (${masse})`)
  }

  // Führt `schritte` im Editor-Design `thema` aus ('' dunkel, 'light-' hell) und stellt danach das vorige Design her.
  async function mitDesign(thema, schritte) {
    const vorher = await page.evaluate(() => JSON.parse(document.querySelector('meta[name="ol-userSettings"]').content).overallTheme)
    await seitenPost('/user/settings', { overallTheme: thema })
    try {
      return await schritte()
    } finally {
      await seitenPost('/user/settings', { overallTheme: vorher })
    }
  }

  // Alle sichtbaren, bedienbaren Texte eines Bereichs mit Kontrast unter 4,5:1 (WCAG, gegen den ersten
  // nicht durchsichtigen Hintergrund darunter).
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
      for (const el of [wurzel, ...wurzel.querySelectorAll('*')]) {
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
      for (const thema of ['light-', '']) {
        await mitDesign(thema, async () => {
          for (const px of [1280, 360]) {
            await breite(px)
            await projektOeffnen('E2E APA')
            const link = page.getByRole('link', { name: 'spur, zur Projektliste' })
            ok((await link.innerText()).trim() === 'spur', `Editor: ${await link.innerText()}`)
            const schlecht = await unlesbar(link)
            ok(schlecht.length === 0, `Schriftzug bei ${px} px, Thema „${thema}“: ${schlecht}`)
            ok(await link.evaluate(a => a.scrollWidth <= a.clientWidth && a.getBoundingClientRect().right <= innerWidth), `Schriftzug läuft über bei ${px} px`)
            await ohneSeitlichesRollen(`Editor ${px} px`)
          }
        })
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
      'Starte damit Claude Code im Terminal. Claude wartet dann von selbst auf Aufträge aus spur und darf dort schreiben, ohne bei jedem Schritt nachzufragen. Den Befehl brauchst du bei jedem Start; er steht auch im Claude-Panel deines Projekts.',
    ],
  ]
  const SCHREIBWERKZEUGE = ['quote_mark', 'doc_edit', 'doc_create', 'reply', 'run_finish', 'wait_for_event']
  const START_WERKZEUGE = `claude --allowedTools "${SCHREIBWERKZEUGE.map(w => `mcp__plugin_spur_spur__${w}`).join(' ')}"`
  const START = `${START_WERKZEUGE} -- "Warte mit wait_for_event auf Aufträge aus spur. Bei ereignis: null rufst du es sofort erneut auf, bei abgeloest tust du nichts; einen Auftrag erledigst du und rufst danach wait_for_event erneut auf."`
  const START_EN = `${START_WERKZEUGE} -- "Use wait_for_event to wait for tasks from spur. On ereignis: null call it again right away, on abgeloest do nothing; finish a task, then call wait_for_event again."`

  // Kein Kasten ist breiter als sein Container, kein Befehl wird abgeschnitten.
  // P9: Ist der Startbefehl schon bekannt, steht er eingeklappt hinter „Startbefehl anzeigen“.
  async function startbefehlZeigen() {
    const zeigen = claudePanel().getByRole('button', { name: 'Startbefehl anzeigen' })
    if (await zeigen.isVisible()) await zeigen.click()
  }

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
    await startbefehlZeigen()
    const kasten = claudePanel().locator('.spur-befehl-kasten')
    ok((await kasten.locator('pre').textContent()) === START, `Startbefehl im Panel: ${await kasten.locator('pre').textContent()}`)
    await kaestenGanz('Claude-Panel')
    await kasten.getByRole('button', { name: 'Kopieren' }).click()
    await kasten.getByRole('button', { name: 'Kopiert' }).waitFor()
    ok((await page.evaluate(() => navigator.clipboard.readText())) === START, 'Panel kopiert nicht den Startbefehl')
    // Der Befehl muss in beiden Designs des Editors lesbar sein (Abnahme: im dunklen Design 1:1).
    for (const thema of ['', 'light-']) {
      await mitDesign(thema, async () => {
        await page.reload()
        await page.locator('.cm-content').first().waitFor()
        await panelOeffnen('Claude')
        await startbefehlZeigen()
        const kasten = claudePanel().locator('.spur-befehl-kasten')
        await kasten.waitFor()
        const schlecht = await unlesbar(kasten)
        ok(schlecht.length === 0, `Startbefehl im Design „${thema || 'dunkel'}“: ${schlecht}`)
      })
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
        await sichtbar('Markiere Text auf der Seite und speichere ihn als Zitat.')
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
    const flaeche = dialog.locator('.spur-gross-bild')
    await page.waitForFunction(() => {
      const el = document.querySelector('.spur-gross-bild')
      return el.scrollWidth > el.clientWidth
    })
    await ohneSeitlichesRollen('Große Ansicht 200 %')
    await groesser.click()
    await groesser.click()
    await dialog.getByText('300 %', { exact: true }).waitFor()
    ok(await groesser.isDisabled(), 'Vergrößern bei 300 % aktiv')
    for (let i = 0; i < 6; i++) await kleiner.click()
    await dialog.getByText('75 %', { exact: true }).waitFor()
    await kleiner.click()
    await dialog.getByText('50 %', { exact: true }).waitFor()
    ok(await kleiner.isDisabled(), 'Verkleinern bei 50 % aktiv')
    ok(await flaeche.isVisible(), 'Seitenbereich fehlt')

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
    // Erst messen, wenn der Dialog fertig eingeblendet ist; währenddessen liegen die Maße kurz unter dem Endwert.
    await klein.dialog.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))))
    const zuKlein = await klein.dialog.getByRole('button').evaluateAll(knoepfe =>
      knoepfe.filter(k => k.offsetParent).map(k => [k.textContent.trim() || k.getAttribute('aria-label'), k.getBoundingClientRect()]).filter(([, r]) => r.width < 24 || r.height < 24).map(([n, r]) => `${n} ${r.width}×${r.height}`)
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
      await quellenMenue('Webseite aufnehmen')
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
    await page.evaluate(() => window.__spur.abbruch.abort())
    await mitDesign('', async () => {
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
    })
    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Claude')
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
    for (const befehl of ['claude plugin marketplace add ahlerjam/spur', 'claude plugin install spur@spur', START_EN]) {
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
    // P5: 35 Einträge; danach drei Ideen für P10 und sechs Zurückstellungen aus P8; P9 erledigte drei.
    ok(eintraege === 42, `Backlog hat ${eintraege} Einträge statt 42`)
    ok(/transformers/i.test(backlog) && /tesseract/i.test(backlog) && /lacks \d+ keys/.test(backlog), 'Backlog ohne Transformers, Tesseract oder fehlende Übersetzungen')
  }

  // P6: Befunde aus der ersten echten Claude-Session.
  features.p6f1 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await page.goto(`${BASE}/user/settings`)
    await page.getByRole('button', { name: 'Token erzeugen' }).click()
    const neu = page.locator('.spur-token-neu')
    const token = await neu.getAttribute('data-spur-token')
    const schritt3 = (await neu.locator('ol > li').nth(2).locator('pre').textContent()).trim()
    ok(schritt3.startsWith('claude --allowedTools "'), `Schritt 3 beginnt anders: ${schritt3}`)
    ok(/ -- "[^"]*wait_for_event[^"]*"$/.test(schritt3), `Schritt 3 endet ohne Prompt mit wait_for_event: ${schritt3}`)
    ok(schritt3 === START, `Schritt 3: ${schritt3}`)

    await projektOeffnen('Demo')
    await panelOeffnen('Claude')
    // Ohne laufende Session; ein Herzschlag eines früheren Features gilt noch bis zu 45 s.
    await claudePanel().getByText('Claude nicht verbunden').waitFor({ timeout: 50000 })
    await startbefehlZeigen()
    await claudePanel()
      .getByText('Starte Claude Code im Terminal mit diesem Befehl. Claude wartet danach von selbst auf Aufträge aus diesem Panel:', { exact: true })
      .waitFor()
    const kasten = claudePanel().locator('.spur-befehl-kasten')
    ok((await kasten.locator('pre').textContent()) === schritt3, 'Panel zeigt einen anderen Befehl als Schritt 3')
    ok((await kasten.getByRole('button', { name: 'Kopieren' }).count()) === 1, 'Panel ohne Kopierknopf')

    const start = Date.now()
    await warteStarten(token)
    await claudePanel().getByText('Claude verbunden', { exact: true }).waitFor({ timeout: 5000 })
    ok(Date.now() - start <= 5000, `„Claude verbunden“ erst nach ${Date.now() - start} ms`)
    await page.evaluate(() => window.__spur.abbruch.abort())
  }

  // Ergebnis des Long-Polls aus warteStarten: das zugestellte Ereignis oder null.
  async function gewartetesEreignis(timeout = 20000) {
    const handle = await page.waitForFunction(
      () => window.__spur.log.find(e => e.fehler || e.msg?.result)?.msg?.result ?? null,
      null,
      { timeout }
    )
    const ergebnis = await handle.jsonValue()
    return JSON.parse(ergebnis.content[0].text).ereignis
  }

  async function mitClaudeKommentieren(token, markieren, text) {
    while ((await werkzeug(token, 'wait_for_event', { max_sekunden: 1 })).inhalt.ereignis);
    await warteStarten(token)
    await markieren()
    await page.getByRole('button', { name: /^(Kommentar hinzufügen|Add comment)$/ }).click()
    const eingabe = page.locator('.review-panel-add-comment-editor .cm-content').first()
    await eingabe.waitFor()
    await eingabe.click()
    await page.keyboard.type(text)
    await page.getByRole('button', { name: /^(Kommentar|Comment)$/ }).click()
    const ereignis = await gewartetesEreignis()
    ok(ereignis?.typ === 'comment_mention', `Kein comment_mention: ${JSON.stringify(ereignis)}`)
    return ereignis.daten
  }

  // Markiert `text` in der Zeile, die ihn enthält, per Tastatur wie ein Mensch.
  async function imEditorMarkieren(text) {
    await page.evaluate(gesucht => {
      const view = window.overleaf.unstable.store.get('editor.view')
      const ende = view.state.doc.toString().indexOf(gesucht) + gesucht.length
      view.dispatch({ selection: { anchor: ende } })
      view.focus()
    }, text)
    for (let i = 0; i < text.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  }

  features.p6f2 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    await projektOeffnen('E2E P6 Kommentar')
    const pid = page.url().split('/').pop()
    await page.locator('.cm-line', { hasText: 'Ergebnisse.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Die Ausbeute lag bei 75,7 Prozent.')

    const offen = await mitClaudeKommentieren(token, () => imEditorMarkieren('75,7 Prozent'), '@claude prüf die Zahl')
    const docs = (await werkzeug(token, 'doc_list', { project_id: pid })).inhalt.eintraege
    const main = docs.find(d => d.pfad === 'main.tex')
    ok(
      offen.doc_id === main.id && offen.pfad === 'main.tex' && offen.stelle?.markiert === '75,7 Prozent' && offen.stelle.zeile === 4,
      `Offenes Dokument: ${JSON.stringify(offen)}`
    )

    // kapitel.tex war in diesem Lauf noch nie geladen, wie ein lange geschlossenes Dokument.
    const eintrag = page.locator('.file-tree').getByRole('treeitem', { name: 'kapitel.tex' })
    await panelSichern(DATEIBAUM, eintrag)
    await eintrag.click()
    await page.locator('.cm-content', { hasText: 'Im Kapitel' }).waitFor()
    const geschlossen = await mitClaudeKommentieren(token, () => imEditorMarkieren('81,2 Prozent'), '@claude und diese?')
    const kapitel = docs.find(d => d.pfad === 'kapitel.tex')
    ok(
      geschlossen.doc_id === kapitel.id && geschlossen.pfad === 'kapitel.tex' && geschlossen.stelle?.markiert === '81,2 Prozent' && geschlossen.stelle.zeile === 1,
      `Geschlossenes Dokument: ${JSON.stringify(geschlossen)}`
    )
  }

  features.p6f3 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E P6 Kommentar')
    // p6f2 lässt kapitel.tex offen, und Overleaf öffnet die zuletzt offene Datei wieder.
    const main = page.locator('.file-tree').getByRole('treeitem', { name: 'main.tex' })
    await panelSichern(DATEIBAUM, main)
    await main.click()
    await page.locator('.cm-content', { hasText: 'Ergebnisse' }).waitFor()
    await imEditorMarkieren('Ergebnisse')
    await page.getByRole('button', { name: /^(Kommentar hinzufügen|Add comment)$/ }).click()
    const feld = page.locator('.review-panel-add-comment-editor .cm-content').first()
    const formular = page.locator('form.review-panel-entry-content')
    const hinweis = formular.getByText('Claude wird benachrichtigt', { exact: true })
    await feld.waitFor()
    // Overleaf setzt den neuen Kommentar erst an seine Stelle und fokussiert dann selbst das Feld (im Shadow-DOM);
    // vorher Getipptes kann mit dem ersten Eintrag verschwinden. Wie ein Mensch: erst tippen, wenn der Cursor dort steht.
    await fokusAuf(feld, 'im neuen Kommentar', 10000)
    await page.keyboard.type('@claude bitte ansehen')
    const angekommen = await feld.filter({ hasText: '@claude bitte ansehen' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    if (!angekommen) ok(false, `Getipptes nicht im Kommentarfeld: „${await feld.textContent({ timeout: 1000 }).catch(() => '(Feld nicht gefunden)')}“`)
    await hinweis.waitFor({ timeout: 5000 })
    const hinweisKasten = formular.locator('.spur-claude-hinweis')
    ok(!(await unlesbar(hinweisKasten)).length, `Hinweis schlecht lesbar: ${await unlesbar(hinweisKasten)}`)
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+Home')
    for (let i = 0; i < '@claude '.length; i++) await page.keyboard.press('Delete')
    await hinweis.waitFor({ state: 'detached', timeout: 5000 })
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' an mail@claude.de')
    await page.waitForTimeout(500)
    ok(!(await hinweis.isVisible()), 'Hinweis bei mail@claude.de')
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type('@claude ')
    await page.keyboard.press('Escape')
    await hinweis.waitFor({ timeout: 5000 })
    const pid = page.url().split('/').pop()
    const kommentare = async () =>
      (await (await page.request.get(`${BASE}/project/${pid}/ranges`)).json()).reduce((n, doc) => n + (doc.ranges.comments?.length ?? 0), 0)
    const vorher = await kommentare()
    await formular.getByRole('button', { name: /^(Kommentar|Comment)$/ }).click()

    const thread = page.locator('.review-panel-entry', { hasText: 'bitte ansehen an mail@claude.de' })
    const marken = thread.locator('.review-panel-comment-body .spur-claude-erwaehnung')
    await marken.first().waitFor()
    ok((await marken.allTextContents()).join() === '@claude', `Hervorgehoben: ${await marken.allTextContents()}`)
    const farben = await thread.locator('.review-panel-comment-body').first().evaluate(el => {
      const marke = el.querySelector('.spur-claude-erwaehnung')
      return [getComputedStyle(marke).color, getComputedStyle(el).color]
    })
    ok(farben[0] !== farben[1], `@claude nicht farbig: ${farben}`)
    const [r, g, b] = farben[0].match(/\d+/g).map(Number)
    ok(b > r && b > g, `@claude nicht blau: ${farben[0]}`)

    await thread.locator('.review-panel-comment-input .cm-content').click()
    await page.keyboard.type('Und @claude auch hier.')
    await thread.getByText('Claude wird benachrichtigt', { exact: true }).waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await thread.locator('.review-panel-comment-body', { hasText: 'auch hier.' }).waitFor()
    ok((await marken.count()) === 2, `Antwort ohne Hervorhebung: ${await marken.count()}`)

    // Die Kommentar-Op geht gesammelt raus; vor dem Neuladen muss der Server sie kennen.
    for (let ende = Date.now() + 20000; (await kommentare()) <= vorher; await page.waitForTimeout(250)) {
      ok(Date.now() < ende, 'Kommentar nach 20 s nicht beim Server')
    }
    for (const thema of ['', 'light-']) {
      await mitDesign(thema, async () => {
        await page.reload()
        await page.locator('.cm-content').first().waitFor()
        const eintrag = page.locator('.review-panel-entry', { hasText: 'bitte ansehen an mail@claude.de' })
        await panelSichern('Überprüfung', eintrag.locator('.review-panel-comment-body').first())
        await eintrag.locator('.spur-claude-erwaehnung').first().waitFor()
        const schlecht = await unlesbar(eintrag.locator('.review-panel-comment-body').first())
        ok(schlecht.length === 0, `Kommentar im Design „${thema || 'dunkel'}“: ${schlecht}`)
      })
    }
  }

  const FOODS = '10.3390/foods11223570'

  features.p6f4 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const zeile = text => page.locator('.spur-zeile', { hasText: text }).first()
    const NICHT_PRUEFBAR = 'nicht prüfbar – Crossref gerade nicht erreichbar'
    try {
      // Vor dem Öffnen: Overleaf stellt ein offenes Prüfbericht-Panel sofort wieder her.
      await fakeSteuern({ stoerungen: { [`crossref:${FOODS}`]: { status: 429, retryAfter: 1, mal: 2 } }, cachesLeeren: true, protokollLeeren: true })
      await projektOeffnen('E2E P6 Crossref')
      const pid = page.url().split('/').pop()
      await panelOeffnen('Prüfbericht')
      await berichtFilter('Alle')
      await zeile('foods2022').getByText('Keine Meldung in Crossref', { exact: true }).waitFor({ timeout: 30000 })
      const foods = zeile('foods2022')
      ok(!/unbekannt|nicht prüfbar/.test(await foods.innerText()), `Gedrosselte DOI: ${await foods.innerText()}`)
      const abrufe = (await (await page.request.get(`${FAKE}/_protokoll`)).json()).abrufe.filter(a => a.pfad.includes(encodeURIComponent(FOODS)))
      ok(abrufe.length === 3, `Crossref-Abrufe für die gedrosselte DOI: ${abrufe.length}`)
      await zeile('erfunden').getByText('DOI nicht registriert', { exact: true }).waitFor()

      await fakeSteuern({ stoerungen: { [`crossref:${FOODS}`]: { status: 503 } }, cachesLeeren: true })
      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      await zeile('foods2022').getByText(NICHT_PRUEFBAR, { exact: true }).waitFor({ timeout: 30000 })
      ok(!/unbekannt/.test(await zeile('foods2022').innerText()), 'Ausfall erscheint als unbekannt')
      await zeile('erfunden').getByText('DOI nicht registriert', { exact: true }).waitFor()

      const bib = (await werkzeug(token, 'bib_list', { project_id: pid })).inhalt.eintraege
      const foodsBib = bib.find(e => e.key === 'foods2022')
      ok(foodsBib.referenz === 'nicht_pruefbar' && foodsBib.grund === 'crossref_nicht_erreichbar', `bib_list: ${JSON.stringify(foodsBib)}`)
      ok(bib.find(e => e.key === 'erfunden').referenz === 'nicht_gefunden', `bib_list erfunden: ${JSON.stringify(bib)}`)

      const abgelehnt = await werkzeug(token, 'source_add', { project_id: pid, doi: FOODS })
      ok(
        abgelehnt.fehler && abgelehnt.inhalt.fehler !== 'doi_nicht_gefunden' && /antwortet gerade nicht/.test(abgelehnt.inhalt.detail) && /noch einmal/.test(abgelehnt.inhalt.detail),
        `source_add bei 503: ${JSON.stringify(abgelehnt.inhalt)}`
      )

      await fakeSteuern({})
      const aufgenommen = await werkzeug(token, 'source_add', { project_id: pid, doi: FOODS })
      ok(!aufgenommen.fehler, `source_add nach Ausfall: ${JSON.stringify(aufgenommen.inhalt)}`)
    } finally {
      await fakeSteuern({})
    }
  }

  features.p6f5 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E P6 Crossref')
    const antworten = ergebnis => Object.fromEntries(ergebnis.dienste.map(d => [d.dienst, d.antwort]))
    try {
      await fakeSteuern({ cachesLeeren: true })
      const suche = (await werkzeug(token, 'paper_search', { project_id: pid, anfrage: 'food waste' })).inhalt
      const quellen = new Set(suche.treffer.flatMap(t => t.dienste))
      for (const dienst of ['OpenAlex', 'Semantic Scholar', 'Crossref', 'arXiv']) {
        ok(quellen.has(dienst), `paper_search ohne Treffer aus ${dienst}: ${[...quellen]}`)
        ok(antworten(suche)[dienst] === 'geantwortet', `paper_search: ${JSON.stringify(suche.dienste)}`)
      }

      for (const richtung of ['zitiert_von', 'zitiert']) {
        const z = (await werkzeug(token, 'paper_citations', { doi: '10.1038/nrn2762', richtung })).inhalt
        ok(z.treffer.length > 0 && !z.hinweis, `paper_citations ${richtung}: ${JSON.stringify(z).slice(0, 300)}`)
      }

      await fakeSteuern({ cachesLeeren: true, stoerungen: { s2: { status: 429 } } })
      const gedrosselt = (await werkzeug(token, 'paper_citations', { doi: '10.1038/nrn2762', richtung: 'zitiert_von' })).inhalt
      ok(gedrosselt.treffer.length > 0 && gedrosselt.treffer.every(t => t.dienste.includes('OpenAlex')), `Treffer ohne OpenAlex: ${JSON.stringify(gedrosselt.treffer)}`)
      ok(antworten(gedrosselt)['Semantic Scholar'] === 'gedrosselt' && antworten(gedrosselt).OpenAlex === 'geantwortet', `Dienste: ${JSON.stringify(gedrosselt.dienste)}`)

      await fakeSteuern({ cachesLeeren: true, stoerungen: { s2: { trennen: true }, openalex: { trennen: true } } })
      const keiner = (await werkzeug(token, 'paper_citations', { doi: '10.1038/nrn2762', richtung: 'zitiert_von' })).inhalt
      ok(keiner.treffer.length === 0 && /Keiner der Dienste hat geantwortet/.test(keiner.hinweis), `Kein Hinweis: ${JSON.stringify(keiner)}`)
      ok(
        keiner.fehler.length === 2 && keiner.fehler.every(f => f.art === 'nicht_erreichbar' && f.text) &&
          Object.values(antworten(keiner)).every(a => a === 'nicht_erreichbar'),
        `Gründe je Dienst: ${JSON.stringify(keiner)}`
      )

      await fakeSteuern({ cachesLeeren: true, stoerungen: { s2: { status: 503 } } })
      await projektOeffnen('E2E P6 Crossref')
      await panelOeffnen('Recherche')
      await paperSuchen('food waste')
      await page.locator('.spur-panel').getByText('Semantic Scholar nicht erreichbar').waitFor({ timeout: 10000 })
      await page.locator('.spur-panel').getByText('Food waste in private households').first().waitFor()
    } finally {
      await fakeSteuern({})
    }
  }

  features.p6f6 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E P6 Crossref')
    const KELLER = '10.1371/journal.pone.0099999'
    try {
      await fakeSteuern({ cachesLeeren: true, protokollLeeren: true, schalter: { UNPAYWALL_EMAIL: '', CROSSREF_MAILTO: 'spur@example.org' } })
      const aufgenommen = await werkzeug(token, 'source_add', { project_id: pid, doi: KELLER })
      ok(!aufgenommen.fehler, `source_add mit CROSSREF_MAILTO: ${JSON.stringify(aufgenommen.inhalt)}`)
      const abrufe = (await (await page.request.get(`${FAKE}/_protokoll`)).json()).abrufe.filter(a => a.dienst === 'unpaywall')
      ok(abrufe.some(a => new URL(a.pfad, BASE).searchParams.get('email') === 'spur@example.org'), `Unpaywall ohne CROSSREF_MAILTO: ${JSON.stringify(abrufe)}`)
      await projektOeffnen('E2E P6 Crossref')
      await panelOeffnen('Quellen')
      await page.locator('.spur-panel').getByRole('button', { name: aufgenommen.inhalt.dateiname }).waitFor({ timeout: 10000 })

      await fakeSteuern({ cachesLeeren: true, schalter: { UNPAYWALL_EMAIL: '', CROSSREF_MAILTO: '' } })
      const andere = await projektId(token, 'E2E P6 Kommentar')
      const abgelehnt = await werkzeug(token, 'source_add', { project_id: andere, doi: FOODS })
      ok(
        abgelehnt.fehler && abgelehnt.inhalt.fehler === 'unpaywall_aus' &&
          ['UNPAYWALL_EMAIL', 'CROSSREF_MAILTO', 'README'].every(w => abgelehnt.inhalt.detail.includes(w)),
        `source_add ohne Adressen: ${JSON.stringify(abgelehnt.inhalt)}`
      )
    } finally {
      await fakeSteuern({ schalter: {} })
    }
  }

  features.p6f7 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E P6 Zahlen')
    const lauf = Date.now()
    const schreiben = async (pfad, neu, n) => {
      const { fehler, inhalt } = await werkzeug(token, 'doc_edit', { project_id: pid, pfad, neu, idempotenz_schluessel: `p6f7-${lauf}-${n}` })
      ok(!fehler, `doc_edit ${pfad}: ${JSON.stringify(inhalt)}`)
      return inhalt.zahlen_ohne_beleg
    }
    const FOLIEN = String.raw`
\documentclass[aspectratio=169,11pt]{beamer}
\definecolor{eon}{RGB}{234,28,10}
\begin{tikzpicture}
  \draw (0,0) -- (3.5,2.25);
  \fill[red!30] (0,0) rectangle (1,1);
\end{tikzpicture}
Das Volumen war $V = 0{,}89\,\mathrm{L}$, die Ausbeute \qty{75.7}{\percent}, die Fläche $x^2$.`
    const gemeldet = await schreiben('main.tex', FOLIEN, 1)
    ok(JSON.stringify(gemeldet) === JSON.stringify(['0,89', '75.7']), `Gemeldet: ${JSON.stringify(gemeldet)}`)
    const bib = await schreiben('quellen.bib', '@article{p6b,\n  volume = {11},\n  pages = {3570}\n}\n', 2)
    ok(bib.length === 0, `.bib gemeldet: ${JSON.stringify(bib)}`)

    await projektOeffnen('E2E P6 Zahlen')
    await panelOeffnen('Claude')
    const karte = claudePanel().locator('.spur-lauf-hinweis', { hasText: 'Zahl ohne Beleg' }).first()
    await karte.waitFor({ timeout: 10000 })
    const karteZahlen = (await karte.innerText()).replace(/^Zahl ohne Beleg: /, '').split(', ')
    ok(karteZahlen.includes('0,89') && karteZahlen.includes('75.7'), `Lauf-Karte: ${karteZahlen}`)
    for (const zahl of ['169', '11', '3.5', '2.25', '30', '234', '28', '10', '2', '3570']) {
      ok(!karteZahlen.includes(zahl), `Lauf-Karte meldet ${zahl}`)
    }

    const neu = await werkzeug(token, 'doc_create', {
      project_id: pid, pfad: 'ergebnisse.tex', inhalt: String.raw`\newcommand{\ausbeute}{\qty{75.7}{\percent}}`, idempotenz_schluessel: `p6f7-${lauf}-3`,
    })
    ok(!neu.fehler, `doc_create: ${JSON.stringify(neu.inhalt)}`)
    const danach = await schreiben('main.tex', String.raw` Nochmals \qty{75.7}{\percent} und $0{,}89$.`, 4)
    ok(JSON.stringify(danach) === JSON.stringify(['0,89']), `Mit ergebnisse.tex gemeldet: ${JSON.stringify(danach)}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Zahlen geprüft.' })
  }

  features.p6f8 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const ZAEHLUNG = '7 Stellen, 1 markiert: 1 ohne Seitenangabe, 4 ohne Quelle, 1 nicht prüfbar'
    const zeile = text => page.locator('.spur-zeile', { hasText: text }).first()
    try {
      await fakeSteuern({ cachesLeeren: true, stoerungen: { [`crossref:${FOODS}`]: { status: 503 } } })
      await projektOeffnen('E2E P6 Bericht')
      const pid = page.url().split('/').pop()
      await panelOeffnen('Prüfbericht')
      await berichtFilter('Alle')
      await kopfzeileAbwarten(ZAEHLUNG)
      for (const key of ['ohneA', 'ohneB', 'ohneC', 'ohneD']) {
        await zeile(key).getByText('keine Quelle aufgenommen', { exact: true }).waitFor()
      }
      await zeile('Sleep supports the consolidation').getByText('Seitenangabe fehlt', { exact: true }).waitFor()
      await zeile('foods2022').getByText('nicht prüfbar – Crossref gerade nicht erreichbar', { exact: true }).waitFor()
      ok(!/keine Quelle|Seitenangabe fehlt/.test(await zeile('hippocampus').innerText()), 'Geprüfte Stelle nennt einen Grund')

      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      await page.waitForTimeout(500)
      await kopfzeileAbwarten(ZAEHLUNG)

      const bericht = (await werkzeug(token, 'check_report', { project_id: pid })).inhalt
      ok(
        JSON.stringify(bericht.zaehlung) === JSON.stringify({ geprueft: 1, ohne_quelle: 4, ohne_seitenangabe: 1, beleg_ohne_wortlaut: 0, nicht_pruefbar: 1, markiert: 1 }),
        `check_report: ${JSON.stringify(bericht.zaehlung)}`
      )
      const gruende = bericht.eintraege.map(z => z.grund).filter(Boolean).sort()
      ok(
        JSON.stringify(gruende) === JSON.stringify(['crossref_nicht_erreichbar', 'keine_quelle', 'keine_quelle', 'keine_quelle', 'keine_quelle', 'seitenangabe_fehlt']),
        `Gründe über MCP: ${JSON.stringify(gruende)}`
      )
    } finally {
      await fakeSteuern({})
    }
  }

  features.p6f9 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const dockerfile = await repoDatei(`${REPO}/server-ce/Dockerfile-base`)
    const liste = new Set(dockerfile.split('tlmgr install --repository ${TEXLIVE_MIRROR}')[1].split('&&')[0].split(/[\s\\]+/).filter(Boolean))
    const fehlen = ['babel-german', 'hyphen-german', 'mhchem', 'siunitx', 'chemformula', 'beamertheme-metropolis', 'pgfopts'].filter(p => !liste.has(p))
    ok(fehlen.length === 0, `Fehlt im Image: ${fehlen}`)
    const smoke = await repoDatei(`${REPO}/services/web/modules/spur/scripts/smoke-dokumente.mjs`)
    for (const teil of ['\\usetheme{metropolis}', '\\usepackage[ngerman]{babel}', '\\ce{H2O}', '\\qty{0.89}{\\liter}']) {
      ok(smoke.includes(teil), `Smoke-Dokument ohne ${teil}`)
    }
    const skript = await repoDatei(`${REPO}/services/web/modules/spur/scripts/smoke-compile.mjs`)
    ok(/for \(const \{ name, dateien \} of DOKUMENTE\)/.test(skript) && skript.includes("file.path === 'output.pdf'"), 'Smoke kompiliert nicht jedes Dokument mit PDF-Prüfung')
  }

  features.p6f10 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const make = await repoDatei(`${REPO}/Makefile`)
    const ziel = name => make.split(`\n${name}:`)[1]?.split(/\n(?=\S)/)[0] ?? ''
    const start = ziel('start')
    ok(start.indexOf('pull') > 0 && start.indexOf('pull') < start.indexOf('up -d'), `make start holt nicht vorher: ${start}`)
    const update = ziel('update')
    const [holen, hinweis, neustart] = ['$(COMPOSE) pull', 'Backup', '$(COMPOSE) up -d'].map(t => update.indexOf(t))
    ok(holen > 0 && hinweis > holen && neustart > hinweis && /echo .*docker compose/.test(update), `make update: ${update}`)

    const readme = await repoDatei(`${REPO}/README.md`)
    const abschnitt = titel => readme.split(`### ${titel}\n`)[1]?.split(/\n#{2,3} /)[0] ?? ''
    const mail = abschnitt('Email')
    for (const v of ['OVERLEAF_EMAIL_FROM_ADDRESS', 'OVERLEAF_EMAIL_SMTP_HOST', 'OVERLEAF_EMAIL_SMTP_PORT', 'OVERLEAF_EMAIL_SMTP_USER', 'OVERLEAF_EMAIL_SMTP_PASS']) {
      ok(mail.includes(v), `Abschnitt Email ohne ${v}`)
    }
    ok(/sends no email/.test(mail), 'Abschnitt Email ohne Hinweis, dass ohne Variablen keine Mails rausgehen')
    const dienste = abschnitt('Research services')
    for (const v of ['CROSSREF_MAILTO', 'UNPAYWALL_EMAIL', 'OPENALEX_API_KEY', 'SEMANTIC_SCHOLAR_API_KEY']) ok(dienste.includes(v), `Research services ohne ${v}`)
    ok(/Optional/.test(dienste), 'Schlüssel nicht als optional beschrieben')
    ok(abschnitt('Update').includes('make update'), 'Abschnitt Update ohne make update')
    const proxy = abschnitt('Behind a corporate proxy')
    ok(proxy.includes('docker-compose.override.yml') && /```yaml\nservices:\n  sharelatex:\n[\s\S]*NODE_EXTRA_CA_CERTS: \/[^\n]+\.crt\n```/.test(proxy) && /\.crt:\/[^\n]+\.crt:ro/.test(proxy), `Proxy-Beispiel unvollständig: ${proxy.slice(0, 300)}`)

    const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1])
    for (const link of links.filter(l => !/^https?:/.test(l))) await repoDatei(`${REPO}/${link}`)
    const kaputt = []
    for (const link of links.filter(l => /^https:/.test(l))) {
      // Ein Namensfehler oder Abbruch im Netz (ENOTFOUND, ECONNRESET) ist kurzzeitig möglich: dreimal versuchen, 5 s Abstand.
      let antwort
      for (let versuch = 0; versuch < 3; versuch++) {
        antwort = await page.request.get(link, { timeout: 20000, maxRedirects: 5 }).catch(e => ({ status: () => e.message.split('\n')[0] }))
        const status = antwort.status()
        if ((Number.isInteger(status) && status < 500 && status !== 429) || versuch === 2) break
        await page.waitForTimeout(5000)
      }
      if (!(Number(antwort.status()) < 400)) kaputt.push(`${link}: ${antwort.status()}`)
    }
    ok(kaputt.length === 0, `Links: ${kaputt.join(' | ')}`)
  }

  features.p6f11 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E P6 Bericht')
    await panelSichern('Quellen', page.getByRole('button', { name: 'smith2024.pdf' }))
    await page.getByRole('button', { name: 'smith2024.pdf' }).click()
    await page.locator('img.spur-seitenbild').waitFor()
    const leiste = page.locator('.spur-panel-werkzeuge')
    const knoepfe = ['Zurück', 'Vorherige Seite', 'Nächste Seite', 'Groß öffnen'].map(name => leiste.getByRole('button', { name }))
    const masse = async () => await Promise.all(knoepfe.map(async k => await k.boundingBox()))
    const bei1280 = await masse()
    const oben = bei1280.map(b => b.y)
    ok(Math.max(...oben) - Math.min(...oben) <= 1, `Oberkanten bei 1280 px: ${oben}`)
    const hoehen = bei1280.map(b => b.height)
    ok(Math.max(...hoehen) - Math.min(...hoehen) <= 1, `Höhen bei 1280 px: ${hoehen}`)

    await breite(360)
    await page.locator('img.spur-seitenbild').waitFor()
    await ohneSeitlichesRollen('Quellen-Vorschau 360 px')
    for (const [i, b] of (await masse()).entries()) {
      ok(b && b.width >= 24 && b.height >= 24, `Knopf ${i + 1} bei 360 px: ${JSON.stringify(b)}`)
    }
    await breite(1280)
  }

  // Der Ablauf selbst läuft in tools/tests/setup.test.mjs (Terminal-Fragen, .env, Rechte, zweiter Aufruf).
  features.p7f3 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const make = await repoDatei(`${REPO}/Makefile`)
    ok(/\nsetup:\n\t@\.\/tools\/setup\.sh\n/.test(make), 'make setup ruft tools/setup.sh nicht auf')
    const skript = await repoDatei(`${REPO}/tools/setup.sh`)
    ok(skript.includes('[ ! -t 0 ]') && skript.includes('read -r -s'), 'setup.sh ohne Terminal-Prüfung oder verdeckte Passworteingabe')
    ok(skript.includes('umask 077'), 'setup.sh legt .env nicht mit Rechten 600 an')
    const readme = await repoDatei(`${REPO}/README.md`)
    ok(readme.includes('make setup'), 'README ohne make setup')
  }

  features.p7f4 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const skill = await repoDatei(`${REPO}/plugins/spur/skills/spur/SKILL.md`)
    const regel = skill.split('## Throttled or unreachable services\n')[1] ?? ''
    for (const teil of ['gedrosselt', 'nicht_erreichbar', 'other services', 'right away', 'summary', 'stages']) {
      ok(regel.includes(teil), `Regel in SKILL.md ohne „${teil}“`)
    }
    const texte = await repoDatei(`${REPO}/services/web/modules/spur/app/src/workflows/standardtexte.mjs`)
    const sammeln = texte.split('Literatur zu einem Thema finden')[1] ?? ''
    ok(sammeln.includes('Throttled or unreachable services'), 'Quellen sammeln verweist nicht auf die Regel')
  }

  // Die Pfadregeln selbst prüft tools/tests/ci-pfade.test.mjs; der PR-Lauf ist Handprüfung.
  features.p7f6 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const ci = await repoDatei(`${REPO}/.github/workflows/ci.yml`)
    ok(!/^on:[\s\S]*?^\s+paths:/m.test(ci.split('\njobs:')[0]), 'ci.yml filtert Pfade am Workflow; die Pflicht-Prüfung bliebe aus')
    ok(ci.includes('node tools/ci/aenderungen.mjs'), 'ci.yml ruft die Pfadregeln nicht auf')
    for (const job of ['test', 'upstream']) {
      const block = ci.split(`\n  ${job}:\n`)[1]?.split(/\n  \S/)[0] ?? ''
      ok(block.includes(`needs.changes.outputs.${job} == 'leicht'`) && block.includes('!cancelled()'), `Job ${job} ohne leichten Weg`)
    }
    const publish = await repoDatei(`${REPO}/.github/workflows/publish.yml`)
    ok(/tags:\s*\[?\s*['"]?v\*/.test(publish) && publish.includes('workflow_dispatch'), 'publish.yml startet nicht bei v*-Tags und per Hand')
    const readme = await repoDatei(`${REPO}/README.md`)
    ok(/git tag v[\d.]+ && git push origin v[\d.]+/.test(readme), 'README ohne Release mit Tag')
  }

  const OHNE_MAIL = 'E-Mail ist nicht eingerichtet – gib den Link selbst weiter.'

  async function mailFake(an) {
    const r = await page.request.post(`${BASE}/spur/dev/mail`, { data: { an } })
    ok(r.status() === 204, `Mail-Fake: ${r.status()}`)
  }

  async function mailsAn(adresse) {
    const { mails } = await (await page.request.get(`${BASE}/spur/dev/mail`)).json()
    return mails.filter(m => m.an.includes(adresse))
  }

  // Liest Link, Hinweis und Kopierknopf eines Einladungslinks in `bereich`.
  async function einladungslink(bereich) {
    const feld = bereich.getByLabel('Einladungslink').last()
    await feld.waitFor()
    const link = await feld.inputValue()
    ok(link.startsWith(`${BASE}/user/activate?token=`), `Link: ${link}`)
    await bereich.getByRole('button', { name: 'Kopieren' }).last().click()
    await bereich.getByRole('button', { name: 'Kopiert' }).last().waitFor()
    return link
  }

  async function kontoAnlegen(email) {
    await page.goto(`${BASE}/admin/user`)
    await page.getByRole('button', { name: 'Konto erstellen' }).click()
    const dialog = page.locator('.modal')
    const erstellen = dialog.getByRole('button', { name: 'Erstellen' })
    // Während der Dialog einblendet, gehen Eingaben verloren; dann bleibt „Erstellen“ gesperrt.
    for (let versuch = 0; versuch < 10; versuch++) {
      await dialog.getByLabel(/^E-Mail/).fill(email)
      await dialog.getByLabel('Vorname').fill('Neu')
      await dialog.getByLabel('Nachname').fill('P7')
      if (await erstellen.isEnabled()) break
      await page.waitForTimeout(300)
    }
    await erstellen.click()
    return dialog
  }

  async function nutzerZeile(email) {
    await page.goto(`${BASE}/admin/user`)
    await page.getByRole('searchbox').or(page.getByLabel('Suchen…')).first().fill(email)
    const zeile = page.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) })
    await zeile.waitFor()
    return zeile
  }

  features.p7f1 = async () => {
    await mailFake(false)
    await anmelden('e2e-admin@example.org')
    const dialog = await kontoAnlegen('neu-p7@example.org')
    await dialog.getByText(OHNE_MAIL).waitFor()
    const link = await einladungslink(dialog)
    await dialog.getByRole('button', { name: 'Schließen' }).click()

    const { seite, schliessen } = await zweiteSeite()
    try {
      await seite.goto(link)
      await seite.getByLabel(/^(Neues Passwort|Passwort)/).first().fill('Test-Passwort-1234')
      await seite.getByRole('button', { name: /Passwort (setzen|festlegen)|Aktivieren|Set password|Activate/i }).click()
      await seite.waitForURL(/\/project/, { timeout: 20000 })
      const angemeldet = await seite.evaluate(() => document.querySelector('meta[name="ol-usersEmail"]')?.content)
      ok(angemeldet === 'neu-p7@example.org', `Angemeldet als ${angemeldet}`)
    } finally {
      await schliessen()
    }

    const zeile = await nutzerZeile('neu-p7@example.org')
    await zeile.getByRole('button', { name: 'Neuen Einladungslink erzeugen' }).click()
    const neuDialog = page.locator('.modal', { hasText: 'Neuen Einladungslink erzeugen' })
    const neuerLink = await einladungslink(neuDialog)
    ok(neuerLink !== link, 'Kein neuer Link')
    await neuDialog.getByRole('button', { name: 'Schließen' }).click()

    await page.goto(`${BASE}/project`)
    await page.getByRole('menuitem', { name: 'Admin' }).click()
    await page.getByRole('menuitem', { name: 'Register Users' }).click()
    await page.waitForURL(`${BASE}/admin/register`)
    await page.getByLabel('Emails to register new users').fill('zweit-p7@example.org')
    await page.getByRole('button', { name: 'Register' }).click()
    await sichtbar(OHNE_MAIL)
    await einladungslink(page)

    await anmelden('e2e-a@example.org')
    // Overleaf leitet Nicht-Admins auf /restricted um, statt 403 zu senden.
    const eigeneId = await page.evaluate(() => document.querySelector('meta[name="ol-user_id"]').content)
    const csrf = await page.evaluate(() => document.querySelector('meta[name="ol-csrfToken"]').content)
    for (const [methode, pfad] of [['get', '/admin/register'], ['post', `/admin/user/${eigeneId}/activation-link`]]) {
      const r = await page.request[methode](`${BASE}${pfad}`, { maxRedirects: 0, headers: { 'X-Csrf-Token': csrf } })
      const ziel = r.headers().location ?? ''
      ok(r.status() === 403 || (r.status() === 302 && ziel.startsWith('/restricted')), `${pfad} für Nicht-Admin: ${r.status()} ${ziel}`)
    }

    await mailFake(true)
    try {
      await anmelden('e2e-admin@example.org')
      const mitMail = await kontoAnlegen('dritt-p7@example.org')
      await mitMail.getByText('Einladung per E-Mail verschickt').waitFor()
      await einladungslink(mitMail)
      ok((await mailsAn('dritt-p7@example.org')).length === 1, 'Fake-SMTP hat keine Einladung erhalten')
    } finally {
      await mailFake(false)
    }
  }

  features.p7f2 = async () => {
    await mailFake(false)
    await anmelden('e2e-admin@example.org')
    await page.goto(`${BASE}/launchpad`)
    const testMail = async () => {
      await page.getByLabel('Email', { exact: true }).fill('e2e-admin@example.org')
      await page.getByRole('button', { name: 'Absenden' }).click()
    }
    await testMail()
    await sichtbar('Keine E-Mail eingerichtet')
    await sichtbar(/README/)
    ok(!(await page.getByText(/E-Mail versendet|Email sent/i).isVisible()), 'Test-Mail meldet Versand ohne Einrichtung')

    await page.goto('about:blank')
    await page.context().clearCookies()
    await page.goto(`${BASE}/user/password/reset`)
    await page.getByLabel('E-Mail').fill('e2e-a@example.org')
    await page.getByRole('button', { name: 'Passwort zurücksetzen' }).click()
    await sichtbar('Bitte einen Admin, dir einen neuen Einladungslink zu erzeugen.')

    await mailFake(true)
    try {
      await anmelden('e2e-admin@example.org')
      await page.goto(`${BASE}/launchpad`)
      await testMail()
      await sichtbar(/E-Mail versendet|Email sent/i)
      ok((await mailsAn('e2e-admin@example.org')).length === 1, 'Fake-SMTP hat die Test-Mail nicht erhalten')
    } finally {
      await mailFake(false)
    }
  }

  features.p7f5 = async () => {
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Pakete')
    const pid = page.url().split('/').pop()
    const token = await neuesToken()
    const paket = name => werkzeug(token, 'tex_package_add', { project_id: pid, paket: name })
    const pfade = async () => (await jsonVon(`/project/${pid}/entities`)).entities.map(e => e.path)
    // Der Editor kompiliert beim Öffnen selbst; ein Compile direkt danach meldet „too-recently-compiled“.
    const kompilieren = async () => {
      for (let i = 0; i < 10; i++) {
        const job = await kompiliertBeiClaude(token, pid)
        if (job.ergebnis?.compile !== 'too-recently-compiled') return job
        await page.waitForTimeout(1500)
      }
      fail('Compile bleibt „too-recently-compiled“')
    }
    const nichtGefunden = async () => {
      const job = await kompilieren()
      ok(job.ergebnis.compile !== 'success', `Compile ohne Theme: ${JSON.stringify(job.ergebnis)}`)
      const { inhalt: log } = await werkzeug(token, 'compile_log', { project_id: pid })
      ok(JSON.stringify(log).includes('beamerthemespurtest.sty') && /not found/.test(JSON.stringify(log)), `Log ohne „not found“: ${JSON.stringify(log).slice(0, 300)}`)
    }
    await nichtGefunden()

    const theme = await paket('beamertheme-spurtest')
    ok(!theme.fehler && theme.inhalt.dateien.includes('tex-pakete/beamertheme-spurtest/beamerthemespurtest.sty'), `Theme: ${JSON.stringify(theme.inhalt)}`)
    ok(!theme.inhalt.dateien.some(d => d.endsWith('README.md')), 'Doku-Datei mit angelegt')
    ok(JSON.stringify(theme.inhalt.fehlende_abhaengigkeiten) === '["spurfarben"]', `Abhängigkeiten: ${theme.inhalt.fehlende_abhaengigkeiten}`)
    const farben = await paket('spurfarben')
    ok(!farben.fehler && farben.inhalt.fehlende_abhaengigkeiten.length === 0, `spurfarben: ${JSON.stringify(farben.inhalt)}`)
    const mitTheme = await kompilieren()
    ok(mitTheme.ergebnis.compile === 'success', `Compile mit Theme: ${JSON.stringify(mitTheme.ergebnis)}`)

    await panelOeffnen('Claude')
    // Die latexmkrc bleibt: Pakete späterer Läufe brauchen sie auch.
    for (const datei of ['tex-pakete/beamertheme-spurtest', 'tex-pakete/spurfarben']) {
      await karte().getByText(datei, { exact: true }).waitFor({ timeout: 20000 })
    }
    await karte().getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte().getByText('Zurückgenommen', { exact: true }).waitFor({ timeout: 20000 })
    const nachher = await pfade()
    ok(!nachher.some(p => p.startsWith('/tex-pakete')) && nachher.includes('/latexmkrc'), `Nach „Lauf rückgängig“: ${nachher}`)
    await nichtGefunden()

    const beamer = await paket('beamer')
    ok(!beamer.fehler && beamer.inhalt.im_image === true && beamer.inhalt.dateien.length === 0, `beamer: ${JSON.stringify(beamer.inhalt)}`)
    ok(beamer.inhalt.hinweis === 'schon im Image', `beamer: ${beamer.inhalt.hinweis}`)
    for (const name of ['../x', 'zwei worte']) {
      const falsch = await paket(name)
      ok(falsch.fehler && falsch.inhalt.fehler === 'eingabe_ungueltig', `${name}: ${JSON.stringify(falsch.inhalt)}`)
    }
    const ausbruch = await paket('spurtest-ausbruch')
    ok(ausbruch.fehler && ausbruch.inhalt.fehler === 'archiv_unsicher', `Ausbruch: ${JSON.stringify(ausbruch.inhalt)}`)
    const riesig = await paket('spurtest-riesig')
    ok(riesig.fehler && riesig.inhalt.fehler === 'paket_zu_gross' && riesig.inhalt.detail.includes('100 MB'), `Riesig: ${JSON.stringify(riesig.inhalt)}`)
    const danach = await pfade()
    ok(!danach.some(p => p.startsWith('/tex-pakete')), `Nach Fehlern angelegt: ${danach}`)

    await fakeSteuern({ schalter: { SPUR_TEX_PAKETE: 'aus' } })
    try {
      const aus = await paket('spurfarben')
      ok(aus.fehler && aus.inhalt.fehler === 'abgeschaltet' && aus.inhalt.detail.includes('Admin'), `Abgeschaltet: ${JSON.stringify(aus.inhalt)}`)
    } finally {
      await fakeSteuern({ schalter: {} })
    }

    const REPO = `${FIXTURES}/../../../../../..`
    const skill = await repoDatei(`${REPO}/plugins/spur/skills/spur/SKILL.md`)
    const ablauf = skill.split('## Missing LaTeX packages\n')[1]?.split('\n## ')[0] ?? ''
    for (const teil of ['compile_log', 'not found', 'tex_package_add', 'compile', 'fehlende_abhaengigkeiten']) {
      ok(ablauf.includes(teil), `SKILL.md: Ablauf ohne „${teil}“`)
    }
    for (const datei of ['README.md', 'docs/mcp-contract.md']) {
      ok((await repoDatei(`${REPO}/${datei}`)).includes('tex_package_add'), `${datei} nennt tex_package_add nicht`)
    }
  }

  // P7 Grenzen. Eigene Konten (e2e-grenze-a/-b/-c, ohne Admin-Rechte); jeder Schritt setzt seine Grenzen selbst.
  const GRENZEN = `${BASE}/spur/admin/grenzen`
  const PROJEKTE_VOLL = 'Du hast 3 von 3 Projekten. Lösche ein Projekt endgültig oder frag deinen Admin.'

  async function seitenAnfrage(methode, pfad, body) {
    // Nach dem Anmelden leitet die Seite noch weiter; das Token steht erst danach sicher im Kopf.
    await page.waitForLoadState('load')
    await page.locator('meta[name="ol-csrfToken"]').waitFor({ state: 'attached' })
    return await page.evaluate(
      async ([m, url, daten]) => {
        const token = document.querySelector('meta[name="ol-csrfToken"]').content
        const r = await fetch(url, {
          method: m,
          headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token, Accept: 'application/json' },
          body: daten === undefined ? undefined : JSON.stringify(daten),
        })
        return { status: r.status, daten: await r.json().catch(() => null) }
      },
      [methode, `${BASE}${pfad}`, body]
    )
  }

  // Als Admin: Standard und Ausnahmen setzen (Werte wie im Formular, '' = unbegrenzt bzw. Standard).
  async function grenzenSetzen(standard, ausnahmen = {}) {
    await anmelden('e2e-admin@example.org')
    const r = await seitenAnfrage('PUT', '/spur/admin/grenzen/standard', { texPaketeAus: false, ...standard })
    ok(r.status === 204, `Standard setzen: ${r.status} ${JSON.stringify(r.daten)}`)
    const { nutzer } = (await seitenAnfrage('GET', '/spur/admin/grenzen.json')).daten
    for (const [email, werte] of Object.entries(ausnahmen)) {
      const id = nutzer.find(n => n.email === email).id
      const a = await seitenAnfrage('PUT', `/spur/admin/grenzen/nutzer/${id}`, werte)
      ok(a.status === 204, `Ausnahme ${email}: ${a.status}`)
    }
  }

  const standardBereich = () => page.locator('section', { has: page.getByRole('heading', { name: 'Standard für alle' }) })
  const nutzerZeileGrenze = email => page.locator(`tr[data-email="${email}"]`)

  features.p7f7 = async () => {
    await grenzenSetzen({ projekte: '', speicherGb: '' })
    await page.goto(`${BASE}/project`)
    await page.getByRole('menuitem', { name: 'Admin' }).click()
    await page.getByRole('menuitem', { name: 'Grenzen' }).click()
    await page.waitForURL(GRENZEN)
    const stand = () => standardBereich().locator('dl').innerText()
    await standardBereich().locator('dl').waitFor()
    ok(/Projekte je Nutzer:\s*unbegrenzt/.test(await stand()) && /Speicher je Projekt:\s*unbegrenzt/.test(await stand()), `Stand: ${await stand()}`)

    await standardBereich().getByLabel('Projekte je Nutzer').fill('3')
    await standardBereich().getByLabel('Speicher je Projekt (GB)').fill('0,01')
    await standardBereich().getByRole('button', { name: 'Speichern' }).click()
    await standardBereich().getByText('Gespeichert').waitFor()
    await page.reload()
    await standardBereich().locator('dl').waitFor()
    ok(/Projekte je Nutzer:\s*3/.test(await stand()) && /Speicher je Projekt:\s*0,01 GB/.test(await stand()), `Nach Neuladen: ${await stand()}`)
    ok((await standardBereich().getByLabel('Projekte je Nutzer').inputValue()) === '3', 'Feld Projekte leer nach Neuladen')

    const b = nutzerZeileGrenze('e2e-grenze-b@example.org')
    await b.getByRole('button', { name: 'Ausnahme für e2e-grenze-b@example.org ändern' }).click()
    await b.getByLabel('Projekte je Nutzer: Art').selectOption('zahl')
    await b.getByLabel('Projekte je Nutzer', { exact: true }).fill('5')
    await b.getByRole('button', { name: 'Speichern' }).click()
    await b.getByText('Projekte: 5').waitFor()
    await page.reload()
    await b.getByText('Projekte: 5').waitFor()
    ok((await b.innerText()).includes('3 / 5'), `Zeile e2e-grenze-b: ${await b.innerText()}`)

    await standardBereich().getByLabel('Projekte je Nutzer').fill('-1')
    await standardBereich().getByLabel('Speicher je Projekt (GB)').fill('abc')
    await standardBereich().getByRole('button', { name: 'Speichern' }).click()
    await standardBereich().getByText('Gib eine ganze Zahl ab 0 ein oder lass das Feld leer.').waitFor()
    await standardBereich().getByText('Gib eine Zahl ab 0 ein, etwa 0,5, oder lass das Feld leer.').waitFor()
    ok((await standardBereich().getByLabel('Projekte je Nutzer').getAttribute('aria-invalid')) === 'true', 'Feld nicht als ungültig markiert')
    await page.reload()
    await standardBereich().locator('dl').waitFor()
    ok(/Projekte je Nutzer:\s*3/.test(await stand()), `Ungültiges gespeichert: ${await stand()}`)

    await anmelden('e2e-grenze-a@example.org')
    const fremd = await page.request.get(GRENZEN, { maxRedirects: 0 })
    ok(fremd.status() === 403 || (fremd.status() === 302 && fremd.headers().location.startsWith('/restricted')), `Grenzen für Nicht-Admin: ${fremd.status()}`)
  }

  // Ein ZIP mit einer Datei, ohne Kompression (für den ZIP-Upload).
  function zipMitDatei(name, text) {
    const daten = Buffer.from(text)
    const crcTabelle = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    let crc = 0xffffffff
    for (const byte of daten) crc = crcTabelle[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    crc = (crc ^ 0xffffffff) >>> 0
    const dateiname = Buffer.from(name)
    const kopf = Buffer.alloc(30)
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt32LE(crc, 14)
    kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(daten.length, 22); kopf.writeUInt16LE(dateiname.length, 26)
    const zentral = Buffer.alloc(46)
    zentral.writeUInt32LE(0x02014b50, 0); zentral.writeUInt16LE(20, 4); zentral.writeUInt16LE(20, 6); zentral.writeUInt32LE(crc, 16)
    zentral.writeUInt32LE(daten.length, 20); zentral.writeUInt32LE(daten.length, 24); zentral.writeUInt16LE(dateiname.length, 28)
    const lokal = Buffer.concat([kopf, dateiname, daten])
    const ende = Buffer.alloc(22)
    ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(1, 8); ende.writeUInt16LE(1, 10)
    ende.writeUInt32LE(46 + dateiname.length, 12); ende.writeUInt32LE(lokal.length, 16)
    return Buffer.concat([lokal, zentral, dateiname, ende])
  }

  async function projektIdVon(name) {
    return (await jsonVon('/user/projects')).projects.find(p => p.name === name)?._id
  }

  features.p7f8 = async () => {
    await grenzenSetzen({ projekte: '3', speicherGb: '' }, { 'e2e-grenze-b@example.org': { projekte: '5', speicherGb: '' } })
    await anmelden('e2e-grenze-a@example.org')
    await page.locator('.spur-grenzen-anzeige', { hasText: '3 von 3 Projekten' }).waitFor()

    await page.getByRole('button', { name: 'Neues Projekt' }).first().click()
    await page.getByRole('menuitem', { name: 'Leeres Projekt' }).click()
    const neu = page.locator('.modal')
    await neu.getByRole('textbox').fill('Grenze A4')
    await neu.getByRole('button', { name: 'Erstellen' }).click()
    await neu.getByText(PROJEKTE_VOLL).waitFor()
    await neu.getByRole('button', { name: 'Abbrechen' }).click()
    await neu.waitFor({ state: 'detached' })

    const zeile = page.getByRole('row', { name: /Grenze A1/ }).first()
    await zeile.getByRole('button', { name: 'Kopieren' }).click()
    const kopie = page.locator('.modal')
    await kopie.getByRole('button', { name: 'Kopieren' }).click()
    await kopie.getByText(PROJEKTE_VOLL).waitFor()
    await kopie.getByRole('button', { name: 'Abbrechen' }).click()
    await kopie.waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Neues Projekt' }).first().click()
    await page.getByRole('menuitem', { name: 'Vorhandenes Projekt (.zip)' }).click()
    const zip = page.locator('.modal')
    await zip.locator('input[type=file]').first().setInputFiles({ name: 'grenze.zip', mimeType: 'application/zip', buffer: zipMitDatei('main.tex', 'Hallo') })
    await zip.getByText(PROJEKTE_VOLL).waitFor({ timeout: 30000 })
    await zip.getByRole('button', { name: 'Abbrechen' }).click()

    const direkt = await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze API' })
    ok(direkt.status === 403 && direkt.daten?.code === 'projekte_voll', `POST /project/new: ${direkt.status} ${JSON.stringify(direkt.daten)}`)

    const a2 = await projektIdVon('Grenze A2')
    ok((await seitenAnfrage('POST', `/project/${a2}/trash`)).status === 200, 'Papierkorb')
    ok((await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze Papierkorb' })).status === 403, 'Papierkorb gibt einen Platz frei')
    ok((await seitenAnfrage('DELETE', `/project/${a2}`)).status === 200, 'Endgültig löschen')
    const wieder = await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze A4' })
    ok(wieder.status === 200 && wieder.daten?.project_id, `Nach endgültigem Löschen: ${wieder.status}`)

    await anmelden('e2e-grenze-b@example.org')
    const viertes = await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze B4' })
    ok(viertes.status === 200, `e2e-grenze-b mit Ausnahme 5: ${viertes.status} ${JSON.stringify(viertes.daten)}`)
  }

  const MB = 1024 * 1024

  async function editorHochladen(name, bytes) {
    await panelSichern(DATEIBAUM, page.locator('.file-tree'))
    await page.locator('.file-tree').getByRole('button', { name: /Hochladen|Upload/ }).first().click()
    await page.locator('.modal input[type=file]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(bytes, 1) })
  }

  // `url` ist die Upload-Adresse des Editors (mit folder_id), abgegriffen beim ersten Upload.
  async function direktHochladen(url, name, bytes) {
    return await page.evaluate(
      async ([ziel, dateiname, groesse]) => {
        const form = new FormData()
        form.append('name', dateiname)
        form.append('qqfile', new Blob([new Uint8Array(groesse)]), dateiname)
        const r = await fetch(ziel, {
          method: 'POST',
          headers: { 'X-Csrf-Token': document.querySelector('meta[name="ol-csrfToken"]').content },
          body: form,
        })
        return { status: r.status, daten: await r.json().catch(() => null) }
      },
      [url, name, bytes]
    )
  }

  features.p7f9 = async () => {
    await grenzenSetzen({ projekte: '', speicherGb: '0,01' })
    await anmelden('e2e-grenze-a@example.org')
    await projektOeffnen('Grenze A1')
    const pid = page.url().split('/').pop()
    const ersterUpload = page.waitForRequest(r => r.method() === 'POST' && r.url().includes(`/project/${pid}/upload`))
    await editorHochladen('erste.bin', 6 * MB)
    const uploadUrl = (await ersterUpload).url()
    await page.locator('.modal').waitFor({ state: 'detached', timeout: 30000 })
    await panelOeffnen('Quellen')
    await page.locator('.spur-speicher-anzeige', { hasText: '0,01 GB von 0,01 GB' }).waitFor({ timeout: 20000 })

    await editorHochladen('zweite.bin', 6 * MB)
    await page.locator('.modal').getByText(/^Dieses Projekt nutzt 0,01 GB von 0,01 GB\. Lösche Dateien oder Quellen oder frag deinen Admin\.$/).waitFor({ timeout: 30000 })
    await page.keyboard.press('Escape')
    await page.locator('.modal').waitFor({ state: 'detached' })

    await panelSichern('Quellen', page.locator('.spur-panel input[type=file]'))
    await page.locator('.spur-panel input[type=file]').setInputFiles({ name: 'gross.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(6 * MB, 1) })
    await page.locator('.spur-panel').getByText(/Dieses Projekt nutzt 0,01 GB von 0,01 GB/).waitFor({ timeout: 30000 })

    // source_add bringt ein kleines PDF; mit 0,005 GB ist das Projekt schon voll.
    await grenzenSetzen({ projekte: '', speicherGb: '0,005' })
    await anmelden('e2e-grenze-a@example.org')
    const token = await neuesToken()
    const mcpVoll = await werkzeug(token, 'source_add', { project_id: pid, doi: '10.1371/journal.pone.0099999' })
    ok(mcpVoll.fehler && mcpVoll.inhalt.fehler === 'speicher_voll', `source_add: ${JSON.stringify(mcpVoll.inhalt)}`)
    await grenzenSetzen({ projekte: '', speicherGb: '0,01' })
    await anmelden('e2e-grenze-a@example.org')
    await projektOeffnen('Grenze A1')

    await editorErsetzen('Text.', 'Text. Weiter geschrieben trotz voller Grenze.')
    await gespeichert(token, pid, 'Weiter geschrieben trotz voller Grenze.')

    const erste = page.locator('.file-tree').getByRole('treeitem', { name: 'erste.bin' })
    await panelSichern(DATEIBAUM, erste)
    await erste.click()
    await page.getByRole('button', { name: 'Aktionsmenü für erste.bin öffnen' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await page.locator('.modal').getByRole('button', { name: 'Löschen' }).click()
    await page.locator('.modal').waitFor({ state: 'detached' })
    await erste.waitFor({ state: 'detached' })
    const danach = await direktHochladen(uploadUrl, 'dritte.bin', 6 * MB)
    ok(danach.status === 200 && danach.daten?.success, `Upload nach dem Löschen: ${danach.status} ${JSON.stringify(danach.daten)}`)

    const ergebnisse = await Promise.all([direktHochladen(uploadUrl, 'gleich-1.bin', 3 * MB), direktHochladen(uploadUrl, 'gleich-2.bin', 3 * MB)])
    const angenommen = ergebnisse.filter(e => e.status === 200).length
    ok(angenommen === 1, `Gleichzeitige Uploads: ${JSON.stringify(ergebnisse)}`)
  }

  features.p7f10 = async () => {
    await grenzenSetzen({ projekte: '3', speicherGb: '0,01' })
    await page.goto(GRENZEN)
    const a = nutzerZeileGrenze('e2e-grenze-a@example.org')
    await a.waitFor()
    ok((await a.innerText()).includes('3 / 3') && (await a.getByText('erreicht', { exact: true }).count()) === 1, `Zeile e2e-grenze-a: ${await a.innerText()}`)

    const projekte = page.locator('section', { has: page.getByRole('heading', { name: 'Projekte', exact: true }) })
    await projekte.getByLabel('Nach Projekt oder Eigentümer suchen').fill('Grenze B2')
    const b2 = projekte.locator('tr[data-projekt="Grenze B2"]')
    const vorher = await b2.innerText()
    ok(vorher.includes('e2e-grenze-b@example.org') && vorher.includes('/ 10,24 MB'), `Zeile Grenze B2: ${vorher}`)
    ok((await b2.getByText('ab 80 %').count()) === 0, 'Grenze B2 schon vor dem Vergrößern markiert')
    const r = await page.request.post(`${BASE}/spur/dev/quelle-vergroessern`, { data: { projekt: 'Grenze B2', bytes: 9 * MB } })
    ok(r.status() === 204, `Quelle vergrößern: ${r.status()}`)
    await page.reload()
    await projekte.getByLabel('Nach Projekt oder Eigentümer suchen').fill('Grenze B2')
    await b2.waitFor()
    ok((await b2.innerText()) === vorher, 'Stand ändert sich ohne Neuberechnung')
    await b2.getByRole('button', { name: 'Speicher von „Grenze B2“ neu berechnen' }).click()
    await b2.getByText('ab 80 %').waitFor({ timeout: 20000 })

    for (const bereich of ['Nutzer', 'Projekte']) {
      const abschnitt = page.locator('section', { has: page.getByRole('heading', { name: bereich, exact: true }) })
      await abschnitt.getByRole('searchbox').fill('')
      await abschnitt.getByRole('button', { name: /^Auslastung/ }).click()
      const erste = await abschnitt.locator('tbody tr').first().innerText()
      ok(/überschritten|erreicht|ab 80 %/.test(erste), `${bereich} nach Auslastung: ${erste}`)
    }
    await breite(360)
    await ohneSeitlichesRollen('Grenzen 360 px')
    await breite(1280)
  }

  features.p7f11 = async () => {
    await grenzenSetzen({ projekte: '', speicherGb: '' })
    await page.goto(GRENZEN)
    await standardBereich().locator('dl').waitFor()
    const stand = await standardBereich().locator('dl').innerText()
    ok(/Projekte je Nutzer:\s*unbegrenzt/.test(stand) && /Speicher je Projekt:\s*unbegrenzt/.test(stand), `Ohne Einstellung: ${stand}`)
    await anmelden('e2e-grenze-c@example.org')
    await page.locator('.project-list-header-row').first().waitFor()
    ok((await page.locator('.spur-grenzen-anzeige').count()) === 0, 'Projektzahl ohne Grenze angezeigt')
    const sechstes = await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze C6' })
    ok(sechstes.status === 200, `Ohne Grenze: ${sechstes.status}`)
    ok((await seitenAnfrage('DELETE', `/project/${sechstes.daten.project_id}`)).status === 200, 'Aufräumen')

    await grenzenSetzen({ projekte: '', speicherGb: '' }, { 'e2e-grenze-c@example.org': { projekte: '3', speicherGb: '' } })
    await anmelden('e2e-grenze-c@example.org')
    await page.locator('.spur-grenzen-anzeige', { hasText: '5 von 3 Projekten' }).waitFor()
    await projektOeffnen('Grenze C5')
    await editorErsetzen('Text.', 'Text. Bleibt bearbeitbar.')
    const token = await neuesToken()
    await gespeichert(token, page.url().split('/').pop(), 'Bleibt bearbeitbar.')
    const gesperrt = await seitenAnfrage('POST', '/project/new', { projectName: 'Grenze C6' })
    ok(gesperrt.status === 403 && gesperrt.daten?.code === 'projekte_voll', `Sechstes Projekt: ${gesperrt.status}`)

    await grenzenSetzen({ projekte: '', speicherGb: '' }, { 'e2e-grenze-c@example.org': { projekte: '', speicherGb: '' } })
    const REPO = `${FIXTURES}/../../../../../..`
    const readme = await repoDatei(`${REPO}/README.md`)
    const betrieb = readme.split('### Grenzen\n')[1]?.split('\n### ')[0] ?? ''
    ok(betrieb.includes('Admin → Grenzen') && betrieb.includes('unlimited'), 'README ohne Abschnitt zu den Grenzen')
  }

  // Binärdatei aus dem Repo als Buffer (repoDatei liest Text).
  async function repoBytes(pfad) {
    await page.setContent('<input type="file">')
    await page.locator('input').setInputFiles(pfad)
    const base64 = await page.locator('input').evaluate(async el => {
      const bytes = new Uint8Array(await el.files[0].arrayBuffer())
      let text = ''
      for (const b of bytes) text += String.fromCharCode(b)
      return btoa(text)
    })
    return Buffer.from(base64, 'base64')
  }

  async function perLink(link, datei, felder = {}) {
    const inhalt = typeof datei === 'string' ? { name: datei, mimeType: 'application/pdf', buffer: await repoBytes(`${FIXTURES}/${datei}`) } : datei
    const r = await page.request.post(link, { multipart: { datei: inhalt, ...felder } })
    return { status: r.status(), daten: await r.json().catch(() => null) }
  }

  features.p7f12 = async () => {
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E Hochladen')
    const andere = await projektId(token, 'E2E Hochladen B')
    const eintrag = await werkzeug(token, 'acquisition_add', { project_id: pid, doi: '10.5555/spur.2024.001' })
    ok(!eintrag.fehler, `acquisition_add: ${JSON.stringify(eintrag.inhalt)}`)
    const { inhalt: link } = await werkzeug(token, 'source_upload_link', { project_id: pid })
    ok(link.gueltig_minuten === 15 && link.max_dateien === 50 && link.link.startsWith(`${BASE}/spur/hochladen/`), `Link: ${JSON.stringify(link)}`)

    const smith = await perLink(link.link, 'smith2024.pdf', { project_id: andere })
    ok(smith.status === 200 && smith.daten.status === 'angelegt' && /^[0-9a-f]{24}$/.test(smith.daten.quelle_id), `smith2024.pdf: ${JSON.stringify(smith)}`)
    ok(smith.daten.beschaffung_id === eintrag.inhalt.eintrag_id, `Nicht der Beschaffungsliste zugeordnet: ${JSON.stringify(smith.daten)}`)
    const bericht = await perLink(link.link, 'arxiv2401.01234.pdf', { titel: 'Testbericht' })
    ok(bericht.status === 200 && bericht.daten.status === 'angelegt', `Zweite Datei: ${JSON.stringify(bericht)}`)
    const nochmal = await perLink(link.link, 'smith2024.pdf')
    ok(nochmal.daten?.status === 'vorhanden' && nochmal.daten.quelle_id === smith.daten.quelle_id, `Duplikat: ${JSON.stringify(nochmal)}`)
    const text = { name: 'kein.pdf', mimeType: 'application/pdf', buffer: Buffer.from('nur Text, kein PDF') }
    const falsch = await perLink(link.link, text)
    ok(falsch.daten?.status === 'abgelehnt' && falsch.daten.grund.startsWith('Keine PDF-Datei'), `Text als PDF: ${JSON.stringify(falsch)}`)

    const imAnderen = (await werkzeug(token, 'sources_list', { project_id: andere })).inhalt.eintraege
    ok(imAnderen.length === 0, `Upload landete in Projekt B: ${JSON.stringify(imAnderen)}`)
    const ohne = await page.request.post(`${BASE}/spur/hochladen`, { multipart: { datei: text } })
    ok(ohne.status() === 401, `Ohne Token: ${ohne.status()}`)
    const fremd = await page.request.post(`${BASE}/spur/hochladen/${'0'.repeat(64)}`, { multipart: { datei: text } })
    ok(fremd.status() === 401, `Falsches Token: ${fremd.status()}`)

    const { inhalt: kurz } = await werkzeug(token, 'source_upload_link', { project_id: pid })
    const spaeter = new Date(Date.now() + 16 * 60 * 1000).toISOString()
    ok((await page.request.post(`${BASE}/spur/dev/zeit`, { data: { jetzt: spaeter } })).status() === 204, 'Zeit vorstellen')
    try {
      const abgelaufen = await perLink(kurz.link, text)
      ok(abgelaufen.status === 410 && abgelaufen.daten.detail.startsWith('Link abgelaufen'), `Nach 15 Minuten: ${JSON.stringify(abgelaufen)}`)
    } finally {
      await page.request.post(`${BASE}/spur/dev/zeit`, { data: { jetzt: null } })
    }
    const { inhalt: voll } = await werkzeug(token, 'source_upload_link', { project_id: pid })
    for (let i = 0; i < 50; i++) ok((await perLink(voll.link, text)).status === 200, `Upload ${i + 1}`)
    const einundfuenfzig = await perLink(voll.link, text)
    ok(einundfuenfzig.status === 410 && einundfuenfzig.daten.detail.startsWith('Link verbraucht'), `51. Upload: ${JSON.stringify(einundfuenfzig)}`)

    await projektOeffnen('E2E Hochladen')
    await panelOeffnen('Quellen')
    for (const name of ['smith2024.pdf', 'arxiv2401.01234.pdf']) await page.getByRole('button', { name }).first().waitFor({ timeout: 20000 })
    const liste = await jsonVon(`/spur/project/${pid}/beschaffung`)
    const zugeordnet = (liste.eintraege ?? liste).find(e => e.doi === '10.5555/spur.2024.001')
    ok(zugeordnet?.status === 'beschafft', `Beschaffungsliste: ${JSON.stringify(zugeordnet)}`)

    await panelOeffnen('Claude')
    for (const name of ['smith2024.pdf', 'arxiv2401.01234.pdf']) await karte().getByText(name, { exact: true }).waitFor({ timeout: 20000 })
    await karte().getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte().getByText('Zurückgenommen', { exact: true }).waitFor({ timeout: 20000 })
    const danach = (await werkzeug(token, 'sources_list', { project_id: pid })).inhalt.eintraege
    ok(danach.length === 0, `Nach „Lauf rückgängig“: ${danach.map(q => q.dateiname)}`)
  }

  // Die Skripte selbst prüft tools/tests/plugin-skripte.test.mjs gegen lokale Fakes.
  features.p7f13 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    for (const skript of ['spur-pdf-holen', 'spur-hochladen']) {
      const text = await repoDatei(`${REPO}/plugins/spur/bin/${skript}`)
      ok(text.startsWith('#!/usr/bin/env bash') || text.startsWith('#!/bin/bash'), `${skript} ohne bash-Shebang`)
      ok(text.includes('--help'), `${skript} ohne --help`)
    }
    const skill = await repoDatei(`${REPO}/plugins/spur/skills/spur/SKILL.md`)
    const ablauf = skill.split('## PDFs from your computer\n')[1]?.split('\n## ')[0] ?? ''
    for (const teil of ['spur-pdf-holen', 'Playwright', 'source_upload_link', 'spur-hochladen', 'paywall']) {
      ok(ablauf.includes(teil), `SKILL.md: Ablauf ohne „${teil}“`)
    }
    const test = await repoDatei(`${REPO}/tools/tests/plugin-skripte.test.mjs`)
    ok(test.includes('spur-pdf-holen') && test.includes('spur-hochladen'), 'Test der Plugin-Skripte fehlt')
  }

  // Die Paketliste prüft tools/tests/tex-pakete.test.mjs; der Smoke auf spur nach dem Merge ist Handprüfung.
  features.p7f14 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const dockerfile = await repoDatei(`${REPO}/server-ce/Dockerfile-base`)
    const liste = dockerfile.split('tlmgr install --repository ${TEXLIVE_MIRROR}')[1]?.split('&&')[0] ?? ''
    ok(/\sxfrac\s/.test(liste), 'xfrac fehlt in der Paketliste des Images')
    const test = await repoDatei(`${REPO}/tools/tests/tex-pakete.test.mjs`)
    ok(/chemformula: \[[^\]]*'xfrac'/.test(test), 'Der Paket-Test kennt die Pakete nicht, die chemformula nachlädt')
  }

  features.p8f1 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const zeile = text => page.locator('.spur-zeile', { hasText: text }).first()
    const badge = (text, status) => zeile(text).locator('.badge', { hasText: status }).first()
    const istRot = async loc =>
      await loc.evaluate(el => {
        const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number)
        return r > 150 && g < 100 && b < 100
      })
    try {
      await fakeSteuern({ cachesLeeren: true })
      await projektOeffnen('E2E P8 DOI')
      const pid = page.url().split('/').pop()
      await panelOeffnen('Prüfbericht')
      await berichtFilter('Alle')
      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      await badge('arxiv2024', 'Registriert bei DataCite').waitFor({ timeout: 30000 })
      ok(!(await istRot(badge('arxiv2024', 'Registriert bei DataCite'))), 'DataCite-Abzeichen ist rot')
      await zeile('arxiv2024').getByText('DataCite liefert keine Rückzugsmeldungen.', { exact: true }).waitFor()
      ok(!/nicht registriert|unbekannt/.test(await zeile('arxiv2024').innerText()), `arXiv-Zeile: ${await zeile('arxiv2024').innerText()}`)
      const nirgends = badge('nirgends', 'DOI nicht registriert')
      await nirgends.waitFor()
      ok(await istRot(nirgends), 'Nicht registrierte DOI ist nicht rot')
      const andere = badge('andere', 'Registriert bei mEDRA, Metadaten nicht geprüft')
      await andere.waitFor()
      ok(!(await istRot(andere)), 'Andere Registrierstelle ist rot')
      const roteMarken = (await page.locator('.cm-content .spur-marke-rot').allTextContents()).join('')
      ok(roteMarken.includes('nirgends') && !/arxiv2024|andere|smith2024/.test(roteMarken), `Rote Markierungen im Editor: ${roteMarken}`)

      await berichtFilter('Markiert')
      const sichtbar = await page.locator('.spur-zeile .spur-zeile-key').allTextContents()
      ok(JSON.stringify(sichtbar) === JSON.stringify(['nirgends']), `Nur Probleme: ${JSON.stringify(sichtbar)}`)
      await berichtFilter('Alle')

      for (const name of ['check_report', 'bib_list']) {
        const liste = (await werkzeug(token, name, { project_id: pid })).inhalt.eintraege
        const arxiv = liste.find(e => e.key === 'arxiv2024')
        ok(
          arxiv.registrierstelle === 'datacite' && arxiv.titel?.startsWith('Sleep-like replay improves memory consolidation') && arxiv.jahr === 2024 && arxiv.problem !== true,
          `${name} arXiv: ${JSON.stringify(arxiv)}`
        )
        ok(liste.find(e => e.key === 'nirgends').referenz === 'nicht_gefunden', `${name} nirgends: ${JSON.stringify(liste)}`)
      }

      await fakeSteuern({ ausfall: ['doiorg'], cachesLeeren: true })
      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      const ausfall = badge('arxiv2024', 'nicht prüfbar – die Registrierstelle ist gerade nicht erreichbar')
      await ausfall.waitFor({ timeout: 30000 })
      ok(!(await istRot(ausfall)), 'Ausfall der Registrierstelle ist rot')
      await fakeSteuern({ cachesLeeren: true })
      await page.getByRole('button', { name: 'Erneut prüfen' }).click()
      await badge('arxiv2024', 'Registriert bei DataCite').waitFor({ timeout: 30000 })
    } finally {
      await fakeSteuern({})
    }
  }

  features.p8f2 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    // Die genaue Kopfzeile auf frischen Daten prüft f7 (ZAEHLUNG_BERICHT); hier die Zahl hinter „markiert“ gegen den Filter.
    await projektOeffnen('E2E Bericht')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Prüfbericht')
    await berichtFilter('Alle')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    const kopf = page.locator('p.spur-zeile-meta', { hasText: KOPFZEILE_BERICHT })
    await kopf.waitFor({ timeout: 30000 })
    const markiert = Number(/, (\d+) markiert/.exec(await kopf.innerText())?.[1])
    const bericht = (await werkzeug(token, 'check_report', { project_id: pid })).inhalt
    const geprueftProbleme = bericht.eintraege.filter(z => z.problem).length
    ok(markiert > 0 && markiert === geprueftProbleme && bericht.zaehlung.markiert === markiert, `${markiert} markiert, Filter ${geprueftProbleme}, MCP ${JSON.stringify(bericht.zaehlung)}`)
    for (const schluessel of ['geprueft', 'ohne_quelle', 'ohne_seitenangabe', 'nicht_pruefbar']) {
      ok(Number.isInteger(bericht.zaehlung[schluessel]), `zaehlung.${schluessel} fehlt: ${JSON.stringify(bericht.zaehlung)}`)
    }
    await berichtFilter('Markiert')
    const sichtbar = await page.locator('.spur-zeile').count()
    const problemeGesamt = bericht.eintraege.filter(z => z.problem).length
    ok(sichtbar === problemeGesamt, `Nur Probleme zeigt ${sichtbar}, MCP ${problemeGesamt}`)
    await berichtFilter('Alle')

    await projektOeffnen('E2E P8 Zählung')
    const pid2 = page.url().split('/').pop()
    await panelOeffnen('Prüfbericht')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await kopfzeileAbwarten('2 Stellen, keine markiert, 1 Beleg ohne Wortlaut', 30000)
    await page.locator('.spur-zeile .badge').getByText('Beleg ohne Wortlaut', { exact: true }).waitFor()
    const zweiter = (await werkzeug(token, 'check_report', { project_id: pid2 })).inhalt.zaehlung
    ok(zweiter.beleg_ohne_wortlaut === 1 && zweiter.geprueft === 1 && zweiter.markiert === 0, `check_report: ${JSON.stringify(zweiter)}`)
    const { daten } = await mcp(token, 'tools/list')
    const beschreibung = daten.result.tools.find(w => w.name === 'check_report').description
    ok(/markiert/.test(beschreibung) && /beleg_ohne_wortlaut/.test(beschreibung), `Beschreibung: ${beschreibung}`)
  }

  const EINSTELLUNGEN = 'Einstellungen der Prüfung'

  async function makrosSpeichern(feld, wert) {
    const knopf = page.getByRole('button', { name: EINSTELLUNGEN })
    if ((await knopf.getAttribute('aria-expanded')) !== 'true') await knopf.click()
    await page.getByLabel(feld, { exact: true }).fill(wert)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  }

  features.p8f3 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const zeile = text => page.locator('.spur-zeile', { hasText: text }).first()
    await projektOeffnen('E2E P8 Makros')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Prüfbericht')
    await berichtFilter('Alle')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await zeile('Sleep supports the consolidation').getByText('Wortlaut: exakt', { exact: true }).waitFor({ timeout: 30000 })
    const abweichend = zeile('Sleep invented').getByText('Wortlaut: abweichend', { exact: true })
    await abweichend.waitFor()
    ok(/bg-danger/.test(await abweichend.evaluate(el => el.closest('.badge').className)), 'Abweichender Wortlaut im Makro ist nicht rot')
    const wort = page.locator('.spur-zeile', { has: page.locator('.badge', { hasText: 'Beleg ohne Wortlaut' }) })
    await wort.waitFor()
    ok((await wort.count()) === 1, `Beleg ohne Wortlaut: ${await wort.count()} Zeilen`)

    const erfunden = await werkzeug(token, 'doc_edit', {
      project_id: pid, pfad: 'main.tex', alt: '\\end{document}', neu: '\\zitat{Erfundener Satz.} \\autocite[347]{smith2024}\n\\end{document}', idempotenz_schluessel: `p8f3-${Date.now()}`,
    })
    ok(erfunden.fehler && erfunden.inhalt.fehler === 'zitat_abweichend', `doc_edit mit \\zitat: ${JSON.stringify(erfunden.inhalt)}`)

    const knopf = page.getByRole('button', { name: EINSTELLUNGEN })
    await knopf.click()
    await page.getByText('Automatisch erkannt: zitat', { exact: true }).waitFor()
    await makrosSpeichern('Zitatmakros', 'wort 2')
    await page.getByText('Nur Buchstaben, ohne Backslash', { exact: true }).waitFor()
    const nichts = await jsonVon(`/spur/project/${pid}/pruefbericht/makros`)
    ok(nichts.zitat.length === 0, `Ungültige Eingabe gespeichert: ${JSON.stringify(nichts)}`)
    await makrosSpeichern('Zitatmakros', '\\wort')
    await knopf.and(page.locator(':focus')).waitFor()
    await zeile('Memory traces').getByText('Wortlaut: exakt', { exact: true }).waitFor({ timeout: 30000 })
    const gespeichert = await jsonVon(`/spur/project/${pid}/pruefbericht/makros`)
    ok(JSON.stringify(gespeichert.zitat) === '["wort"]', `Gespeichert: ${JSON.stringify(gespeichert)}`)

    await anmelden('e2e-leser@example.org')
    await projektOeffnen('E2E P8 Makros')
    await panelOeffnen('Prüfbericht')
    await page.getByRole('button', { name: EINSTELLUNGEN }).click()
    const feld = page.getByLabel('Zitatmakros', { exact: true })
    await page.getByText('Nur wer im Projekt schreiben darf, kann die Listen ändern.').waitFor()
    ok((await feld.inputValue()) === 'wort' && !(await feld.isEditable()), 'Leser kann die Liste ändern')
    ok((await page.getByRole('button', { name: 'Speichern', exact: true }).count()) === 0, 'Leser sieht Speichern')
    const status = await page.evaluate(async url => {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': document.querySelector('meta[name="ol-csrfToken"]').content },
        body: JSON.stringify({ zitat: [], ausgeblendet: [] }),
      })
      return r.status
    }, `${BASE}/spur/project/${pid}/pruefbericht/makros`)
    ok(status === 403, `Speichern als Leser: ${status}`)
  }

  features.p8f4 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const keys = async () => await page.locator('.spur-zeile .spur-zeile-key').allTextContents()
    await projektOeffnen('E2E P8 Vermerke')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Prüfbericht')
    await berichtFilter('Alle')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await page.getByText('2 Stellen in ausgeblendeten Bereichen übersprungen', { exact: true }).waitFor({ timeout: 30000 })
    ok(JSON.stringify(await keys()) === '["smith2024"]', `Zeilen: ${JSON.stringify(await keys())}`)
    const bericht = (await werkzeug(token, 'check_report', { project_id: pid })).inhalt
    ok(
      bericht.uebersprungen === 2 && !bericht.eintraege.some(z => ['brown2005', 'wider2023'].includes(z.key)),
      `check_report: ${bericht.uebersprungen}, ${JSON.stringify(bericht.eintraege.map(z => z.key))}`
    )

    await editorErsetzen('\\newcommand{\\note}[1]{}', '\\newcommand{\\note}[1]{\\textcolor{red}{#1}}')
    await gespeichert(token, pid, '\\textcolor{red}{#1}')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await page.getByText('1 Stelle in ausgeblendeten Bereichen übersprungen', { exact: true }).waitFor({ timeout: 30000 })
    ok((await keys()).includes('brown2005'), `Nach sichtbarem \\note: ${JSON.stringify(await keys())}`)

    await makrosSpeichern('Ausgeblendete Makros', 'note')
    await page.getByText('2 Stellen in ausgeblendeten Bereichen übersprungen', { exact: true }).waitFor({ timeout: 30000 })
    ok(!(await keys()).includes('brown2005'), `Nach der Einstellung: ${JSON.stringify(await keys())}`)
  }

  features.p8f5 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E P8 Zahlen')
    const lauf = Date.now()
    const schreiben = async (neu, n) => {
      const { fehler, inhalt } = await werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', neu, idempotenz_schluessel: `p8f5-${lauf}-${n}` })
      ok(!fehler, `doc_edit: ${JSON.stringify(inhalt)}`)
      return inhalt.zahlen_ohne_beleg
    }
    const datum = await schreiben('\nDie Erhebung fand am 12.11.2026 um 14:30 Uhr statt, ausgewertet mit Version 1.2.3 am 12. November 2026.\n', 1)
    ok(!datum?.length, `Datum gemeldet: ${JSON.stringify(datum)}`)
    await projektOeffnen('E2E P8 Zahlen')
    await panelOeffnen('Claude')
    await claudePanel().getByText('main.tex', { exact: false }).first().waitFor({ timeout: 10000 })
    ok((await claudePanel().getByText('Zahl ohne Beleg').count()) === 0, 'Lauf-Karte meldet Datum als Zahl ohne Beleg')
    const werte = await schreiben('\nVon 240 Befragten antworteten 37,5 Prozent am 12.11.2026.\n', 2)
    ok(JSON.stringify(werte) === '["240","37,5"]', `Gemeldet: ${JSON.stringify(werte)}`)
    const karte = claudePanel().locator('.spur-lauf-hinweis', { hasText: 'Zahl ohne Beleg' }).first()
    await karte.getByText(/^Zahl ohne Beleg: .*\b240\b/).waitFor({ timeout: 10000 })
    const karteZahlen = (await karte.innerText()).replace(/^Zahl ohne Beleg: /, '').split(', ')
    ok(!karteZahlen.some(z => /^(12|11|2026|14|30|1\.2\.3)$/.test(z)), `Lauf-Karte: ${karteZahlen}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Datum geprüft.' })
  }

  const CARLITO_DATEIEN = ['carlito-optionen.sty', 'carlito.sty', 'ly1carlito.fd', 'ot1carlito.fd', 't1carlito.fd'].map(d => `/tex-pakete/carlito/${d}`)

  async function paketPfade(pid) {
    return (await jsonVon(`/project/${pid}/entities`)).entities.map(e => e.path).filter(p => p.startsWith('/tex-pakete/')).sort()
  }

  features.p8f6 = async () => {
    await breite(1280)
    // Speicher wird nur mit einer Grenze berechnet; 1 GB stört die übrigen Schritte nicht.
    await grenzenSetzen({ projekte: '', speicherGb: '1' })
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const carlito = pid => werkzeug(token, 'tex_package_add', { project_id: pid, paket: 'carlito' })
    const vollstaendig = async pid => ok(JSON.stringify(await paketPfade(pid)) === JSON.stringify(CARLITO_DATEIEN), `Dateien: ${await paketPfade(pid)}`)
    try {
      const pid = await projektId(token, 'E2E P8 Pakete')
      await fakeSteuern({ stoerungen: { texlive: { status: 502, mal: 2 } }, schalter: {} })
      const nachZwei = await carlito(pid)
      ok(!nachZwei.fehler && JSON.stringify([...nachZwei.inhalt.dateien].sort()) === JSON.stringify(CARLITO_DATEIEN.map(p => p.slice(1))), `Nach zwei 502: ${JSON.stringify(nachZwei.inhalt)}`)
      const zweimal = await carlito(pid)
      ok(!zweimal.fehler && zweimal.inhalt.hinweis === 'schon im Projekt' && zweimal.inhalt.dateien.length === 0, `Zweiter Aufruf: ${JSON.stringify(zweimal.inhalt)}`)
      await vollstaendig(pid)

      const pidB = await projektId(token, 'E2E P8 Pakete Fehler')
      await fakeSteuern({ stoerungen: { texlive: { status: 502 }, 'texlive-b': { status: 502 } } })
      const beide = await carlito(pidB)
      ok(
        beide.fehler && beide.inhalt.fehler === 'spiegel_nicht_erreichbar' && beide.inhalt.detail === 'Die Paketquelle antwortet mit Fehler 502. Versuch es später erneut.',
        `Beide Spiegel 502: ${JSON.stringify(beide.inhalt)}`
      )
      await projektOeffnen('E2E P8 Pakete Fehler')
      await panelSichern(DATEIBAUM, page.locator('.file-tree').getByRole('treeitem', { name: 'main.tex' }))
      ok((await page.locator('.file-tree').getByRole('treeitem', { name: 'tex-pakete' }).count()) === 0, 'Ordner tex-pakete im Dateibaum')
      await panelOeffnen('Claude')
      ok((await claudePanel().getByText('tex-pakete/carlito').count()) === 0, 'Lauf-Karte listet das Paket')

      await fakeSteuern({ schalter: { SPUR_TEX_UPLOAD_FEHLER: '3' } })
      const vorher = (await jsonVon(`/spur/project/${pidB}/speicher`)).bytes
      const abbruch = await carlito(pidB)
      ok(abbruch.fehler && abbruch.inhalt.fehler === 'paket_abgebrochen', `Upload-Fehler: ${JSON.stringify(abbruch.inhalt)}`)
      ok((await paketPfade(pidB)).length === 0, `Nach dem Upload-Fehler: ${await paketPfade(pidB)}`)
      const ordner = (await jsonVon(`/project/${pidB}/entities`)).entities.filter(e => e.path.startsWith('/tex-pakete'))
      ok(ordner.length === 0, `Rest: ${JSON.stringify(ordner)}`)
      const nachher = (await jsonVon(`/spur/project/${pidB}/speicher`)).bytes
      ok(Number.isInteger(vorher) && nachher === vorher, `Speicher vorher ${vorher}, nachher ${nachher}`)

      await fakeSteuern({ stoerungen: { texlive: { status: 502 } }, schalter: {} })
      const zweiter = await carlito(pidB)
      ok(!zweiter.fehler && zweiter.inhalt.dateien.length === 5, `Zweiter Spiegel: ${JSON.stringify(zweiter.inhalt)}`)
      await vollstaendig(pidB)
      await fakeSteuern({ schalter: {} })

      for (const name of ['E2E P8 Pakete Rest', 'E2E P8 Pakete Rest B']) {
        const pidRest = await projektId(token, name)
        const rest = await carlito(pidRest)
        ok(!rest.fehler && rest.inhalt.dateien.length === 5, `${name}: ${JSON.stringify(rest.inhalt)}`)
        await vollstaendig(pidRest)
      }
      const pidRest = await projektId(token, 'E2E P8 Pakete Rest')
      let job
      for (let i = 0; i < 10; i++) {
        job = await kompiliertBeiClaude(token, pidRest)
        if (job.ergebnis?.compile !== 'too-recently-compiled') break
        await page.waitForTimeout(1500)
      }
      ok(job.ergebnis.compile === 'success', `Compile mit carlito: ${JSON.stringify(job.ergebnis)}`)

      // Abbruch beim Client mitten im Upload: Der Server stellt fertig, der neue Aufruf wartet darauf.
      const pidAbbruch = await projektId(token, 'E2E P8 Pakete Abbruch')
      await fakeSteuern({ schalter: { SPUR_TEX_UPLOAD_PAUSE_MS: '600' } })
      const abgebrochen = await page.request
        .post(`${BASE}/spur/mcp`, {
          headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tex_package_add', arguments: { project_id: pidAbbruch, paket: 'carlito' } } },
          timeout: 1500,
        })
        .then(() => 'fertig', () => 'abgebrochen')
      ok(abgebrochen === 'abgebrochen', `Aufruf nicht abgebrochen: ${abgebrochen}`)
      const danach = await carlito(pidAbbruch)
      ok(!danach.fehler && (danach.inhalt.hinweis === 'schon im Projekt' || danach.inhalt.dateien.length === 5), `Nach dem Abbruch: ${JSON.stringify(danach.inhalt)}`)
      await vollstaendig(pidAbbruch)
    } finally {
      await fakeSteuern({ schalter: {} })
      await grenzenSetzen({ projekte: '', speicherGb: '' })
    }
  }

  features.p8f7 = async () => {
    await breite(1280)
    const TEX_FELDER = ['Größe je Paket (MB)', 'Pakete je Projekt (MB)', 'Installationen je Stunde']
    const texFeld = name => standardBereich().getByLabel(name, { exact: true })
    try {
      await grenzenSetzen({ projekte: '', speicherGb: '' })
      await anmelden('e2e-pakete@example.org')
      const token = await neuesToken()
      const paket = async (projekt, name) => await werkzeug(token, 'tex_package_add', { project_id: await projektId(token, projekt), paket: name })
      const gross = await paket('E2E P8 Grenzen A', 'spurtest-gross')
      ok(!gross.fehler && gross.inhalt.dateien.length === 1, `30 MB mit Standardgrenzen: ${JSON.stringify(gross.inhalt)}`)

      await grenzenSetzen({ projekte: '', speicherGb: '' }, { 'e2e-pakete@example.org': { projekte: '', speicherGb: '0,01' } })
      await anmelden('e2e-pakete@example.org')
      const voll = await paket('E2E P8 Grenzen B', 'spurtest-gross')
      ok(voll.fehler && voll.inhalt.fehler === 'speicher_voll' && /GB von 0,01 GB/.test(voll.inhalt.detail), `Speicher-Grenze: ${JSON.stringify(voll.inhalt)}`)
      const zuViele = await paket('E2E P8 Grenzen Voll', 'carlito')
      ok(zuViele.fehler && zuViele.inhalt.fehler === 'projekt_zu_viele_dateien' && zuViele.inhalt.detail.includes('erlaubt sind 2000'), `2000 Einträge: ${JSON.stringify(zuViele.inhalt)}`)
      const pidVoll = await projektId(token, 'E2E P8 Grenzen Voll')
      ok((await paketPfade(pidVoll)).length === 0, `Nach projekt_zu_viele_dateien: ${await paketPfade(pidVoll)}`)

      await grenzenSetzen({ projekte: '', speicherGb: '' })
      await page.goto(GRENZEN)
      await standardBereich().getByRole('heading', { name: 'TeX-Pakete' }).waitFor()
      const platzhalter = await Promise.all(TEX_FELDER.map(f => texFeld(f).getAttribute('placeholder')))
      ok(JSON.stringify(platzhalter) === '["100","300","60"]', `Platzhalter: ${platzhalter}`)
      for (const [feld, wert] of [['Größe je Paket (MB)', '0'], ['Pakete je Projekt (MB)', '-5'], ['Installationen je Stunde', 'abc']]) await texFeld(feld).fill(wert)
      await standardBereich().getByRole('button', { name: 'Speichern' }).click()
      await standardBereich().getByText('Bitte eine ganze Zahl ab 1 eingeben', { exact: false }).first().waitFor()
      ok((await standardBereich().getByText('Bitte eine ganze Zahl ab 1 eingeben', { exact: false }).count()) === 3, 'Nicht jedes Feld meldet den Fehler')
      ok((await texFeld('Installationen je Stunde').getAttribute('aria-invalid')) === 'true', 'Feld nicht als ungültig markiert')
      for (const [feld, wert] of [['Größe je Paket (MB)', '10'], ['Pakete je Projekt (MB)', '20'], ['Installationen je Stunde', '2']]) await texFeld(feld).fill(wert)
      await standardBereich().getByRole('button', { name: 'Speichern' }).click()
      await standardBereich().getByText('Gespeichert').waitFor()
      await page.reload()
      await texFeld('Installationen je Stunde').waitFor()
      const werte = await Promise.all(TEX_FELDER.map(f => texFeld(f).inputValue()))
      ok(JSON.stringify(werte) === '["10","20","2"]', `Nach dem Neuladen: ${werte}`)

      await anmelden('e2e-pakete@example.org')
      const zuGross = await paket('E2E P8 Grenzen C', 'spurtest-gross')
      ok(zuGross.fehler && zuGross.inhalt.fehler === 'paket_zu_gross' && zuGross.inhalt.detail.includes('ist entpackt 30 MB groß, erlaubt sind 10 MB.'), `10 MB: ${JSON.stringify(zuGross.inhalt)}`)

      await anmelden('e2e-pakete-b@example.org')
      const tokenB = await neuesToken()
      const pidD = await projektId(tokenB, 'E2E P8 Drossel')
      const holen = name => werkzeug(tokenB, 'tex_package_add', { project_id: pidD, paket: name })
      for (const name of ['beamer', 'spurtestgibtsnicht', '../x', 'spurtest-ausbruch', 'spurtest-gross']) {
        const r = await holen(name)
        ok(r.inhalt.hinweis === 'schon im Image' || r.fehler, `${name}: ${JSON.stringify(r.inhalt)}`)
      }
      ok(!(await holen('spurfarben')).fehler, 'Erstes kleines Paket')
      ok((await holen('spurfarben')).inhalt.hinweis === 'schon im Projekt', 'Zweiter Aufruf')
      ok(!(await holen('beamertheme-spurtest')).fehler, 'Zweites kleines Paket')
      const drittes = await holen('carlito')
      ok(drittes.fehler && drittes.inhalt.fehler === 'zu_viele_anfragen' && drittes.inhalt.detail.includes('2 Installationen je Stunde'), `Drittes: ${JSON.stringify(drittes.inhalt)}`)

      await page.goto(`${BASE}/project`)
      const fremd = await seitenAnfrage('PUT', '/spur/admin/grenzen/standard', { texPaketMb: '500' })
      ok(fremd.status === 403, `Speichern ohne Admin-Rechte: ${fremd.status}`)

      await anmelden('e2e-admin@example.org')
      await page.goto(GRENZEN)
      await texFeld('Größe je Paket (MB)').waitFor()
      for (const f of TEX_FELDER) await texFeld(f).fill('')
      await standardBereich().getByRole('button', { name: 'Speichern' }).click()
      await standardBereich().getByText('Gespeichert').waitFor()
      await page.reload()
      await texFeld('Größe je Paket (MB)').waitFor()
      ok((await texFeld('Größe je Paket (MB)').inputValue()) === '' && (await texFeld('Größe je Paket (MB)').getAttribute('placeholder')) === '100', 'Leeres Feld stellt den Standard nicht her')
    } finally {
      await grenzenSetzen({ projekte: '', speicherGb: '' })
    }
  }

  features.p8f8 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const lauf = Date.now()
    let n = 0
    const anlegen = async (projekt, pfad, inhalt = 'Die Einleitung beginnt hier.') =>
      await werkzeug(token, 'doc_create', { project_id: await projektId(token, projekt), pfad, inhalt, idempotenz_schluessel: `p8f8-${lauf}-${n++}` })
    const pfade = async projekt => (await jsonVon(`/project/${await projektId(token, projekt)}/entities`)).entities.map(e => e.path)
    try {
      const erstes = await anlegen('E2E P8 Anlegen', 'kapitel/einleitung.tex')
      ok(!erstes.fehler && erstes.inhalt.aenderung === true, `doc_create: ${JSON.stringify(erstes.inhalt)}`)
      const zweites = await anlegen('E2E P8 Anlegen', 'kapitel/einleitung.tex')
      ok(zweites.fehler && zweites.inhalt.fehler === 'konflikt' && zweites.inhalt.detail.includes('kapitel/einleitung.tex'), `Zweiter Aufruf: ${JSON.stringify(zweites.inhalt)}`)

      const datei = await anlegen('E2E P8 Anlegen Dateien', 'abb/x.tex')
      ok(datei.fehler && datei.inhalt.fehler === 'pfad_ist_datei' && datei.inhalt.detail === '„abb“ ist eine Datei, kein Ordner. Wähl einen anderen Pfad.', `abb/x.tex: ${JSON.stringify(datei.inhalt)}`)
      ok(!(await pfade('E2E P8 Anlegen Dateien')).some(p => p.startsWith('/abb/')), 'Unter abb entstand etwas')
      const zahlen = await anlegen('E2E P8 Anlegen Dateien', 'zahlen.tex', 'Es antworteten 240 Personen.')
      ok(!zahlen.fehler && JSON.stringify(zahlen.inhalt.zahlen_ohne_beleg) === '["240"]', `Mit binärer ergebnisse.tex: ${JSON.stringify(zahlen.inhalt)}`)

      const voll = await anlegen('E2E P8 Anlegen Voll', 'neu.tex')
      ok(
        voll.fehler && voll.inhalt.fehler === 'projekt_zu_viele_dateien' &&
          voll.inhalt.detail === 'Das Projekt hat 2000 von 2000 Dateien. Lösch Dateien, zum Beispiel nicht gebrauchte TeX-Pakete.',
        `2000 Einträge: ${JSON.stringify(voll.inhalt)}`
      )

      await fakeSteuern({ schalter: { SPUR_DOKUPDATER_500: '1' } })
      const dienst = await anlegen('E2E P8 Anlegen', 'kapitel/methoden.tex')
      ok(dienst.fehler && dienst.inhalt.fehler === 'dienst_nicht_erreichbar' && /gleich noch einmal/.test(dienst.inhalt.detail), `500: ${JSON.stringify(dienst.inhalt)}`)
      ok(!(await pfade('E2E P8 Anlegen')).includes('/kapitel/methoden.tex'), 'Leeres Dokument blieb liegen')
      await fakeSteuern({ schalter: {} })
      const nochmal = await anlegen('E2E P8 Anlegen', 'kapitel/methoden.tex')
      ok(!nochmal.fehler, `Nach dem Abschalten: ${JSON.stringify(nochmal.inhalt)}`)

      await fakeSteuern({ schalter: { SPUR_DOKUPDATER_500: '1', SPUR_DOC_AUFRAEUMEN_FEHLER: '1' } })
      const doppelt = await anlegen('E2E P8 Anlegen', 'kapitel/ergebnisse-text.tex')
      ok(doppelt.fehler && doppelt.inhalt.fehler === 'dienst_nicht_erreichbar', `Auch Aufräumen scheitert: ${JSON.stringify(doppelt.inhalt)}`)
      await fakeSteuern({ schalter: {} })
      const danach = await anlegen('E2E P8 Anlegen', 'kapitel/ergebnisse-text.tex')
      ok(!danach.fehler, `Nach gescheitertem Aufräumen: ${JSON.stringify(danach.inhalt)}`)

      // Die Log-Zeile zur Fehler-ID prüft der Builder mit spur-dev logs web (Handprüfung, siehe progress.md).
      await fakeSteuern({ schalter: { SPUR_DOC_CREATE_FEHLER: '1' } })
      const intern = await anlegen('E2E P8 Anlegen', 'kapitel/intern.tex', 'Geheimer Inhalt 4711')
      ok(intern.fehler && intern.inhalt.fehler === 'interner_fehler' && /Fehler-ID [0-9a-f]{8}\.$/.test(intern.inhalt.detail), `Interner Fehler: ${JSON.stringify(intern.inhalt)}`)
      await fakeSteuern({ schalter: {} })

      await projektOeffnen('E2E P8 Anlegen')
      const kapitel = page.locator('.file-tree').getByRole('treeitem', { name: 'kapitel' })
      await panelSichern(DATEIBAUM, kapitel)
      if ((await kapitel.getAttribute('aria-expanded')) !== 'true') await kapitel.click()
      await page.locator('.file-tree').getByRole('treeitem', { name: 'einleitung.tex' }).click()
      await page.locator('.cm-content .ol-cm-change-i', { hasText: 'Die Einleitung beginnt hier.' }).first().waitFor({ timeout: 20000 })
    } finally {
      await fakeSteuern({ schalter: {} })
    }
  }

  // wait_for_event aus dem Browser wie ein MCP-Client; Ergebnis und Dauer landen in window.__warten[name].
  async function wartenStarten(token, name, args = {}) {
    await page.evaluate(([t, n, a]) => {
      window.__warten ??= {}
      const start = Date.now()
      const eintrag = { ergebnis: null }
      window.__warten[n] = eintrag
      fetch('/spur/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wait_for_event', arguments: a } }),
      })
        .then(r => r.text())
        .then(text => {
          const zeilen = text.split('\n').filter(z => z.startsWith('data:')).map(z => JSON.parse(z.slice(5)))
          const antwort = (zeilen.length ? zeilen : [JSON.parse(text)]).find(d => d.result || d.error)
          eintrag.ergebnis = antwort.result ? JSON.parse(antwort.result.content[0].text) : antwort
          eintrag.dauer = Date.now() - start
        })
        .catch(e => (eintrag.ergebnis = { fehler: e.message }))
    }, [token, name, args])
  }

  async function gewartet(name, timeout = 20000) {
    const handle = await page.waitForFunction(n => window.__warten?.[n]?.ergebnis && window.__warten[n], name, { timeout })
    return await handle.jsonValue()
  }

  features.p8f9 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    await projektOeffnen('E2E P8 Warten')
    const pid = page.url().split('/').pop()
    const auftrag = async text => ok((await seitenPost(`/spur/project/${pid}/claude/auftrag`, { text })).status === 201, `Auftrag ${text}`)
    // Ältere Aufträge dieses Kontos sind für diesen Schritt gelesen.
    await werkzeug(token, 'events_since', {})
    try {
      await fakeSteuern({ schalter: { SPUR_WARTEN_S: '2' } })
      const leer = (await werkzeug(token, 'wait_for_event', {})).inhalt
      ok(leer.ereignis === null && 'cursor' in leer && leer.hinweis === 'Kein Auftrag. Ruf wait_for_event erneut auf.' && !leer.abgeloest, `Ohne Auftrag: ${JSON.stringify(leer)}`)

      // Zwischen zwei Aufrufen bleibt das Panel verbunden (kurze Aufrufe von 2 s, Pausen von 3 s, 45 s lang).
      await panelOeffnen('Claude')
      await wartenStarten(token, 'takt0')
      await claudePanel().getByText('Claude verbunden', { exact: true }).waitFor({ timeout: 10000 })
      const ende = Date.now() + 45000
      for (let i = 1; Date.now() < ende; i++) {
        ok((await claudePanel().getByText('Claude nicht verbunden').count()) === 0, `Flackern nach ${45 - Math.round((ende - Date.now()) / 1000)} s`)
        if (i % 10 === 0) await wartenStarten(token, `takt${i}`)
        await page.waitForTimeout(500)
      }
      await fakeSteuern({ schalter: {} })

      await wartenStarten(token, 'panel')
      await page.waitForTimeout(500)
      const feld = claudePanel().getByLabel('Auftrag an Claude')
      await feld.fill('Bitte Abschnitt 1 glätten')
      const gesendet = Date.now()
      await feld.press('Control+Enter')
      const panel = await gewartet('panel', 10000)
      ok(panel.ergebnis.ereignis?.daten?.text === 'Bitte Abschnitt 1 glätten' && panel.ergebnis.cursor === panel.ergebnis.ereignis.id, `Aus dem Panel: ${JSON.stringify(panel.ergebnis)}`)
      ok(Date.now() - gesendet <= 6000, `Auftrag kam nach ${Date.now() - gesendet} ms`)

      await wartenStarten(token, 'erster')
      await page.waitForTimeout(1000)
      await wartenStarten(token, 'zweiter')
      const erster = await gewartet('erster', 10000)
      ok(erster.ergebnis.ereignis === null && erster.ergebnis.abgeloest === true && /nicht erneut auf/.test(erster.ergebnis.hinweis), `Abgelöst: ${JSON.stringify(erster.ergebnis)}`)
      await auftrag('Für den zweiten Aufruf')
      const zweiter = await gewartet('zweiter', 10000)
      ok(zweiter.ergebnis.ereignis?.daten?.text === 'Für den zweiten Aufruf', `Zweiter Aufruf: ${JSON.stringify(zweiter.ergebnis)}`)
      ok(erster.ergebnis.ereignis === null, 'Erster Aufruf bekam den Auftrag')

      const angekommen = []
      for (let i = 0; i < 10; i++) {
        await wartenStarten(token, `folge${i}`)
        await auftrag(`Auftrag ${i}`)
        angekommen.push((await gewartet(`folge${i}`, 10000)).ergebnis.ereignis?.daten?.text)
      }
      ok(JSON.stringify(angekommen) === JSON.stringify(Array.from({ length: 10 }, (_, i) => `Auftrag ${i}`)), `Zehn Aufträge: ${JSON.stringify(angekommen)}`)

      const cursor = zweiter.ergebnis.cursor
      const neuere = (await werkzeug(token, 'events_since', { cursor })).inhalt
      ok(JSON.stringify(neuere.ereignisse.map(e => e.daten.text)) === JSON.stringify(angekommen), `events_since mit Cursor: ${JSON.stringify(neuere.ereignisse.map(e => e.daten.text))}`)
      await auftrag('Nur über events_since')
      const neueste = (await werkzeug(token, 'events_since', {})).inhalt.ereignisse
      ok(neueste.at(-1).daten.text === 'Nur über events_since', `events_since ohne Cursor: ${neueste.at(-1)?.daten?.text}`)
      ok((await werkzeug(token, 'wait_for_event', { max_sekunden: 2 })).inhalt.ereignis === null, 'Über events_since Gelesenes kam erneut')

      const REPO = `${FIXTURES}/../../../../../..`
      const { daten } = await mcp(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
      const beschreibung = (await mcp(token, 'tools/list')).daten.result.tools.find(w => w.name === 'wait_for_event').description
      const skill = await repoDatei(`${REPO}/plugins/spur/skills/spur/SKILL.md`)
      // Der Startbefehl im Panel ist claude … -- "<spur_start_prompt>" (claude-verbinden.tsx, Frontend-Test).
      const startbefehl = JSON.parse(await repoDatei(`${REPO}/services/web/locales/de.json`)).spur_start_prompt
      const texte = { anweisungen: daten.result.instructions, beschreibung, skill, startbefehl }
      for (const [name, text] of Object.entries(texte)) {
        for (const teil of ['wait_for_event', 'ereignis: null', 'abgeloest']) ok(text.includes(teil), `${name} ohne „${teil}“: ${text}`)
      }
    } finally {
      await fakeSteuern({ schalter: {} })
    }
  }

  features.p8f10 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const SPERRE = 'Ein Proxy oder Filter in deinem Netz blockiert diese Anfrage (Status 403). Das liegt nicht an deinem Dokument. Wende dich an deine IT oder versuch es in einem anderen Netz.'
    const SPERRE_OHNE = SPERRE.replace(' (Status 403)', '')
    const pdfBereich = () => page
    // Der Editor kompiliert beim Öffnen; ein Klick direkt danach meldet „zu kurz nach dem letzten Kompilieren“.
    const neuKompilieren = async () => {
      await page.waitForTimeout(3000)
      await page.getByRole('button', { name: KOMPILIEREN }).first().click()
    }
    try {
      await projektOeffnen('E2E P8 Proxy')
      await page.locator('.pdf-viewer .page canvas').first().waitFor({ timeout: 120000 })

      await fakeSteuern({ schalter: { SPUR_PROXY_PDF: '403' } })
      await neuKompilieren()
      const meldung = pdfBereich().getByText(SPERRE, { exact: true })
      await meldung.waitFor({ timeout: 60000 })
      ok((await pdfBereich().getByText('PDF-Wiedergabe-Fehler').count()) === 0, 'Weiter „PDF-Wiedergabe-Fehler“')
      ok((await meldung.getAttribute('role')) === 'alert', 'Meldung ohne role="alert"')
      await meldung.focus()
      ok(await meldung.evaluate(el => el === document.activeElement), 'Meldung nicht per Tastatur erreichbar')

      await fakeSteuern({ schalter: { SPUR_PROXY_PDF: '200' } })
      await neuKompilieren()
      await pdfBereich().getByText(SPERRE_OHNE, { exact: true }).waitFor({ timeout: 60000 })

      await fakeSteuern({ schalter: { SPUR_PROXY_PDF: 'kaputt' } })
      await neuKompilieren()
      await pdfBereich().getByText('PDF-Wiedergabe-Fehler').first().waitFor({ timeout: 60000 })
      ok((await pdfBereich().getByText(SPERRE_OHNE).count()) === 0, 'Defektes PDF als Proxy-Sperre gemeldet')

      await fakeSteuern({ schalter: {} })
      await neuKompilieren()
      await page.locator('.pdf-viewer .page canvas').first().waitFor({ timeout: 120000 })

      for (const [art, text] of [['403', SPERRE], ['200', SPERRE_OHNE]]) {
        await fakeSteuern({ schalter: { SPUR_PROXY_API: art } })
        await page.reload()
        await page.locator('.cm-content').first().waitFor()
        await panelOeffnen('Quellen')
        const quellenMeldung = page.locator('.spur-panel').getByText(text, { exact: true })
        await quellenMeldung.waitFor({ timeout: 20000 })
        ok(await quellenMeldung.evaluate(el => Boolean(el.closest('[role="alert"]'))), `Quellen-Meldung (${art}) ohne role="alert"`)
        ok((await page.locator('.spur-panel').getByText(/^(Forbidden|Noch keine Quellen)$/).count()) === 0, `Quellen-Panel (${art}) zeigt Forbidden oder eine leere Liste`)
      }
      await fakeSteuern({ schalter: {} })
      const nochmal = page.locator('.spur-panel').getByRole('button', { name: 'Erneut versuchen' })
      await nochmal.focus()
      await page.keyboard.press('Enter')
      await page.locator('.spur-panel').getByText('Noch keine Quellen').waitFor({ timeout: 20000 })
    } finally {
      await fakeSteuern({ schalter: {} })
    }
  }

  // Der Namensabgleich Vertrag ↔ werkzeuge.mjs ist tools/tests/mcp-vertrag.test.mjs (node --test).
  features.p8f11 = async () => {
    const REPO = `${FIXTURES}/../../../../../..`
    const enthaelt = (text, teile, wo) => {
      for (const teil of teile) ok(text.includes(teil), `${wo} ohne „${teil}“`)
    }
    const vertrag = await repoDatei(`${REPO}/docs/mcp-contract.md`)
    ok(!vertrag.includes('paper_lookup'), 'Vertrag nennt paper_lookup')
    enthaelt(vertrag, ['`doc_create`', 'inhalt', 'pfad_ist_datei', 'projekt_zu_viele_dateien', 'dienst_nicht_erreichbar', 'Fehler-ID', 'zaehlung.markiert',
      'beleg_ohne_wortlaut', 'uebersprungen', 'registrierstelle', '100 MB', '300 MB', '(60)', 'cursor', 'abgeloest'], 'Vertrag')
    ok((await repoDatei(`${REPO}/tools/tests/mcp-vertrag.test.mjs`)).includes('werkzeuge.mjs'), 'Test des Vertrags fehlt')

    const readme = await repoDatei(`${REPO}/README.md`)
    const claude = readme.split('## Claude and your data\n')[1]?.split('\n## ')[0] ?? ''
    enthaelt(claude, ['100 seconds', 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS'], 'README, Claude')
    const betrieb = readme.split('## Installation\n')[1]?.split('\n## Make targets')[0] ?? ''
    enthaelt(betrieb, ['doi.org', 'api.datacite.org', 'TeX-Pakete', 'Fehler-ID', '/var/log/overleaf/web.log'], 'README, Betrieb')
    const bericht = readme.split('## The check report\n')[1]?.split('\n## ')[0] ?? ''
    enthaelt(bericht, ['Zitatmakros', 'Ausgeblendete Makros', 'DataCite', 'Registriert bei'], 'README, Prüfbericht')

    const adr = await repoDatei(`${REPO}/docs/adr/0006-doi-check-across-registration-agencies.md`)
    enthaelt(adr, ['doi.org', 'DataCite', '## Decision Outcome'], 'ADR 0006')
    const adr3 = await repoDatei(`${REPO}/docs/adr/0003-own-claude-integration.md`)
    ok(!adr3.includes('/spur:lauf') && adr3.includes('100 seconds'), 'ADR 0003 nennt /spur:lauf oder nicht den kurzen Poll')
    enthaelt(await repoDatei(`${REPO}/docs/adr/0001-module-in-web-service.md`), ['pdf-js-viewer.tsx'], 'ADR 0001 (Kern-Patches)')

    const skill = await repoDatei(`${REPO}/plugins/spur/skills/spur/SKILL.md`)
    enthaelt(skill, ['## Waiting for jobs', 'abgeloest', 'spiegel_nicht_erreichbar', 'paket_abgebrochen', 'dienst_nicht_erreichbar', 'pfad_ist_datei', 'Fehler-ID'], 'SKILL.md')
    const backlog = await repoDatei(`${REPO}/docs/backlog.md`)
    enthaelt(backlog, ['MCP tasks', 'error ID'], 'Backlog')
  }

  // P9: Konsolenfehler (console.error) zählen ab hier mit; die älteren Features prüfen nur Seitenfehler.
  const konsolenMeldungen = []
  page.on('console', m => m.type() === 'error' && konsolenMeldungen.push(m.text()))
  // `erwartet`: Meldungen, die ein Schritt absichtlich auslöst (Ladefehler über einen Dev-Schalter).
  function ohneKonsolenfehler(wo, erwartet = null) {
    const meldungen = konsolenMeldungen.splice(0).filter(m => !erwartet?.test(m))
    ok(meldungen.length === 0, `${wo}: Konsolenfehler ${meldungen.join(' | ').slice(0, 400)}`)
  }

  const PANELS = ['Quellen', 'Recherche', 'Prüfbericht', 'Vorschläge', 'Claude']

  // Panel öffnen und eine offene Quellen-Vorschau verlassen (ihr Titel ist der Name der Quelle).
  async function panelMitListe(panel) {
    const zurueck = page.locator('.spur-panel').getByRole('button', { name: 'Zurück', exact: true })
    if (panel === 'Quellen' && (await zurueck.isVisible())) await zurueck.click()
    await panelOeffnen(panel)
  }
  const modal = () => page.locator('.modal.show')

  // Seltene Aktionen des Quellen-Panels; gibt den Knopf zurück, der danach den Fokus bekommt.
  async function quellenAktion(name) {
    await quellenMenue(name)
    return page.locator('.spur-panel').getByRole('button', { name: 'Weitere Aktionen' })
  }

  const SPUR_DIALOGE = [
    ['Importieren', async () => { await panelOeffnen('Quellen'); return await quellenAktion('Importieren') }],
    ['Aus anderem Projekt holen', async () => { await panelOeffnen('Quellen'); return await quellenAktion('Aus anderem Projekt holen') }],
    ['Literaturmatrix', async () => { await panelOeffnen('Quellen'); return await quellenAktion('Literaturmatrix') }],
    ['KI-Offenlegung', async () => {
      await panelOeffnen('Claude')
      const knopf = page.getByRole('button', { name: 'KI-Offenlegung' })
      await knopf.click()
      return knopf
    }],
    ['Quelle löschen', async () => {
      await panelOeffnen('Quellen')
      if (!(await page.getByRole('button', { name: 'Quelle löschen' }).isVisible())) {
        await page.locator('.spur-panel').getByText('smith2024.pdf').first().click()
      }
      const knopf = page.getByRole('button', { name: 'Quelle löschen' })
      await knopf.click()
      return knopf
    }],
  ]

  async function dialogFarbe() {
    await modal().locator('.modal-content').waitFor()
    return await modal().locator('.modal-content').evaluate(el => {
      const s = getComputedStyle(el)
      return { hintergrund: s.backgroundColor, text: s.color }
    })
  }

  const hell = farbe => {
    const [r, g, b] = farbe.match(/[\d.]+/g).map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }

  async function dialogeImDesign(thema) {
    return await mitDesign(thema, async () => {
      await projektOeffnen('E2E Bericht')
      await page.getByRole('button', { name: /^(Teilen|Share)$/ }).first().click()
      const teilen = await dialogFarbe()
      await page.keyboard.press('Escape')
      await modal().waitFor({ state: 'detached' })
      ok(thema ? hell(teilen.hintergrund) > 0.8 : hell(teilen.hintergrund) < 0.2, `Projekt teilen im Design „${thema}“: ${teilen.hintergrund}`)
      for (const [name, oeffnen] of SPUR_DIALOGE) {
        const knopf = await oeffnen()
        const farbe = await dialogFarbe()
        ok(
          farbe.hintergrund === teilen.hintergrund && farbe.text === teilen.text,
          `${name} im Design „${thema || 'dunkel'}“: ${JSON.stringify(farbe)} statt ${JSON.stringify(teilen)}`
        )
        await page.keyboard.press('Escape')
        await modal().waitFor({ state: 'detached' })
        ok(await knopf.evaluate(el => el === document.activeElement), `${name}: Fokus nach Esc nicht am Auslöser`)
      }
    })
  }

  features.p9f1 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')
    await dialogeImDesign('')
    await dialogeImDesign('light-')

    await projektOeffnen('E2E Bericht')
    for (const [name, oeffnen] of SPUR_DIALOGE) {
      const knopf = await oeffnen()
      await modal().waitFor()
      const schliessen = modal().locator('.modal-footer').getByRole('button', { name: /^(Schließen|Abbrechen)$/ })
      ok((await schliessen.count()) === 1, `${name}: kein Knopf „Schließen“ oder „Abbrechen“`)
      await schliessen.click()
      await modal().waitFor({ state: 'detached' })
      ok(await knopf.evaluate(el => el === document.activeElement), `${name}: Fokus nach „Schließen“ nicht am Auslöser`)
    }

    for (const panel of PANELS) {
      await panelMitListe(panel)
      const inhalt = page.getByRole('tabpanel', { name: panel }).locator('.spur-panel').first()
      await inhalt.waitFor()
      const masse = await inhalt.evaluate(wurzel => {
        const titel = wurzel.querySelector('.rail-panel-title').getBoundingClientRect().left
        const links = [...wurzel.querySelectorAll('button, input, textarea, select, p, h5, h6, li, label, [role=tab], a, pre')]
          .map(el => el.getBoundingClientRect())
          .filter(r => r.width > 0 && r.height > 0)
          .map(r => r.left)
        const ebenen = [...wurzel.querySelectorAll('h1, h2, h3, h4, h5, h6')]
          .filter(h => !h.classList.contains('rail-panel-title'))
          .map(h => Number(h.tagName[1]))
        return { titel, links: Math.min(...links), ebenen }
      })
      ok(Math.abs(masse.links - masse.titel) <= 1, `${panel}: Inhalt beginnt bei ${masse.links}, Titel bei ${masse.titel}`)
      let vorige = 4
      for (const ebene of masse.ebenen) {
        ok(ebene > 4 && ebene <= vorige + 1, `${panel}: Überschriften springen (${masse.ebenen})`)
        vorige = ebene
      }
    }

    // Wie auf dem Handy: bei 360 px laden; ein offenes Panel aus 1280 px klappt beim Verkleinern ein.
    await breite(360)
    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    for (const panel of PANELS) {
      await panelMitListe(panel)
      await ohneSeitlichesRollen(`Panel ${panel} bei 360 px`)
    }
    for (const [name, oeffnen] of SPUR_DIALOGE) {
      await oeffnen()
      await modal().waitFor()
      await ohneSeitlichesRollen(`${name} bei 360 px`)
      await page.keyboard.press('Escape')
      await modal().waitFor({ state: 'detached' })
    }
    await breite(1280)
    ohneKonsolenfehler('p9f1')
  }


  // Gibt dem offenen Seitenpanel eine feste Breite (wie nach dem Ziehen am Rand).
  async function panelBreite(px) {
    await page.locator('[id^="ide-redesign-sidebar-panel-"]').first().evaluate((el, breite) => {
      el.style.flex = `0 0 ${breite}px`
    }, px)
    await page.waitForTimeout(100)
  }

  // Ganz sichtbar heißt: innerhalb des Panels und nicht in sich abgeschnitten.
  async function imPanelGanz(locator, wo) {
    const masse = await locator.evaluate(el => {
      const panel = el.closest('[id^="ide-redesign-sidebar-panel-"]').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { links: r.left - panel.left, rechts: panel.right - r.right, abgeschnitten: el.scrollWidth > el.clientWidth + 1 }
    })
    ok(masse.links >= 0 && masse.rechts >= 0 && !masse.abgeschnitten, `${wo}: nicht ganz sichtbar ${JSON.stringify(masse)}`)
  }

  features.p9f2 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')
    await panelOeffnen('Quellen')
    const panel = page.locator('.spur-panel')
    await panel.getByRole('button', { name: 'Quelle hinzufügen' }).waitFor()
    await panel.getByRole('button', { name: 'Weitere Aktionen' }).click()
    const eintraege = await page.getByRole('menuitem').allInnerTexts()
    ok(
      JSON.stringify(eintraege.map(e => e.trim())) ===
        JSON.stringify(['Webseite aufnehmen', 'Aus anderem Projekt holen', 'Importieren', 'Quellen exportieren', 'Literaturmatrix']),
      `Menü: ${eintraege}`
    )
    await page.keyboard.press('Escape')

    const smith = panel.locator('.spur-liste li', { hasText: 'Sleep and Memory' })
    await smith.getByRole('button', { name: /^Sleep and Memory/ }).waitFor()
    await smith.getByText('A. Smith · 2024', { exact: true }).waitFor()
    await smith.getByText('8 Seiten · Text erkannt', { exact: true }).waitFor()

    await quellenMenue('Webseite aufnehmen')
    const adresse = modal().getByLabel('Adresse der Webseite')
    await adresse.fill('kein link')
    await modal().getByRole('button', { name: 'Aufnehmen', exact: true }).click()
    await modal().getByText('Bitte eine vollständige Adresse mit http:// oder https:// eingeben.').waitFor()
    ok((await adresse.inputValue()) === 'kein link', 'Ungültige Adresse verloren')
    ok((await adresse.getAttribute('aria-invalid')) === 'true', 'Feld nicht als ungültig markiert')
    await page.keyboard.press('Escape')
    await modal().waitFor({ state: 'detached' })

    await panelBreite(240)
    for (const [element, wo] of [
      [panel.getByRole('button', { name: 'Quelle hinzufügen' }), 'Quelle hinzufügen'],
      [panel.getByRole('button', { name: 'Weitere Aktionen' }), 'Weitere Aktionen'],
      [panel.getByRole('searchbox', { name: 'Quellen durchsuchen' }), 'Suchfeld'],
    ]) {
      await imPanelGanz(element, `${wo} bei 240 px`)
    }

    // Leeres Projekt: Platzhalter beim Laden, Erklärung, Upload über die Hauptaktion.
    let freigeben
    const gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/spur\/project\/[0-9a-f]+\/quellen$/, async route => {
      await gehalten
      // Ein zweiter Abruf derselben Adresse kann schon beantwortet sein.
      await route.continue().catch(() => {})
    })
    await projektOeffnen('E2E Leer')
    await panelOeffnen('Quellen')
    await panel.locator('.spur-platzhalter-zeile').first().waitFor()
    freigeben()
    await page.unroute(/\/spur\/project\/[0-9a-f]+\/quellen$/)
    await panel.getByText('Noch keine Quellen. Lade ein PDF hoch oder nimm eine Webseite auf.', { exact: true }).waitFor()
    ok((await panel.locator('.spur-platzhalter-zeile').count()) === 0, 'Platzhalter nach dem Laden')
    ok((await panel.getByRole('button', { name: 'Quelle hinzufügen' }).count()) === 2, 'Leerer Zustand ohne „Quelle hinzufügen“')
    // Der echte Dateidialog bliebe im Playwright-Server hängen: den Klick auf das Dateifeld abfangen.
    const dateiFeld = panel.locator('input[type=file]')
    ok((await dateiFeld.getAttribute('accept')).includes('.pdf'), 'Dateiauswahl nimmt keine PDFs')
    await dateiFeld.evaluate(el => el.addEventListener('click', e => {
      e.preventDefault()
      el.dataset.geoeffnet = 'ja'
    }, { once: true }))
    await panel.getByRole('button', { name: 'Quelle hinzufügen' }).first().click()
    ok((await dateiFeld.getAttribute('data-geoeffnet')) === 'ja', '„Quelle hinzufügen“ öffnet keine Dateiauswahl')
    await dateiFeld.setInputFiles(`${FIXTURES}/smith2024.pdf`)
    const neu = panel.locator('.spur-liste li').first().getByRole('button', { name: /^Sleep and Memory/ })
    await neu.waitFor({ timeout: 30000 })
    await page.waitForFunction(() => document.activeElement?.textContent?.startsWith('Sleep and Memory'), null, { timeout: 5000 })

    // Ladefehler mit „Erneut versuchen“.
    await fakeSteuern({ schalter: { SPUR_PROXY_API: '403' } })
    try {
      await page.reload()
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Quellen')
      await panel.getByRole('button', { name: 'Erneut versuchen' }).waitFor({ timeout: 20000 })
    } finally {
      await fakeSteuern({ schalter: {} })
    }
    await panel.getByRole('button', { name: 'Erneut versuchen' }).click()
    await neu.waitFor()

    // Mehr als 100 Quellen: nachladen, ohne Metadaten der Dateiname als Titel, Suchtreffer jenseits der ersten 100.
    await projektOeffnen('E2E Viele')
    await panelOeffnen('Quellen')
    const zeilen = panel.locator('.spur-liste li')
    await panel.getByText('100 von 300', { exact: true }).waitFor()
    ok((await zeilen.count()) === 100, `Liste zeigt ${await zeilen.count()} Einträge`)
    await panel.getByRole('button', { name: 'quelle-000.pdf', exact: true }).waitFor()
    await suchen('seltene Wortfolge')
    await panel.locator('.spur-zeile', { hasText: 'quelle-150.pdf' }).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Groß öffnen' }).waitFor()
    await sichtbar('quelle-150.pdf')
    await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
    await suchen('')
    await panel.getByRole('button', { name: 'Weitere Quellen laden' }).click()
    await panel.getByText('200 von 300', { exact: true }).waitFor()
    ok((await zeilen.count()) === 200, `Nach dem Nachladen ${await zeilen.count()} Einträge`)
    // Ladefehler mit Absicht (Dev-Schalter); die Quellen von „E2E Viele“ sind Einträge ohne PDF-Datei.
    ohneKonsolenfehler('p9f2', /Failed to load resource: the server responded with a status of (403|500)/)
  }


  features.p9f3 = async () => {
    const SATZ = 'Participants completed the task over two consecutive nights.'
    const SEITE_346 = 'Seite 346 (PDF-Seite 2 von 8)'
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')
    await mitDesign('', async () => {
      await projektOeffnen('E2E Bericht')
      await panelOeffnen('Quellen')
      await page.locator('.spur-panel').getByRole('button', { name: /^Sleep and Memory/ }).click()
      await page.locator('.spur-panel').getByRole('link', { name: 'Original herunterladen' }).waitFor()
      const { knopf, dialog } = await grossOeffnen()
      const bild = dialog.locator('img.spur-seitenbild')
      await bild.waitFor()
      const rahmen = await dialog.locator('.modal-content').evaluate(el => getComputedStyle(el).backgroundColor)
      ok(hell(rahmen) < 0.2, `Großansicht im dunklen Design hell: ${rahmen}`)
      const leiste = dialog.locator('.spur-gross-leiste')
      await leiste.getByRole('heading', { name: 'Angaben zur Quelle' }).waitFor()
      await leiste.getByRole('heading', { name: 'Gespeicherte Zitate' }).waitFor()
      await leiste.getByLabel('Notiz zur Quelle').waitFor()
      ok((await dialog.locator('pre.spur-seitentext').count()) === 0, 'Seitentext steht als zweite Kopie da')

      // Zoom: scharf, rollbar, nichts unter der Seitenleiste.
      const flaeche = dialog.locator('.spur-gross-bild')
      const groesser = dialog.getByRole('button', { name: 'Vergrößern' })
      for (const stufe of ['125 %', '150 %', '200 %']) {
        await groesser.click()
        await dialog.getByText(stufe, { exact: true }).waitFor()
      }
      await page.waitForFunction(() => {
        const el = document.querySelector('.spur-gross-bild')
        const img = el.querySelector('img')
        return el.scrollWidth > el.clientWidth && el.scrollHeight > el.clientHeight && img.complete &&
          img.naturalWidth >= img.getBoundingClientRect().width * devicePixelRatio
      }, null, { timeout: 20000 })
      const [bereichBox, leisteBox] = await Promise.all([flaeche.boundingBox(), leiste.boundingBox()])
      ok(bereichBox.x + bereichBox.width <= leisteBox.x + 1, `Seite unter der Seitenleiste: ${JSON.stringify([bereichBox, leisteBox])}`)
      await dialog.getByRole('button', { name: 'An Breite anpassen' }).click()
      await dialog.getByText('100 %', { exact: true }).waitFor()
      await page.waitForFunction(() => {
        const el = document.querySelector('.spur-gross-bild')
        return el.scrollWidth <= el.clientWidth
      })

      // Tasten, feste Werkzeugleiste, alte Seite bis die neue da ist, neue Seite oben.
      const knoepfe = ['Vorherige Seite', 'Nächste Seite', 'Verkleinern', 'Vergrößern'].map(name => dialog.getByRole('button', { name }))
      const lage = async () => Promise.all(knoepfe.map(async k => JSON.stringify(await k.boundingBox())))
      const vorher = await lage()
      const mitten = vorher.map(b => JSON.parse(b)).map(b => Math.round(b.y + b.height / 2))
      ok(Math.max(...mitten) - Math.min(...mitten) <= 2, `Blättern und Zoom nicht auf einer Linie: ${mitten}`)
      await flaeche.evaluate(el => el.scrollTo(0, 300))
      let freigeben
      const gehalten = new Promise(resolve => (freigeben = resolve))
      await page.route(/\/seiten\/2\/bild/, async route => {
        await gehalten
        await route.continue().catch(() => {})
      })
      await page.keyboard.press('ArrowRight')
      await dialog.getByText(SEITE_346, { exact: true }).waitFor()
      ok(await bild.isVisible(), 'Alte Seite verschwindet beim Blättern')
      ok((await bild.getAttribute('src')).includes('/seiten/1/'), 'Neue Seite vor dem Laden gezeigt')
      freigeben()
      await page.waitForFunction(() => document.querySelector('.spur-gross-bild img')?.getAttribute('src').includes('/seiten/2/'))
      await page.unroute(/\/seiten\/2\/bild/)
      ok((await flaeche.evaluate(el => el.scrollTop)) === 0, 'Neue Seite beginnt nicht oben')
      ok(JSON.stringify(await lage()) === JSON.stringify(vorher), 'Werkzeugleiste springt beim Blättern')
      await page.keyboard.press('ArrowLeft')
      await dialog.getByText(/^Seite 345 \(PDF-Seite 1 von 8\)$/).waitFor()
      await page.keyboard.press('+')
      await dialog.getByText('125 %', { exact: true }).waitFor()
      await page.keyboard.press('-')
      await dialog.getByText('100 %', { exact: true }).waitFor()

      // Markieren auf der Seite, als Zitat speichern, einfügen.
      await dialog.locator('.spur-textebene', { hasText: 'Participants' }).waitFor()
      await textMarkieren(SATZ, dialog)
      await leiste.getByRole('button', { name: 'Zitat speichern' }).click()
      const zitat = leiste.locator('.spur-zitate li', { hasText: SATZ })
      await zitat.getByText(/^S\. 345 · /).waitFor()
      ok((await dialog.getByText('Keine Schreibrechte').count()) === 0, '„Keine Schreibrechte“ für Schreibende')
      const einfuegen = zitat.getByRole('button', { name: 'Einfügen' })
      ok(await einfuegen.isEnabled(), '„Einfügen“ für Schreibende gesperrt')
      await einfuegen.click()
      await page.waitForFunction(
        satz => document.querySelector('.cm-content').innerText.includes(`\\enquote{${satz}} \\autocite[345]{smith2024}`),
        SATZ,
        { timeout: 10000 }
      )

      // Seitenleiste einklappen, bleibt eingeklappt.
      await dialog.getByRole('button', { name: 'Seitenleiste ausblenden' }).click()
      await leiste.waitFor({ state: 'hidden' })
      const ohneLeiste = await flaeche.boundingBox()
      const dialogBox = await dialog.locator('.modal-content').boundingBox()
      ok(ohneLeiste.width >= dialogBox.width - 2, `Seite nutzt ohne Seitenleiste nicht die ganze Breite: ${ohneLeiste.width} von ${dialogBox.width}`)

      // Original herunterladen.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('link', { name: 'Original herunterladen' }).click(),
      ])
      ok(download.suggestedFilename() === 'smith2024.pdf', `Download heißt ${download.suggestedFilename()}`)

      // Auf Seite 346 schließen: Vorschau folgt, Fokus auf „Groß öffnen“.
      await page.keyboard.press('ArrowRight')
      await dialog.getByText(SEITE_346, { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await page.locator('.spur-panel').getByText(SEITE_346, { exact: true }).waitFor()
      ok(await knopf.evaluate(el => el === document.activeElement), 'Fokus nach dem Schließen nicht auf „Groß öffnen“')
      const wieder = await grossOeffnen()
      await wieder.dialog.getByRole('button', { name: 'Seitenleiste einblenden' }).click()
      await wieder.dialog.locator('.spur-gross-leiste').waitFor()

      // Seitenbild scheitert: Meldung, Text bleibt lesbar; beim Laden ein Platzhalter.
      await fakeSteuern({ schalter: { SPUR_SEITENBILD_FEHLER: '403' } })
      try {
        await page.keyboard.press('ArrowRight')
        await wieder.dialog.getByText('Die Seite ließ sich nicht laden.').waitFor({ timeout: 20000 })
        await wieder.dialog.locator('.spur-seitentext-ersatz').waitFor()
      } finally {
        await fakeSteuern({ schalter: {} })
      }
      let weiter
      const halten = new Promise(resolve => (weiter = resolve))
      await page.route(/\/bild\?/, async route => {
        await halten
        await route.continue().catch(() => {})
      })
      await wieder.dialog.getByRole('button', { name: 'Erneut versuchen' }).click()
      await wieder.dialog.locator('.spur-seite-platzhalter').waitFor()
      weiter()
      await wieder.dialog.locator('img.spur-seitenbild').waitFor()
      await page.unroute(/\/bild\?/)

      // Schmal: einspaltig, Seitenleiste unter der Seite, kein Rollen der ganzen Ansicht.
      for (const px of [768, 360]) {
        await breite(px)
        await page.waitForTimeout(300)
        const [seite, unten, inhalt] = await Promise.all([
          wieder.dialog.locator('.spur-gross-bild').boundingBox(),
          wieder.dialog.locator('.spur-gross-leiste').boundingBox(),
          wieder.dialog.locator('.modal-content').boundingBox(),
        ])
        ok(unten.y >= seite.y + seite.height - 1, `${px} px: Seitenleiste nicht unter der Seite`)
        ok(inhalt.height <= (await page.evaluate(() => window.innerHeight)) + 1, `${px} px: höher als das Fenster`)
        await ohneSeitlichesRollen(`Großansicht bei ${px} px`)
      }
      await breite(1280)
      await page.keyboard.press('Escape')
      await wieder.dialog.waitFor({ state: 'detached' })
    })

    // Scan: Hinweis auf unsicheren Text und Seitenzahl bestätigen; Webseite einspaltig ohne Werkzeugleiste.
    await projektOeffnen('E2E Scan')
    await panelOeffnen('Quellen')
    await page.locator('.spur-panel').getByRole('button', { name: /scan\.pdf/ }).click()
    await page.locator('.spur-panel img.spur-seitenbild').waitFor()
    // Wie die Vorschau: Hinweis und „Seitenzahl bestätigen“ nur bei erkanntem Text.
    const vorschauHinweis = await page.locator('.spur-panel .spur-ocr-hinweis').count()
    const vorschauBestaetigen = await page.locator('.spur-panel').getByRole('button', { name: 'Seitenzahl bestätigen' }).count()
    const scan = await grossOeffnen()
    await scan.dialog.locator('img.spur-seitenbild').waitFor()
    ok((await scan.dialog.locator('.spur-ocr-hinweis').count()) === vorschauHinweis, 'OCR-Hinweis anders als in der Vorschau')
    ok((await scan.dialog.getByRole('button', { name: 'Seitenzahl bestätigen' }).count()) === vorschauBestaetigen, '„Seitenzahl bestätigen“ anders als in der Vorschau')
    await page.keyboard.press('Escape')
    await scan.dialog.waitFor({ state: 'detached' })
    await projektOeffnen('E2E Web')
    await panelOeffnen('Quellen')
    const webQuelle = page.locator('.spur-panel').getByRole('button', { name: /^Schlafhygiene im Schichtdienst/ })
    if (!(await webQuelle.isVisible())) {
      await quellenMenue('Webseite aufnehmen')
      await page.getByLabel('Adresse der Webseite').fill('http://127.0.0.1/spur/dev/web/testseite')
      await page.getByRole('button', { name: 'Aufnehmen', exact: true }).click()
    }
    await webQuelle.click()
    const web = await grossOeffnen()
    await web.dialog.getByText(/^Schnappschuss von http/).waitFor()
    ok((await web.dialog.locator('.spur-gross-werkzeuge').count()) === 0, 'Webseite mit Werkzeugleiste')
    const [text, koerper] = await Promise.all([
      web.dialog.locator('pre.spur-seitentext').boundingBox(),
      web.dialog.locator('.modal-body').boundingBox(),
    ])
    ok(text.width >= koerper.width * 0.9, `Webseite nicht in voller Breite: ${text.width} von ${koerper.width}`)
    await page.keyboard.press('Escape')

    // Ohne Schreibrecht: „Keine Schreibrechte“ und „Einfügen“ gesperrt.
    await anmelden('e2e-leser@example.org')
    await projektOeffnen('E2E Bericht')
    await panelOeffnen('Quellen')
    await page.locator('.spur-panel').getByRole('button', { name: /^Sleep and Memory/ }).click()
    const lesen = await grossOeffnen()
    const fremd = lesen.dialog.locator('.spur-zitate li', { hasText: SATZ })
    await fremd.waitFor()
    await lesen.dialog.getByText('Keine Schreibrechte').waitFor()
    ok(await fremd.getByRole('button', { name: 'Einfügen' }).isDisabled(), '„Einfügen“ ohne Schreibrecht aktiv')
    await page.keyboard.press('Escape')
    // Der 403 des Seitenbilds ist gewollt (Testschalter).
    ohneKonsolenfehler('p9f3', /Failed to load resource: the server responded with a status of 403/)
  }


  features.p9f4 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')
    await panelOeffnen('Prüfbericht')
    const bericht = page.getByRole('tabpanel', { name: 'Prüfbericht' })
    const gruppe = datei => bericht.getByRole('button', { name: new RegExp(`^${datei.replace('.', '\\.')}\\s*\\d+ Stellen?, \\d+ markiert$`) })
    await gruppe('main.tex').waitFor({ timeout: 30000 })
    await gruppe('kapitel.tex').waitFor()
    const kapitelZeile = bericht.locator('.spur-zeile', { hasText: 'kapitel.tex:' })
    await kapitelZeile.first().waitFor()
    await gruppe('kapitel.tex').click()
    ok((await gruppe('kapitel.tex').getAttribute('aria-expanded')) === 'false', 'Gruppe lässt sich nicht einklappen')
    ok((await kapitelZeile.count()) === 0, 'Eingeklappte Gruppe zeigt Stellen')
    await gruppe('kapitel.tex').click()
    await kapitelZeile.first().waitFor()

    // Filter mit Zahlen; „Markiert“ zeigt nur Stellen mit Problem; ein leerer Filter erklärt sich.
    const zahlen = {}
    for (const name of ['Alle', 'Markiert', 'Ohne Quelle', 'Nicht prüfbar']) {
      const label = bericht.locator('.spur-filter label', { hasText: new RegExp(`^${name}\\s+\\d+$`) })
      zahlen[name] = Number((await label.innerText()).match(/\d+$/)[0])
    }
    ok(zahlen.Alle === (await bericht.locator('.spur-zeile').count()), `„Alle“ zählt ${zahlen.Alle}`)
    await berichtFilter('Markiert')
    ok((await bericht.locator('.spur-zeile').count()) === zahlen.Markiert, `„Markiert“ zeigt ${await bericht.locator('.spur-zeile').count()} statt ${zahlen.Markiert}`)
    const ohneProblem = await bericht.locator('.spur-zeile').evaluateAll(zeilen =>
      zeilen.filter(z => !z.querySelector('.badge.bg-danger, .badge[class*="bg-warning"]')).length
    )
    ok(ohneProblem === 0, `„Markiert“ zeigt ${ohneProblem} Stellen ohne Problem`)
    await berichtFilter('Alle')

    // Erneut prüfen: alter Bericht bleibt, „Prüfung läuft …“, danach der Zeitpunkt.
    let freigeben
    const gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/pruefbericht$/, async route => {
      await gehalten
      await route.continue().catch(() => {})
    })
    await bericht.getByRole('button', { name: 'Erneut prüfen' }).click()
    await bericht.getByText('Prüfung läuft …', { exact: true }).waitFor()
    ok((await bericht.locator('.spur-zeile').count()) === zahlen.Alle, 'Alter Bericht verschwindet während der Prüfung')
    freigeben()
    await bericht.getByText('Prüfung läuft …', { exact: true }).waitFor({ state: 'detached' })
    await page.unroute(/\/pruefbericht$/)
    const uhr = await page.evaluate(() => new Date().toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit' }))
    const zeitpunkt = await bericht.getByText(/^Zuletzt geprüft: heute, \d{2}:\d{2}$/).innerText()
    ok(zeitpunkt.endsWith(uhr) || Math.abs(Number(zeitpunkt.slice(-2)) - Number(uhr.slice(-2))) <= 1, `${zeitpunkt} statt ${uhr}`)

    // Abzeichen nebeneinander, nicht breiter als ihr Text, lesbar in beiden Designs.
    const abzeichen = await bericht.locator('.spur-badges').evaluateAll(gruppen => gruppen.map(g => {
      const b = [...g.querySelectorAll('.badge')].map(x => {
        const r = x.getBoundingClientRect()
        const inhalt = x.querySelector('.badge-content') ?? x
        const text = document.createRange()
        text.selectNodeContents(inhalt)
        return { top: Math.round(r.top), breite: r.width, text: text.getBoundingClientRect().width }
      })
      return b
    }))
    const zuBreit = abzeichen.flat().filter(b => b.breite > b.text + 24)
    ok(zuBreit.length === 0, `Abzeichen breiter als ihr Text: ${JSON.stringify(zuBreit)}`)
    ok(abzeichen.some(g => g.length > 1 && g[0].top === g[1].top), 'Keine zwei Abzeichen nebeneinander')
    for (const thema of ['', 'light-']) {
      await mitDesign(thema, async () => {
        await page.reload()
        await page.locator('.cm-content').first().waitFor()
        await panelOeffnen('Prüfbericht')
        await bericht.locator('.spur-badges .badge').first().waitFor({ timeout: 30000 })
        const schlecht = await unlesbar(bericht.locator('.spur-liste').first())
        ok(schlecht.length === 0, `Abzeichen im Design „${thema || 'dunkel'}“: ${schlecht}`)
      })
    }
    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Prüfbericht')

    // Tooltip an der roten Markierung: Maus und Tastatur.
    const marke = page.locator('.cm-content .spur-marke-rot', { hasText: 'Sleep strongly supports' })
    await marke.waitFor({ timeout: 30000 })
    // Beim Überfahren legt CodeMirror den Tooltip in eine Hülle, am Cursor trägt die Hülle selbst die Klasse.
    const tooltip = page.locator('.cm-tooltip.spur-befund-tooltip, .cm-tooltip .spur-befund-tooltip')
    // Cursor weg von der Markierung, sonst zeigt schon der Tooltip am Cursor den Befund.
    await page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^1$/ }).click()
    await page.keyboard.press('Home')
    // Die Markierung kann umbrechen: über die erste Zeile fahren, nicht über die Mitte des ganzen Kastens.
    const box = await marke.evaluate(el => {
      const r = el.getClientRects()[0]
      return { x: r.left, y: r.top, height: r.height }
    })
    for (let i = 0; i < 10 && !(await tooltip.filter({ hasText: 'Wortlaut: abweichend' }).isVisible()); i++) {
      await page.mouse.move(box.x + 10 + i * 5, box.y + box.height / 2)
      await page.waitForTimeout(700)
    }
    await tooltip.filter({ hasText: 'Wortlaut: abweichend' }).waitFor({ timeout: 5000 })
    await page.mouse.move(5, 5)
    await page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^8$/ }).click()
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
    await tooltip.filter({ hasText: 'Wortlaut: abweichend' }).waitFor()
    await page.keyboard.press('Home')

    // Sprung aus dem Bericht.
    await page.locator('.cm-content').evaluate(el => el.blur())
    await bericht.getByRole('button', { name: 'main.tex:8', exact: true }).click()
    await page.locator('.cm-activeLineGutter', { hasText: /^8$/ }).waitFor()

    await bericht.getByRole('button', { name: 'Einstellungen der Prüfung' }).waitFor()
    await bericht.getByText(/, (\d+ markiert|keine markiert)/).first().waitFor()

    // Ein Filter ohne Treffer erklärt sich (im Projekt mit nur grünen Stellen).
    await projektOeffnen('E2E Bericht Grün')
    await panelOeffnen('Prüfbericht')
    await bericht.locator('.spur-filter label', { hasText: /^Markiert\s+0$/ }).waitFor({ timeout: 30000 })
    await berichtFilter('Markiert')
    await bericht.getByText('Keine Stellen mit diesem Befund.', { exact: true }).waitFor()
    ohneKonsolenfehler('p9f4')
  }


  features.p9f5 = async () => {
    const SATZ = 'Von 240 Befragten antworteten 90.'
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Automatik')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    const panel = claudePanel()
    const schalter = panel.getByRole('switch', AUTOMATIK)
    await schalter.waitFor()
    await panel.getByText('Rote Zitate bleiben offen.', { exact: true }).waitFor()
    ok((await panel.locator('.spur-lauf-karte').count()) === 0, 'Lauf-Karte vor dem ersten Lauf')
    ok(await schalter.isChecked(), 'Altes Häkchen nicht als Schalter übernommen')
    ok((await page.getByText('Automatisch annehmen, wenn ein Lauf ohne Probleme endet').count()) === 0, 'Altes Häkchen noch da')

    const token = await neuesToken()
    let nr = 0
    const schreiben = async (alt, neu, pfad = 'main.tex', mitToken = token) => {
      const r = await werkzeug(mitToken, 'doc_edit', { project_id: pid, pfad, alt, neu, idempotenz_schluessel: `p9f5-${Date.now()}-${nr++}` })
      ok(!r.fehler, `doc_edit ${neu}: ${JSON.stringify(r.inhalt)}`)
      return r.inhalt
    }

    // Schalter an: sofort angenommen, ohne run_finish; Hinweis auf Zahlen ohne Beleg.
    await schreiben('Alpha Satz.', `Alpha Satz. ${SATZ}`)
    await page.waitForFunction(
      satz => {
        const inhalt = document.querySelector('.cm-content')
        return inhalt.innerText.includes(satz) && ![...inhalt.querySelectorAll('[class*="ol-cm-change"]')].some(e => e.textContent.includes('Befragten'))
      },
      SATZ,
      { timeout: 5000 }
    )
    const karte = panel.locator('.spur-lauf-karte').first()
    await karte.locator('.spur-lauf-automatisch', { hasText: SATZ }).getByText('Automatisch angenommen').waitFor({ timeout: 10000 })
    await karte.getByText('Zahl ohne Beleg: 240, 90', { exact: true }).waitFor()

    // Rotes Zitat bleibt offen und steht oben unter „Bitte prüfen“; der Rest desselben Laufs ist angenommen.
    const rot = await schreiben('Gamma Satz.', 'Gamma Satz. \\footfullcite{smith2024}')
    ok(rot.rot.length === 1, `Zitat nicht rot: ${JSON.stringify(rot)}`)
    await schreiben('Delta Satz.', 'Delta Satz ergänzt.')
    const zuPruefen = karte.locator('.spur-lauf-rot', { hasText: 'Bitte prüfen' })
    await zuPruefen.locator('.spur-lauf-aenderung', { hasText: 'footfullcite' }).waitFor({ timeout: 10000 })
    const reihenfolge = await karte.locator('.spur-lauf-aenderung .spur-nachricht-text').allInnerTexts()
    ok(reihenfolge[0].includes('footfullcite'), `Rotes Zitat nicht oben: ${reihenfolge}`)
    await karte.locator('.spur-lauf-automatisch', { hasText: 'ergänzt' }).waitFor()

    // Schalter aus: Neue Änderungen bleiben offen. Per Tastatur, ohne Sprung, mit Zustand.
    const vorher = JSON.stringify(await panel.locator('.spur-automatik').boundingBox())
    await schalter.focus()
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/claude/automatik')), page.keyboard.press('Space')])
    ok(!(await schalter.isChecked()) && (await schalter.getAttribute('role')) === 'switch', 'Schalter nicht per Tastatur aus')
    ok(JSON.stringify(await panel.locator('.spur-automatik').boundingBox()) === vorher, 'Schalter springt beim Speichern')
    // Während und nach dem Speichern bleibt der Fokus auf dem Schalter, nicht auf der Seite.
    await page.waitForFunction(() => !document.querySelector('#spur-automatik[aria-busy]'))
    await fokusAuf(schalter, 'nach dem Speichern')
    const zwoelf = [['Beta Satz.', 'Beta Satz. Nachtrag']]
    for (const wort of ['Eins.', 'Zwei.', 'Drei.', 'Vier.', 'Fünf.']) zwoelf.push([wort, `${wort} neu`])
    for (const [alt, neu] of zwoelf) await schreiben(alt, neu)
    for (const wort of ['Sechs.', 'Sieben.', 'Acht.', 'Neun.', 'Zehn.', 'Elf.']) await schreiben(wort, `${wort} neu`, 'extra.tex')
    await karte.locator('.spur-lauf-aenderung', { hasText: 'Nachtrag' }).getByRole('button', { name: 'Annehmen' }).waitFor({ timeout: 10000 })

    // Alles Offene jetzt annehmen: Rückfrage, Abbrechen ändert nichts, Annehmen lässt nur Rotes offen.
    const sammel = panel.getByRole('button', { name: 'Alles Offene jetzt annehmen' })
    await sammel.click()
    await modal().getByText('12 Änderungen in 2 Dateien annehmen? Rote Zitate bleiben offen.', { exact: true }).waitFor()
    await modal().getByRole('button', { name: 'Abbrechen' }).click()
    await modal().waitFor({ state: 'detached' })
    ok((await karte.locator('.spur-lauf-aenderung', { hasText: 'Nachtrag' }).count()) === 1, 'Abbrechen hat angenommen')
    await fokusAuf(sammel, 'nach „Abbrechen“')
    // Per Tastatur: Enter öffnet, Enter auf „Annehmen“ nimmt an; danach liegt der Fokus auf „Nur rote Zitate offen (1)“.
    await sammel.focus()
    await page.keyboard.press('Enter')
    await modal().getByRole('button', { name: 'Annehmen', exact: true }).focus()
    await page.keyboard.press('Enter')
    await modal().waitFor({ state: 'detached', timeout: 20000 })
    const nichts = panel.getByRole('button', { name: 'Nur rote Zitate offen (1)' })
    await nichts.waitFor({ timeout: 10000 })
    ok(await nichts.isDisabled(), '„Nur rote Zitate offen“ nicht gesperrt')
    await fokusAuf(nichts, 'nach dem Annehmen')
    await page.keyboard.press('Enter')
    ok((await modal().count()) === 0, '„Nur rote Zitate offen“ öffnet den Dialog')
    await zuPruefen.locator('.spur-lauf-aenderung', { hasText: 'footfullcite' }).waitFor()
    ok((await karte.locator('.spur-lauf-aenderung', { hasText: 'Nachtrag' }).count()) === 0, 'Offenes nicht angenommen')

    // Lauf rückgängig nimmt auch automatisch Angenommenes zurück.
    await karte.getByRole('button', { name: 'Lauf rückgängig' }).click()
    await karte.getByText('Zurückgenommen', { exact: true }).waitFor({ timeout: 20000 })
    const zurueck = await page.evaluate(async p => (await (await fetch(`/spur/project/${p}/claude`)).json()).laeufe[0], pid)
    ok(zurueck.lauf.status === 'zurueckgenommen', `Status ${zurueck.lauf.status}`)
    await page.waitForFunction(
      () => [...document.querySelectorAll('.cm-content [class*="ol-cm-change-d"], .cm-content .ol-cm-change')].length > 0 ||
        !document.querySelector('.cm-content').innerText.includes('Befragten'),
      null,
      { timeout: 10000 }
    )

    // Fehler beim Speichern: Schalter springt zurück, die Meldung nennt den Grund.
    await fakeSteuern({ schalter: { SPUR_AUTOMATIK_FEHLER: '1' } })
    try {
      await schalter.check({ force: true }).catch(() => {})
      await panel.getByText('Speichern ist gerade nicht möglich. Bitte versuch es gleich noch einmal.').waitFor({ timeout: 10000 })
      await page.waitForFunction(() => !document.querySelector('#spur-automatik').checked)
    } finally {
      await fakeSteuern({ schalter: {} })
    }

    // Gilt nur in diesem Projekt.
    await projektOeffnen('E2E Schreiben')
    await panelOeffnen('Claude')
    await claudePanel().getByRole('switch', AUTOMATIK).waitFor()
    ok(!(await claudePanel().getByRole('switch', AUTOMATIK).isChecked()), 'Schalter in „E2E Schreiben“ an')

    // Reviewer und Lesende: weder Schalter noch Knopf, die Routen antworten 403.
    for (const email of ['e2e-review@example.org', 'e2e-leser@example.org']) {
      await anmelden(email)
      await page.goto(`${BASE}/project/${pid}`)
      await page.locator('.cm-content').first().waitFor()
      await panelOeffnen('Claude')
      await claudePanel().getByText(/^Claude (nicht )?verbunden$/).first().waitFor()
      ok((await claudePanel().getByRole('switch').count()) === 0, `${email} sieht den Schalter`)
      ok((await claudePanel().getByRole('button', { name: /Alles Offene|Nichts offen|Nur rote Zitate offen/ }).count()) === 0, `${email} sieht die Sammelannahme`)
      for (const [methode, pfad, body] of [['PUT', `/spur/project/${pid}/claude/automatik`, { an: true }], ['POST', `/spur/project/${pid}/claude/alles-annehmen`, {}]]) {
        const antwort = await seitenAnfrage(methode, pfad, body)
        ok(antwort.status === 403, `${email} ${methode} ${pfad}: ${antwort.status}`)
      }
    }

    // Ohne Schreibrecht bleibt die nächste Änderung des eigenen Claude offen, auch mit eingeschaltetem Schalter.
    await anmelden('e2e-schreib@example.org')
    const schreibId = await page.evaluate(() => document.querySelector('meta[name="ol-user_id"]').content)
    const schreibToken = await neuesToken()
    await anmelden('e2e-a@example.org')
    await page.goto(`${BASE}/project/${pid}`)
    await page.locator('.cm-content').first().waitFor()
    const herab = await seitenAnfrage('PUT', `/project/${pid}/users/${schreibId}`, { privilegeLevel: 'review' })
    ok(herab.status === 204, `Herabstufen: ${herab.status}`)
    await schreiben('Neun.', 'Neun. als Reviewer', 'extra.tex', schreibToken)
    await anmelden('e2e-schreib@example.org')
    await page.goto(`${BASE}/project/${pid}`)
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Claude')
    await claudePanel().locator('.spur-lauf-aenderung', { hasText: 'als Reviewer' }).waitFor({ timeout: 15000 })
    ohneKonsolenfehler('p9f5', /Failed to load resource: the server responded with a status of (403|503)/)
  }


  features.p9f6 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    // Nicht verbunden, ohne Aufträge: Status, Startbefehl, Weg zu den Tokens, gesperrtes Eingabefeld.
    await projektOeffnen('E2E Viele Läufe')
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('spur-startbefehl')).forEach(k => localStorage.removeItem(k)))
    await page.reload()
    await page.locator('.cm-content').first().waitFor()
    await panelOeffnen('Claude')
    const panel = claudePanel()
    await panel.getByText('Claude nicht verbunden').waitFor()
    const link = panel.getByRole('link', { name: 'Token verwalten' })
    ok((await link.getAttribute('href')) === '/user/settings#language-feedback', `Token verwalten führt nach ${await link.getAttribute('href')}`)
    await panel.getByText(/claude --allowedTools/).waitFor()
    await panel.locator('.spur-befehl-kasten').getByRole('button', { name: 'Kopieren' }).click()
    await panel.locator('.spur-befehl-kasten').getByRole('button', { name: 'Kopiert' }).waitFor()
    ok(await panel.getByLabel('Auftrag an Claude').isDisabled(), 'Eingabefeld ohne Verbindung bedienbar')
    await panel.getByText('Verbinde zuerst Claude').waitFor()

    // Mehr als 20 Läufe: „Ältere laden“.
    ok((await panel.locator('.spur-lauf-karte').count()) === 20, `Läufe: ${await panel.locator('.spur-lauf-karte').count()}`)
    await panel.getByRole('button', { name: 'Ältere laden' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.spur-lauf-karte').length === 22)
    ok((await panel.getByRole('button', { name: 'Ältere laden' }).count()) === 0, '„Ältere laden“ nach dem letzten Lauf')

    // Ohne Aufträge: der Hinweis steht direkt über dem Eingabefeld.
    await projektOeffnen('E2E Leer')
    await panelOeffnen('Claude')
    const leer = panel.getByText('Noch keine Aufträge. Schreib unten, was Claude tun soll.', { exact: true })
    await leer.waitFor()
    const [hinweisBox, eingabeBox] = await Promise.all([leer.boundingBox(), panel.locator('.spur-chat-eingabe').boundingBox()])
    ok(eingabeBox.y - (hinweisBox.y + hinweisBox.height) < 40, `Hinweis nicht direkt über dem Eingabefeld: ${hinweisBox.y}, ${eingabeBox.y}`)

    // Verbunden: Startbefehl eingeklappt, Lauf-Karte direkt unter der Statuszeile und ganz sichtbar.
    await projektOeffnen('E2E Läufe')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    const token = await neuesToken()
    let nr = 0
    const schreiben = async (alt, neu) => {
      const r = await werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', alt, neu, idempotenz_schluessel: `p9f6-${Date.now()}-${nr++}` })
      ok(!r.fehler, `doc_edit: ${JSON.stringify(r.inhalt)}`)
    }
    await schreiben('Eins.', 'Eins. a')
    await schreiben('Zwei.', 'Zwei. b')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Erster Lauf' })
    await schreiben('Drei.', 'Drei. c')
    await schreiben('Vier.', 'Vier. d')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Zweiter Lauf' })
    await schreiben('Fünf.', 'Fünf. e')
    await verbinden(token)
    await panel.getByRole('button', { name: 'Startbefehl anzeigen' }).waitFor()
    ok((await panel.getByText(/claude --allowedTools/).count()) === 0, 'Startbefehl trotz Verbindung offen')
    const koepfe = panel.locator('.spur-lauf-kopf button')
    await page.waitForFunction(() => document.querySelectorAll('.spur-lauf-kopf button').length === 3, null, { timeout: 15000 })
    ok(JSON.stringify(await koepfe.evaluateAll(k => k.map(b => b.getAttribute('aria-expanded')))) === '["true","false","false"]', 'Neuester Lauf nicht allein offen')
    for (const i of [1, 2]) {
      const text = await koepfe.nth(i).innerText()
      ok(/Fertig/.test(text) && /2 offen/.test(text), `Älterer Lauf: ${text}`)
    }
    const [status, ersteKarte, inhalt] = await Promise.all([
      panel.locator('.spur-claude-status').boundingBox(),
      panel.locator('.spur-lauf-karte').first().boundingBox(),
      panel.locator('.spur-claude-inhalt').boundingBox(),
    ])
    ok(ersteKarte.y - (status.y + status.height) < 24, `Lauf-Karte nicht unter der Statuszeile: ${status.y + status.height}, ${ersteKarte.y}`)
    ok(ersteKarte.y >= inhalt.y && ersteKarte.y + ersteKarte.height <= inhalt.y + inhalt.height, 'Lauf-Karte abgeschnitten')

    // Einen älteren Lauf aufklappen und einzeln entscheiden.
    await koepfe.nth(2).click()
    const aelter = panel.locator('.spur-lauf-karte').nth(2)
    await aelter.locator('.spur-lauf-aenderung').first().getByRole('button', { name: 'Annehmen', exact: true }).click()
    await page.waitForFunction(() => /1 offen/.test(document.querySelectorAll('.spur-lauf-kopf button')[2]?.innerText ?? ''), null, { timeout: 10000 })
    await panel.locator('.spur-lauf-karte').nth(2).getByRole('button', { name: 'Ablehnen' }).first().click()
    await page.waitForFunction(() => !/offen/.test(document.querySelectorAll('.spur-lauf-kopf button')[2]?.innerText ?? 'offen'), null, { timeout: 10000 })

    // Ein Fehler der Abfrage verschwindet, sobald sie wieder klappt.
    await fakeSteuern({ schalter: { SPUR_CLAUDE_FEHLER: '403' } })
    try {
      await panel.locator('.notification-type-error').first().waitFor({ timeout: 15000 })
    } finally {
      await fakeSteuern({ schalter: {} })
    }
    await panel.locator('.notification-type-error').first().waitFor({ state: 'detached', timeout: 15000 })

    // Token erzeugen: Doppelklick gibt ein Token; Widerrufen fragt nach.
    await page.goto(`${BASE}/user/settings`)
    const zeilen = page.locator('.spur-token')
    await page.getByRole('button', { name: 'Token erzeugen' }).waitFor()
    const vorher = await zeilen.count()
    await page.getByRole('button', { name: 'Token erzeugen' }).dblclick()
    await page.getByText('So verbindest du Claude Code').waitFor()
    await page.waitForTimeout(1000)
    ok((await zeilen.count()) === vorher + 1, `Doppelklick: ${(await zeilen.count()) - vorher} Tokens`)
    await zeilen.first().getByRole('button', { name: 'Widerrufen' }).click()
    await page.locator('.modal').getByText('Danach kann sich Claude mit diesem Token nicht mehr verbinden.').waitFor()
    await page.locator('.modal').getByRole('button', { name: 'Abbrechen' }).click()
    ok((await zeilen.count()) === vorher + 1, 'Abbrechen hat widerrufen')
    ohneKonsolenfehler('p9f6', /Failed to load resource: the server responded with a status of 403/)
  }


  features.p9f7 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const recherche = () => page.getByRole('tabpanel', { name: 'Recherche' })
    await projektOeffnen('E2E Recherche')

    // „Nicht frei“ lesbar in beiden Designs.
    for (const thema of ['', 'light-']) {
      await mitDesign(thema, async () => {
        await projektOeffnen('E2E Recherche')
        await panelOeffnen('Recherche')
        await paperSuchen('sleep memory')
        const nichtFrei = recherche().locator('.spur-paper', { hasText: 'Nicht frei' }).first()
        await nichtFrei.waitFor()
        const schlecht = await unlesbar(nichtFrei)
        ok(schlecht.length === 0, `Treffer im Design „${thema || 'dunkel'}“: ${schlecht}`)
      })
    }
    await projektOeffnen('E2E Recherche')
    await panelOeffnen('Recherche')
    await paperSuchen('sleep memory')

    // Je Treffer eine Hauptaktion, der Rest im Menü; die DOI ist ein Link.
    const treffer = recherche().locator('.spur-paper').filter({ has: page.locator('.spur-paper-doi') })
    const anzahl = await treffer.count()
    ok(anzahl > 0, 'Keine Treffer mit DOI')
    for (let i = 0; i < anzahl; i++) {
      const eintrag = treffer.nth(i)
      const haupt = await eintrag.locator('.spur-paper-aktionen > .btn').allInnerTexts()
      const frei = (await eintrag.getByText('Open Access', { exact: true }).count()) > 0
      ok(JSON.stringify(haupt) === JSON.stringify([frei ? 'Aufnehmen' : 'Auf die Beschaffungsliste']), `Hauptaktion: ${haupt}`)
      const doi = await eintrag.locator('.spur-paper-doi a').innerText()
      ok((await eintrag.locator('.spur-paper-doi a').getAttribute('href')) === `https://doi.org/${doi}`, `DOI-Link für ${doi}`)
    }
    await treffer.first().getByRole('button', { name: 'Weitere Aktionen' }).click()
    const menue = await page.getByRole('menuitem').allInnerTexts()
    ok(JSON.stringify(menue.map(m => m.trim())) === '["Zitiert von","Zitiert"]', `Menü: ${menue}`)
    await page.keyboard.press('Escape')

    // Reiter mit Pfeiltasten.
    const reiter = name => recherche().getByRole('tab', { name, exact: true })
    await reiter('Treffer').focus()
    await page.keyboard.press('ArrowRight')
    ok((await reiter('Suchprotokoll').getAttribute('aria-selected')) === 'true', 'Pfeil rechts wählt „Suchprotokoll“ nicht')
    ok(await reiter('Suchprotokoll').evaluate(el => el === document.activeElement), 'Fokus nicht auf „Suchprotokoll“')
    await page.keyboard.press('ArrowRight')
    ok((await reiter('Beschaffung').getAttribute('aria-selected')) === 'true', 'Pfeil rechts wählt „Beschaffung“ nicht')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    ok((await reiter('Treffer').getAttribute('aria-selected')) === 'true', 'Pfeil links wählt „Treffer“ nicht')

    // Schmal: Reiter in einer Zeile oder rollend, Suchfeld und „Suchen“ ganz sichtbar.
    await panelBreite(240)
    const oben = await recherche().getByRole('tab').evaluateAll(t => t.map(e => Math.round(e.getBoundingClientRect().top)))
    ok(new Set(oben).size === 1, `Reiter stapeln: ${oben}`)
    await imPanelGanz(recherche().getByRole('searchbox', { name: 'Paper suchen' }), 'Suchfeld bei 240 px')
    await imPanelGanz(recherche().getByRole('button', { name: 'Suchen', exact: true }), '„Suchen“ bei 240 px')

    // Platzhalter während der Suche, Text ohne Treffer.
    let freigeben
    const gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/recherche\?/, async route => {
      await gehalten
      await route.continue().catch(() => {})
    })
    await recherche().getByRole('searchbox', { name: 'Paper suchen' }).fill('sleep')
    await recherche().getByRole('button', { name: 'Suchen', exact: true }).click()
    await recherche().locator('.spur-platzhalter-zeile').first().waitFor()
    freigeben()
    await page.unroute(/\/recherche\?/)
    await paperSuchen('xyzxyz')
    await recherche().getByText('Keine Treffer für „xyzxyz“. Prüf die Schreibweise oder such nach der DOI.', { exact: true }).waitFor()

    // Beschaffung: „PDF hochladen“ als Hauptaktion, Exporte im Menü, leere Liste erklärt sich.
    await reiter('Beschaffung').click()
    await recherche().locator('.btn-primary', { hasText: 'PDF hochladen' }).waitFor()
    await recherche().getByRole('button', { name: 'Liste exportieren' }).click()
    const exporte = await page.getByRole('menuitem').evaluateAll(m => m.map(e => e.getAttribute('aria-label')))
    ok(JSON.stringify(exporte) === '["Als .bib exportieren","Als .ris exportieren","Als CSV exportieren"]', `Exporte: ${exporte}`)
    await page.keyboard.press('Escape')
    await projektOeffnen('E2E Leer')
    await panelOeffnen('Recherche')
    await reiter('Beschaffung').click()
    await recherche().getByText('Die Beschaffungsliste ist leer. Nicht freie Treffer setzt du mit „Auf die Beschaffungsliste“ hierher.').waitFor()
    ohneKonsolenfehler('p9f7')
  }


  features.p9f8 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')

    // Vorschläge: „Für mich“ und „Standard für alle im Projekt“, je Auslöser eine Zeile; Tageslimit am Feld.
    let freigeben
    let gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/vorschlaege$/, async route => {
      await gehalten
      await route.continue().catch(() => {})
    })
    await panelOeffnen('Vorschläge')
    const vorschlaege = page.getByRole('tabpanel', { name: 'Vorschläge' })
    await vorschlaege.locator('.spur-platzhalter-zeile').first().waitFor()
    freigeben()
    await page.unroute(/\/vorschlaege$/)
    await vorschlaege.getByRole('heading', { name: 'Für mich', exact: true }).waitFor()
    await vorschlaege.getByRole('heading', { name: 'Standard für alle im Projekt', exact: true }).waitFor()
    for (const zeile of await vorschlaege.locator('.spur-vorschlag-zeile').all()) {
      const [name, auswahl] = await Promise.all([zeile.locator('label').boundingBox(), zeile.locator('select').boundingBox()])
      ok(Math.abs(name.y + name.height / 2 - (auswahl.y + auswahl.height / 2)) < 6, 'Auslöser nicht als Zeile mit Namen und Auswahl')
    }
    const limit = vorschlaege.getByLabel('Tageslimit, für alle Projekte')
    const stand = vorschlaege.getByText(/^Heute \d+ von \d+ Auslösern$/)
    const [feldBox, standBox] = await Promise.all([limit.boundingBox(), stand.boundingBox()])
    ok(Math.abs(feldBox.y - standBox.y) < feldBox.height, 'Stand steht nicht neben dem Feld')
    for (const wert of ['0', 'abc']) {
      await limit.fill(wert)
      await vorschlaege.locator('.spur-vorschlag-limit').getByRole('button', { name: 'Speichern' }).click()
      await vorschlaege.getByText('Bitte eine ganze Zahl von 1 bis 1000 eingeben.').waitFor()
      ok((await limit.getAttribute('aria-invalid')) === 'true', `Feld bei „${wert}“ nicht als ungültig markiert`)
    }

    // Literaturmatrix: Platzhalter ganz lesbar, „Gespeichert“ an der Zelle, Fehler mit erhaltenem Text.
    await panelOeffnen('Quellen')
    await quellenMenue('Literaturmatrix')
    const matrix = modal()
    const neueSpalte = matrix.getByPlaceholder('Neue Spalte, etwa „Methode“')
    const passt = await neueSpalte.evaluate(el => {
      const stil = getComputedStyle(el)
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.font = `${stil.fontSize} ${stil.fontFamily}`
      const frei = el.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight)
      return ctx.measureText(el.placeholder).width <= frei
    })
    ok(passt, 'Platzhalter der neuen Spalte abgeschnitten')
    if ((await matrix.getByRole('columnheader', { name: 'P9 Methode' }).count()) === 0) {
      await neueSpalte.fill('P9 Methode')
      await matrix.getByRole('button', { name: 'Spalte hinzufügen' }).click()
      await matrix.getByRole('columnheader', { name: 'P9 Methode' }).waitFor()
    }
    const zelle = matrix.getByLabel(/^P9 Methode: smith2024\.pdf$/)
    await zelle.fill('Experiment')
    await zelle.press('Tab')
    const zellStatus = zelle.locator('xpath=ancestor::td').getByRole('status')
    await zellStatus.getByText('Gespeichert', { exact: true }).waitFor()
    await fakeSteuern({ schalter: { SPUR_MATRIX_FEHLER: '1' } })
    try {
      await zelle.fill('Experiment mit Kontrollgruppe')
      await zelle.press('Tab')
      await zellStatus.getByText('Speichern ist gerade nicht möglich. Bitte versuch es gleich noch einmal.').waitFor()
      ok((await zelle.inputValue()) === 'Experiment mit Kontrollgruppe', 'Text nach Fehler verloren')
    } finally {
      await fakeSteuern({ schalter: {} })
    }
    await page.keyboard.press('Escape')
    await matrix.waitFor({ state: 'detached' })

    // Quelle löschen: Zahl lädt sichtbar; scheitert sie, bleibt Löschen möglich.
    gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/pruefbericht$/, async route => {
      await gehalten
      await route.continue().catch(() => {})
    })
    await page.locator('.spur-panel').getByRole('button', { name: /^Sleep and Memory/ }).click()
    await page.getByRole('button', { name: 'Quelle löschen' }).click()
    await modal().getByText('Betroffene Zitate werden gezählt …').waitFor()
    freigeben()
    await page.unroute(/\/pruefbericht$/)
    await modal().getByText(/Zitate? nutz/).waitFor()
    await modal().getByRole('button', { name: 'Abbrechen' }).click()
    await fakeSteuern({ schalter: { SPUR_PRUEFBERICHT_FEHLER: '403' } })
    try {
      await page.getByRole('button', { name: 'Quelle löschen' }).click()
      await modal().getByText('Die betroffenen Zitate ließen sich nicht ermitteln.').waitFor({ timeout: 20000 })
      ok(await modal().getByRole('button', { name: 'Endgültig löschen' }).isEnabled(), 'Löschen ohne Zahl gesperrt')
      await modal().getByRole('button', { name: 'Abbrechen' }).click()
    } finally {
      await fakeSteuern({ schalter: {} })
    }

    // Import: Ladehinweis der Sammlungen, gleiche Namen als zwei Zeilen, Schließen während des Uploads fragt nach.
    const pdf = await repoBytes(`${FIXTURES}/keller2014.pdf`)
    await projektOeffnen('E2E Leer')
    await panelOeffnen('Quellen')
    gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(/\/import\/zotero$/, async route => {
      if (route.request().method() === 'GET') await gehalten
      await route.continue().catch(() => {})
    })
    await quellenMenue('Importieren')
    await modal().getByText('Zotero-Sammlungen werden geladen').waitFor()
    freigeben()
    await page.unroute(/\/import\/zotero$/)
    let hochladen
    const upload = new Promise(resolve => (hochladen = resolve))
    await page.route(/\/quellen$/, async route => {
      if (route.request().method() === 'POST') await upload
      await route.continue().catch(() => {})
    })
    await modal().getByLabel('PDFs wählen').setInputFiles([
      { name: 'gleich.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'gleich.pdf', mimeType: 'application/pdf', buffer: pdf },
    ])
    ok((await modal().locator('.spur-import-liste li', { hasText: 'gleich.pdf' }).count()) === 2, 'Gleiche Namen nicht als zwei Zeilen')
    await modal().getByRole('button', { name: 'Schließen' }).click()
    await modal().getByText('Der Upload läuft noch. Beim Schließen kommen die übrigen Dateien nicht an.').waitFor()
    await modal().getByRole('button', { name: 'Weiter hochladen' }).click()
    hochladen()
    await page.waitForFunction(() => [...document.querySelectorAll('.spur-import-liste li')].every(li => !li.textContent.includes('wird aufgenommen')), null, { timeout: 30000 }).catch(() => {})
    await page.unroute(/\/quellen$/)
    await modal().getByRole('button', { name: 'Schließen' }).click()
    await modal().waitFor({ state: 'detached' })

    // Einladungslink: „Kopiert“ nur, wenn das Kopieren gelungen ist.
    await mailFake(false)
    await anmelden('e2e-admin@example.org')
    const dialog = await kontoAnlegen(`p9f8-${Date.now()}@example.org`)
    await dialog.getByLabel('Einladungslink').last().waitFor()
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('verweigert'))
      document.execCommand = () => false
    })
    await dialog.getByRole('button', { name: 'Kopieren' }).last().click()
    await dialog.getByText('Kopieren nicht möglich. Markier den Link und kopier ihn von Hand.').waitFor()
    ok((await dialog.getByRole('button', { name: 'Kopiert' }).count()) === 0, '„Kopiert“ trotz Fehler')
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    ohneKonsolenfehler('p9f8', /Failed to load resource: the server responded with a status of (403|409|503)/)
  }


  features.p9f10 = async () => {
    await breite(1280)
    const de = JSON.parse(await repoDatei(`${FIXTURES}/../../../../locales/de.json`))
    const en = JSON.parse(await repoDatei(`${FIXTURES}/../../../../locales/en.json`))
    // Englische Texte, die im Deutschen anders lauten: Taucht einer in der Oberfläche auf, fehlt eine Übersetzung.
    const englisch = new Set(Object.keys(en).filter(k => de[k] && de[k] !== en[k] && /[a-z]{3}/.test(en[k])).map(k => en[k]))
    const nurDeutsch = (texte, wo) => {
      const fremd = texte.map(t => t.trim()).filter(t => englisch.has(t))
      ok(fremd.length === 0, `${wo}: englisch ${fremd.join(' | ')}`)
    }
    await anmelden('e2e-a@example.org')

    // Projektliste: relative Zeit deutsch, Papierkorb, Stichwörter nicht abgeschnitten.
    await page.goto(`${BASE}/project`)
    await page.getByPlaceholder(/^Suche in allen Projekten…$/).filter({ visible: true }).first().fill('E2E Alt')
    const zeile = page.getByRole('row', { name: /E2E Alt/ }).first()
    await zeile.getByText(/^vor 2 Tagen von dir$/).filter({ visible: true }).first().waitFor()
    await page.getByText('Papierkorb', { exact: true }).first().waitFor()
    const abgeschnitten = await page.locator('.project-list-sidebar-wrapper-react, .project-list-sidebar').first().evaluate(seite =>
      [...seite.querySelectorAll('*')].filter(el => el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim())
    ).catch(() => [])
    ok(abgeschnitten.length === 0, `Abgeschnitten in der Seitenleiste: ${abgeschnitten}`)
    nurDeutsch(await page.locator('main, nav, aside').allInnerTexts().then(t => t.join('\n').split('\n')), 'Projektliste')
    await page.getByRole('button', { name: /^(Konto|Account)/ }).first().click().catch(() => {})
    nurDeutsch(await page.locator('.dropdown-menu.show').allInnerTexts().then(t => t.join('\n').split('\n')), 'Kontomenü')
    await page.keyboard.press('Escape')

    // Editor: Menüleiste und jedes Menü deutsch.
    await projektOeffnen('E2E Bericht')
    const leiste = page.getByRole('menubar').first()
    const menues = (await leiste.locator('.menu-bar-toggle').allInnerTexts()).map(t => t.trim())
    ok(JSON.stringify(menues) === JSON.stringify(['Datei', 'Bearbeiten', 'Einfügen', 'Ansicht', 'Format', 'Hilfe']), `Menüleiste: ${menues}`)
    for (const name of menues) {
      await leiste.getByRole('button', { name, exact: true }).first().click()
      await page.locator('.dropdown-menu.show').first().waitFor()
      nurDeutsch(await page.locator('.dropdown-menu.show').allInnerTexts().then(t => t.join('\n').split('\n')), `Menü ${name}`)
      await page.keyboard.press('Escape')
    }

    // Leiste links: zugängliche Namen und Tooltips.
    for (const name of ['Dateibaum', 'Projektsuche', 'Überprüfung', 'Chat']) {
      const tab = railTab(name)
      await tab.waitFor()
      await tab.hover()
      await page.getByRole('tooltip').filter({ hasText: name }).first().waitFor({ timeout: 5000 })
      await page.mouse.move(600, 400)
    }

    // Review-Panel: deutsche Knöpfe zum Annehmen und Ablehnen.
    await projektOeffnen('E2E Schreiben')
    await panelSichern(DATEIBAUM, page.locator('.file-tree').getByRole('treeitem', { name: 'voll.tex' }))
    await page.locator('.file-tree').getByRole('treeitem', { name: 'voll.tex' }).click()
    await panelSichern('Überprüfung', page.locator('.review-panel-entry').first(), 60000)
    const knoepfe = await page.locator('.review-panel-entry button').evaluateAll(b => b.map(e => e.getAttribute('aria-label') || e.textContent.trim()))
    ok(knoepfe.some(k => /annehmen/i.test(k)) && knoepfe.some(k => /ablehnen/i.test(k)), `Review-Knöpfe: ${knoepfe.slice(0, 6)}`)
    nurDeutsch(knoepfe, 'Review-Panel')
    ohneKonsolenfehler('p9f10')
  }


  // Grund und Füllung des Schriftzugs liegen übereinander; gemessen bei 0, 50 und 100 % Fortschritt.
  async function schriftzugDeckt(wo) {
    await page.locator('.loading-screen-brand-fuellung').waitFor({ timeout: 20000 })
    for (const stand of [0, 50, 100]) {
      const abweichung = await page.evaluate(p => {
        const grund = document.querySelector('.loading-screen-brand-grund')
        const fuellung = document.querySelector('.loading-screen-brand-fuellung')
        fuellung.style.clipPath = `inset(${100 - p}% 0 0 0)`
        const a = grund.getBoundingClientRect()
        const b = fuellung.getBoundingClientRect()
        const text = document.querySelector('.loading-screen-label')?.getBoundingClientRect()
        const mitte = r => r.left + r.width / 2
        return {
          rahmen: Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.height - b.height), Math.abs(a.bottom - b.bottom)),
          text: text ? Math.abs(mitte(text) - mitte(a)) : 0,
          unter: text ? text.top >= a.bottom : true,
        }
      }, stand)
      ok(abweichung.rahmen <= 1, `${wo} bei ${stand} %: Füllung versetzt um ${abweichung.rahmen} px`)
      ok(abweichung.unter && abweichung.text <= 2, `${wo}: Text nicht mittig darunter (${JSON.stringify(abweichung)})`)
    }
  }

  // Hält Anfragen an `muster` an, bis `schritte` fertig sind; so bleibt der Ladebildschirm stehen.
  async function mitGehaltenemNetz(muster, schritte) {
    let freigeben
    const gehalten = new Promise(resolve => (freigeben = resolve))
    await page.route(muster, async route => {
      await gehalten
      await route.continue().catch(() => {})
    })
    try {
      await schritte()
    } finally {
      freigeben()
      await page.unroute(muster)
    }
  }

  features.p9f11 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Quellen')
    const pid = page.url().split('/').pop()
    // Die Tokens entstehen erst, wenn der Linkzugriff eingeschaltet wird.
    await seitenAnfrage('POST', `/project/${pid}/settings/admin`, { publicAccessLevel: 'tokenBased' })
    const { readAndWrite } = await (await page.request.get(`${BASE}/project/${pid}/tokens`)).json()
    ok(readAndWrite, 'Kein Freigabelink')

    for (const [px, thema] of [[1280, 'light-'], [1280, ''], [360, '']]) {
      await breite(px)
      await mitDesign(thema, async () => {
        await mitGehaltenemNetz(/\/socket\.io\//, async () => {
          await page.goto(`${BASE}/project/${pid}`, { waitUntil: 'commit' })
          await schriftzugDeckt(`Editor ${px} px ${thema || 'dunkel'}`)
        })
        await page.locator('.cm-content').first().waitFor({ timeout: 60000 })
      })
    }
    await breite(1280)

    await anmelden('e2e-review@example.org')
    await mitGehaltenemNetz(/\/grant$/, async () => {
      await page.goto(`${BASE}/${readAndWrite}`, { waitUntil: 'commit' })
      // Overleaf fragt vor dem Beitreten nach; der Ladebildschirm steht, solange der Zugriff angefragt wird.
      const beitreten = page.getByRole('button', { name: /beitreten|join/i }).first()
      await beitreten.waitFor({ timeout: 15000 }).then(() => beitreten.click(), () => {})
      await schriftzugDeckt('Freigabelink')
    })
    ohneKonsolenfehler('p9f11', /Failed to load resource|WebSocket|socket\.io/)
  }


  features.p9f9 = async () => {
    await breite(1280)
    await anmelden('e2e-admin@example.org')
    const seite = page.locator('main.spur-admin-seite')

    // Admin-Menü auf Deutsch, beide Einträge führen zur Seite.
    const breiten = {}
    for (const [eintrag, pfad] of [['Grenzen', '/spur/admin/grenzen'], ['Workflows', '/spur/admin/workflows']]) {
      await page.goto(`${BASE}/project`)
      await page.getByRole('menuitem', { name: 'Admin', exact: true }).first().click()
      await page.getByRole('menuitem', { name: eintrag, exact: true }).click()
      await page.waitForURL(new RegExp(`${pfad}$`))
      await seite.getByRole('heading', { level: 1, name: eintrag }).waitFor()
      await seite.locator('section.spur-admin-abschnitt h2').first().waitFor()
      ok((await seite.locator(':scope > p').count()) >= 1, `${eintrag}: kein einleitender Satz`)
      ok((await seite.locator('section.spur-admin-abschnitt h2').count()) >= 1, `${eintrag}: keine Abschnitte`)
      breiten[eintrag] = (await seite.boundingBox()).width
    }
    ok(breiten.Grenzen === breiten.Workflows, `Inhaltsbreiten: ${JSON.stringify(breiten)}`)

    // Workflows: „Gespeichert“ am Knopf; über 20 000 Zeichen eine Meldung am Feld, die Eingabe bleibt.
    const abschnitt = seite.locator('section.spur-admin-abschnitt').first()
    const feld = abschnitt.locator('textarea')
    const text = await feld.inputValue()
    // Per Tastatur gespeichert, bleibt der Fokus auf dem Knopf (er ist beim Laden kurz gesperrt).
    const speichern = abschnitt.getByRole('button', { name: 'Speichern', exact: true })
    await speichern.focus()
    await page.keyboard.press('Enter')
    await abschnitt.locator('.spur-vorschlag-aktionen').getByText(/^Gespeichert/).waitFor()
    await fokusAuf(speichern, 'nach „Speichern“')
    const lang = 'x'.repeat(20001)
    await feld.fill(lang)
    await abschnitt.getByRole('button', { name: 'Speichern', exact: true }).click()
    await abschnitt.getByText(/^Der Text hat 20.001 Zeichen; erlaubt sind höchstens 20.000\./).waitFor()
    ok((await feld.inputValue()).length === 20001, 'Zu langer Text verloren')
    ok((await feld.getAttribute('aria-invalid')) === 'true', 'Feld nicht als ungültig markiert')
    await feld.fill(text)

    // Grenzen: Suche nach Name oder Adresse, Blättern ab 50 Zeilen, leere Tabellen erklären sich.
    await page.goto(`${BASE}/spur/admin/grenzen`)
    const nutzer = seite.locator('section', { has: page.getByRole('heading', { name: 'Nutzer' }) }).first()
    await nutzer.getByLabel('Nach Name oder Adresse suchen').fill('e2e-leser@')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-email]').length === 1)
    ok((await page.locator('tr[data-email]').getAttribute('data-email')) === 'e2e-leser@example.org', 'Suche findet die Adresse nicht')
    const echt = await (await page.request.get(`${BASE}/spur/admin/grenzen.json`)).json()
    const viele = Array.from({ length: 60 }, (_, i) => ({ ...echt.nutzer[0], id: `p9-${i}`, email: `p9-${i}@example.org`, name: `P9 ${i}` }))
    for (const [nutzerListe, projekte, pruefen] of [
      [viele, echt.projekte, async () => {
        ok((await page.locator('tr[data-email]').count()) === 50, `Erste Seite: ${await page.locator('tr[data-email]').count()} Zeilen`)
        await seite.getByRole('navigation', { name: 'Seiten der Nutzerliste' }).getByRole('button', { name: 'Nächste Seite' }).click()
        ok((await page.locator('tr[data-email]').count()) === 10, `Zweite Seite: ${await page.locator('tr[data-email]').count()} Zeilen`)
      }],
      [[], [], async () => {
        await seite.getByText('Noch keine Nutzer', { exact: true }).waitFor()
        await seite.getByText('Noch keine Projekte', { exact: true }).waitFor()
      }],
    ]) {
      await page.route(/\/spur\/admin\/grenzen\.json$/, route => route.fulfill({ json: { ...echt, nutzer: nutzerListe, projekte } }))
      await page.reload()
      await seite.getByRole('heading', { level: 1, name: 'Grenzen' }).waitFor()
      await page.locator('table').first().waitFor()
      await pruefen()
      await page.unroute(/\/spur\/admin\/grenzen\.json$/)
    }

    // 360 px: Die Seite rollt nicht seitlich, breite Tabellen rollen in ihrem Bereich.
    await breite(360)
    for (const pfad of ['/spur/admin/grenzen', '/spur/admin/workflows']) {
      await page.goto(`${BASE}${pfad}`)
      await seite.locator('h1').waitFor()
      await page.waitForTimeout(500)
      await ohneSeitlichesRollen(`${pfad} bei 360 px`)
    }
    await breite(1280)
    ohneKonsolenfehler('p9f9')
  }


  features.p9f12 = async () => {
    const wurzel = `${FIXTURES}/../../../../../..`
    const readme = await repoDatei(`${wurzel}/README.md`)
    const adr2 = await repoDatei(`${wurzel}/docs/adr/0002-single-write-path.md`)
    const vertrag = await repoDatei(`${wurzel}/docs/mcp-contract.md`)
    const kern = await repoDatei(`${wurzel}/docs/adr/0001-module-in-web-service.md`)
    const backlog = await repoDatei(`${wurzel}/docs/backlog.md`)
    const enthaelt = (text, teile, wo) => {
      const fehlt = teile.filter(t => !text.includes(t))
      ok(fehlt.length === 0, `${wo}: fehlt ${fehlt.join(' | ')}`)
    }
    enthaelt(readme, ['Alles von Claude automatisch annehmen', 'Rote Zitate bleiben offen.', 'Alles Offene jetzt annehmen', 'Lauf rückgängig', 'Original herunterladen', 'Markiert', 'Ohne Quelle', 'tooltip'], 'README')
    enthaelt(adr2, ['Addendum 2026-11-13', 'red', 'no tool'], 'ADR 0002')
    ok(/switch "Alles von Claude automatisch annehmen"/.test(vertrag) && /no tool to accept/.test(vertrag), 'MCP-Vertrag nennt die Regel nicht')
    enthaelt(kern, ['loading-branded.tsx', 'locales/de.json', 'admin-menu.tsx'], 'Kern-Patches')
    ok(!/Nicht frei|Menüsprach|mixed menu|narrow research/i.test(backlog.split('## ').find(t => t.startsWith('Interface')) ?? ''), 'Erledigtes steht noch im Backlog')
    ok(/lacks \d+ keys/.test(backlog), 'Backlog nennt die Zahl fehlender deutscher Schlüssel nicht')
    for (const [name, text] of [['README', readme], ['ADR 0002', adr2], ['Vertrag', vertrag], ['Kern-Patches', kern], ['Backlog', backlog]]) {
      ok(!text.includes('Automatisch annehmen, wenn ein Lauf ohne Probleme endet'), `${name} nennt das alte Häkchen`)
      ok(!/\bLimits\b/.test(text), `${name} nennt „Limits“`)
    }
  }

  features.p10f7 = async () => {
    await breite(1280)
    await grenzenSetzen({ projekte: '', speicherGb: '1' })
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    await fakeSteuern({ stoerungen: {}, schalter: {} })
    const pid = await projektId(token, 'E2E P8 Pakete B')
    const antworten = await Promise.all([1, 2].map(() => werkzeug(token, 'tex_package_add', { project_id: pid, paket: 'carlito' })))
    ok(antworten.every(a => !a.fehler), `Gleichzeitig: ${JSON.stringify(antworten.map(a => a.inhalt))}`)
    ok(antworten.filter(a => a.inhalt.dateien.length === 5).length === 1, `Genau eine Installation: ${JSON.stringify(antworten.map(a => a.inhalt))}`)
    ok(antworten.filter(a => a.inhalt.hinweis === 'schon im Projekt').length === 1, `Zweiter meldet nicht „schon im Projekt“: ${JSON.stringify(antworten.map(a => a.inhalt))}`)
    const pfade = await paketPfade(pid)
    ok(JSON.stringify(pfade) === JSON.stringify(CARLITO_DATEIEN), `Dateien: ${pfade}`)
  }

  features.p10f1 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    await projektOeffnen('E2E Bericht')
    const pid = page.url().split('/').pop()
    await panelOeffnen('Prüfbericht')
    await berichtFilter('Alle')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    const kopf = page.locator('p.spur-zeile-meta', { hasText: KOPFZEILE_BERICHT })
    await kopf.waitFor({ timeout: 30000 })
    const text = await kopf.innerText()
    const zahlFilter = Number(/^Markiert\s+(\d+)$/.exec((await page.locator('.spur-filter label', { hasText: /^Markiert\s+\d+$/ }).innerText()).trim())?.[1])
    const zahlKopf = Number(/, (\d+) markiert/.exec(text)?.[1])
    ok(zahlFilter > 0 && zahlFilter === zahlKopf, `Filter ${zahlFilter}, Kopfzeile „${text}“`)
    ok(new RegExp(`^\\d+ Stellen, ${zahlKopf} markiert: \\d+ mit Befund`).test(text), `Kopfzeile beginnt nicht mit Gesamtzahl und markiert: „${text}“`)
    const dateien = await page.locator('.spur-gruppe-kopf .spur-zeile-meta').allInnerTexts()
    const summe = dateien.reduce((s, t) => s + Number(/(\d+) markiert/.exec(t)?.[1] ?? 0), 0)
    ok(summe === zahlFilter, `Dateizeilen ${JSON.stringify(dateien)} ergeben ${summe}, Filter ${zahlFilter}`)
    await berichtFilter('Markiert')
    await page.waitForFunction(n => document.querySelectorAll('.spur-gruppe .spur-zeile').length === n, zahlFilter, { timeout: 5000 }).catch(() => {})
    const sichtbar = await page.locator('.spur-gruppe .spur-zeile').count()
    ok(sichtbar === zahlFilter, `Mit Filter ${sichtbar} Zeilen, Filterknopf „${await page.locator('.spur-filter .btn-check:checked + label').innerText()}“`)
    await berichtFilter('Alle')
    const bericht = (await werkzeug(token, 'check_report', { project_id: pid })).inhalt
    ok(bericht.zaehlung.markiert === zahlFilter, `check_report: ${JSON.stringify(bericht.zaehlung)}`)
    const { daten } = await mcp(token, 'tools/list')
    const beschreibung = daten.result.tools.find(w => w.name === 'check_report').description
    ok(/markiert zählt alle Stellen mit problem: true/.test(beschreibung), `Beschreibung: ${beschreibung}`)

    await projektOeffnen('E2E P8 Zählung')
    await panelOeffnen('Prüfbericht')
    await page.getByRole('button', { name: 'Erneut prüfen' }).click()
    await page.getByText(/, keine markiert/).waitFor({ timeout: 30000 })
    await page.locator('.spur-filter label', { hasText: /^Markiert\s+0$/ }).waitFor()
  }

  features.p10f3 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    let nr = 0
    const schreiben = async (pid, alt, neu) => {
      const r = await werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', alt, neu, idempotenz_schluessel: `p10f3-${Date.now()}-${nr++}` })
      ok(!r.fehler, `doc_edit ${neu}: ${JSON.stringify(r.inhalt)}`)
      return r.inhalt
    }
    const ROT = '\\parencite{unbekannt}'

    // Schalter an: normale Änderung ist angenommen, übrig bleibt nur das rote Zitat.
    await projektOeffnen('E2E Rot Auto')
    let pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    let panel = claudePanel()
    await schreiben(pid, 'Alpha Satz.', 'Alpha Satz erweitert.')
    const rot = await schreiben(pid, 'Beta Satz.', `Beta Satz. ${ROT}`)
    ok(rot.rot.length === 1, `Zitat nicht rot: ${JSON.stringify(rot)}`)
    const nurRot = panel.getByRole('button', { name: 'Nur rote Zitate offen (1)' })
    await nurRot.waitFor({ timeout: 15000 })
    ok((await nurRot.getAttribute('aria-disabled')) === 'true', 'Knopf nicht ausgegraut')
    await panel.getByText(/Rote Zitate werden einzeln geprüft/).waitFor()
    ok((await panel.getByRole('button', { name: 'Nichts offen' }).count()) === 0, '„Nichts offen“ steht trotz rotem Zitat da')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Auto an.' })

    // Schalter aus: ohne Änderungen „Nichts offen“, mit zwei normalen „Alles Offene jetzt annehmen (2)“.
    await projektOeffnen('E2E Rot Hand')
    pid = page.url().split('/').pop()
    await panelOeffnen('Claude')
    panel = claudePanel()
    await panel.getByRole('button', { name: 'Nichts offen' }).waitFor({ timeout: 15000 })
    await schreiben(pid, 'Alpha Satz.', 'Alpha Satz erweitert.')
    await schreiben(pid, 'Gamma Satz.', 'Gamma Satz erweitert.')
    await panel.getByRole('button', { name: 'Alles Offene jetzt annehmen (2)' }).waitFor({ timeout: 15000 })

    // Dazu ein rotes Zitat: „Alle annehmen“ der Lauf-Karte fragt nach.
    await schreiben(pid, 'Beta Satz.', `Beta Satz. ${ROT}`)
    const karte = panel.locator('.spur-lauf-karte').first()
    const alle = karte.getByRole('button', { name: 'Alle annehmen', exact: true })
    await karte.locator('.spur-lauf-rot', { hasText: 'Bitte prüfen' }).locator('.spur-lauf-aenderung', { hasText: 'parencite' }).waitFor({ timeout: 15000 })
    await alle.click()
    await modal().getByText('1 rotes Zitat mit annehmen?', { exact: true }).waitFor()
    await fokusAuf(modal().getByRole('button', { name: 'Nur die anderen', exact: true }), 'im Dialog')
    // Esc schließt, nichts ist angenommen, der Fokus liegt wieder auf „Alle annehmen“.
    await page.keyboard.press('Escape')
    await modal().waitFor({ state: 'detached' })
    ok((await karte.locator('.spur-lauf-aenderung').count()) === 3, 'Esc hat etwas angenommen')
    await fokusAuf(alle, 'nach Esc')
    // „Nur die anderen“: Das rote Zitat bleibt als Track Change offen.
    await alle.click()
    await modal().getByRole('button', { name: 'Nur die anderen', exact: true }).click()
    await modal().waitFor({ state: 'detached', timeout: 20000 })
    await karte.locator('.spur-lauf-aenderung', { hasText: 'erweitert' }).waitFor({ state: 'detached', timeout: 15000 })
    await karte.locator('.spur-lauf-rot', { hasText: 'Bitte prüfen' }).locator('.spur-lauf-aenderung', { hasText: 'parencite' }).waitFor()
    ok((await karte.locator('.spur-lauf-aenderung').count()) === 1, 'Nach „Nur die anderen“ ist mehr als das rote Zitat offen')
    // „Alle annehmen“ im Dialog nimmt auch das rote Zitat an.
    await alle.click()
    await modal().getByRole('button', { name: 'Alle annehmen', exact: true }).click()
    await modal().waitFor({ state: 'detached', timeout: 20000 })
    await karte.locator('.spur-lauf-aenderung', { hasText: 'parencite' }).waitFor({ state: 'detached', timeout: 15000 })
    ok((await karte.locator('.spur-lauf-rot').count()) === 0 && (await karte.getByText('Bitte prüfen').count()) === 0, 'Leere Überschrift „Bitte prüfen“ nach der Annahme')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Hand.' })

    // Ein Lauf ohne rote Zitate: ohne Dialog.
    await schreiben(pid, 'Delta Satz.', 'Delta Satz erweitert.')
    const neu = panel.locator('.spur-lauf-karte').first()
    await neu.locator('.spur-lauf-aenderung', { hasText: 'erweitert' }).waitFor({ timeout: 15000 })
    await neu.getByRole('button', { name: 'Alle annehmen', exact: true }).click()
    await neu.locator('.spur-lauf-aenderung', { hasText: 'erweitert' }).waitFor({ state: 'detached', timeout: 15000 })
    ok((await modal().count()) === 0, 'Dialog ohne rotes Zitat')
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Ohne Rot.' })
  }

  features.p10f5 = async () => {
    await breite(1280)
    await grenzenSetzen({ projekte: '', speicherGb: '1' })
    await page.goto(`${BASE}/spur/admin/grenzen`)
    const abschnitt = page.locator('section', { has: page.getByRole('heading', { name: 'Projekte', exact: true }) })
    const zeilen = abschnitt.locator('tbody tr[data-projekt]')
    await zeilen.first().waitFor({ timeout: 30000 })
    const { projekte } = (await seitenAnfrage('GET', '/spur/admin/grenzen.json')).daten
    ok(projekte.length > 50, `Zu wenige Projekte für die zweite Seite: ${projekte.length}`)
    ok((await zeilen.count()) === 50, `Zeilen auf Seite 1: ${await zeilen.count()}`)
    await abschnitt.getByRole('navigation', { name: 'Seiten der Projektliste' }).waitFor()

    const suche = abschnitt.getByLabel('Nach Projekt oder Eigentümer suchen')
    await suche.fill('P8 Pakete')
    const namen = await zeilen.evaluateAll(z => z.map(e => e.getAttribute('data-projekt')))
    ok(namen.length > 0 && namen.every(n => n.includes('P8 Pakete')), `Suche nach Projekt: ${namen}`)
    await suche.fill('e2e-pakete@')
    const eigentuemer = await zeilen.evaluateAll(z => z.map(e => e.children[1].textContent))
    ok(eigentuemer.length > 0 && eigentuemer.every(e => e.startsWith('e2e-pakete@') || e.includes('e2e-pakete@')), `Suche nach Eigentümer: ${eigentuemer}`)
    await suche.fill('gibt-es-nicht-xyz')
    await abschnitt.getByText('Keine Projekte gefunden', { exact: true }).waitFor()
    await suche.fill('')

    const zellen = await zeilen.evaluateAll(z => z.map(e => e.querySelector('.spur-grenzen-zahl').textContent.trim()))
    ok(zellen.every(z => /^\d/.test(z)) && !zellen.some(z => /^0 GB/.test(z)), `Speicher: ${zellen.slice(0, 20)}`)
    ok(zellen.some(z => /^[\d.,]+ (KB|MB)/.test(z)), `Keine KB oder MB: ${zellen.slice(0, 20)}`)
    const leer = projekte.slice(0, 50).find(p => p.bytes === 0)
    if (leer) {
      const text = await abschnitt.locator(`tr[data-projekt="${leer.name}"] .spur-grenzen-zahl`).first().textContent()
      ok(/^0 KB/.test(text.trim()), `Leeres Projekt: ${text}`)
    }

    // Zeile 51 steht auf der zweiten Seite; „Speicher neu berechnen“ trifft genau dieses Projekt.
    await abschnitt.getByRole('button', { name: 'Nächste Seite' }).click()
    const erste = zeilen.first()
    const name = await erste.getAttribute('data-projekt')
    const ziel = projekte[50]
    ok(ziel.name === name, `Zeile 51 ist „${name}“, erwartet „${ziel.name}“`)
    const [anfrage] = await Promise.all([
      page.waitForRequest(r => r.method() === 'POST' && r.url().includes('/neu-berechnen')),
      erste.getByRole('button', { name: /neu berechnen/ }).click(),
    ])
    ok(anfrage.url().includes(`/projekt/${ziel.id}/neu-berechnen`), `Anfrage: ${anfrage.url()}, erwartet ${ziel.id}`)
  }

  features.p10f2 = async () => {
    await anmelden('e2e-a@example.org')
    const token = await neuesToken()
    const pid = await projektId(token, 'E2E P8 Zahlen')
    let nr = 0
    const schreiben = async neu => {
      const { fehler, inhalt } = await werkzeug(token, 'doc_edit', { project_id: pid, pfad: 'main.tex', neu, idempotenz_schluessel: `p10f2-${Date.now()}-${nr++}` })
      ok(!fehler, `doc_edit: ${JSON.stringify(inhalt)}`)
      return inhalt.zahlen_ohne_beleg
    }
    const zeit = await schreiben('\nDie Sitzung begann um 9 Uhr und endete um 9.30 Uhr, ausgewertet mit Python 3.12, R 4.3.1 und SPSS 29, gesetzt mit LaTeX2e.\n')
    ok(JSON.stringify(zeit) === '[]', `Uhrzeiten und Versionen gemeldet: ${JSON.stringify(zeit)}`)
    const werte = await schreiben('\nVon 240 Befragten antworteten 37,5 Prozent; der Mittelwert lag bei 3.14 und 12,5 von 1.250 Fällen fehlten.\n')
    ok(JSON.stringify([...werte].sort()) === JSON.stringify(['1.250', '12,5', '240', '3.14', '37,5']), `Gemeldet: ${JSON.stringify(werte)}`)
    await werkzeug(token, 'run_finish', { project_id: pid, zusammenfassung: 'Uhrzeiten geprüft.' })
  }

  features.p10f4 = async () => {
    await breite(1280)
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E P8 DOI')
    await page.locator('.cm-content').waitFor({ timeout: 60000 })
    await railTab(DATEIBAUM).click()
    ok((await page.title()) === 'E2E P8 DOI – spur', `Titel im Editor: „${await page.title()}“`)
    const ENGLISCH = ['Resize', 'Close dialog', 'More actions', 'Project files history', 'Project history and labels', 'Toggle navigation']
    const englischeAttribute = async () =>
      await page.evaluate(
        woerter => [...document.querySelectorAll('[title],[aria-label]')].flatMap(e => [e.getAttribute('title'), e.getAttribute('aria-label')]).filter(t => woerter.includes(t)),
        ENGLISCH
      )
    ok((await page.locator('[title="Größe ändern"]').count()) >= 1, 'Resizer ohne deutschen Tooltip')
    const imEditor = await englischeAttribute()
    ok(imEditor.length === 0, `Englische Attribute im Editor: ${imEditor}`)
    await page.getByRole('button', { name: 'Teilen' }).first().click()
    await page.getByRole('button', { name: 'Dialog schließen' }).first().waitFor()
    const imDialog = await englischeAttribute()
    ok(imDialog.length === 0, `Englische Attribute im Dialog: ${imDialog}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Dialog schließen' }).first().waitFor({ state: 'detached' })
    const baum = page.getByRole('button', { name: 'Dateibaum ausblenden', exact: true })
    await baum.waitFor()
    ok((await baum.getAttribute('aria-label')) === 'Dateibaum ausblenden', 'aria-label des Knopfs')
    await page.goto(`${BASE}/project`)
    await page.getByPlaceholder(/^Suche in allen Projekten…$/).filter({ visible: true }).first().waitFor({ timeout: 30000 })
    ok((await page.title()) === 'Deine Projekte – spur', `Titel der Projektliste: „${await page.title()}“`)

    await projektOeffnen('E2E Kaputt')
    await page.getByRole('button', { name: KOMPILIEREN }).first().click()
    await page.getByText('Rohprotokoll', { exact: true }).first().waitFor({ state: 'attached', timeout: 120000 })
    ok((await page.getByText(/^Raw logs?$/i).count()) === 0, 'Englisches „Raw Logs“ im Log-Bereich')
  }

  features.p10f6 = async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await anmelden('e2e-a@example.org')
    await projektOeffnen('E2E Bericht')
    await panelOeffnen('Prüfbericht')
    await page.locator('.spur-filter').waitFor({ timeout: 30000 })
    const knoepfe = () =>
      page.locator('.spur-filter label').evaluateAll(l =>
        l.map(e => {
          const r = e.getBoundingClientRect()
          return { text: e.textContent, x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.width), abgeschnitten: e.scrollWidth > e.clientWidth + 1 }
        })
      )
    const ziehen = async ziel => {
      const hb = await page.getByRole('separator').first().boundingBox()
      await page.mouse.move(hb.x + hb.width / 2, 500)
      await page.mouse.down()
      await page.mouse.move(ziel, 500, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(800)
    }
    await ziehen(250)
    const schmal = await knoepfe()
    ok(schmal.length === 4 && !schmal.some(k => k.abgeschnitten), `Schmal abgeschnitten: ${JSON.stringify(schmal)}`)
    ok(new Set(schmal.map(k => k.y)).size === 2 && new Set(schmal.map(k => k.b)).size <= 2 && Math.abs(schmal[0].b - schmal[1].b) <= 2, `Schmal kein 2×2-Raster: ${JSON.stringify(schmal)}`)
    await ziehen(470)
    const breit = await knoepfe()
    ok(new Set(breit.map(k => k.y)).size === 1 && !breit.some(k => k.abgeschnitten), `Breit nicht in einer Zeile: ${JSON.stringify(breit)}`)
    // Pfeiltasten wechseln den Filter.
    await page.getByRole('radio', { name: /^Alle/ }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('radio', { name: /^Markiert/, checked: true }).waitFor()
    for (const schema of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: schema })
      const farben = await page.locator('.spur-filter .btn-check:checked + label').evaluate(el => {
        const cs = getComputedStyle(el)
        return [cs.color, cs.backgroundColor]
      })
      const hell = c => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const [a, b] = farben.map(hell).sort((x, y) => y - x)
      ok((a + 0.05) / (b + 0.05) >= 4.5, `Kontrast des aktiven Filters (${schema}): ${farben}`)
    }
    await page.emulateMedia({ colorScheme: null })
  }

  // Jeder Lauf beginnt auf denselben Daten, auch nach einem früheren Lauf.
  const bereit = await page.request.post(`${BASE}/spur/dev/e2e/vorbereiten`, { timeout: 300000 })
  if (bereit.status() !== 204) return `vorbereiten FEHLER: ${bereit.status()} ${await bereit.text()}`
  const ergebnis = []
  for (const [id, lauf] of Object.entries(features)) {
    if (nur.length && !nur.includes(id)) continue
    konsolenFehler.length = 0
    konsolenMeldungen.length = 0
    // Ein abgebrochener Schritt kann eine angehaltene Route hinterlassen; sie hielte jede spätere Anfrage fest.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    try {
      await lauf()
      ok(konsolenFehler.length === 0, `Fehler: ${konsolenFehler.join(' | ')}`)
      ergebnis.push(`${id} ok`)
    } catch (error) {
      // Die Zeile im Stapel hilft beim Finden des Schritts (run-code liefert keine Dateinamen).
      const stelle = (error.stack ?? '').split('\n').filter(z => /<anonymous>:\d+/.test(z)).slice(0, 6).map(z => z.match(/:(\d+):\d+\)?$/)?.[1]).join(' < ')
      ergebnis.push(`${id} FEHLER: ${error.message}${stelle ? ` (Zeilen ${stelle})` : ''}`)
    }
  }
  page.off('pageerror', beiFehler)
  return ergebnis.join('\n')
}
