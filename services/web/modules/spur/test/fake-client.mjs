// Fake-Client für die MCP-Schnittstelle, ersetzt Claude Code in Tests.
// Aufruf: SPUR_TOKEN=… node services/web/modules/spur/test/fake-client.mjs wait [max_sekunden]
//         … events [cursor] | reply <project_id> <text>
// Gibt je Nachricht eine JSON-Zeile mit Sekunden seit Start aus.
const BASIS = process.env.SPUR_URL || 'http://localhost:8080'
const TOKEN = process.env.SPUR_TOKEN
const start = Date.now()

function ausgeben(art, daten) {
  console.log(JSON.stringify({ s: Math.round((Date.now() - start) / 100) / 10, art, daten }))
}

async function aufruf(name, args, meta) {
  const antwort = await fetch(`${BASIS}/spur/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: meta },
    }),
  })
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}: ${await antwort.text()}`)
  const dekodierer = new TextDecoder()
  let puffer = ''
  let ergebnis = null
  for await (const teil of antwort.body) {
    puffer += dekodierer.decode(teil, { stream: true })
    for (let i = puffer.indexOf('\n\n'); i >= 0; i = puffer.indexOf('\n\n')) {
      const block = puffer.slice(0, i)
      puffer = puffer.slice(i + 2)
      const daten = block
        .split('\n')
        .filter(z => z.startsWith('data:'))
        .map(z => z.slice(5))
        .join('')
      if (!daten) continue
      const nachricht = JSON.parse(daten)
      if (nachricht.method === 'notifications/progress') {
        ausgeben('fortschritt', nachricht.params.message)
      } else if (nachricht.result) {
        ergebnis = JSON.parse(nachricht.result.content[0].text)
        ausgeben('ergebnis', ergebnis)
      }
    }
  }
  return ergebnis
}

const [befehl, ...rest] = process.argv.slice(2)
if (!TOKEN) {
  console.error('SPUR_TOKEN fehlt')
  process.exit(2)
}
try {
  if (befehl === 'wait') {
    await aufruf('wait_for_event', { max_sekunden: Number(rest[0] ?? 1800) }, { progressToken: 'fake' })
  } else if (befehl === 'events') {
    await aufruf('events_since', rest[0] ? { cursor: rest[0] } : {})
  } else if (befehl === 'reply') {
    await aufruf('reply', { project_id: rest[0], text: rest.slice(1).join(' ') })
  } else {
    console.error('Befehle: wait [max_sekunden] | events [cursor] | reply <project_id> <text>')
    process.exit(2)
  }
} catch (error) {
  ausgeben('fehler', error.message)
  process.exit(1)
}
