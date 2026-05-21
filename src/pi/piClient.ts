export type PiIntegrationStatus = {
  auth: 'mock' | 'sdk'
  payments: 'mock' | 'sdk'
  leaderboard: 'local' | 'api'
  rewards: 'simulated' | 'server'
}

export type PiUser = {
  piUid: string
  username: string
  accessToken: string
  isAuthenticated: boolean
  fallbackMode: boolean
}

export type VipPaymentResult = {
  paid: boolean
  transactionId?: string
  paymentId?: string
  fallbackMode: boolean
  cancelled?: boolean
  error?: string
}

type PiAuthResult = {
  user?: {
    uid?: string
    username?: string
  }
  uid?: string
  username?: string
  accessToken?: string
}

type VerifiedPiAuthResponse = {
  verified: boolean
  user?: {
    uid?: string
    username?: string
  }
  error?: string
}

type PiPayment = {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
  identifier?: string
}

type PiPaymentCallbacks = {
  onReadyForServerApproval?: (paymentId: string) => void | Promise<void>
  onReadyForServerCompletion?: (paymentId: string, txid: string) => void | Promise<void>
  onCancel?: (paymentId: string) => void
  onError?: (error: Error | unknown, payment?: unknown) => void
}

declare global {
  interface Window {
    Pi?: {
      init?: (config: { version: string; sandbox?: boolean }) => void | Promise<void>
      authenticate?: (
        scopes: string[],
        onIncompletePaymentFound?: (payment: unknown) => void,
      ) => Promise<PiAuthResult>
      createPayment?: (payment: PiPayment, callbacks: PiPaymentCallbacks) => void
    }
  }
}

const PI_SDK_VERSION = '2.0'
const PI_SANDBOX = true

const VIP_PRICE_PI = 1
const VIP_PASS_DAYS = 7

const PI_SDK_INJECTION_ATTEMPTS = 50
const PI_SDK_INJECTION_DELAY_MS = 200

const PI_SDK_INIT_TIMEOUT_MS = 15000
const PI_AUTH_TIMEOUT_MS = 20000
const PI_PAYMENT_SCOPE_TIMEOUT_MS = 20000
const PI_BACKEND_TIMEOUT_MS = 20000
const PI_PAYMENT_TIMEOUT_MS = 90000

let piSdkInitialized = false
let piSdkInitPromise: Promise<boolean> | null = null
let authenticatePromise: Promise<PiUser> | null = null
let paymentScopePromise: Promise<boolean> | null = null
let paymentScopeGranted = false
let currentPiUser: PiUser | null = null

export const PI_INTEGRATION_STATUS: PiIntegrationStatus = {
  auth: 'sdk',
  payments: 'sdk',
  leaderboard: 'local',
  rewards: 'simulated',
}

export function isPiBrowser(): boolean {
  return typeof window !== 'undefined' && Boolean(window.Pi)
}

export function createMockPiUser(): PiUser {
  return {
    piUid: 'guest-user',
    username: 'Guest',
    accessToken: '',
    isAuthenticated: false,
    fallbackMode: true,
  }
}

function timeoutError(label: string) {
  return new Error(`${label} timeout`)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(label)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function getPaymentIdFromUnknown(payment: unknown) {
  const possiblePayment = payment as {
    identifier?: string
    paymentId?: string
    id?: string
  }

  return possiblePayment.identifier || possiblePayment.paymentId || possiblePayment.id || ''
}

async function reportIncompletePayment(payment: unknown, accessToken?: string) {
  const paymentId = getPaymentIdFromUnknown(payment)

  console.info('[Pi SDK] Incomplete payment found:', payment)

  if (!paymentId) return

  await fetch('/api/pi/payments/incomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentId,
      accessToken: accessToken || currentPiUser?.accessToken || '',
    }),
  }).catch((error) => {
    console.warn('[Pi SDK] incomplete payment handler failed:', error)
  })
}

async function waitForPiSdk() {
  if (typeof window === 'undefined') return false

  for (let attempt = 0; attempt < PI_SDK_INJECTION_ATTEMPTS; attempt += 1) {
    if (window.Pi?.init && window.Pi.authenticate) return true

    await new Promise((resolve) => {
      setTimeout(resolve, PI_SDK_INJECTION_DELAY_MS)
    })
  }

  return Boolean(window.Pi?.init && window.Pi.authenticate)
}

export async function initPiSdk() {
  if (piSdkInitialized) return true
  if (piSdkInitPromise) return piSdkInitPromise

  piSdkInitPromise = (async () => {
    const sdkAvailable = await withTimeout(waitForPiSdk(), PI_SDK_INIT_TIMEOUT_MS, 'Pi SDK availability')

    if (!sdkAvailable || !window.Pi?.init) {
      console.warn('[Pi SDK] Pi Browser SDK unavailable.')
      return false
    }

    try {
      await withTimeout(
        Promise.resolve(
          window.Pi.init({
            version: PI_SDK_VERSION,
            sandbox: PI_SANDBOX,
          }),
        ),
        PI_SDK_INIT_TIMEOUT_MS,
        'Pi SDK initialization',
      )

      piSdkInitialized = true
      console.info('[Pi SDK] initialized.')
      return true
    } catch (error) {
      console.error('[Pi SDK] init failed:', error)
      piSdkInitialized = false
      piSdkInitPromise = null
      return false
    }
  })()

  return piSdkInitPromise
}

async function postJson<TResponse>(url: string, body: Record<string, unknown>): Promise<TResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PI_BACKEND_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${url} failed with ${response.status}${text ? `: ${text}` : ''}`)
    }

    return response.json() as Promise<TResponse>
  } finally {
    clearTimeout(timer)
  }
}

async function verifyPiAccessToken(accessToken: string) {
  return postJson<VerifiedPiAuthResponse>('/api/pi/auth/verify', {
    accessToken,
  })
}

async function approvePayment(paymentId: string, identifier: string, accessToken: string) {
  return postJson<{ approved?: boolean }>('/api/pi/payments/approve', {
    paymentId,
    identifier,
    accessToken,
  })
}

async function completePayment(paymentId: string, txid: string, identifier: string, accessToken: string) {
  return postJson<{ completed?: boolean }>('/api/pi/payments/complete', {
    paymentId,
    txid,
    identifier,
    accessToken,
  })
}

async function requestPaymentScope(accessToken: string) {
  if (paymentScopeGranted) return true
  if (paymentScopePromise) return paymentScopePromise

  paymentScopePromise = (async () => {
    const sdkInitialized = await initPiSdk()

    if (!sdkInitialized || !window.Pi?.authenticate) {
      throw new Error('Pi payment permission SDK unavailable.')
    }

    await withTimeout(
      window.Pi.authenticate(['payments'], (incompletePayment) => {
        void reportIncompletePayment(incompletePayment, accessToken)
      }),
      PI_PAYMENT_SCOPE_TIMEOUT_MS,
      'Pi payment permission',
    )

    paymentScopeGranted = true
    return true
  })().finally(() => {
    paymentScopePromise = null
  })

  return paymentScopePromise
}

export async function authenticatePiUser(): Promise<PiUser> {
  if (currentPiUser?.isAuthenticated && currentPiUser.accessToken) return currentPiUser
  if (authenticatePromise) return authenticatePromise

  authenticatePromise = (async () => {
    const sdkInitialized = await initPiSdk()

    if (!sdkInitialized || !window.Pi?.authenticate) {
      console.info('[Pi SDK] Running in guest auth mode.')
      currentPiUser = createMockPiUser()
      return currentPiUser
    }

    try {
      console.info('[Pi SDK] Opening username authentication.')

      const auth = await withTimeout(
        window.Pi.authenticate(['username'], (incompletePayment) => {
          void reportIncompletePayment(incompletePayment, currentPiUser?.accessToken)
        }),
        PI_AUTH_TIMEOUT_MS,
        'Pi authentication',
      )

      console.info('[Pi SDK] Username scope authenticated:', auth)

      if (!auth.accessToken) {
        console.warn('[Pi SDK] No access token returned:', auth)
        currentPiUser = createMockPiUser()
        return currentPiUser
      }

      const verification = await verifyPiAccessToken(auth.accessToken)

      if (!verification.verified || !verification.user?.uid) {
        throw new Error(verification.error || 'Pi authentication could not be verified.')
      }

      currentPiUser = {
        piUid: verification.user.uid,
        username: verification.user.username || auth.user?.username || auth.username || 'Pioneer',
        accessToken: auth.accessToken,
        isAuthenticated: true,
        fallbackMode: false,
      }

      return currentPiUser
    } catch (error) {
      console.error('[Pi SDK] Authentication failed:', error)
      currentPiUser = createMockPiUser()
      return currentPiUser
    } finally {
      authenticatePromise = null
    }
  })()

  return authenticatePromise
}

export async function requestVipPayment(): Promise<VipPaymentResult> {
  const sdkInitialized = await initPiSdk()

  if (!sdkInitialized || !window.Pi?.createPayment) {
    return {
      paid: false,
      fallbackMode: true,
      error: 'Pi payment SDK unavailable. Open the app inside Pi Browser.',
    }
  }

  const authenticatedUser =
    currentPiUser?.isAuthenticated && currentPiUser.accessToken ? currentPiUser : await authenticatePiUser()

  if (!authenticatedUser.isAuthenticated || !authenticatedUser.accessToken) {
    return {
      paid: false,
      fallbackMode: authenticatedUser.fallbackMode,
      error: 'Pi authentication is required before starting a payment.',
    }
  }

  const accessToken = authenticatedUser.accessToken
  const paymentIdentifier = `playpitiles-vip-${Date.now()}`

  try {
    await requestPaymentScope(accessToken)
  } catch (error) {
    console.error('[Pi SDK] Payment permission failed:', error)

    return {
      paid: false,
      fallbackMode: false,
      error: error instanceof Error ? error.message : 'Pi payment permission failed',
    }
  }

  return new Promise((resolve) => {
    let resolved = false

    const finish = (result: VipPaymentResult) => {
      if (resolved) return
      resolved = true
      clearTimeout(paymentTimeout)
      resolve(result)
    }

    const paymentTimeout = setTimeout(() => {
      finish({
        paid: false,
        fallbackMode: false,
        error: 'Pi payment timeout',
      })
    }, PI_PAYMENT_TIMEOUT_MS)

    try {
      window.Pi?.createPayment?.(
        {
          amount: VIP_PRICE_PI,
          memo: `PlayPiTiles VIP Pass - ${VIP_PASS_DAYS} days`,
          metadata: {
            app: 'playpitiles',
            feature: 'vip-pass',
            durationDays: VIP_PASS_DAYS,
            identifier: paymentIdentifier,
            piUid: authenticatedUser.piUid,
            username: authenticatedUser.username,
            createdAt: new Date().toISOString(),
          },
          identifier: paymentIdentifier,
        },
        {
          async onReadyForServerApproval(paymentId) {
            console.info('[Pi SDK] Ready for server approval:', paymentId)

            try {
              await approvePayment(paymentId, paymentIdentifier, accessToken)
              console.info('[Pi SDK] Payment approved by backend:', paymentId)
            } catch (error) {
              console.error('[Pi SDK] Backend approval failed:', error)

              finish({
                paid: false,
                paymentId,
                fallbackMode: false,
                error: error instanceof Error ? error.message : 'Backend payment approval failed',
              })
            }
          },

          async onReadyForServerCompletion(paymentId, txid) {
            console.info('[Pi SDK] Ready for server completion:', paymentId, txid)

            try {
              await completePayment(paymentId, txid, paymentIdentifier, accessToken)
              console.info('[Pi SDK] Payment completed by backend:', paymentId, txid)

              finish({
                paid: true,
                transactionId: txid,
                paymentId,
                fallbackMode: false,
              })
            } catch (error) {
              console.error('[Pi SDK] Backend completion failed:', error)

              finish({
                paid: false,
                transactionId: txid,
                paymentId,
                fallbackMode: false,
                error: error instanceof Error ? error.message : 'Backend payment completion failed',
              })
            }
          },

          onCancel(paymentId) {
            console.warn('[Pi SDK] Payment cancelled:', paymentId)

            finish({
              paid: false,
              paymentId,
              fallbackMode: false,
              cancelled: true,
            })
          },

          onError(error, payment) {
            console.error('[Pi SDK] Payment error:', error, payment)

            finish({
              paid: false,
              fallbackMode: false,
              error: error instanceof Error ? error.message : 'Unknown Pi payment error',
            })
          },
        },
      )
    } catch (error) {
      console.error('[Pi SDK] createPayment failed:', error)

      finish({
        paid: false,
        fallbackMode: false,
        error: error instanceof Error ? error.message : 'Pi createPayment failed',
      })
    }
  })
}
