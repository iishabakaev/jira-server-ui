import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles/globals.css'

// Точка входа SPA. React 19 + StrictMode; компилятор React сам убирает
// ручные мемоизации, поэтому useMemo/useCallback в коде — исключение, а не правило.
const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
