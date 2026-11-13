import moment from 'moment'
// spur: Daten im Verlauf in der Sprache der Oberfläche (Deutsch und Englisch), wie utils/dates.ts.
import 'moment/locale/de'
import getMeta from '@/utils/meta'

moment.updateLocale('en', {
  calendar: {
    lastDay: '[Yesterday]',
    sameDay: '[Today]',
    nextDay: '[Tomorrow]',
    lastWeek: 'ddd, Do MMM YY',
    nextWeek: 'ddd, Do MMM YY',
    sameElse: 'ddd, Do MMM YY',
  },
})
moment.updateLocale('de', {
  calendar: {
    lastDay: '[Gestern]',
    sameDay: '[Heute]',
    nextDay: '[Morgen]',
    lastWeek: 'ddd, D. MMM YY',
    nextWeek: 'ddd, D. MMM YY',
    sameElse: 'ddd, D. MMM YY',
  },
})
// Das Laden einer Locale macht sie global; jede Funktion hier wählt die Sprache selbst.
moment.locale('en')

const sprache = () => getMeta('ol-i18n')?.currentLangCode ?? 'en'

// Deutsch zeigt Uhrzeiten ohne am/pm: „h:mm a“ wird „H:mm“.
const auf24Stunden = (format: string) =>
  sprache() === 'de' ? format.replace(/\bh:mm a\b/, 'H:mm') : format

export function formatTime(
  date: moment.MomentInput,
  format = 'h:mm a',
  utc = false
) {
  const momentDate = utc ? moment.utc(date) : moment(date)
  return momentDate.locale(sprache()).format(auf24Stunden(format))
}

export function relativeDate(date: moment.MomentInput) {
  return moment(date).locale(sprache()).calendar()
}

export function formatTimeBasedOnYear(date: moment.MomentInput) {
  const currentDate = moment()

  // Deutsch setzt nach dem Tag einen Punkt: „13. November“.
  const tag = sprache() === 'de' ? 'D.' : 'D'
  return currentDate.diff(date, 'years') > 0
    ? formatTime(date, `${tag} MMMM YYYY, h:mm a`)
    : formatTime(date, `${tag} MMMM, h:mm a`)
}
