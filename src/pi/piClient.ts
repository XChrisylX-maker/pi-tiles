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
  onReadyForServerApproval?: (paymentId: string) => void
  onReadyForServerCompletion?: (paymentId: string, txid: string) => void
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

export async function initPiSdk() {
  if (typeof window === 'undefined') return false

  // Pi Browser injects window.Pi asynchronously on some devices.
  // Waiting briefly prevents early authenticate/createPayment calls from failing
  // with "Pi Network SDK was not initialized".
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (window.Pi?.init) break

    await new Promise((resolve) => {
      setTimeout(resolve, 150)
    })
  }

  if (!window.Pi?.init) {
    console.warn('[Pi SDK] Pi Browser SDK unavailable.')
    return false
  }

  try {
    window.Pi.init({
      version: PI_SDK_VERSION,
      sandbox: true,
    })

    console.info('[Pi SDK] initialized.')

    return true
  } catch (error) {
    console.error('[Pi SDK] init failed:', error)
    return false
  }
}

export async function authenticatePiUser(): Promise<PiUser> {
  if (!isPiBrowser() || !window.Pi?.authenticate) {
    console.info('[Pi SDK] Running in mock auth mode.')
    return createMockPiUser()
  }

  await initPiSdk()

  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      (incompletePayment) => {
        console.info('[Pi SDK] Incomplete payment found:', incompletePayment)

        // Production TODO:
        // Send incompletePayment.identifier/paymentId to the backend.
        // The backend should check payment status and complete/cancel if needed.
      },
    )

    return {
      piUid: auth.uid || crypto.randomUUID(),
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
  if (!isPiBrowser()) {
    console.info('[Pi SDK] Mock VIP payment accepted.')

    return {
      paid: true,
      transactionId: 'mock-vip-payment',
      paymentId: 'mock-vip-payment-id',
      fallbackMode: true,
    }
  }

  await initPiSdk()

  const pi = window.Pi
  const createPayment = pi?.createPayment

  if (!createPayment) {
    console.info('[Pi SDK] createPayment unavailable, using mock fallback.')

    return {
      paid: true,
      transactionId: 'mock-vip-payment',
      paymentId: 'mock-vip-payment-id',
      fallbackMode: true,
    }
  }

  return new Promise((resolve) => {
    const paymentIdentifier = `pi-tiles-vip-${Date.now()}`

    try {
      createPayment(
        {
          amount: VIP_PRICE_PI,
          memo: `Pi Tiles VIP Pass - ${VIP_PASS_DAYS} days`,
          metadata: {
            app: 'pi-tiles',
            feature: 'vip-pass',
            durationDays: VIP_PASS_DAYS,
            createdAt: new Date().toISOString(),
          },
          identifier: paymentIdentifier,
        },
        {
          onReadyForServerApproval(paymentId) {
            console.info('[Pi SDK] Ready for server approval:', paymentId)

            // Production TODO:
            // POST /api/pi/payments/approve
            // body: { paymentId, identifier: paymentIdentifier }
            // Backend must call Pi Platform approve endpoint.
          },

          onReadyForServerCompletion(paymentId, txid) {
            console.info('[Pi SDK] Ready for server completion:', paymentId, txid)

            // Production TODO:
            // POST /api/pi/payments/complete
            // body: { paymentId, txid, identifier: paymentIdentifier }
            // Backend must call Pi Platform complete endpoint,
            // then set user.vipUntil = now + 7 days.

            resolve({
              paid: true,
              transactionId: txid,
              paymentId,
              fallbackMode: false,
            })
          },

          onCancel(paymentId) {
            console.warn('[Pi SDK] Payment cancelled:', paymentId)

            resolve({
              paid: false,
              paymentId,
              fallbackMode: false,
              cancelled: true,
            })
          },

          onError(error, payment) {
            console.error('[Pi SDK] Payment error:', error, payment)

            resolve({
              paid: false,
              fallbackMode: false,
              error: error instanceof Error ? error.message : 'Unknown Pi payment error',
            })
          },
        },
      )
    } catch (error) {
      console.error('[Pi SDK] createPayment failed:', error)

      resolve({
        paid: false,
        fallbackMode: false,
        error: error instanceof Error ? error.message : 'Pi createPayment failed',
      })
    }
  })
}
