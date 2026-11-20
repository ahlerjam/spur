// Fake des TeX-Live-Archivs für Tests (nur mit SPUR_DEV=1, unter dem Paper-Fake eingehängt): baut <paket>.tar.xz
// zur Anfrage aus den Dateien unter test/fixtures/texlive/<paket>/. Drei Pakete gibt es nur hier: eins mit einem
// Eintrag außerhalb des Archivs (spurtest-ausbruch), eins über 100 MB (spurtest-riesig, nur der Header) und eins
// mit 30 MB entpackt (spurtest-gross). Die Paketdatenbank (tlpkg/texlive.tlpdb.xz) entsteht aus denselben Ordnern.
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const FIXTURES = fileURLToPath(new URL('../../../test/fixtures/texlive/', import.meta.url))
const MB = 1024 * 1024
const RIESIG = 101 * MB
const GROSS_ORDNER = Path.join(os.tmpdir(), 'spur-texlive-fake', 'spurtest-gross')
const GROSS_DATEI = 'fonts/opentype/public/spurtest-gross/spurtestgross.otf'

function archiv(res, argumente) {
  res.type('application/x-xz')
  const tar = spawn('tar', ['-cJf', '-', ...argumente])
  tar.stdout.pipe(res)
}

async function grossVorbereiten() {
  const datei = Path.join(GROSS_ORDNER, GROSS_DATEI)
  if ((await stat(datei).catch(() => null))?.size === 30 * MB) return
  await mkdir(Path.dirname(datei), { recursive: true })
  await writeFile(datei, Buffer.alloc(30 * MB))
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
  if (paket === 'spurtest-gross') {
    await grossVorbereiten()
    return archiv(res, ['-C', GROSS_ORDNER, 'fonts'])
  }
  const inhalt = paket && (await readdir(`${FIXTURES}${paket}`).catch(() => null))
  if (!inhalt) return res.sendStatus(404)
  archiv(res, ['-C', `${FIXTURES}${paket}`, ...inhalt])
}

async function dateienUnter(ordner, pfad = '') {
  const eintraege = await readdir(Path.join(ordner, pfad), { withFileTypes: true })
  const listen = await Promise.all(
    eintraege.map(e => (e.isDirectory() ? dateienUnter(ordner, Path.join(pfad, e.name)) : [Path.join(pfad, e.name)]))
  )
  return listen.flat()
}

export async function texLiveDatenbankFake(req, res) {
  const pakete = (await readdir(FIXTURES, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)
  const bloecke = await Promise.all(
    pakete.map(async paket => {
      const laufzeit = (await dateienUnter(`${FIXTURES}${paket}`)).filter(p => !p.startsWith('tlpkg/'))
      return `name ${paket}\nrunfiles size=1\n${laufzeit.map(p => ` RELOC/${p}`).join('\n')}\n`
    })
  )
  res.type('application/x-xz')
  const xz = spawn('xz', ['-c'])
  xz.stdout.pipe(res)
  xz.stdin.end(bloecke.join('\n'))
}
