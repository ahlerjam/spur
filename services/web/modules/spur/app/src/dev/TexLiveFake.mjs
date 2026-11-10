// Fake des TeX-Live-Archivs für Tests (nur mit SPUR_DEV=1): baut <paket>.tar.xz zur Anfrage aus den Textdateien
// unter test/fixtures/texlive/<paket>/. Zwei Pakete gibt es nur hier: eins mit einem Eintrag außerhalb des Archivs
// (spurtest-ausbruch) und eins über 20 MB (spurtest-riesig).
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const FIXTURES = fileURLToPath(new URL('../../../test/fixtures/texlive/', import.meta.url))
const RIESIG = 21 * 1024 * 1024

function archiv(res, argumente) {
  res.type('application/x-xz')
  const tar = spawn('tar', ['-cJf', '-', ...argumente])
  tar.stdout.pipe(res)
}

export async function texLiveFake(req, res) {
  const paket = /^([a-z0-9_-]+)\.tar\.xz$/.exec(req.params.datei)?.[1]
  if (paket === 'spurtest-riesig') {
    res.set({ 'Content-Type': 'application/x-xz', 'Content-Length': String(RIESIG) })
    return Readable.from((function* () {
      for (let i = 0; i < RIESIG / 65536; i++) yield Buffer.alloc(65536)
    })()).pipe(res)
  }
  if (paket === 'spurtest-ausbruch') {
    return archiv(res, ['-P', '--transform', 's,^x$,../../etc/x,', '-C', `${FIXTURES}${paket}`, 'x'])
  }
  const inhalt = paket && (await readdir(`${FIXTURES}${paket}`).catch(() => null))
  if (!inhalt) return res.sendStatus(404)
  archiv(res, ['-C', `${FIXTURES}${paket}`, ...inhalt])
}
