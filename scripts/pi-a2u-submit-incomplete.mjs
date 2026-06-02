#!/usr/bin/env node

import 'dotenv/config'
import PiBackend from 'pi-backend'

const BASE_URL = process.env.PITILES_BASE_URL || 'https://play-pi-tiles.com'
const ADMIN_TOKEN = process.env.PITILES_ADMIN_TOKEN || process.env.PI_ADMIN_TOKEN || ''
const PI_API_KEY = process.env.PI_API_KEY || process.env.PI_SERVER_API_KEY || ''
const PI_WALLET_PRIVATE_SEED = process.env.PI_WALLET_PRIVATE_SEED || ''
const DRY_RUN = process.argv.includes('--dry-run')
const PiNetwork = PiBackend?.default || PiBackend

async function request(path, options = {}) {
  if (!ADMIN_TOKEN) {
    throw new Error('Missing PITILES_ADMIN_TOKEN environment variable.')
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload, null, 2)}`)
  }

  return payload
}

function extractPayments(payload) {
  const candidates = [
    payload?.incomplete_server_payments,
    payload?.incompleteServerPayments,
    payload?.payments,
    payload?.items,
    Array.isArray(payload) ? payload : null,
  ].find(Array.isArray)

  return candidates || []
}

function getPaymentId(payment) {
  return payment?.identifier || payment?.paymentId || payment?.id || ''
}

async function main() {
  if (!DRY_RUN && !PI_API_KEY) throw new Error('Missing PI_API_KEY environment variable.')
  if (!DRY_RUN && !PI_WALLET_PRIVATE_SEED) throw new Error('Missing PI_WALLET_PRIVATE_SEED environment variable.')

  const pi = DRY_RUN ? null : new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED)
  const incompletePayload = await request('/api/pi/payments/incomplete-server', {
    method: 'GET',
  })
  const payments = extractPayments(incompletePayload).filter((payment) => {
    const id = getPaymentId(payment)
    const isAppToUser = payment?.direction === 'app_to_user' || payment?.direction === 'AppToUser' || payment?.to_address
    const needsTx = !payment?.transaction?.txid
    const needsCompletion = !payment?.status?.developer_completed

    return id && isAppToUser && needsTx && needsCompletion
  })

  console.log(`Incomplete App-to-User payments to submit: ${payments.length}`)

  for (const payment of payments) {
    const paymentId = getPaymentId(payment)

    try {
      console.log(`Submitting ${paymentId} -> ${payment.to_address || 'unknown wallet'} (${payment.amount || '?'} Pi)`)

      if (DRY_RUN) continue

      const txid = await pi.submitPayment(paymentId)
      console.log(`Transaction submitted: ${txid}`)

      const completed = await request('/api/pi/payments/app-to-user/complete', {
        method: 'POST',
        body: JSON.stringify({
          paymentId,
          txid,
        }),
      })

      console.log(`Completed ${completed.payment?.id || paymentId}`)
    } catch (error) {
      console.error(`FAILED ${paymentId}:`, error instanceof Error ? error.message : error)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
