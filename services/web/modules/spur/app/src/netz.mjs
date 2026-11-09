// Gemeinsamer Schutz vor SSRF für Anfragen an Adressen, die Nutzer oder Dritte vorgeben.
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Problem } from './probleme.mjs'

export const gesperrtFehler = () =>
  new Problem(
    422,
    'adresse_gesperrt',
    'spur_fehler_adresse_gesperrt'
  )

// Nicht öffentlich erreichbare Netze. BlockList prüft IPv4-gemappte IPv6-Adressen (::ffff:…) in
// jeder Schreibweise gegen die IPv4-Regeln.
const GESPERRT = new net.BlockList()
for (const [netz, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]) {
  GESPERRT.addSubnet(netz, bits, 'ipv4')
}
for (const [netz, bits] of [
  ['::', 96], // unbestimmt, Loopback und alte IPv4-kompatible Adressen
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  GESPERRT.addSubnet(netz, bits, 'ipv6')
}

export function adresseGesperrt(ip) {
  return GESPERRT.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4')
}

// GET-Anfrage, die nur an erlaubte Adressen verbindet. Geprüft wird die Adresse, mit der sich der
// Socket wirklich verbindet, nicht eine frühere Auflösung (DNS-Rebinding). Liefert die IncomingMessage.
// Ein gesperrtes Ziel lehnt die Anfrage mit `gesperrtFehler()` ab, andere Fehler kommen unverändert.
export function geschuetztHolen(url, { gesperrt = adresseGesperrt, signal, headers = {}, lookup = dns.lookup } = {}) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && gesperrt(host)) return Promise.reject(gesperrtFehler())
  const geprueft = (name, optionen, fertig) =>
    lookup(name, optionen, (error, adresse, familie) => {
      if (error) return fertig(error)
      const liste = Array.isArray(adresse) ? adresse : [{ address: adresse }]
      if (liste.some(a => gesperrt(a.address))) return fertig(gesperrtFehler())
      fertig(null, adresse, familie)
    })
  const modul = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    modul.get(url, { lookup: geprueft, signal, headers }, resolve).on('error', reject)
  })
}
