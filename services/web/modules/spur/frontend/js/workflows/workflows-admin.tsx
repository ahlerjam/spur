import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import { anfrage, jsonAnfrage } from '../api'

type Workflow = { name: string; titel: string; beschreibung: string; text: string; angepasst: boolean }

const PFAD = '/spur/admin/workflows'

export default function WorkflowsAdmin() {
  const { isReady } = useWaitForI18n()
  const { t } = useTranslation()
  const [liste, setListe] = useState<Workflow[] | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    try {
      setListe((await anfrage<{ workflows: Workflow[] }>(`${PFAD}.json`)).workflows)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  if (!isReady) return null

  return (
    <div className="spur-workflows-admin">
      <h1>{t('spur_workflows')}</h1>
      <p>{t('spur_workflows_admin_hinweis')}</p>
      {fehler && <Notification type="error" content={fehler} />}
      {!liste && !fehler && <p aria-busy="true">{t('loading')}</p>}
      {liste?.map(w => <WorkflowBearbeiten key={w.name} workflow={w} neuLaden={laden} />)}
    </div>
  )
}

function WorkflowBearbeiten({ workflow, neuLaden }: { workflow: Workflow; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const [text, setText] = useState(workflow.text)
  const [meldung, setMeldung] = useState<{ typ: 'success' | 'error'; text: string } | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  useEffect(() => setText(workflow.text), [workflow.text])
  const id = `spur-workflow-text-${workflow.name}`

  const ausfuehren = async (methode: string, daten: unknown, erfolg: string) => {
    setLaeuft(true)
    setMeldung(null)
    try {
      await jsonAnfrage(methode, `${PFAD}/${workflow.name}`, daten)
      await neuLaden()
      setMeldung({ typ: 'success', text: erfolg })
    } catch (error) {
      setMeldung({ typ: 'error', text: (error as Error).message })
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <section className="spur-workflow-admin" aria-labelledby={`${id}-titel`}>
      <div className="spur-lauf-kopf">
        <h2 id={`${id}-titel`}>{workflow.titel}</h2>
        <OLBadge bg={workflow.angepasst ? 'info' : 'light'}>
          {workflow.angepasst ? t('spur_workflow_angepasst') : t('spur_workflow_standard')}
        </OLBadge>
      </div>
      <p className="spur-zeile-meta">
        <code>/spur:{workflow.name}</code> · {workflow.beschreibung}
      </p>
      <form
        onSubmit={e => {
          e.preventDefault()
          ausfuehren('PUT', { text }, t('spur_workflow_gespeichert'))
        }}
      >
        <OLFormLabel htmlFor={id}>{t('spur_workflow_text', { titel: workflow.titel })}</OLFormLabel>
        <OLFormControl as="textarea" id={id} rows={12} value={text} onChange={e => setText(e.target.value)} />
        <div className="spur-vorschlag-aktionen">
          <OLButton type="submit" variant="primary" size="sm" isLoading={laeuft}>
            {t('spur_workflow_speichern')}
          </OLButton>
          {workflow.angepasst && (
            <OLButton
              variant="secondary"
              size="sm"
              disabled={laeuft}
              onClick={() => ausfuehren('DELETE', undefined, t('spur_workflow_zurueckgesetzt'))}
            >
              {t('spur_workflow_zuruecksetzen')}
            </OLButton>
          )}
        </div>
        <div role="status">{meldung && <Notification type={meldung.typ} content={meldung.text} />}</div>
      </form>
    </section>
  )
}
