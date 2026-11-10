import { expect } from 'chai'
import { render, screen } from '@testing-library/react'
import { ExpandableContent } from '@/features/review-panel/components/review-panel-expandable-content'
import { ClaudeHinweis } from '@modules/spur/frontend/js/erwaehnung/claude-erwaehnung'
import { deutschAktivieren } from './helpers/deutsch'

describe('@claude im Kommentar', function () {
  deutschAktivieren()

  it('hebt @claude im Kommentar hervor, den Rest nicht', function () {
    const { container } = render(<ExpandableContent content="@claude bitte ansehen, sagt @Claude." contentLimit={100} />)
    const marken = container.querySelectorAll('.spur-claude-erwaehnung')
    expect([...marken].map(m => m.textContent)).to.deep.equal(['@claude', '@Claude'])
    expect(container.textContent).to.equal('@claude bitte ansehen, sagt @Claude.')
  })

  it('hebt Adressen und längere Namen nicht hervor', function () {
    const { container } = render(<ExpandableContent content="mail@claude.de und @claudette" contentLimit={100} />)
    expect(container.querySelectorAll('.spur-claude-erwaehnung')).to.have.length(0)
  })

  it('zeigt unter dem Feld „Claude wird benachrichtigt“ nur bei einer Erwähnung', function () {
    const { rerender } = render(<ClaudeHinweis text="@claude bitte ansehen" />)
    screen.getByText('Claude wird benachrichtigt')
    rerender(<ClaudeHinweis text=" bitte ansehen" />)
    expect(screen.queryByText('Claude wird benachrichtigt')).to.equal(null)
    rerender(<ClaudeHinweis text="mail@claude.de" />)
    expect(screen.queryByText('Claude wird benachrichtigt')).to.equal(null)
  })
})
