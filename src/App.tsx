import './App.css'
import { PiTilesGame } from './components/PiTilesGame'
import { PrivacyPolicy } from './components/PrivacyPolicy'
import { TermsOfService } from './components/TermsOfService'

export default function App() {
  const pathname = window.location.pathname

  if (pathname === '/privacy' || pathname === '/privacy/') {
    return <PrivacyPolicy />
  }

  if (pathname === '/terms' || pathname === '/terms/') {
    return <TermsOfService />
  }

  return <PiTilesGame />
}
