import ReactDOM from 'react-dom/client'
import WorkflowsAdmin from '../workflows/workflows-admin'

const element = document.getElementById('spur-workflows-admin')
if (element) {
  ReactDOM.createRoot(element).render(<WorkflowsAdmin />)
}
