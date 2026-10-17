import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/inter'
import App from './App'
import './index.css'
import { startAccount } from './lib/account'
import { recoverInterruptedMessages } from './lib/repo'

void recoverInterruptedMessages().then(startAccount)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
