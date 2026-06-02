#!/usr/bin/env node

import 'dotenv/config'

const BASE_URL = process.env.PITILES_BASE_URL || 'https://play-pi-tiles.com'
const ADMIN_TOKEN = process.env.PITILES_ADMIN_TOKEN || process.env.PI_ADMIN_TOKEN || ''
const DEFAULT_RECIPIENTS_PATH = new URL('./pi-a2u-known-recipients.json', import.meta.url)
const DEFAULT_A2U_AMOUNT = Number(process.env.PITILES_A2U_AMOUNT || 0.01)
const DEFAULT_A2U_MEMO_PREFIX = process.env.PITILES_A2U_MEMO_PREFIX || 'PlayPiTiles Testnet wallet validation'
const DEFAULT_SYNC_INTERVAL_MS = Number(process.env.PITILES_SYNC_INTERVAL_MS || 60000)
const DEFAULT_CREATE_LIMIT = Number(process.env.PITILES_A2U_LIMIT || 0)
const DEFAULT_A2U_TARGET = Number(process.env.PITILES_A2U_TARGET || 10)

function printUsage() {
  console.log(`
Usage:
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs create recipients.json
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs auto-10 [recipients.json]
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs sync-create [recipients.json]
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs watch-create [recipients.json]
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs complete <paymentId> <txid>
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs incomplete
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs users
  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs add-users users.json

Recipients file:
  [
    { "uid": "pi-user-uid-1", "amount": 0.01, "memo": "PlayPiTiles test payout 1" },
    { "uid": "pi-user-uid-2", "amount": 0.01, "memo": "PlayPiTiles test payout 2" }
  ]

sync-create fetches known Pi users, updates the recipients file, then creates only missing
App-to-User payments. watch-create repeats that flow every PITILES_SYNC_INTERVAL_MS.
Set PITILES_A2U_LIMIT=10 to create at most 10 new missing payments in one run.
auto-10 waits until PITILES_A2U_TARGET users are known, then creates payments for that target set.
`)
}

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

async function readJsonFile(filePath, fallback) {
  const { readFile } = await import('node:fs/promises')

  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFile(filePath, payload) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function getRecipientsPath(filePath) {
  return filePath || DEFAULT_RECIPIENTS_PATH
}

function getRecipientPaymentId(recipient) {
  return recipient.paymentId || recipient.payment?.id || recipient.payment?.payment?.identifier || ''
}

function getRecipientReference(recipient, index) {
  const uid = String(recipient.uid || '').trim()
  return String(recipient.reference || `testnet-mainnet-wallet-validation-${uid || index + 1}`)
}

function normalizeRecipient(recipient, index) {
  const uid = String(recipient.uid || '').trim()
  const amount = Number(recipient.amount ?? DEFAULT_A2U_AMOUNT)
  const memo = String(recipient.memo || `${DEFAULT_A2U_MEMO_PREFIX} ${index + 1}`)

  return {
    ...recipient,
    uid,
    amount,
    memo,
    reference: getRecipientReference(recipient, index),
  }
}

async function createPayments(filePath, options = {}) {
  if (!filePath) {
    printUsage()
    process.exitCode = 1
    return
  }

  const recipients = await readJsonFile(filePath, [])

  if (!Array.isArray(recipients)) {
    throw new Error('Recipients file must contain an array.')
  }

  if (recipients.length === 0 && options.onlyMissing) {
    console.log('No recipients yet.')
    return
  }

  if (recipients.length === 0) {
    throw new Error('Recipients file must contain a non-empty array.')
  }

  const seen = new Set()
  const results = []
  let createdCount = 0

  for (const [index, recipient] of recipients.entries()) {
    if (options.maxRecipients && index >= options.maxRecipients) break

    const normalizedRecipient = normalizeRecipient(recipient, index)
    const uid = normalizedRecipient.uid

    if (!uid) throw new Error(`Recipient #${index + 1} is missing uid.`)
    if (seen.has(uid)) throw new Error(`Duplicate uid in recipients file: ${uid}`)
    seen.add(uid)

    if (options.onlyMissing && getRecipientPaymentId(normalizedRecipient)) {
      console.log(`#${index + 1} | skipped | uid=${uid} | paymentId=${getRecipientPaymentId(normalizedRecipient)}`)
      continue
    }

    if (options.limit && createdCount >= options.limit) {
      console.log(`#${index + 1} | pending | uid=${uid} | limit reached`)
      continue
    }

    const result = await request('/api/pi/payments/app-to-user', {
      method: 'POST',
      body: JSON.stringify({
        uid,
        amount: normalizedRecipient.amount,
        memo: normalizedRecipient.memo,
        reference: normalizedRecipient.reference,
        metadata: {
          purpose: 'mainnet-wallet-validation',
          position: index + 1,
          ...(normalizedRecipient.username ? { username: normalizedRecipient.username } : {}),
        },
      }),
    })

    results.push(result)
    createdCount += 1
    const payment = result.payment
    const paymentId = payment?.id || payment?.payment?.identifier || 'missing'

    recipients[index] = {
      ...normalizedRecipient,
      paymentId,
      paymentStatus: result.duplicate ? 'duplicate' : 'created',
      paymentUpdatedAt: new Date().toISOString(),
      ...(payment?.payment?.from_address ? { fromAddress: payment.payment.from_address } : {}),
      ...(payment?.payment?.to_address ? { toAddress: payment.payment.to_address } : {}),
    }

    if (options.writeBack) {
      await writeJsonFile(filePath, recipients)
    }

    console.log(
      [
        `#${index + 1}`,
        result.duplicate ? 'duplicate' : 'created',
        `uid=${uid}`,
        `paymentId=${paymentId}`,
        `amount=${normalizedRecipient.amount}`,
        payment?.payment?.from_address ? `from=${payment.payment.from_address}` : '',
        payment?.payment?.to_address ? `to=${payment.payment.to_address}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    )
  }

  if (options.writeBack) {
    await writeJsonFile(filePath, recipients)
    console.log(`\nRecipients file updated: ${filePath}`)
  }

  console.log('\nNext: send each blockchain transaction from the app wallet, then run:')
  console.log('  PITILES_ADMIN_TOKEN=... node scripts/pi-a2u-payments.mjs complete <paymentId> <txid>')
}

async function completePayment(paymentId, txid) {
  if (!paymentId || !txid) {
    printUsage()
    process.exitCode = 1
    return
  }

  const result = await request('/api/pi/payments/app-to-user/complete', {
    method: 'POST',
    body: JSON.stringify({
      paymentId,
      txid,
    }),
  })

  console.log(JSON.stringify(result, null, 2))
}

async function incompletePayments() {
  const result = await request('/api/pi/payments/incomplete-server', {
    method: 'GET',
  })

  console.log(JSON.stringify(result, null, 2))
}

async function knownUsers() {
  const result = await request('/api/admin/pi-users', {
    method: 'GET',
  })

  console.log(`Known Pi users (${result.scope || 'current week'}): ${result.count}`)
  for (const user of result.users || []) {
    console.log(`${user.uid} | ${user.username || 'unknown'} | best=${user.bestScore} | scores=${user.scores} | ${user.vip ? 'VIP' : 'Pioneer'}`)
  }
}

async function fetchKnownUsers() {
  const result = await request('/api/admin/pi-users', {
    method: 'GET',
  })

  return Array.isArray(result.users) ? result.users : []
}

async function syncKnownRecipients(filePath) {
  const resolvedPath = getRecipientsPath(filePath)
  const recipients = await readJsonFile(resolvedPath, [])

  if (!Array.isArray(recipients)) {
    throw new Error('Recipients file must contain an array.')
  }

  const users = await fetchKnownUsers()
  const recipientsByUid = new Map(recipients.map((recipient) => [String(recipient.uid || '').trim(), recipient]))
  let addedCount = 0
  let updatedCount = 0

  for (const user of users) {
    const uid = String(user.uid || '').trim()
    if (!uid) continue

    const existing = recipientsByUid.get(uid)
    if (existing) {
      if (user.username && existing.username !== user.username) {
        existing.username = user.username
        updatedCount += 1
      }
      continue
    }

    const position = recipients.length + 1
    const nextRecipient = {
      uid,
      username: user.username || '',
      amount: DEFAULT_A2U_AMOUNT,
      memo: `${DEFAULT_A2U_MEMO_PREFIX} ${position}`,
      reference: `testnet-mainnet-wallet-validation-${uid}`,
      discoveredAt: new Date().toISOString(),
    }

    recipients.push(nextRecipient)
    recipientsByUid.set(uid, nextRecipient)
    addedCount += 1
  }

  await writeJsonFile(resolvedPath, recipients)
  console.log(`Recipients synced: ${resolvedPath}`)
  console.log(`Known users fetched: ${users.length} | added=${addedCount} | username updates=${updatedCount}`)

  return {
    filePath: resolvedPath,
    recipients,
    addedCount,
    updatedCount,
  }
}

async function syncCreatePayments(filePath) {
  const { filePath: resolvedPath } = await syncKnownRecipients(filePath)
  await createPayments(resolvedPath, {
    limit: DEFAULT_CREATE_LIMIT,
    onlyMissing: true,
    writeBack: true,
  })
}

async function autoCreateTargetPayments(filePath) {
  const target = DEFAULT_A2U_TARGET
  const resolvedPath = getRecipientsPath(filePath)

  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('PITILES_A2U_TARGET must be a positive number.')
  }

  while (true) {
    const { recipients } = await syncKnownRecipients(resolvedPath)
    const validRecipients = recipients.filter((recipient) => String(recipient.uid || '').trim())

    if (validRecipients.length >= target) {
      console.log(`Target reached: ${validRecipients.length}/${target} known users.`)
      await createPayments(resolvedPath, {
        maxRecipients: target,
        onlyMissing: true,
        writeBack: true,
      })
      console.log(`\nCreated or confirmed App-to-User payments for the first ${target} users.`)
      console.log('Next: submit incomplete server payments with:')
      console.log('  node scripts/pi-a2u-submit-incomplete.mjs --dry-run')
      console.log('  node scripts/pi-a2u-submit-incomplete.mjs')
      return
    }

    console.log(`Waiting for known users: ${validRecipients.length}/${target}. Next check in ${DEFAULT_SYNC_INTERVAL_MS}ms.`)
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_SYNC_INTERVAL_MS))
  }
}

async function watchCreatePayments(filePath) {
  const resolvedPath = getRecipientsPath(filePath)

  console.log(`Watching known Pi users every ${DEFAULT_SYNC_INTERVAL_MS}ms. Recipients file: ${resolvedPath}`)

  while (true) {
    try {
      await syncCreatePayments(resolvedPath)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    }

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_SYNC_INTERVAL_MS))
  }
}

async function addUsers(filePath) {
  if (!filePath) {
    printUsage()
    process.exitCode = 1
    return
  }

  const { readFile } = await import('node:fs/promises')
  const users = JSON.parse(await readFile(filePath, 'utf8'))
  const result = await request('/api/admin/pi-users', {
    method: 'POST',
    body: JSON.stringify({
      users,
    }),
  })

  console.log(`Known Pi users (global): ${result.count}`)
  console.log(`New users added: ${result.addedCount}`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'create') return createPayments(args[0])
  if (command === 'auto-10') return autoCreateTargetPayments(args[0])
  if (command === 'sync-create') return syncCreatePayments(args[0])
  if (command === 'watch-create') return watchCreatePayments(args[0])
  if (command === 'complete') return completePayment(args[0], args[1])
  if (command === 'incomplete') return incompletePayments()
  if (command === 'users') return knownUsers()
  if (command === 'add-users') return addUsers(args[0])

  printUsage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
