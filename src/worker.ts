export interface Env {
  PI_API_KEY?: SecretBinding
  PI_SERVER_API_KEY?: SecretBinding
  PI_MOCK_PAYMENTS?: string
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
}

const PI_API_BASE = 'https://api.minepi.com/v2'
const PI_API_TIMEOUT_MS = 15000

type AuthVerifyBody = {
  accessToken?: string
}

type ApproveBody = {
  paymentId?: string
  identifier?: string
  accessToken?: string
}

type CompleteBody = {
  paymentId?: string
  txid?: string
  identifier?: string
  accessToken?: string
}

type IncompleteBody = {
  paymentId?: string
  accessToken?: string
}

type PiMeResponse = {
  uid?: string
  username?: string
}

type SecretBinding =
  | string
  | {
      get: () => Promise<string>
    }

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
  })
}

function apiHeaders(request: Request, extra?: HeadersInit) {
  const origin = request.headers.get('Origin')
  const headers = new Headers(extra)

  headers.set('Cache-Control', headers.get('Cache-Control') || 'no-store')
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')

  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
  }

  return headers
}

function apiJson(request: Request, data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: apiHeaders(request, headers),
  })
}

function apiOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: apiHeaders(request),
  })
}

function withAppHeaders(response: Response) {
  const headers = new Headers(response.headers)

  headers.delete('X-Frame-Options')
  headers.set('Cache-Control', headers.get('Cache-Control') || 'no-store')
  headers.set(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.minepi.com https://minepi.com https://sandbox.minepi.com;",
  )

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function getAssetRequest(request: Request, pathname: string) {
  const appRoutes = ['/privacy', '/privacy/', '/terms', '/terms/']

  if (!appRoutes.includes(pathname)) {
    return request
  }

  const url = new URL(request.url)
  url.pathname = '/'
  url.search = ''

  return new Request(url, request)
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

async function resolveSecretBinding(binding?: SecretBinding) {
  if (!binding) return ''
  if (typeof binding === 'string') return binding.trim()

  try {
    const value = await binding.get()
    return value.trim()
  } catch (error) {
    console.error('[Pi API] failed to read secret binding', error)
    return ''
  }
}

async function getPiApiKey(env: Env) {
  return (await resolveSecretBinding(env.PI_API_KEY)) || (await resolveSecretBinding(env.PI_SERVER_API_KEY))
}

function shouldMockPayments(env: Env) {
  return env.PI_MOCK_PAYMENTS?.toLowerCase() === 'true'
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = PI_API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function parseResponsePayload(response: Response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

async function verifyAccessToken(accessToken: string): Promise<PiMeResponse> {
  const response = await fetchWithTimeout(`${PI_API_BASE}/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const payload = await parseResponsePayload(response)

  if (!response.ok) {
    console.error('[Pi Auth] verification failed', {
      status: response.status,
      payload,
    })

    throw new Error(`Pi token verification failed with ${response.status}`)
  }

  const userPayload = payload as PiMeResponse

  if (!userPayload.uid) {
    throw new Error('Pi token verification did not return a user id')
  }

  return userPayload
}

async function piServerRequest(env: Env, path: string, init?: RequestInit) {
  const apiKey = await getPiApiKey(env)

  if (!apiKey) {
    return json(
      {
        error: 'Missing PI_API_KEY',
      },
      500,
    )
  }

  const response = await fetchWithTimeout(`${PI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  const payload = await parseResponsePayload(response)

  if (!response.ok) {
    console.error('[Pi API] request failed', {
      path,
      status: response.status,
      payload,
    })
  }

  return json(payload, response.status)
}

async function verifyPiAuth(request: Request) {
  const body = await readJson<AuthVerifyBody>(request)

  if (!body?.accessToken) {
    return apiJson(
      request,
      {
        verified: false,
        error: 'Missing accessToken',
      },
      400,
    )
  }

  try {
    const userPayload = await verifyAccessToken(body.accessToken)

    const session = {
      uid: userPayload.uid,
      username: userPayload.username || '',
      createdAt: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    }

    const sessionCookie = [
      `pitiles_session=${encodeURIComponent(JSON.stringify(session))}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=None',
      'Max-Age=604800',
    ].join('; ')

    return apiJson(
      request,
      {
        verified: true,
        user: {
          uid: userPayload.uid,
          username: userPayload.username || '',
        },
      },
      200,
      {
        'Set-Cookie': sessionCookie,
      },
    )
  } catch (error) {
    console.error('[Pi Auth] verification exception', error)

    return apiJson(
      request,
      {
        verified: false,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      },
      401,
    )
  }
}

async function approvePayment(request: Request, env: Env) {
  const body = await readJson<ApproveBody>(request)

  if (!body?.paymentId) {
    return json({ error: 'Missing paymentId' }, 400)
  }

  if (body.accessToken) {
    try {
      await verifyAccessToken(body.accessToken)
    } catch (error) {
      return json(
        {
          approved: false,
          error: error instanceof Error ? error.message : 'Invalid Pi access token',
        },
        401,
      )
    }
  }

  if (shouldMockPayments(env)) {
    console.warn('[Pi Payment] mock approve', body.paymentId)

    return json({
      approved: true,
      paymentId: body.paymentId,
      identifier: body.identifier,
      mode: 'mock',
    })
  }

  return piServerRequest(env, `/payments/${body.paymentId}/approve`, {
    method: 'POST',
  })
}

async function completePayment(request: Request, env: Env) {
  const body = await readJson<CompleteBody>(request)

  if (!body?.paymentId || !body?.txid) {
    return json({ error: 'Missing paymentId or txid' }, 400)
  }

  if (body.accessToken) {
    try {
      await verifyAccessToken(body.accessToken)
    } catch (error) {
      return json(
        {
          completed: false,
          error: error instanceof Error ? error.message : 'Invalid Pi access token',
        },
        401,
      )
    }
  }

  if (shouldMockPayments(env)) {
    console.warn('[Pi Payment] mock complete', body.paymentId, body.txid)

    return json({
      completed: true,
      paymentId: body.paymentId,
      txid: body.txid,
      identifier: body.identifier,
      mode: 'mock',
    })
  }

  return piServerRequest(env, `/payments/${body.paymentId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      txid: body.txid,
    }),
  })
}

async function incompletePayment(request: Request) {
  const body = await readJson<IncompleteBody>(request)

  if (!body?.paymentId) {
    return json({ error: 'Missing paymentId' }, 400)
  }

  console.warn('[Pi Payment] incomplete payment reported', body.paymentId)

  return json({
    received: true,
    paymentId: body.paymentId,
  })
}

function methodNotAllowed(pathname: string, method: string) {
  return json(
    {
      error: 'Method not allowed',
      path: pathname,
      method,
    },
    405,
    {
      Allow: 'POST',
    },
  )
}

function apiNotFound(pathname: string, method: string) {
  return json(
    {
      error: 'API route not found',
      path: pathname,
      method,
    },
    404,
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname

    console.log('[Worker]', request.method, pathname)

    if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return apiOptions(request)
    }

    if (pathname === '/api/pi/auth/verify') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return verifyPiAuth(request)
    }

    if (pathname === '/api/pi/payments/approve') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return approvePayment(request, env)
    }

    if (pathname === '/api/pi/payments/complete') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return completePayment(request, env)
    }

    if (pathname === '/api/pi/payments/incomplete') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return incompletePayment(request)
    }

    if (pathname.startsWith('/api/')) {
      return apiNotFound(pathname, request.method)
    }

    const assetResponse = await env.ASSETS.fetch(getAssetRequest(request, pathname))
    return withAppHeaders(assetResponse)
  },
}
