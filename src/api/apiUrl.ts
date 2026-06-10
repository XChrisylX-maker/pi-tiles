const CONFIGURED_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') return ''

  const { hostname } = window.location
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'

  return isLocal ? '' : 'https://play-pi-tiles.com'
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const apiBaseUrl = CONFIGURED_API_BASE_URL || getDefaultApiBaseUrl()

  return `${apiBaseUrl}${normalizedPath}`
}
