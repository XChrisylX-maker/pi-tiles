import type { Board, ScorePayload } from '../game/gameEngine'
import { validateScoreSubmission } from '../game/gameEngine'

export const VIP_PRICE_PI = 1
export const VIP_POOL_SHARE = 0.2

export const SEEDED_PIONEER_NAMES = [
  'PiWolf',
  'CryptoMina',
  'NekoPi',
  'PioneerMax',
  'LunaNode',
  'BlockCat',
  'PiZen',
  'KappaPi',
  'SatoshiKitty',
  'ChainNora',
  'PixelPioneer',
  'PiRanger',
] as const

export const REWARD_WEIGHTS = [25, 18, 14, 10, 8, 7, 6, 5, 4, 3] as const
export const TOTAL_REWARD_WEIGHT = REWARD_WEIGHTS.reduce((sum, value) => sum + value, 0)

export type LeaderboardEntry = {
  id: string
  piUid: string
  name: string
  score: number
  games: number
  vip: boolean
  isPlayer: boolean
}

export type RewardPool = {
  vipMembers: number
  weeklyPool: number
  vipRevenue: number
  platformRevenue: number
}

export type SubmitScoreResult = {
  accepted: boolean
  entry?: LeaderboardEntry
  reason?: string
}

export function makeSeededLeaderboard(): LeaderboardEntry[] {
  return SEEDED_PIONEER_NAMES.map((name, index) => ({
    id: name,
    piUid: `guest-${name.toLowerCase()}`,
    name,
    score: Math.floor(1800 + Math.random() * 9000) - index * 260,
    games: Math.floor(3 + Math.random() * 24),
    vip: Math.random() > 0.45,
    isPlayer: false,
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

export function calculateRewardPool(vipMembers: number): RewardPool {
  const vipRevenue = vipMembers * VIP_PRICE_PI
  const weeklyPool = Number((vipMembers * VIP_PRICE_PI * VIP_POOL_SHARE).toFixed(2))
  const platformRevenue = Number((vipRevenue - weeklyPool).toFixed(2))

  return {
    vipMembers,
    weeklyPool,
    vipRevenue,
    platformRevenue,
  }
}

export function getVipRank(leaderboard: LeaderboardEntry[], row: LeaderboardEntry): number | null {
  if (!row.vip) return null
  const vipRows = leaderboard.filter((entry) => entry.vip)
  return vipRows.findIndex((entry) => entry.id === row.id) + 1
}

export function rewardForVipRank(vipRank: number | null, pool: number): string {
  if (!vipRank || vipRank > 10) return 'Global Only'
  const weight = REWARD_WEIGHTS[vipRank - 1] || 0
  const reward = ((pool * weight) / TOTAL_REWARD_WEIGHT).toFixed(2)
  return `${reward} Pi`
}

export async function submitScoreToLeaderboard({
  payload,
  currentRows,
  isVip,
  board,
}: {
  payload: ScorePayload
  currentRows: LeaderboardEntry[]
  isVip: boolean
  board: Board
}): Promise<SubmitScoreResult> {
  const validation = validateScoreSubmission({
    score: payload.score,
    validMoves: payload.validMoves,
    board,
  })

  if (!validation.valid) {
    return { accepted: false, reason: validation.reason }
  }

  const previousPlayerRow = currentRows.find((row) => row.piUid === payload.piUid)

  // Placeholder: production should POST payload to an API and trust only server-scored results.
  return {
    accepted: true,
    entry: {
      id: `player-${Date.now()}`,
      piUid: payload.piUid,
      name: payload.username,
      score: payload.score,
      games: (previousPlayerRow?.games || 0) + 1,
      vip: isVip,
      isPlayer: true,
    },
  }
}

export function mergeLeaderboardEntry(rows: LeaderboardEntry[], entry: LeaderboardEntry): LeaderboardEntry[] {
  return [...rows.filter((row) => !row.isPlayer), entry].sort((a, b) => b.score - a.score).slice(0, 10)
}
