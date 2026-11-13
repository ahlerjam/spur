import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { anfrage, projektPfad } from '../api'
import { useSeite, type Seite } from './seite'
import SeitenBlaettern from './seiten-blaettern'
import SeitenzahlBestaetigen from './seitenzahl-bestaetigen'
import Zitate from './zitate'
import { anzeigename, datumLang, OCR_SICHER_AB, type Quelle } from './typen'

// Prozent der Bereichsbreite; 100 heißt „An Breite anpassen“.
const ZOOM = [50, 75, 100, 125, 150, 200, 250, 300]
const BREITE = ZOOM.indexOf(100)
// Seitenverhältnis von US Letter, bis die Textebene das echte liefert.
const SEITENVERHAELTNIS = 792 / 612

type TextEbene = { breite: number | null; hoehe: number | null; zeilen: { x: number; y: number; b: number; h: number; text: string }[] }

const leisteSchluessel = () => `spur-gross-seitenleiste:${getMeta('ol-user_id')}`

function leisteGemerkt() {
  try {
    return window.localStorage.getItem(leisteSchluessel()) !== 'zu'
  } catch {
    return true
  }
}

function leisteMerken(offen: boolean) {
  try {
    window.localStorage.setItem(leisteSchluessel(), offen ? 'auf' : 'zu')
  } catch {
    // Ohne Speicher gilt der Zustand nur bis zum Schließen.
  }
}

const imEingabefeld = (ziel: EventTarget | null) =>
  ziel instanceof HTMLElement && (ziel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ziel.tagName))

// Durchsichtiger Text über dem Bild: markierbar und für Screenreader lesbar, ohne zweite Kopie daneben.
function TextUeberBild({ ebene, massstab, setTextElement }: { ebene: TextEbene; massstab: number; setTextElement: (el: HTMLElement | null) => void }) {
  const wurzel = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    for (const zeile of wurzel.current?.querySelectorAll<HTMLElement>('[data-breite]') ?? []) {
      zeile.style.transform = ''
      const ist = zeile.getBoundingClientRect().width
      if (ist > 0) zeile.style.transform = `scaleX(${Number(zeile.dataset.breite) / ist})`
    }
  }, [ebene, massstab])
  return (
    <div
      className="spur-textebene spur-seitentext"
      ref={el => {
        wurzel.current = el
        setTextElement(el)
      }}
    >
      {ebene.zeilen.map((zeile, i) => (
        <span
          key={i}
          data-breite={zeile.b * massstab}
          style={{ left: zeile.x * massstab, top: zeile.y * massstab, fontSize: zeile.h * massstab * 0.88 }}
        >
          {zeile.text}
          {/* Zwischen den Zeilen ein Leerzeichen, damit markierter Text keine Wörter verklebt. */}{' '}
        </span>
      ))}
    </div>
  )
}

function Seitenbereich({
  quelle,
  nummer,
  zuletzt,
  zoom,
  setTextElement,
}: {
  quelle: Quelle
  nummer: number
  zuletzt: Seite | null
  zoom: number
  setTextElement: (el: HTMLElement | null) => void
}) {
  const { t } = useTranslation()
  const flaeche = useRef<HTMLDivElement>(null)
  const [bereich, setBereich] = useState(0)
  const [ebenen, setEbenen] = useState<Record<number, TextEbene>>({})
  const [angezeigt, setAngezeigt] = useState<{ src: string; nummer: number } | null>(null)
  const [fehler, setFehler] = useState<number | null>(null)
  const [versuch, setVersuch] = useState(0)

  useLayoutEffect(() => {
    const el = flaeche.current
    if (!el) return
    const messen = () => {
      const stil = getComputedStyle(el)
      setBereich(el.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight))
    }
    messen()
    const beobachter = new ResizeObserver(messen)
    beobachter.observe(el)
    return () => beobachter.disconnect()
  }, [])

  useEffect(() => {
    if (ebenen[nummer]) return
    let aktuell = true
    anfrage<TextEbene>(projektPfad(`/quellen/${quelle.id}/seiten/${nummer}/textebene`))
      .then(ebene => aktuell && setEbenen(alt => ({ ...alt, [nummer]: ebene })))
      .catch(() => aktuell && setEbenen(alt => ({ ...alt, [nummer]: { breite: null, hoehe: null, zeilen: [] } })))
    return () => {
      aktuell = false
    }
  }, [quelle.id, nummer, ebenen])

  const seitenBreite = Math.max(1, Math.round((bereich * zoom) / 100))
  // So viele Pixel wie Gerätepixel, damit die Schrift beim Zoomen scharf bleibt.
  // In Schritten von 200 px wie der Server: Kleine Breitenänderungen behalten dieselbe Adresse und den Cache.
  const pixel = Math.min(4800, Math.ceil((seitenBreite * (window.devicePixelRatio || 1)) / 200) * 200)
  const src = projektPfad(`/quellen/${quelle.id}/seiten/${nummer}/bild?breite=${pixel}${versuch ? `&versuch=${versuch}` : ''}`)

  // Das alte Bild bleibt stehen, bis das neue geladen ist; so springt beim Blättern und Zoomen nichts.
  useEffect(() => {
    if (!bereich) return
    let aktuell = true
    const bild = new Image()
    bild.onload = () => {
      if (!aktuell) return
      setFehler(null)
      setAngezeigt(alt => {
        if (alt?.nummer !== nummer) flaeche.current?.scrollTo({ top: 0, left: 0 })
        return { src, nummer }
      })
    }
    bild.onerror = () => aktuell && setFehler(nummer)
    bild.src = src
    return () => {
      aktuell = false
    }
  }, [src, nummer, bereich])

  const anzeige = angezeigt ?? null
  const ebene = anzeige ? ebenen[anzeige.nummer] : undefined
  const verhaeltnis = ebene?.breite && ebene.hoehe ? ebene.hoehe / ebene.breite : SEITENVERHAELTNIS
  const seitenText = zuletzt?.seite === nummer ? zuletzt.text : ''

  return (
    <div className="spur-gross-bild" ref={flaeche} tabIndex={0} aria-label={t('spur_seitenbild')}>
      {fehler === nummer ? (
        <div className="spur-seite-fehler" style={{ width: seitenBreite }}>
          <Notification
            type="warning"
            content={
              <>
                <p className="mb-2">{t('spur_seite_nicht_geladen')}</p>
                <OLButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Beim neuen Versuch steht der Platzhalter in Seitengröße, bis das Bild da ist.
                    setFehler(null)
                    setAngezeigt(null)
                    setVersuch(versuch + 1)
                  }}
                >
                  {t('spur_erneut_versuchen')}
                </OLButton>
              </>
            }
          />
          {seitenText && <pre className="spur-seitentext spur-seitentext-ersatz" ref={setTextElement}>{seitenText}</pre>}
        </div>
      ) : anzeige ? (
        <div className="spur-gross-seite" style={{ width: seitenBreite }}>
          <img
            className="spur-seitenbild"
            src={anzeige.src}
            alt={t('spur_seite_von', { seite: anzeige.nummer, gesamt: quelle.seitenzahl })}
          />
          {ebene && ebene.breite && ebene.zeilen.length > 0 && (
            <TextUeberBild ebene={ebene} massstab={seitenBreite / ebene.breite} setTextElement={setTextElement} />
          )}
        </div>
      ) : (
        <div
          className="spur-gross-seite spur-seite-platzhalter"
          role="status"
          aria-label={t('spur_seite_laedt')}
          style={{ width: seitenBreite, height: seitenBreite * verhaeltnis }}
        />
      )}
    </div>
  )
}

function Angaben({ quelle }: { quelle: Quelle }) {
  const { t } = useTranslation()
  const zeilen: [string, string][] = [
    [t('spur_titel'), quelle.titel ?? anzeigename(quelle)],
    [t('spur_autoren'), (quelle.autoren ?? []).join(', ')],
    [t('spur_jahr'), quelle.jahr ? String(quelle.jahr) : ''],
    [t('spur_doi'), quelle.doi ?? ''],
    [t('spur_datei'), quelle.dateiname],
    [t('spur_umfang'), t(quelle.art === 'pdf' ? 'spur_seiten' : 'spur_abschnitte', { count: quelle.seitenzahl })],
  ]
  return (
    <dl className="spur-angaben">
      {zeilen
        .filter(([, wert]) => wert)
        .map(([name, wert]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{wert}</dd>
          </div>
        ))}
    </dl>
  )
}

function OcrHinweis({ quelle, seite }: { quelle: Quelle; seite: Seite | null }) {
  const { t } = useTranslation()
  if (!seite || quelle.status !== 'ocr') return null
  return (
    <p className="spur-ocr-hinweis">
      {seite.ocrKonfidenz != null && seite.ocrKonfidenz < OCR_SICHER_AB
        ? t('spur_ocr_seite_unsicher', { konfidenz: seite.ocrKonfidenz })
        : t('spur_ocr_seite')}
    </p>
  )
}

export default function QuelleGross({
  quelle,
  startSeite,
  schliessen,
}: {
  quelle: Quelle
  startSeite: number
  schliessen: (nummer: number) => void
}) {
  const { t, i18n } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [nummer, setNummer] = useState(startSeite)
  const [stufe, setStufe] = useState(BREITE)
  const [leisteOffen, setLeisteOffen] = useState(leisteGemerkt)
  const [textElement, setTextElement] = useState<HTMLElement | null>(null)
  const { seite, zuletzt, fehler } = useSeite(quelle.id, nummer)
  const mitBild = quelle.art === 'pdf'
  const zoom = ZOOM[stufe]
  const zu = () => schliessen(nummer)

  const blaettern = useCallback(
    (richtung: number) => setNummer(n => Math.min(quelle.seitenzahl, Math.max(1, n + richtung))),
    [quelle.seitenzahl]
  )
  const zoomen = useCallback((richtung: number) => setStufe(s => Math.min(ZOOM.length - 1, Math.max(0, s + richtung))), [])

  useEffect(() => {
    if (quelle.web) return
    const taste = (e: KeyboardEvent) => {
      if (imEingabefeld(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
      const aktion = {
        ArrowLeft: () => blaettern(-1),
        PageUp: () => blaettern(-1),
        ArrowRight: () => blaettern(1),
        PageDown: () => blaettern(1),
        '+': () => mitBild && zoomen(1),
        '=': () => mitBild && zoomen(1),
        '-': () => mitBild && zoomen(-1),
        '0': () => mitBild && setStufe(BREITE),
      }[e.key]
      if (!aktion) return
      e.preventDefault()
      aktion()
    }
    document.addEventListener('keydown', taste)
    return () => document.removeEventListener('keydown', taste)
  }, [quelle.web, mitBild, blaettern, zoomen])

  const leisteUmschalten = () => {
    leisteMerken(!leisteOffen)
    setLeisteOffen(!leisteOffen)
  }

  const herunterladen = !quelle.web && (
    <OLButton variant="secondary" size="sm" href={projektPfad(`/quellen/${quelle.id}/datei`)} download={quelle.dateiname}>
      <MaterialIcon type="download" /> {t('spur_original_herunterladen')}
    </OLButton>
  )

  const textSeite = seite ?? zuletzt
  const zitate = textSeite?.text.trim() ? (
    <Zitate quelle={quelle} seite={textSeite.seite} textElement={textElement} ueberschrift="h3" />
  ) : null

  // Webseiten und Transkripte: Text einspaltig in voller Breite, Zitate darunter.
  if (!mitBild) {
    return (
      <OLModal themed show onHide={zu} className="spur-gross">
        <OLModalHeader closeButton={false}>
          <OLModalTitle as="h2">{anzeigename(quelle)}</OLModalTitle>
          {herunterladen}
          <OLButton variant="secondary" size="sm" onClick={zu}>
            {t('close')}
          </OLButton>
        </OLModalHeader>
        {!quelle.web && (
          <div className="spur-gross-werkzeuge">
            <SeitenBlaettern quelle={quelle} nummer={nummer} seite={seite} setNummer={setNummer} />
          </div>
        )}
        <OLModalBody className="spur-gross-inhalt spur-gross-einspaltig">
          {quelle.web && (
            <p className="spur-zeile-meta">
              {t('spur_schnappschuss_von', { url: quelle.web.url })}
              {' · '}
              {t('spur_abgerufen_am', { datum: datumLang(quelle.web.abgerufenAm, i18n.language) })}
            </p>
          )}
          {fehler && <Notification type="warning" content={fehler} />}
          {textSeite?.text.trim() ? (
            <pre className="spur-seitentext" ref={setTextElement}>
              {textSeite.text}
            </pre>
          ) : (
            textSeite && <p className="spur-leer">{t('spur_kein_text')}</p>
          )}
          {zitate}
        </OLModalBody>
      </OLModal>
    )
  }

  return (
    <OLModal themed show onHide={zu} className="spur-gross">
      <OLModalHeader closeButton={false}>
        <OLModalTitle as="h2">{anzeigename(quelle)}</OLModalTitle>
        {herunterladen}
        <OLButton variant="secondary" size="sm" onClick={zu}>
          {t('close')}
        </OLButton>
      </OLModalHeader>
      <div className="spur-gross-werkzeuge">
        <SeitenBlaettern quelle={quelle} nummer={nummer} seite={seite} setNummer={setNummer} />
        <div className="spur-zoom" role="group" aria-label={t('spur_zoom')}>
          <OLIconButton
            variant="ghost"
            size="sm"
            icon="zoom_out"
            accessibilityLabel={t('spur_verkleinern')}
            disabled={stufe === 0}
            onClick={() => zoomen(-1)}
          />
          <span className="spur-zoom-wert" aria-live="polite">
            {zoom} %
          </span>
          <OLIconButton
            variant="ghost"
            size="sm"
            icon="zoom_in"
            accessibilityLabel={t('spur_vergroessern')}
            disabled={stufe === ZOOM.length - 1}
            onClick={() => zoomen(1)}
          />
          <OLButton variant="ghost" size="sm" disabled={stufe === BREITE} onClick={() => setStufe(BREITE)}>
            {t('spur_an_breite')}
          </OLButton>
        </div>
        <OLButton
          variant="ghost"
          size="sm"
          className="spur-leiste-knopf"
          aria-expanded={leisteOffen}
          aria-controls="spur-gross-leiste"
          onClick={leisteUmschalten}
        >
          <MaterialIcon type={leisteOffen ? 'right_panel_close' : 'right_panel_open'} />{' '}
          {t(leisteOffen ? 'spur_seitenleiste_aus' : 'spur_seitenleiste_ein')}
        </OLButton>
      </div>
      <OLModalBody className={`spur-gross-inhalt${leisteOffen ? '' : ' spur-leiste-zu'}`}>
        <div className="spur-gross-hauptteil">
          {fehler && <Notification type="warning" content={fehler} />}
          <Seitenbereich quelle={quelle} nummer={nummer} zuletzt={zuletzt} zoom={zoom} setTextElement={setTextElement} />
          {quelle.status === 'ocr' && textSeite?.text.trim() && (
            <details className="spur-erkannt">
              <summary>{t('spur_erkannter_text')}</summary>
              <pre className="spur-seitentext" ref={setTextElement}>
                {textSeite.text}
              </pre>
            </details>
          )}
        </div>
        <aside id="spur-gross-leiste" className="spur-gross-leiste" hidden={!leisteOffen} aria-label={t('spur_angaben')}>
          <h3 className="spur-abschnitt">{t('spur_angaben')}</h3>
          <Angaben quelle={quelle} />
          <OcrHinweis quelle={quelle} seite={textSeite} />
          {darfSchreiben && seite && seite.text.trim() && (
            <SeitenzahlBestaetigen key={nummer} quelle={quelle} pdfSeite={nummer} label={seite.label} />
          )}
          {zitate}
        </aside>
      </OLModalBody>
    </OLModal>
  )
}
