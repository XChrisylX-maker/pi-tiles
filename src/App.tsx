import './App.css'
import { PiTilesGame } from './components/PiTilesGame'
import { PrivacyPolicy } from './components/PrivacyPolicy'

export default function App() {
  const pathname = window.location.pathname

  if (pathname === '/privacy' || pathname === '/privacy/') {
    return <PrivacyPolicy />
  }

  return <PiTilesGame />
}
