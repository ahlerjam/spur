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
  const inhalt = /json/.test(typ) ? await antwort.json() : null
  if (!antwort.ok) {
    throw new ApiFehler(inhalt?.detail ?? antwort.statusText, antwort.status, inhalt)
  }
  return inhalt as T
}

export const jsonAnfrage = <T>(methode: string, pfad: string, daten?: unknown) =>
  anfrage<T>(pfad, {
    method: methode,
    body: daten === undefined ? undefined : JSON.stringify(daten),
  })
