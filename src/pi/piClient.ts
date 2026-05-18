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
  fallbackMode: boolean
}

declare global {
  interface Window {
    Pi?: {
      authenticate?: (
        scopes: string[],
        onIncompletePaymentFound?: (payment: unknown) => void,
      ) => Promise<{ uid?: string; username?: string; accessToken?: string }>
      createPayment?: (payment: unknown, callbacks: unknown) => void
    }
  }
}

export const PI_INTEGRATION_STATUS: PiIntegrationStatus = {
  auth: 'mock',
  payments: 'mock',
  leaderboard: 'local',
  rewards: 'simulated',
}

export function createMockPiUser(): PiUser {
  return {
    piUid: 'mock-user-001',
    username: 'You',
    accessToken: 'mock-access-token',
    isAuthenticated: true,
    fallbackMode: true,
  }
}

export async function authenticatePiUser(): Promise<PiUser> {
  if (typeof window === 'undefined' || !window.Pi?.authenticate) {
    return createMockPiUser()
  }

  try {
    const user = await window.Pi.authenticate(['username', 'payments'], () => {
      // Placeholder: production should complete or cancel unfinished Pi payments server-side.
    })

    return {
      piUid: user.uid || 'unknown-pi-user',
      username: user.username || 'Pioneer',
      accessToken: user.accessToken || '',
      isAuthenticated: true,
      fallbackMode: false,
    }
  } catch {
    return createMockPiUser()
  }
}

export async function requestVipPayment(): Promise<VipPaymentResult> {
  if (typeof window === 'undefined' || !window.Pi?.createPayment) {
    return { paid: true, transactionId: 'mock-vip-payment', fallbackMode: true }
  }

  // Placeholder: wire Pi.createPayment to server approval/completion callbacks.
  return { paid: false, fallbackMode: false }
}
