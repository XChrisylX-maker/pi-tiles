import type { Board, ScorePayload } from '../game/gameEngine'
import { validateScoreSubmission } from '../game/gameEngine'

export const VIP_PRICE_PI = 1
export const VIP_POOL_SHARE = 0.2
export const LEADERBOARD_LIMIT = 10

export const REWARD_SHARES = [0.25, 0.15, 0.1, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7, 0.5 / 7] as const

export type LeaderboardEntry = {
  id: string
  piUid: string
  name: string
  score: number
  games: number
  vip: boolean
  isPlayer: boolean
  week?: string
  weekKey?: string
  submittedAt?: string
  rewardsRank?: number | null
  reward?: string
  rewardEligible?: boolean
  rank?: number
}

export type RewardPool = {
  vipMembers: number
  weeklyPool: number
}

export type SubmitScoreResult = {
  accepted: boolean
  entry?: LeaderboardEntry
  leaderboard?: WeeklyLeaderboard
  reason?: string
}

export type WeeklyLeaderboard = {
  week: string
  weekKey: string
  weekStartsAt: string
  weekEndsAt: string
  entries: LeaderboardEntry[]
  updatedAt: string
  rewards: RewardPool
}

export function makeSeededLeaderboard(): LeaderboardEntry[] {
  return []
}

export function calculateRewardPool(vipMembers: number): RewardPool {
  const weeklyPool = Number((vipMembers * VIP_PRICE_PI * VIP_POOL_SHARE).toFixed(2))

  return {
    vipMembers,
    weeklyPool,
  }
}

export function getVipRank(leaderboard: LeaderboardEntry[], row: LeaderboardEntry): number | null {
  if (!row.vip) return null
  const vipRows = leaderboard.filter((entry) => entry.vip)
  return vipRows.findIndex((entry) => entry.id === row.id) + 1
}

export function rewardForVipRank(vipRank: number | null, pool: number): string {
  if (!vipRank || vipRank > 10) return 'Global Only'
  const share = REWARD_SHARES[vipRank - 1] || 0
  const reward = (pool * share).toFixed(2)
  return `${reward} Pi`
}

async function parseLeaderboardResponse(response: Response) {
  const payload = (await response.json()) as SubmitScoreResult & WeeklyLeaderboard

  if (!response.ok) {
    throw new Error(payload.reason || 'Leaderboard request failed.')
  }

  return payload
}

export async function fetchWeeklyLeaderboard(): Promise<WeeklyLeaderboard> {
  const response = await fetch('/api/leaderboard', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  return (await parseLeaderboardResponse(response)) as WeeklyLeaderboard
}

export async function submitScoreToLeaderboard({
  payload,
  currentRows,
  isVip,
  board,
  accessToken,
}: {
  payload: ScorePayload
  currentRows: LeaderboardEntry[]
  isVip: boolean
  board: Board
  accessToken?: string
}): Promise<SubmitScoreResult> {
  const validation = validateScoreSubmission({
    score: payload.score,
    validMoves: payload.validMoves,
    board,
  })

  if (!validation.valid) {
    return { accepted: false, reason: validation.reason }
  }

  try {
    const response = await fetch('/api/leaderboard/scores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload,
        isVip,
        accessToken,
      }),
    })
    const result = (await parseLeaderboardResponse(response)) as SubmitScoreResult

    if (result.accepted) return result

    return {
      accepted: false,
      reason: result.reason || 'Score rejected by leaderboard server.',
    }
  } catch (error) {
    console.warn('[Leaderboard] server submit failed, keeping local round result only:', error)
  }

  const previousPlayerGames = currentRows.filter((row) => row.piUid === payload.piUid).length

  return {
    accepted: true,
    entry: {
      id: `player-${Date.now()}`,
      piUid: payload.piUid,
      name: payload.username,
      score: payload.score,
      games: previousPlayerGames + 1,
      vip: isVip,
      isPlayer: true,
    },
  }
}

export function mergeLeaderboardEntry(rows: LeaderboardEntry[], entry: LeaderboardEntry): LeaderboardEntry[] {
  return [...rows, entry].sort((a, b) => b.score - a.score)
}
