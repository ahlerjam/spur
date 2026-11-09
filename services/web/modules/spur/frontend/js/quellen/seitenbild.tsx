import { useState, type CSSProperties } from 'react'
import Notification from '@/shared/components/notification'
import { anfrage } from '../api'

// Ein kaputtes Bild zeigt sonst nur eine leere Fläche; die Antwort des Servers sagt, was fehlt.
export default function Seitenbild({ src, alt, style }: { src: string; alt: string; style?: CSSProperties }) {
  const [fehler, setFehler] = useState<{ src: string; text: string } | null>(null)
  if (fehler?.src === src) return <Notification type="warning" content={fehler.text} />
  return (
    <img
      className="spur-seitenbild"
      style={style}
      alt={alt}
      src={src}
      onError={() =>
        anfrage(src).catch(error => setFehler({ src, text: (error as Error).message }))
      }
    />
  )
}
