// Nur mit SPUR_DEV=1 eingehängt (SpurRouter): Die E2E-Suite schaltet Mail ein (Settings.email zeigt dann auf
// einen SMTP-Empfänger im Prozess) und liest, was angekommen ist. Ausgeschaltet gilt wieder die echte Einrichtung.
import net from 'node:net'
import Settings from '@overleaf/settings'

let zustand = null

function empfaenger(mails) {
  return net.createServer(verbindung => {
    let puffer = ''
    let mail = null
    let imText = false
    const antworten = zeile => verbindung.write(`${zeile}\r\n`)
    antworten('220 spur-mail-fake')
    verbindung.on('data', stueck => {
      puffer += stueck.toString('utf8')
      let ende
      while ((ende = puffer.indexOf('\r\n')) >= 0) {
        const zeile = puffer.slice(0, ende)
        puffer = puffer.slice(ende + 2)
        if (imText) {
          if (zeile === '.') {
            imText = false
            mails.push(mail)
            antworten('250 OK')
          } else {
            mail.text += `${zeile.replace(/^\./, '')}\n`
          }
          continue
        }
        const befehl = zeile.slice(0, 4).toUpperCase()
        if (befehl === 'EHLO' || befehl === 'HELO') antworten('250 spur-mail-fake')
        else if (befehl === 'MAIL') (mail = { an: [], text: '' }), antworten('250 OK')
        else if (befehl === 'RCPT') mail.an.push(zeile.match(/<([^>]*)>/)?.[1]), antworten('250 OK')
        else if (befehl === 'DATA') (imText = true), antworten('354 Weiter')
        else if (befehl === 'QUIT') antworten('221 Tschüss'), verbindung.end()
        else antworten('250 OK')
      }
    })
    verbindung.on('error', () => {})
  })
}

export async function mailFakeAus() {
  if (!zustand) return
  Settings.email = zustand.original
  await new Promise(fertig => zustand.server.close(fertig))
  zustand = null
}

async function mailFakeAn() {
  if (zustand) return
  const mails = []
  const server = empfaenger(mails)
  await new Promise(fertig => server.listen(0, '127.0.0.1', fertig))
  zustand = { server, mails, original: Settings.email }
  Settings.email = {
    fromAddress: 'spur@example.org',
    parameters: { host: '127.0.0.1', port: server.address().port, ignoreTLS: true },
  }
}

export async function mailFakeSteuern(req, res) {
  const { an } = req.body ?? {}
  if (typeof an !== 'boolean') return res.status(422).json({ detail: 'an muss true oder false sein.' })
  await (an ? mailFakeAn() : mailFakeAus())
  res.sendStatus(204)
}

export function mailFakeLesen(_req, res) {
  res.json({ mails: zustand?.mails ?? [] })
}
