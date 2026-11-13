import moment from 'moment'
// spur: relative Zeiten („vor 2 Tagen“) in der Sprache der Oberfläche; spur liefert Deutsch und Englisch.
import 'moment/locale/de'
import getMeta from '@/utils/meta'

const sprache = () => getMeta('ol-i18n')?.currentLangCode ?? 'en'

export function formatDate(date: moment.MomentInput, format?: string) {
  if (!date) return 'N/A'
  if (format == null) {
    format = 'Do MMM YYYY, h:mm a'
  }
  return moment(date).format(format)
}

export function fromNowDate(date: moment.MomentInput | string) {
  return moment(date).locale(sprache()).fromNow()
}
