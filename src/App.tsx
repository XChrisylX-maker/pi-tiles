import './App.css'
import { AndroidPiTilesGame } from './android/AndroidPiTilesGame'
import { PiTilesGame } from './components/PiTilesGame'
import { PrivacyPolicy } from './components/PrivacyPolicy'
import { TermsOfService } from './components/TermsOfService'

export default function App() {
  const pathname = window.location.pathname
  const isAndroidApp = import.meta.env.VITE_ANDROID_APP === 'true'

  if (pathname === '/privacy' || pathname === '/privacy/') {
    return <PrivacyPolicy />
  }

  if (pathname === '/terms' || pathname === '/terms/') {
    return <TermsOfService />
  }

  return isAndroidApp ? <AndroidPiTilesGame /> : <PiTilesGame platform="pi" />
}
