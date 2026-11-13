import i18n from 'i18next'
import getMeta from '@/utils/meta'

export class ApiFehler extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly daten?: { fehler?: Record<string, string> }
  ) {
    super(message)
  }
}

export const projektPfad = (rest: string) =>
  `/spur/project/${getMeta('ol-project_id')}${rest}`

export async function anfrage<T>(pfad: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.method && init.method !== 'GET') {
    headers.set('X-Csrf-Token', getMeta('ol-csrfToken'))
  }
  if (typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  const antwort = await fetch(pfad, { ...init, headers })
  const typ = antwort.headers.get('Content-Type') ?? ''
  if (!/json/.test(typ)) {
    // spur antwortet immer mit JSON oder leer; eine andere Seite (meist HTML) kommt von einem Proxy oder Filter.
    if ((await antwort.text()).trim()) {
      throw new ApiFehler(proxySperreText(antwort.ok ? undefined : antwort.status), antwort.status)
    }
    if (!antwort.ok) throw new ApiFehler(antwort.statusText, antwort.status)
    return null as T
  }
  const inhalt = await antwort.json()
  if (!antwort.ok) {
    throw new ApiFehler(inhalt?.detail ?? antwort.statusText, antwort.status, inhalt)
  }
  return inhalt as T
}

export const proxySperreText = (status?: number) =>
  status ? i18n.t('spur_proxy_sperre_status', { status }) : i18n.t('spur_proxy_sperre')

export const jsonAnfrage = <T>(methode: string, pfad: string, daten?: unknown) =>
  anfrage<T>(pfad, {
    method: methode,
    body: daten === undefined ? undefined : JSON.stringify(daten),
  })
