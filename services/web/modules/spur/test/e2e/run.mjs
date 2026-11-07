// `make e2e`: führt spur-e2e.js gegen den laufenden Stack aus. SPUR_URL ändert die Adresse.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const quelle = readFileSync(new URL('./spur-e2e.js', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
globalThis.SPUR_URL = process.env.SPUR_URL
// eslint-disable-next-line no-eval
const ergebnis = await eval(`(${quelle})`)(page)
await browser.close()
console.log(ergebnis)
process.exit(/FEHLER/.test(ergebnis) ? 1 : 0)
