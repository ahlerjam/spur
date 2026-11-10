import '@/features/header-footer-react'
import ReactDOM from 'react-dom/client'
import GrenzenAdmin from '../grenzen/grenzen-admin'

const element = document.getElementById('spur-grenzen-admin')
if (element) {
  ReactDOM.createRoot(element).render(<GrenzenAdmin />)
}
