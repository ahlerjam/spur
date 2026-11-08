import Path from 'node:path'
import { setTimeout as warten } from 'node:timers/promises'
import { ablageWurzel } from '../QuellenManager.mjs'
import { fakeEmbeddings } from '../schalter.mjs'

export const DIMENSIONEN = 384
export const MODELL = 'Xenova/multilingual-e5-small'
export const modellOrdner = () => Path.join(Path.dirname(ablageWurzel()), 'spur-modelle')

function normieren(vektor) {
  const laenge = Math.hypot(...vektor) || 1
  return vektor.map(x => x / laenge)
}

// Testersatz: Zeichen-Trigramme in 384 Fächern. Ähnliche Wortstämme landen nah beieinander.
export function fakeVektor(text) {
  const vektor = new Float32Array(DIMENSIONEN)
  const woerter = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  for (const wort of woerter) {
    const rand = ` ${wort} `
    for (let i = 0; i + 3 <= rand.length; i++) {
      let h = 2166136261
      for (const c of rand.slice(i, i + 3)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
      vektor[(h >>> 0) % DIMENSIONEN] += 1
    }
  }
  return normieren(vektor)
}

let pipelineVersprechen = null

// Das echte Modell lädt erst beim ersten Gebrauch in das Daten-Volume.
async function echteEinbettung(text) {
  pipelineVersprechen ??= import('@huggingface/transformers').then(({ env, pipeline }) => {
    env.cacheDir = modellOrdner()
    env.allowRemoteModels = true
    return pipeline('feature-extraction', MODELL, { dtype: 'q8' })
  })
  const extraktor = await pipelineVersprechen
  const ausgabe = await extraktor(text, { pooling: 'mean', normalize: true })
  return Float32Array.from(ausgabe.data)
}

// Der Fake ist sofort fertig; die Pause je Passage macht den Fortschritt im Test sichtbar.
export const fakePause = { ms: 1000 }

// e5 erwartet die Präfixe „query:“ und „passage:“.
export async function einbetten(text, art) {
  if (fakeEmbeddings()) {
    if (art === 'passage' && fakePause.ms) await warten(fakePause.ms)
    return fakeVektor(text)
  }
  return await echteEinbettung(`${art}: ${text}`)
}

export function aehnlichkeit(a, b) {
  let summe = 0
  for (let i = 0; i < a.length; i++) summe += a[i] * b[i]
  return summe
}
