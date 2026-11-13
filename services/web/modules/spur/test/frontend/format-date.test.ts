import { expect } from 'chai'
import {
  formatTime,
  formatTimeBasedOnYear,
  relativeDate,
} from '@/features/utils/format-date'

const sprache = (code: string) =>
  window.metaAttributesCache.set('ol-i18n', { currentLangCode: code })

describe('Datumsformate im Verlauf und Chat', function () {
  afterEach(function () {
    sprache('en')
  })

  it('zeigt Deutsch mit 24-Stunden-Uhrzeit', function () {
    sprache('de')
    expect(formatTime('2025-03-04T15:30:00', 'h:mm a')).to.equal('15:30')
  })

  it('setzt im Deutschen den Punkt nach dem Tag', function () {
    sprache('de')
    const heute = new Date()
    heute.setHours(9, 5, 0, 0)
    heute.setDate(13)
    expect(formatTimeBasedOnYear(heute)).to.match(/^13\. \p{L}+, 9:05$/u)
    expect(formatTimeBasedOnYear('2020-11-13T09:05:00')).to.equal(
      '13. November 2020, 9:05'
    )
  })

  it('bleibt auf Englisch bei 12-Stunden-Uhrzeit ohne Punkt', function () {
    sprache('en')
    expect(formatTime('2025-03-04T15:30:00', 'h:mm a')).to.equal('3:30 pm')
    expect(formatTimeBasedOnYear('2020-11-13T09:05:00')).to.equal(
      '13 November 2020, 9:05 am'
    )
  })

  it('nennt gestern und heute auf Deutsch', function () {
    sprache('de')
    expect(relativeDate(new Date())).to.equal('Heute')
  })
})
