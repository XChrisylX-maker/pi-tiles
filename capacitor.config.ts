import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.playpitiles.app',
  appName: 'PlayPiTiles',
  webDir: 'dist/android',
  server: {
    androidScheme: 'https',
  },
}

export default config
