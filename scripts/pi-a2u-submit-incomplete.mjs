#!/usr/bin/env node

import { config as loadEnv } from 'dotenv'
import { readFile, writeFile } from 'node:fs/promises'
import PiBackend from 'pi-backend'

loadEnv()
loadEnv({
  path: new URL('../src/.env', import.meta.url),
  override: false,
})

const BASE_URL = process.env.PITILES_BASE_URL || 'https://play-pi-tiles.com'
const ADMIN_TOKEN = process.env.PI_ADMIN_TOKEN || process.env.PITILES_ADMIN_TOKEN || ''
const PI_API_KEY_SOURCE = process.env.PI_API_KEY ? 'PI_API_KEY' : process.env.PI_SERVER_API_KEY ? 'PI_SERVER_API_KEY' : ''
const PI_API_KEY = process.env.PI_API_KEY || process.env.PI_SERVER_API_KEY || ''
const PI_WALLET_PRIVATE_SEED = process.env.PI_WALLET_PRIVATE_SEED || ''
const DRY_RUN = process.argv.includes('--dry-run')
const RECIPIENTS_PATH = new URL('./pi-a2u-known-recipients.json', import.meta.url)
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
      'X-PiTiles-Admin': ADMIN_TOKEN,
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

async function readKnownRecipients() {
  try {
    const recipients = JSON.parse(await readFile(RECIPIENTS_PATH, 'utf8'))
    return Array.isArray(recipients) ? recipients : []
  } catch {
    return []
  }
}

async function writeKnownRecipients(recipients) {
  await writeFile(RECIPIENTS_PATH, `${JSON.stringify(recipients, null, 2)}\n`)
}

function needsSubmission(payment) {
  const id = getPaymentId(payment)
  const isAppToUser = payment?.direction === 'app_to_user' || payment?.direction === 'AppToUser' || payment?.to_address
  const needsTx = !payment?.transaction?.txid
  const needsCompletion = !payment?.status?.developer_completed

  return id && isAppToUser && needsTx && needsCompletion
}

function describePaymentState(payment) {
  const status = payment?.status || {}
  const txid = payment?.transaction?.txid || ''

  return [
    `direction=${payment?.direction || 'unknown'}`,
    `developer_approved=${Boolean(status.developer_approved)}`,
    `transaction_verified=${Boolean(status.transaction_verified)}`,
    `developer_completed=${Boolean(status.developer_completed)}`,
    `cancelled=${Boolean(status.cancelled)}`,
    `txid=${txid || 'none'}`,
  ].join(' | ')
}

function fingerprint(value) {
  if (!value) return 'missing'

  return `${value.slice(0, 5)}...${value.slice(-5)} (${value.length} chars)`
}

function describeSdkError(error) {
  if (!error || typeof error !== 'object') return String(error)

  const response = error.response
  const status = response?.status ? `status=${response.status}` : ''
  const payload = response?.data ? ` payload=${JSON.stringify(response.data)}` : ''
  const message = error instanceof Error ? error.message : String(error)

  return [message, status, payload].filter(Boolean).join(' | ')
}

async function main() {
  if (!DRY_RUN && !PI_API_KEY) throw new Error('Missing PI_API_KEY environment variable.')
  if (!DRY_RUN && !PI_WALLET_PRIVATE_SEED) throw new Error('Missing PI_WALLET_PRIVATE_SEED environment variable.')

  console.log(`Mode: ${DRY_RUN ? 'dry-run' : 'submit'}`)
  console.log(`Pi API key: ${PI_API_KEY_SOURCE || 'missing'} ${fingerprint(PI_API_KEY)}`)
  console.log(`Wallet seed: ${fingerprint(PI_WALLET_PRIVATE_SEED)}`)

  const pi = new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED)
  const incompletePayload = await request('/api/pi/payments/incomplete-server', {
    method: 'GET',
  })
  const recipients = await readKnownRecipients()
  const paymentsById = new Map(
    extractPayments(incompletePayload)
      .filter(needsSubmission)
      .map((payment) => [getPaymentId(payment), payment]),
  )

  const locallyTrackedIds = recipients
    .filter((recipient) => ['created', 'duplicate', 'needs_completion'].includes(recipient.paymentStatus))
    .map((recipient) => getPaymentId(recipient))
    .filter(Boolean)
  let reconciledCount = 0

  for (const paymentId of locallyTrackedIds) {
    if (paymentsById.has(paymentId)) continue

    try {
      const payment = await pi.getPayment(paymentId)
      console.log(`Tracked ${paymentId}: ${describePaymentState(payment)}`)

      if (payment?.status?.developer_completed && payment?.transaction?.txid) {
        const recipientIndex = recipients.findIndex((recipient) => getPaymentId(recipient) === paymentId)

        if (recipientIndex >= 0) {
          recipients[recipientIndex] = {
            ...recipients[recipientIndex],
            paymentStatus: 'completed',
            txid: payment.transaction.txid,
            paymentCompletedAt: recipients[recipientIndex].paymentCompletedAt || new Date().toISOString(),
          }
          reconciledCount += 1
        }
        continue
      }

      if (needsSubmission(payment)) paymentsById.set(paymentId, payment)
    } catch (error) {
      console.warn(`Unable to inspect tracked payment ${paymentId}:`, describeSdkError(error))
    }
  }

  if (reconciledCount > 0) {
    await writeKnownRecipients(recipients)
    console.log(`Reconciled completed payments in local tracking: ${reconciledCount}`)
  }

  const payments = [...paymentsById.values()]

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

      const recipientIndex = recipients.findIndex((recipient) => getPaymentId(recipient) === paymentId)
      if (recipientIndex >= 0) {
        recipients[recipientIndex] = {
          ...recipients[recipientIndex],
          paymentStatus: 'completed',
          txid,
          paymentCompletedAt: new Date().toISOString(),
        }
        await writeKnownRecipients(recipients)
      }
    } catch (error) {
      console.error(`FAILED ${paymentId}:`, describeSdkError(error))
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
