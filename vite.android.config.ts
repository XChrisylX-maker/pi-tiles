import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'android-remove-pi-sdk',
      transformIndexHtml(html) {
        return html.replace(/\s*<script src="https:\/\/sdk\.minepi\.com\/pi-sdk\.js"><\/script>/, '')
      },
    },
  ],
  build: {
    outDir: 'dist/android',
    emptyOutDir: true,
  },
  define: {
    'import.meta.env.VITE_ANDROID_APP': JSON.stringify('true'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('https://play-pi-tiles.com'),
  },
})
