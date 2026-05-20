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
  uid?: string
  username?: string
  accessToken?: string
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
      init?: (config: { version: string; sandbox?: boolean }) => void
      authenticate?: (
        scopes: string[],
        onIncompletePaymentFound?: (payment: unknown) => void,
      ) => Promise<PiAuthResult>
      createPayment?: (payment: PiPayment, callbacks: PiPaymentCallbacks) => void
    }
  }
}

const PI_SDK_VERSION = '2.0'
const VIP_PRICE_PI = 1
const VIP_PASS_DAYS = 7
const PI_SDK_INJECTION_ATTEMPTS = 30
const PI_SDK_INJECTION_DELAY_MS = 150

let piSdkInitialized = false
let piSdkInitPromise: Promise<boolean> | null = null

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
    piUid: 'mock-user-001',
    username: 'Local Pioneer',
    accessToken: 'mock-access-token',
    isAuthenticated: true,
    fallbackMode: true,
  }
}

function makeFallbackId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function waitForPiSdk() {
  if (typeof window === 'undefined') return false

  for (let attempt = 0; attempt < PI_SDK_INJECTION_ATTEMPTS; attempt += 1) {
    if (window.Pi?.init) return true

    await new Promise((resolve) => {
      setTimeout(resolve, PI_SDK_INJECTION_DELAY_MS)
    })
  }

  return Boolean(window.Pi?.init)
}

export async function initPiSdk() {
  if (piSdkInitialized) return true

  if (piSdkInitPromise) {
    return piSdkInitPromise
  }

  piSdkInitPromise = (async () => {
    const sdkAvailable = await waitForPiSdk()

    if (!sdkAvailable || !window.Pi?.init) {
      console.warn('[Pi SDK] Pi Browser SDK unavailable.')
      return false
    }

    try {
      window.Pi.init({
        version: PI_SDK_VERSION,
        sandbox: true,
      })

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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${url} failed with ${response.status}${text ? `: ${text}` : ''}`)
  }

  return response.json() as Promise<TResponse>
}

async function approvePayment(paymentId: string, identifier: string) {
  return postJson<{ approved?: boolean }>('/api/pi/payments/approve', {
    paymentId,
    identifier,
  })
}

async function completePayment(paymentId: string, txid: string, identifier: string) {
  return postJson<{ completed?: boolean }>('/api/pi/payments/complete', {
    paymentId,
    txid,
    identifier,
  })
}

export async function authenticatePiUser(): Promise<PiUser> {
  const sdkInitialized = await initPiSdk()

  if (!sdkInitialized || !window.Pi?.authenticate) {
    console.info('[Pi SDK] Running in mock auth mode.')
    return createMockPiUser()
  }

  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      (incompletePayment) => {
        console.info('[Pi SDK] Incomplete payment found:', incompletePayment)
      },
    )

    return {
      piUid: auth.uid || makeFallbackId('pi-user'),
      username: auth.username || 'Pioneer',
      accessToken: auth.accessToken || '',
      isAuthenticated: true,
      fallbackMode: false,
    }
  } catch (error) {
    console.error('[Pi SDK] Authentication failed, falling back to mock user:', error)
    return createMockPiUser()
  }
}

export async function requestVipPayment(): Promise<VipPaymentResult> {
  const sdkInitialized = await initPiSdk()

  if (!sdkInitialized || !window.Pi?.createPayment) {
    console.info('[Pi SDK] createPayment unavailable, using mock fallback.')

    return {
      paid: true,
      transactionId: 'mock-vip-payment',
      paymentId: 'mock-vip-payment-id',
      fallbackMode: true,
    }
  }

  const paymentIdentifier = `playpitiles-vip-${Date.now()}`

  return new Promise((resolve) => {
    let resolved = false

    const finish = (result: VipPaymentResult) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }

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
            createdAt: new Date().toISOString(),
          },
          identifier: paymentIdentifier,
        },
        {
          async onReadyForServerApproval(paymentId) {
            console.info('[Pi SDK] Ready for server approval:', paymentId)

            try {
              await approvePayment(paymentId, paymentIdentifier)
              console.info('[Pi SDK] Payment approved by backend:', paymentId)
            } catch (error) {
              console.error('[Pi SDK] Backend approval failed:', error)

              finish({
                paid: false,
                paymentId,
                fallbackMode: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Backend payment approval failed',
              })
            }
          },

          async onReadyForServerCompletion(paymentId, txid) {
            console.info('[Pi SDK] Ready for server completion:', paymentId, txid)

            try {
              await completePayment(paymentId, txid, paymentIdentifier)
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
                error:
                  error instanceof Error
                    ? error.message
                    : 'Backend payment completion failed',
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
