import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob'

const GOOGLE_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111'

let bannerStartPromise: Promise<void> | null = null

async function startTestBanner() {
  if (!Capacitor.isNativePlatform()) return
  if (bannerStartPromise) return bannerStartPromise

  bannerStartPromise = (async () => {
    await AdMob.initialize({
      initializeForTesting: true,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    })

    await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error) => {
      console.warn('[Android AdMob] Test banner failed to load:', error)
    })

    await AdMob.showBanner({
      adId: GOOGLE_TEST_BANNER_ID,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      isTesting: true,
      npa: true,
      margin: 0,
    })

    document.documentElement.classList.add('android-native-ad')
  })().catch((error) => {
    bannerStartPromise = null
    console.warn('[Android AdMob] Initialization failed:', error)
  })

  return bannerStartPromise
}

export function AndroidAdSlot() {
  useEffect(() => {
    void startTestBanner()
  }, [])

  return null
}
