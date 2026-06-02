export interface Env {
  PI_API_KEY?: SecretBinding
  PI_SERVER_API_KEY?: SecretBinding
  PI_ADMIN_TOKEN?: SecretBinding
  PI_MOCK_PAYMENTS?: string
  LEADERBOARD?: KVNamespace
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
}

const PI_API_BASE = 'https://api.minepi.com/v2'
const PI_API_TIMEOUT_MS = 15000
const REWARD_RANK_LIMIT = 10
const DAY_MS = 24 * 60 * 60 * 1000
const GMT_PLUS_ONE_OFFSET_MS = 60 * 60 * 1000
const LEADERBOARD_TTL_SECONDS = 60 * 60 * 24 * 14
const MIN_VALID_MOVES = 2
const REWARD_SHARES = [0.25, 0.15, 0.1, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7] as const
const VIP_PRICE_PI = 1
const VIP_POOL_SHARE = 0.2
const A2U_PAYMENT_TTL_SECONDS = 60 * 60 * 24 * 30
const GLOBAL_KNOWN_PI_USERS_KEY = 'known-pi-users:global'
const KNOWN_PI_USERS_LOOKBACK_WEEKS = 8

type KVNamespace = {
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>
  list?: (options?: { prefix?: string }) => Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}

type AuthVerifyBody = {
  accessToken?: string
}

type ScorePayload = {
  piUid?: string
  username?: string
  score?: number
  validMoves?: number
  finalBoardHash?: string
  week?: string
  clientTimestamp?: string
  antiCheatVersion?: string
}

type SubmitScoreBody = {
  payload?: ScorePayload
  isVip?: boolean
  accessToken?: string
}

type LeaderboardEntry = {
  id: string
  piUid: string
  name: string
  score: number
  games: number
  vip: boolean
  isPlayer: boolean
  week: string
  weekKey: string
  submittedAt: string
  rewardsRank: number | null
  reward: string
  rewardEligible: boolean
  rank: number
}

type StoredLeaderboard = {
  week: string
  weekKey: string
  weekStartsAt: string
  weekEndsAt: string
  entries: LeaderboardEntry[]
  updatedAt: string
  rewards: {
    vipMembers: number
    weeklyPool: number
  }
}

type VipRewardStats = {
  weekKey: string
  activeVips: number
  weeklyPool: number
  updatedAt: string
}

type VipPass = {
  active: boolean
  piUid: string
  username: string
  paymentId: string
  txid?: string
  identifier?: string
  activatedAt: string
  expiresAt: string
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

type VipStatusBody = {
  accessToken?: string
}

type IncompleteBody = {
  paymentId?: string
  accessToken?: string
}

type AppToUserPaymentBody = {
  uid?: string
  amount?: number
  memo?: string
  metadata?: Record<string, unknown>
  reference?: string
}

type CompleteAppToUserPaymentBody = {
  paymentId?: string
  txid?: string
  reference?: string
}

type AdminPiUsersBody = {
  uid?: string
  username?: string
  users?: {
    uid?: string
    username?: string
  }[]
}

type PiMeResponse = {
  uid?: string
  username?: string
}

type PiPaymentDTO = {
  identifier?: string
  user_uid?: string
  amount?: number
  memo?: string
  metadata?: Record<string, unknown>
  from_address?: string
  to_address?: string
  direction?: string
  created_at?: string
  network?: string
  status?: {
    developer_approved?: boolean
    transaction_verified?: boolean
    developer_completed?: boolean
    cancelled?: boolean
    user_cancelled?: boolean
  }
  transaction?: null | {
    txid?: string
    verified?: boolean
    _link?: string
  }
}

type StoredAppToUserPayment = {
  id: string
  uid: string
  amount: number
  memo: string
  reference: string
  metadata: Record<string, unknown>
  status: 'created' | 'completed'
  createdAt: string
  completedAt?: string
  txid?: string
  payment: PiPaymentDTO
}

type KnownPiUser = {
  uid: string
  username: string
  firstSeenAt: string
  lastSeenAt: string
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
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-PiTiles-Admin, X-Admin-Token')
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

async function getPiAdminToken(env: Env) {
  return resolveSecretBinding(env.PI_ADMIN_TOKEN)
}

function shouldMockPayments(env: Env) {
  return env.PI_MOCK_PAYMENTS?.toLowerCase() === 'true'
}

function isVipPaymentIdentifier(identifier?: string) {
  return Boolean(identifier?.startsWith('playpitiles-vip-'))
}

function getVipPassKey(piUid: string) {
  return `vip-pass:${piUid}`
}

async function storeVipPass({
  env,
  user,
  paymentId,
  txid,
  identifier,
}: {
  env: Env
  user: PiMeResponse
  paymentId: string
  txid?: string
  identifier?: string
}) {
  if (!env.LEADERBOARD || !user.uid) return null

  const activatedAt = new Date()
  const week = getWeeklyPeriod(activatedAt)
  const existingPass = await readVipPass(env, user.uid)

  if (existingPass && getWeeklyPeriod(new Date(existingPass.activatedAt)).key === week.key) {
    return existingPass
  }

  const expiresAt = new Date(week.endsAt)
  const ttlSeconds = Math.max(60, Math.ceil((expiresAt.getTime() - activatedAt.getTime()) / 1000))

  const pass: VipPass = {
    active: true,
    piUid: user.uid,
    username: user.username || '',
    paymentId,
    txid,
    identifier,
    activatedAt: activatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }

  await env.LEADERBOARD.put(getVipPassKey(user.uid), JSON.stringify(pass), {
    expirationTtl: ttlSeconds,
  })
  await incrementVipRewardStats(env)

  return pass
}

async function readVipPass(env: Env, piUid: string) {
  if (!env.LEADERBOARD) return null

  const stored = await env.LEADERBOARD.get(getVipPassKey(piUid))
  if (!stored) return null

  try {
    const pass = JSON.parse(stored) as VipPass

    if (!pass.expiresAt || new Date(pass.expiresAt).getTime() <= Date.now()) return null
    if (pass.activatedAt && getWeeklyPeriod(new Date(pass.activatedAt)).key !== getWeeklyPeriod().key) return null

    return {
      ...pass,
      active: true,
    }
  } catch (error) {
    console.error('[VIP] failed to parse VIP pass', error)
    return null
  }
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

function getWeeklyPeriod(date = new Date()) {
  const gmtPlusOneDate = new Date(date.getTime() + GMT_PLUS_ONE_OFFSET_MS)
  const gmtPlusOneDay = gmtPlusOneDate.getUTCDay()
  const gmtPlusOneMidnight = Date.UTC(
    gmtPlusOneDate.getUTCFullYear(),
    gmtPlusOneDate.getUTCMonth(),
    gmtPlusOneDate.getUTCDate(),
  )
  const startLocalMidnight = gmtPlusOneMidnight - gmtPlusOneDay * DAY_MS
  const startUtc = new Date(startLocalMidnight - GMT_PLUS_ONE_OFFSET_MS)
  const endUtc = new Date(startUtc.getTime() + 7 * DAY_MS)
  const startLabelDate = new Date(startUtc.getTime() + GMT_PLUS_ONE_OFFSET_MS)
  const year = startLabelDate.getUTCFullYear()
  const firstSunday = new Date(Date.UTC(year, 0, 1))
  firstSunday.setUTCDate(firstSunday.getUTCDate() - firstSunday.getUTCDay())
  const week = Math.floor((startLabelDate.getTime() - firstSunday.getTime()) / (7 * DAY_MS)) + 1
  const paddedWeek = String(week).padStart(2, '0')

  return {
    key: `${year}-S${paddedWeek}`,
    label: `Week ${week} · ${year}`,
    startsAt: startUtc.toISOString(),
    endsAt: endUtc.toISOString(),
  }
}

function getRecentWeeklyPeriods(date = new Date(), count = KNOWN_PI_USERS_LOOKBACK_WEEKS) {
  return Array.from({ length: count }, (_, index) => getWeeklyPeriod(new Date(date.getTime() - index * 7 * DAY_MS)))
}

function getLeaderboardKey(weekKey: string) {
  return `leaderboard:${weekKey}`
}

function getVipStatsKey(weekKey: string) {
  return `vip-stats:${weekKey}`
}

function getKnownPiUsersKey(weekKey: string) {
  return `known-pi-users:${weekKey}`
}

function getAppToUserPaymentKey(paymentId: string) {
  return `a2u-payment:${paymentId}`
}

function getAppToUserReferenceKey(reference: string) {
  return `a2u-reference:${reference}`
}

function calculateRewardPool(vipMembers: number) {
  const weeklyPool = Number((vipMembers * VIP_PRICE_PI * VIP_POOL_SHARE).toFixed(2))

  return {
    vipMembers,
    weeklyPool,
  }
}

function rewardPoolFromStats(stats: VipRewardStats) {
  return {
    vipMembers: stats.activeVips,
    weeklyPool: stats.weeklyPool,
  }
}

async function readVipRewardStats(env: Env, week = getWeeklyPeriod()): Promise<VipRewardStats> {
  const emptyStats: VipRewardStats = {
    weekKey: week.key,
    activeVips: 0,
    weeklyPool: 0,
    updatedAt: new Date().toISOString(),
  }

  if (!env.LEADERBOARD) return emptyStats

  const stored = await env.LEADERBOARD.get(getVipStatsKey(week.key))
  if (!stored) return emptyStats

  try {
    return {
      ...emptyStats,
      ...(JSON.parse(stored) as VipRewardStats),
      weekKey: week.key,
    }
  } catch (error) {
    console.error('[VIP] failed to parse VIP reward stats', error)
    return emptyStats
  }
}

async function readKnownPiUsers(env: Env, week = getWeeklyPeriod()) {
  if (!env.LEADERBOARD) return []

  const stored = await env.LEADERBOARD.get(getKnownPiUsersKey(week.key))
  if (!stored) return []

  try {
    const users = JSON.parse(stored) as KnownPiUser[]
    return Array.isArray(users) ? users : []
  } catch (error) {
    console.error('[Pi Auth] failed to parse known Pi users', error)
    return []
  }
}

async function writeKnownPiUsers(env: Env, key: string, users: KnownPiUser[], expirationTtl?: number) {
  if (!env.LEADERBOARD) return

  await env.LEADERBOARD.put(
    key,
    JSON.stringify(users.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.username.localeCompare(b.username))),
    expirationTtl ? { expirationTtl } : undefined,
  )
}

async function readKnownPiUsersByKey(env: Env, key: string) {
  if (!env.LEADERBOARD) return []

  const stored = await env.LEADERBOARD.get(key)
  if (!stored) return []

  try {
    const users = JSON.parse(stored) as KnownPiUser[]
    return Array.isArray(users) ? users : []
  } catch (error) {
    console.error('[Pi Auth] failed to parse known Pi users', error)
    return []
  }
}

function mergeKnownPiUsers(...groups: KnownPiUser[][]) {
  const usersByUid = new Map<string, KnownPiUser>()

  groups.flat().forEach((user) => {
    if (!user.uid) return

    const current = usersByUid.get(user.uid)
    usersByUid.set(user.uid, {
      uid: user.uid,
      username: user.username || current?.username || '',
      firstSeenAt: current?.firstSeenAt && current.firstSeenAt < user.firstSeenAt ? current.firstSeenAt : user.firstSeenAt,
      lastSeenAt: current?.lastSeenAt && current.lastSeenAt > user.lastSeenAt ? current.lastSeenAt : user.lastSeenAt,
    })
  })

  return [...usersByUid.values()]
}

async function readGlobalKnownPiUsers(env: Env) {
  return readKnownPiUsersByKey(env, GLOBAL_KNOWN_PI_USERS_KEY)
}

async function rememberPiUser(env: Env, user: PiMeResponse, week = getWeeklyPeriod()) {
  if (!env.LEADERBOARD || !user.uid) return

  const users = await readKnownPiUsers(env, week)
  const globalUsers = await readGlobalKnownPiUsers(env)
  const now = new Date().toISOString()
  const current = users.find((knownUser) => knownUser.uid === user.uid)
  const nextUsers = current
    ? users.map((knownUser) =>
        knownUser.uid === user.uid
          ? {
              ...knownUser,
              username: user.username || knownUser.username,
              lastSeenAt: now,
            }
          : knownUser,
      )
    : [
        ...users,
        {
          uid: user.uid,
          username: user.username || '',
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ]

  const nextGlobalUsers = mergeKnownPiUsers(globalUsers, nextUsers)

  await writeKnownPiUsers(env, getKnownPiUsersKey(week.key), nextUsers, LEADERBOARD_TTL_SECONDS)
  await writeKnownPiUsers(env, GLOBAL_KNOWN_PI_USERS_KEY, nextGlobalUsers)
}

async function incrementVipRewardStats(env: Env, week = getWeeklyPeriod()) {
  if (!env.LEADERBOARD) return null

  const currentStats = await readVipRewardStats(env, week)
  const activeVips = currentStats.activeVips + 1
  const pool = calculateRewardPool(activeVips)
  const nextStats: VipRewardStats = {
    weekKey: week.key,
    activeVips,
    weeklyPool: pool.weeklyPool,
    updatedAt: new Date().toISOString(),
  }

  await env.LEADERBOARD.put(getVipStatsKey(week.key), JSON.stringify(nextStats), {
    expirationTtl: LEADERBOARD_TTL_SECONDS,
  })

  return nextStats
}

async function writeVipRewardStats(env: Env, activeVips: number, week = getWeeklyPeriod()) {
  if (!env.LEADERBOARD) return null

  const pool = calculateRewardPool(activeVips)
  const nextStats: VipRewardStats = {
    weekKey: week.key,
    activeVips,
    weeklyPool: pool.weeklyPool,
    updatedAt: new Date().toISOString(),
  }

  await env.LEADERBOARD.put(getVipStatsKey(week.key), JSON.stringify(nextStats), {
    expirationTtl: LEADERBOARD_TTL_SECONDS,
  })

  return nextStats
}

function rewardForVipRank(vipRank: number | null, pool: number) {
  if (!vipRank || vipRank > REWARD_RANK_LIMIT) return 'Global Only'

  const share = REWARD_SHARES[vipRank - 1] || 0
  const reward = (pool * share).toFixed(2)

  return `${reward} Pi`
}

type AdminCheck = { ok: true } | { ok: false; response: Response }

async function requireAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const adminToken = await getPiAdminToken(env)
  const requestToken =
    request.headers.get('X-PiTiles-Admin') ||
    request.headers.get('X-Admin-Token') ||
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')

  if (!adminToken) {
    return {
      ok: false,
      response: apiJson(
        request,
        {
          error: 'Missing PI_ADMIN_TOKEN',
        },
        500,
      ),
    }
  }

  if (!requestToken || requestToken !== adminToken) {
    return {
      ok: false,
      response: apiJson(
        request,
        {
          error: 'Unauthorized',
        },
        401,
      ),
    }
  }

  return {
    ok: true,
  }
}

function decorateLeaderboard(entries: LeaderboardEntry[], week = getWeeklyPeriod(), rewards = calculateRewardPool(0)): StoredLeaderboard {
  const rankedEntries = [...entries]
    .sort((a, b) => b.score - a.score || new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())

  let vipRank = 0
  const decoratedEntries = rankedEntries.map((entry, index) => {
    if (!entry.vip) {
      return {
        ...entry,
        rank: index + 1,
        rewardsRank: null,
        reward: 'No rewards',
        rewardEligible: false,
      }
    }

    vipRank += 1

    return {
      ...entry,
      rank: index + 1,
      rewardsRank: vipRank,
      reward: rewardForVipRank(vipRank, rewards.weeklyPool),
      rewardEligible: vipRank <= REWARD_RANK_LIMIT,
    }
  })

  return {
    week: week.label,
    weekKey: week.key,
    weekStartsAt: week.startsAt,
    weekEndsAt: week.endsAt,
    entries: decoratedEntries,
    updatedAt: new Date().toISOString(),
    rewards,
  }
}

async function readStoredLeaderboard(env: Env, week = getWeeklyPeriod()) {
  const vipStats = await readVipRewardStats(env, week)
  const rewards = rewardPoolFromStats(vipStats)

  if (!env.LEADERBOARD) return decorateLeaderboard([], week, rewards)

  const stored = await env.LEADERBOARD.get(getLeaderboardKey(week.key))
  if (!stored) return decorateLeaderboard([], week, rewards)

  try {
    const parsed = JSON.parse(stored) as StoredLeaderboard
    return decorateLeaderboard(parsed.entries || [], week, rewards)
  } catch (error) {
    console.error('[Leaderboard] failed to parse stored leaderboard', error)
    return decorateLeaderboard([], week, rewards)
  }
}

async function writeStoredLeaderboard(env: Env, leaderboard: StoredLeaderboard) {
  if (!env.LEADERBOARD) {
    throw new Error('Missing LEADERBOARD KV binding')
  }

  await env.LEADERBOARD.put(getLeaderboardKey(leaderboard.weekKey), JSON.stringify(leaderboard), {
    expirationTtl: LEADERBOARD_TTL_SECONDS,
  })
}

async function storeAppToUserPayment(env: Env, payment: StoredAppToUserPayment) {
  if (!env.LEADERBOARD) {
    throw new Error('Missing LEADERBOARD KV binding')
  }

  await env.LEADERBOARD.put(getAppToUserPaymentKey(payment.id), JSON.stringify(payment), {
    expirationTtl: A2U_PAYMENT_TTL_SECONDS,
  })
  await env.LEADERBOARD.put(getAppToUserReferenceKey(payment.reference), payment.id, {
    expirationTtl: A2U_PAYMENT_TTL_SECONDS,
  })
}

async function readAppToUserPayment(env: Env, paymentId: string) {
  if (!env.LEADERBOARD) return null

  const stored = await env.LEADERBOARD.get(getAppToUserPaymentKey(paymentId))
  if (!stored) return null

  try {
    return JSON.parse(stored) as StoredAppToUserPayment
  } catch (error) {
    console.error('[Pi A2U] failed to parse stored payment', error)
    return null
  }
}

async function readAppToUserPaymentByReference(env: Env, reference: string) {
  if (!env.LEADERBOARD) return null

  const paymentId = await env.LEADERBOARD.get(getAppToUserReferenceKey(reference))
  if (!paymentId) return null

  return readAppToUserPayment(env, paymentId)
}

function validateLeaderboardPayload(payload?: ScorePayload) {
  if (!payload) return 'Missing score payload.'
  if (!payload.piUid?.trim()) return 'Missing player id.'
  if (!payload.username?.trim()) return 'Missing player name.'
  if (!Number.isFinite(payload.score) || Number(payload.score) <= 0) return 'Score must be positive.'
  if (!Number.isFinite(payload.validMoves) || Number(payload.validMoves) < MIN_VALID_MOVES) return 'Not enough valid moves.'
  if (!payload.finalBoardHash?.trim()) return 'Missing board validation hash.'

  return ''
}

async function getLeaderboard(request: Request, env: Env) {
  const leaderboard = await readStoredLeaderboard(env)
  return apiJson(request, leaderboard)
}

async function submitLeaderboardScore(request: Request, env: Env) {
  const body = await readJson<SubmitScoreBody>(request)
  const validationError = validateLeaderboardPayload(body?.payload)

  if (validationError) {
    return apiJson(
      request,
      {
        accepted: false,
        reason: validationError,
      },
      400,
    )
  }

  const payload = body!.payload!
  let piUid = payload.piUid!.trim()
  let username = payload.username!.trim()

  if (body?.accessToken) {
    try {
      const user = await verifyAccessToken(body.accessToken)
      piUid = user.uid || piUid
      username = user.username || username
    } catch (error) {
      return apiJson(
        request,
        {
          accepted: false,
          reason: error instanceof Error ? error.message : 'Invalid Pi access token',
        },
        401,
      )
    }
  }

  const week = getWeeklyPeriod()
  const currentLeaderboard = await readStoredLeaderboard(env, week)
  const previousPlayerGames = currentLeaderboard.entries.filter((entry) => entry.piUid === piUid).length
  const entry: LeaderboardEntry = {
    id: crypto.randomUUID(),
    piUid,
    name: username,
    score: Math.floor(Number(payload.score)),
    games: previousPlayerGames + 1,
    vip: Boolean(body?.isVip),
    isPlayer: true,
    week: week.label,
    weekKey: week.key,
    submittedAt: new Date().toISOString(),
    rewardsRank: null,
    reward: body?.isVip ? 'Global Only' : 'No rewards',
    rewardEligible: false,
    rank: 0,
  }
  const nextLeaderboard = decorateLeaderboard([...currentLeaderboard.entries, entry], week)
  const savedEntry = nextLeaderboard.entries.find((row) => row.id === entry.id)

  await writeStoredLeaderboard(env, nextLeaderboard)

  return apiJson(request, {
    accepted: true,
    entry: savedEntry || entry,
    leaderboard: nextLeaderboard,
  })
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

async function piServerFetch(env: Env, path: string, init?: RequestInit) {
  const apiKey = await getPiApiKey(env)

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      payload: {
        error: 'Missing PI_API_KEY',
      },
    }
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

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

async function verifyPiAuth(request: Request, env: Env) {
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
    await rememberPiUser(env, userPayload)

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

  if (shouldMockPayments(env)) {
    console.warn('[Pi Payment] mock approve', body.paymentId)

    return json({
      approved: true,
      paymentId: body.paymentId,
      identifier: body.identifier,
      mode: 'mock',
    })
  }

  console.info('[Pi Payment] approving payment', {
    paymentId: body.paymentId,
    identifier: body.identifier,
  })

  const piResponse = await piServerFetch(env, `/payments/${body.paymentId}/approve`, {
    method: 'POST',
  })

  console.info('[Pi Payment] approve response', {
    paymentId: body.paymentId,
    ok: piResponse.ok,
    status: piResponse.status,
    payload: piResponse.payload,
  })

  return json(
    {
      approved: piResponse.ok,
      paymentId: body.paymentId,
      identifier: body.identifier,
      payment: piResponse.payload,
      ...(!piResponse.ok ? { error: 'Pi payment approval failed.' } : {}),
    },
    piResponse.status,
  )
}

async function completePayment(request: Request, env: Env) {
  const body = await readJson<CompleteBody>(request)

  if (!body?.paymentId || !body?.txid) {
    return json({ error: 'Missing paymentId or txid' }, 400)
  }

  let verifiedUser: PiMeResponse | null = null

  if (body.accessToken) {
    try {
      verifiedUser = await verifyAccessToken(body.accessToken)
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
    const vipPass =
      verifiedUser && isVipPaymentIdentifier(body.identifier)
        ? await storeVipPass({
            env,
            user: verifiedUser,
            paymentId: body.paymentId,
            txid: body.txid,
            identifier: body.identifier,
          })
        : null

    return json({
      completed: true,
      paymentId: body.paymentId,
      txid: body.txid,
      identifier: body.identifier,
      vipPass,
      mode: 'mock',
    })
  }

  const completeResponse = await piServerRequest(env, `/payments/${body.paymentId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      txid: body.txid,
    }),
  })
  const completePayload = await completeResponse.json().catch(() => ({}))
  const vipPass =
    completeResponse.ok && verifiedUser && isVipPaymentIdentifier(body.identifier)
      ? await storeVipPass({
          env,
          user: verifiedUser,
          paymentId: body.paymentId,
          txid: body.txid,
          identifier: body.identifier,
        })
      : null

  return json(
    {
      ...completePayload,
      completed: completeResponse.ok,
      paymentId: body.paymentId,
      txid: body.txid,
      identifier: body.identifier,
      vipPass,
    },
    completeResponse.status,
  )
}

async function getVipStatus(request: Request, env: Env) {
  const body = await readJson<VipStatusBody>(request)

  if (!body?.accessToken) {
    return json({ active: false, error: 'Missing accessToken' }, 400)
  }

  try {
    const user = await verifyAccessToken(body.accessToken)
    const vipPass = await readVipPass(env, user.uid || '')

    return json({
      active: Boolean(vipPass?.active),
      vipPass,
    })
  } catch (error) {
    return json(
      {
        active: false,
        error: error instanceof Error ? error.message : 'Invalid Pi access token',
      },
      401,
    )
  }
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

function validateAppToUserPaymentBody(body: AppToUserPaymentBody | null) {
  if (!body?.uid?.trim()) return 'Missing Pi user uid.'
  if (!Number.isFinite(body.amount) || Number(body.amount) <= 0) return 'Amount must be positive.'
  if (!body.memo?.trim()) return 'Missing payment memo.'

  return ''
}

async function createAppToUserPayment(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const body = await readJson<AppToUserPaymentBody>(request)
  const validationError = validateAppToUserPaymentBody(body)

  if (validationError) {
    return apiJson(
      request,
      {
        created: false,
        error: validationError,
      },
      400,
    )
  }

  const uid = body!.uid!.trim()
  const amount = Number(Number(body!.amount).toFixed(7))
  const memo = body!.memo!.trim().slice(0, 256)
  const reference = (body!.reference || `a2u-${uid}-${amount}-${memo}`).trim().slice(0, 256)
  const existingPayment = await readAppToUserPaymentByReference(env, reference)

  if (existingPayment) {
    return apiJson(request, {
      created: false,
      duplicate: true,
      payment: existingPayment,
    })
  }

  const metadata = {
    app: 'playpitiles',
    type: 'app-to-user',
    reference,
    ...(body!.metadata || {}),
  }
  const piResponse = await piServerFetch(env, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      payment: {
        amount,
        memo,
        metadata,
        uid,
      },
    }),
  })

  if (!piResponse.ok) {
    return apiJson(
      request,
      {
        created: false,
        error: 'Pi App-to-User payment creation failed.',
        details: piResponse.payload,
      },
      piResponse.status,
    )
  }

  const payment = piResponse.payload as PiPaymentDTO
  const paymentId = payment.identifier

  if (!paymentId) {
    return apiJson(
      request,
      {
        created: false,
        error: 'Pi payment response did not include an identifier.',
        details: payment,
      },
      502,
    )
  }

  const storedPayment: StoredAppToUserPayment = {
    id: paymentId,
    uid,
    amount,
    memo,
    reference,
    metadata,
    status: 'created',
    createdAt: new Date().toISOString(),
    payment,
  }

  await storeAppToUserPayment(env, storedPayment)

  return apiJson(request, {
    created: true,
    payment: storedPayment,
  })
}

async function completeAppToUserPayment(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const body = await readJson<CompleteAppToUserPaymentBody>(request)

  if (!body?.paymentId?.trim() || !body.txid?.trim()) {
    return apiJson(
      request,
      {
        completed: false,
        error: 'Missing paymentId or txid.',
      },
      400,
    )
  }

  const paymentId = body.paymentId.trim()
  const txid = body.txid.trim()
  const piResponse = await piServerFetch(env, `/payments/${paymentId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      txid,
    }),
  })

  if (!piResponse.ok) {
    return apiJson(
      request,
      {
        completed: false,
        error: 'Pi App-to-User payment completion failed.',
        details: piResponse.payload,
      },
      piResponse.status,
    )
  }

  const storedPayment = await readAppToUserPayment(env, paymentId)
  const completedPayment: StoredAppToUserPayment = {
    ...(storedPayment || {
      id: paymentId,
      uid: '',
      amount: 0,
      memo: '',
      reference: body.reference || paymentId,
      metadata: {},
      createdAt: new Date().toISOString(),
      payment: piResponse.payload as PiPaymentDTO,
    }),
    status: 'completed',
    completedAt: new Date().toISOString(),
    txid,
    payment: piResponse.payload as PiPaymentDTO,
  }

  await storeAppToUserPayment(env, completedPayment)

  return apiJson(request, {
    completed: true,
    payment: completedPayment,
  })
}

async function getIncompleteServerPayments(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const piResponse = await piServerFetch(env, '/payments/incomplete_server_payments', {
    method: 'GET',
  })

  return apiJson(
    request,
    {
      ok: piResponse.ok,
      ...((piResponse.payload as Record<string, unknown>) || {}),
    },
    piResponse.status,
  )
}

async function getKnownPiUsers(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const leaderboard = await readStoredLeaderboard(env)
  const recentWeeks = getRecentWeeklyPeriods()
  const knownUsersByWeek = await Promise.all(recentWeeks.map((week) => readKnownPiUsers(env, week)))
  const globalKnownUsers = await readGlobalKnownPiUsers(env)
  const knownUsers = mergeKnownPiUsers(globalKnownUsers, ...knownUsersByWeek)
  const recentLeaderboards = await Promise.all(recentWeeks.map((week) => readStoredLeaderboard(env, week)))
  const usersByUid = new Map<string, { uid: string; username: string; vip: boolean; scores: number; bestScore: number }>()

  knownUsers.forEach((user) => {
    usersByUid.set(user.uid, {
      uid: user.uid,
      username: user.username,
      vip: false,
      scores: 0,
      bestScore: 0,
    })
  })

  recentLeaderboards.flatMap((storedLeaderboard) => storedLeaderboard.entries).forEach((entry) => {
    if (!entry.piUid || entry.piUid.startsWith('guest-') || entry.piUid === 'guest-user') return

    const current = usersByUid.get(entry.piUid)
    const next = {
      uid: entry.piUid,
      username: entry.name,
      vip: Boolean(current?.vip || entry.vip),
      scores: (current?.scores || 0) + 1,
      bestScore: Math.max(current?.bestScore || 0, entry.score),
    }

    usersByUid.set(entry.piUid, next)
  })

  const knownUsersFromLeaderboards = [...usersByUid.values()].map((user) => ({
    uid: user.uid,
    username: user.username,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }))
  const nextGlobalUsers = mergeKnownPiUsers(knownUsers, knownUsersFromLeaderboards)

  if (nextGlobalUsers.length !== globalKnownUsers.length) {
    await writeKnownPiUsers(env, GLOBAL_KNOWN_PI_USERS_KEY, nextGlobalUsers)
  }

  return apiJson(request, {
    week: leaderboard.week,
    weekKey: leaderboard.weekKey,
    scope: 'global',
    count: usersByUid.size,
    migratedWeeks: recentWeeks.map((week) => week.key),
    users: [...usersByUid.values()].sort((a, b) => b.bestScore - a.bestScore || a.username.localeCompare(b.username)),
  })
}

async function addKnownPiUsers(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const body = await readJson<AdminPiUsersBody>(request)
  const inputUsers = body?.users?.length ? body.users : body?.uid ? [{ uid: body.uid, username: body.username }] : []
  const now = new Date().toISOString()
  const usersToAdd: KnownPiUser[] = inputUsers
    .map((user) => ({
      uid: String(user.uid || '').trim(),
      username: String(user.username || '').trim(),
      firstSeenAt: now,
      lastSeenAt: now,
    }))
    .filter((user) => Boolean(user.uid) && !user.uid.startsWith('guest-') && user.uid !== 'guest-user')

  if (!usersToAdd.length) {
    return apiJson(
      request,
      {
        added: false,
        error: 'Missing Pi uid.',
      },
      400,
    )
  }

  const currentUsers = await readGlobalKnownPiUsers(env)
  const nextUsers = mergeKnownPiUsers(currentUsers, usersToAdd)

  await writeKnownPiUsers(env, GLOBAL_KNOWN_PI_USERS_KEY, nextUsers)

  return apiJson(request, {
    added: true,
    addedCount: nextUsers.length - currentUsers.length,
    count: nextUsers.length,
    users: nextUsers,
  })
}

async function inspectPiUsers(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  const recentWeeks = getRecentWeeklyPeriods()
  const globalKnownUsers = await readGlobalKnownPiUsers(env)
  const weeklyKnownUsers = await Promise.all(
    recentWeeks.map(async (week) => ({
      weekKey: week.key,
      users: await readKnownPiUsers(env, week),
    })),
  )
  const leaderboards = await Promise.all(
    recentWeeks.map(async (week) => ({
      weekKey: week.key,
      leaderboard: await readStoredLeaderboard(env, week),
    })),
  )
  const vipPasses: KnownPiUser[] = []

  if (env.LEADERBOARD?.list) {
    let cursor: string | undefined

    do {
      const page = await env.LEADERBOARD.list({
        prefix: 'vip-pass:',
        ...(cursor ? { cursor } : {}),
      })

      await Promise.all(
        page.keys.map(async (key) => {
          const stored = await env.LEADERBOARD!.get(key.name)
          if (!stored) return

          try {
            const pass = JSON.parse(stored) as VipPass
            if (!pass.piUid) return

            vipPasses.push({
              uid: pass.piUid,
              username: pass.username || '',
              firstSeenAt: pass.activatedAt || new Date().toISOString(),
              lastSeenAt: pass.activatedAt || new Date().toISOString(),
            })
          } catch (error) {
            console.error('[VIP] failed to parse pass during inspect', error)
          }
        }),
      )

      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)
  }

  const leaderboardUsers = leaderboards.flatMap(({ leaderboard }) =>
    leaderboard.entries
      .filter((entry) => entry.piUid && !entry.piUid.startsWith('guest-') && entry.piUid !== 'guest-user')
      .map((entry) => ({
        uid: entry.piUid,
        username: entry.name,
        firstSeenAt: entry.submittedAt,
        lastSeenAt: entry.submittedAt,
      })),
  )
  const mergedUsers = mergeKnownPiUsers(
    globalKnownUsers,
    ...weeklyKnownUsers.map(({ users }) => users),
    leaderboardUsers,
    vipPasses,
  )

  await writeKnownPiUsers(env, GLOBAL_KNOWN_PI_USERS_KEY, mergedUsers)

  return apiJson(request, {
    inspected: true,
    count: mergedUsers.length,
    globalCountBefore: globalKnownUsers.length,
    weeklyCounts: weeklyKnownUsers.map(({ weekKey, users }) => ({
      weekKey,
      count: users.length,
    })),
    leaderboardCounts: leaderboards.map(({ weekKey, leaderboard }) => ({
      weekKey,
      count: new Set(
        leaderboard.entries
          .filter((entry) => entry.piUid && !entry.piUid.startsWith('guest-') && entry.piUid !== 'guest-user')
          .map((entry) => entry.piUid),
      ).size,
    })),
    vipPassCount: new Set(vipPasses.map((pass) => pass.uid)).size,
    users: mergedUsers,
  })
}

async function repairVipStats(request: Request, env: Env) {
  const admin = await requireAdmin(request, env)
  if (admin.ok === false) return admin.response

  if (!env.LEADERBOARD?.list) {
    return apiJson(
      request,
      {
        repaired: false,
        error: 'KV list is not available.',
      },
      500,
    )
  }

  const week = getWeeklyPeriod()
  const activePasses = new Map<string, VipPass>()
  let cursor: string | undefined

  do {
    const page = await env.LEADERBOARD.list({
      prefix: 'vip-pass:',
      ...(cursor ? { cursor } : {}),
    })

    await Promise.all(
      page.keys.map(async (key) => {
        const stored = await env.LEADERBOARD!.get(key.name)
        if (!stored) return

        try {
          const pass = JSON.parse(stored) as VipPass
          const passWeek = pass.activatedAt ? getWeeklyPeriod(new Date(pass.activatedAt)) : null

          if (
            pass.active &&
            pass.piUid &&
            pass.expiresAt &&
            new Date(pass.expiresAt).getTime() > Date.now() &&
            passWeek?.key === week.key
          ) {
            activePasses.set(pass.piUid, pass)
          }
        } catch (error) {
          console.error('[VIP] failed to parse pass during repair', error)
        }
      }),
    )

    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  const previousStats = await readVipRewardStats(env, week)
  const nextStats = await writeVipRewardStats(env, activePasses.size, week)
  const leaderboard = await readStoredLeaderboard(env, week)
  await writeStoredLeaderboard(env, leaderboard)

  return apiJson(request, {
    repaired: true,
    week: week.label,
    weekKey: week.key,
    previous: previousStats,
    next: nextStats,
    activeVipUids: [...activePasses.keys()],
  })
}

function methodNotAllowed(pathname: string, method: string, allow = 'POST') {
  return json(
    {
      error: 'Method not allowed',
      path: pathname,
      method,
    },
    405,
    {
      Allow: allow,
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
      return verifyPiAuth(request, env)
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

    if (pathname === '/api/pi/payments/app-to-user') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return createAppToUserPayment(request, env)
    }

    if (pathname === '/api/pi/payments/app-to-user/complete') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return completeAppToUserPayment(request, env)
    }

    if (pathname === '/api/pi/payments/incomplete-server') {
      if (request.method !== 'GET') return methodNotAllowed(pathname, request.method, 'GET')
      return getIncompleteServerPayments(request, env)
    }

    if (pathname === '/api/admin/pi-users') {
      if (request.method === 'POST') return addKnownPiUsers(request, env)
      if (request.method !== 'GET') return methodNotAllowed(pathname, request.method, 'GET, POST')
      return getKnownPiUsers(request, env)
    }

    if (pathname === '/api/admin/pi-users/inspect') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return inspectPiUsers(request, env)
    }

    if (pathname === '/api/admin/vip-stats/repair') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return repairVipStats(request, env)
    }

    if (pathname === '/api/pi/vip/status') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return getVipStatus(request, env)
    }

    if (pathname === '/api/leaderboard') {
      if (request.method !== 'GET') return methodNotAllowed(pathname, request.method, 'GET')
      return getLeaderboard(request, env)
    }

    if (pathname === '/api/leaderboard/scores') {
      if (request.method !== 'POST') return methodNotAllowed(pathname, request.method)
      return submitLeaderboardScore(request, env)
    }

    if (pathname.startsWith('/api/')) {
      return apiNotFound(pathname, request.method)
    }

    const assetResponse = await env.ASSETS.fetch(getAssetRequest(request, pathname))
    return withAppHeaders(assetResponse)
  },
}
