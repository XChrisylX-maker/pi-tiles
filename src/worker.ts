export interface Env {
  PI_SERVER_API_KEY: string
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
}

const PI_API_BASE = 'https://api.minepi.com/v2'

type ApproveBody = {
  paymentId?: string
}

type CompleteBody = {
  paymentId?: string
  txid?: string
}

async function piRequest(env: Env, path: string, init?: RequestInit) {
  if (!env.PI_SERVER_API_KEY) {
    return Response.json({ error: 'Missing PI_SERVER_API_KEY' }, { status: 500 })
  }

  const response = await fetch(`${PI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${env.PI_SERVER_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  const text = await response.text()

  return new Response(text || '{}', {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/pi/payments/approve') {
      const body = (await request.json()) as ApproveBody

      if (!body.paymentId) {
        return Response.json({ error: 'Missing paymentId' }, { status: 400 })
      }

      return piRequest(env, `/payments/${body.paymentId}/approve`, {
        method: 'POST',
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/pi/payments/complete') {
      const body = (await request.json()) as CompleteBody

      if (!body.paymentId || !body.txid) {
        return Response.json({ error: 'Missing paymentId or txid' }, { status: 400 })
      }

      return piRequest(env, `/payments/${body.paymentId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ txid: body.txid }),
      })
    }

    return env.ASSETS.fetch(request)
  },
}