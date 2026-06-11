import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  areNeighbors,
  BOARD_SIZE,
  buildScorePayload,
  currentWeekLabel,
  findMatches,
  makeBoard,
  MIN_VALID_MOVES,
  resolveOneStep,
  ROUND_SECONDS,
  swapCells,
  SYMBOL_STYLES,
} from '../game/gameEngine'
import type { Board, ScorePayload } from '../game/gameEngine'
import {
  calculateRewardPool,
  fetchWeeklyLeaderboard,
  getVipRank,
  LEADERBOARD_LIMIT,
  makeSeededLeaderboard,
  mergeLeaderboardEntry,
  rewardForVipRank,
  submitScoreToLeaderboard,
  VIP_PRICE_PI,
} from '../api/leaderboardApi'
import type { LeaderboardEntry, RewardPool } from '../api/leaderboardApi'
import { authenticatePiUser, checkVipPass, createMockPiUser, PI_INTEGRATION_STATUS, requestVipPayment } from '../pi/piClient'
import type { PiUser } from '../pi/piClient'
import { useAutoSubmit } from '../hooks/useAutoSubmit'
import { useCountdown } from '../hooks/useCountdown'
import {
  playComboSound,
  playDangerSound,
  playMatchSound,
  playStartSound,
  playSuccessSound,
  playSwapSound,
  playTapSound,
} from '../audio/audioEngine'
import { AndroidAdSlot } from '../android/AndroidAdSlot'
import { AndroidPiBridge } from '../android/AndroidPiBridge'

type IconName = 'sparkles' | 'shield' | 'zap' | 'crown' | 'server' | 'wallet'

const ICONS: Record<IconName, string> = {
  sparkles: '✦',
  shield: '✓',
  zap: '↯',
  crown: '♛',
  server: '▣',
  wallet: '◫',
}

const COMBO_CALLOUTS = ['CHAIN', 'MEGA', 'ULTRA', 'BLAST', 'PI STORM'] as const
const MATCH_FLASH_MS = 145
const REFILL_ANIMATION_MS = 310
const INVALID_SWAP_PREVIEW_MS = 65
const INVALID_SWAP_REWIND_MS = 105
const TILE_SIZE_PX = 58
const MAX_VISIBLE_CASCADES = 10
const MAX_CASCADE_STEPS = 64
const SWIPE_THRESHOLD_PX = 14
const PI_CONNECT_UI_TIMEOUT_MS = 12000
const SHOW_PI_DEBUG_PANEL = import.meta.env.DEV
const COLUMN_FALL_DELAYS = [8, 0, 12, 4, 16] as const

type TileDragStart = {
  index: number
  pointerId: number
  x: number
  y: number
  resolved: boolean
}

type BonusBurst = {
  id: number
  index: number
  label: string
  kind: 'pi-bonus' | 'pi-bomb' | 'pi-boom'
}

function Icon({ name, tone = '' }: { name: IconName; tone?: string }) {
  return (
    <span className={`pi-icon ${tone}`} aria-hidden="true">
      {ICONS[name]}
    </span>
  )
}

function getTileSymbol(tile: Board[number]) {
  return typeof tile === 'string' ? tile : tile.symbol
}

function getTileId(tile: Board[number], index: number) {
  return typeof tile === 'string' ? `legacy-tile-${index}-${tile}` : tile.id
}

function getTilePower(tile: Board[number]) {
  return typeof tile === 'string' ? undefined : tile.power
}

function formatBonusBubble(score: number) {
  return `+${score}`
}

function withUiTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timeout`))
    }, ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function getBonusBurstPosition(index: number) {
  const row = Math.floor(index / BOARD_SIZE)
  const col = index % BOARD_SIZE

  return {
    x: Math.min(78, Math.max(22, (col + 0.5) * 20)),
    y: Math.min(78, Math.max(22, (row + 0.5) * 20)),
  }
}

function getSwapMotion(index: number, swap: number[]) {
  if (swap.length !== 2 || !swap.includes(index)) {
    return { col: 0, row: 0 }
  }

  const otherIndex = swap[0] === index ? swap[1] : swap[0]

  return {
    col: (otherIndex % BOARD_SIZE) - (index % BOARD_SIZE),
    row: Math.floor(otherIndex / BOARD_SIZE) - Math.floor(index / BOARD_SIZE),
  }
}

function getLeaderboardStatus(row: LeaderboardEntry, vipRank: number | null, reward: string) {
  if (row.vip) {
    return vipRank ? `VIP · rewards ranking #${vipRank} · ${reward}` : 'VIP · rewards ranking'
  }

  if (row.piUid.startsWith('guest-')) return 'Guest · no rewards'

  return 'Pioneer · no rewards'
}

type PiTilesGameProps = {
  platform: 'pi' | 'android'
}

export function PiTilesGame({ platform }: PiTilesGameProps) {
  const isAndroidApp = platform === 'android'
  const [piUser, setPiUser] = useState<PiUser | null>(null)
  const [isConnectingPi, setIsConnectingPi] = useState(false)

  const [board, setBoard] = useState<Board>(makeBoard)
  const [selected, setSelected] = useState<number | null>(null)
  const [lastSwap, setLastSwap] = useState<number[]>([])
  const [invalidSwap, setInvalidSwap] = useState<number[]>([])
  const [lastMatches, setLastMatches] = useState<number[]>([])
  const [fallDistances, setFallDistances] = useState<number[]>([])
  const [newTiles, setNewTiles] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('Pick a tile, then swap with a neighbor.')
  const [best, setBest] = useState(0)
  const [playerName, setPlayerName] = useState('')
  const [leaderboardSearch, setLeaderboardSearch] = useState('')
  const [isVip, setIsVip] = useState(false)
  const [isCheckingVipStatus, setIsCheckingVipStatus] = useState(false)
  const [isOpeningVipPayment, setIsOpeningVipPayment] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(makeSeededLeaderboard)
  const [leaderboardWeek, setLeaderboardWeek] = useState(currentWeekLabel())
  const [submitted, setSubmitted] = useState(false)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [validMoves, setValidMoves] = useState(0)
  const [lastPayload, setLastPayload] = useState<ScorePayload | null>(null)
  const [comboBurst, setComboBurst] = useState(0)
  const [comboCallout, setComboCallout] = useState<(typeof COMBO_CALLOUTS)[number] | null>(null)
  const [bonusBursts, setBonusBursts] = useState<BonusBurst[]>([])
  const [isBoardQuaking, setIsBoardQuaking] = useState(false)
  const [isRefilling, setIsRefilling] = useState(false)
  const [refillCascadeStep, setRefillCascadeStep] = useState(0)
  const [isAnimatingResolution, setIsAnimatingResolution] = useState(false)
  const [securityNote, setSecurityNote] = useState(
    'Connect Pioneer to enable Pi username and VIP payment.',
  )

  const animationTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const lastDangerTick = useRef<number | null>(null)
  const mounted = useRef(true)
  const connectRequest = useRef<Promise<PiUser> | null>(null)
  const tileDragStart = useRef<TileDragStart | null>(null)
  const bonusBurstId = useRef(0)
  const suppressNextTileClick = useRef(false)
  const submitInFlight = useRef(false)
  const leaderboardRevision = useRef(0)
  const [rewardPool, setRewardPool] = useState<RewardPool>(() => calculateRewardPool(0))
  const { vipMembers, weeklyPool } = rewardPool

  const isRealPiAuth = piUser !== null && !piUser.fallbackMode && Boolean(piUser.accessToken)
  const selectedLabel = selected === null ? '—' : getTileSymbol(board[selected])
  const nextRewardPreview = useMemo(() => `${3 * 3 * 10}+`, [])
  const isCriticalTimer = playing && timeLeft <= 10
  const isHotCombo = combo >= 5
  const leaderboardQuery = leaderboardSearch.trim().toLowerCase()
  const searchedLeaderboard = useMemo(() => {
    if (!leaderboardQuery) return leaderboard

    return leaderboard.filter((row) => {
      const haystack = [row.name, row.piUid, `#${row.rank || ''}`, String(row.score)].join(' ').toLowerCase()

      return haystack.includes(leaderboardQuery)
    })
  }, [leaderboard, leaderboardQuery])
  const selectedLeaderboardPlayer = useMemo(() => {
    if (!leaderboardQuery) return null

    const exact =
      leaderboard.find((row) => row.name.toLowerCase() === leaderboardQuery) ||
      leaderboard.find((row) => row.piUid.toLowerCase() === leaderboardQuery) ||
      searchedLeaderboard[0]

    if (!exact) return null

    const rows = leaderboard
      .filter((row) => {
        if (exact.piUid && row.piUid === exact.piUid) return true

        return row.name.toLowerCase() === exact.name.toLowerCase()
      })
      .sort((a, b) => b.score - a.score || (a.rank || 9999) - (b.rank || 9999))
    const bestRow = rows[0] || exact
    const bestRank = rows.reduce((rank, row) => Math.min(rank, row.rank || rank), bestRow.rank || 0)
    const vipRow = rows.find((row) => row.vip)
    const vipRank = vipRow ? getVipRank(leaderboard, vipRow) : null

    return {
      name: exact.name,
      rows,
      bestScore: bestRow.score,
      bestRank,
      scoresCount: rows.length,
      vip: rows.some((row) => row.vip),
      vipRank,
      reward: vipRow ? vipRow.reward || rewardForVipRank(vipRank, weeklyPool) : 'No rewards',
    }
  }, [leaderboard, leaderboardQuery, searchedLeaderboard, weeklyPool])

  const clearAnimationTimers = useCallback(() => {
    animationTimers.current.forEach((timer) => clearTimeout(timer))
    animationTimers.current = []
  }, [])

  const showBonusBursts = useCallback((bursts: Omit<BonusBurst, 'id'>[], quake = false) => {
    if (bursts.length === 0 && !quake) return

    if (bursts.length > 0) {
      setBonusBursts(
        bursts.map((burst) => {
          bonusBurstId.current += 1

          return {
            ...burst,
            id: bonusBurstId.current,
          }
        }),
      )

      const clearTimer = setTimeout(() => {
        if (mounted.current) setBonusBursts([])
      }, 700)
      animationTimers.current.push(clearTimer)
    }

    if (quake) {
      setIsBoardQuaking(false)

      window.requestAnimationFrame(() => {
        if (!mounted.current) return

        setIsBoardQuaking(true)

        const quakeTimer = setTimeout(() => {
          if (mounted.current) setIsBoardQuaking(false)
        }, 220)
        animationTimers.current.push(quakeTimer)
      })
    }
  }, [])

  const connectPioneer = useCallback(async () => {
    if (connectRequest.current) return connectRequest.current
    if (piUser?.isAuthenticated && piUser.accessToken) return piUser

    const request = (async () => {
      setIsConnectingPi(true)
      setSecurityNote('Opening Pi authentication...')

      try {
        const user = await withUiTimeout(authenticatePiUser(), PI_CONNECT_UI_TIMEOUT_MS, 'Pi authentication')

        if (!mounted.current) return user

        setPiUser(user)
        setPlayerName(user.username)

        if (user.fallbackMode) {
          setSecurityNote('Pi authentication unavailable. Continuing in guest mode.')
          setMessage('Guest mode ready.')
          return user
        }

        setSecurityNote(`Pioneer connected: ${user.username}`)
        setMessage(`Welcome, ${user.username}.`)
        return user
      } catch (error) {
        console.error('[PiTiles] Pioneer connection failed:', error)
        const fallbackUser = createMockPiUser()

        if (mounted.current) {
          setPiUser(fallbackUser)
          setSecurityNote(error instanceof Error ? error.message : 'Pioneer connection failed. Continuing in guest mode.')
          setMessage('Guest mode ready.')
        }

        return fallbackUser
      } finally {
        connectRequest.current = null

        if (mounted.current) {
          setIsConnectingPi(false)
        }
      }
    })()

    connectRequest.current = request
    return request
  }, [piUser])

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!playing || timeLeft <= 0 || timeLeft > 10) return
    if (lastDangerTick.current === timeLeft) return

    lastDangerTick.current = timeLeft
    playDangerSound()
  }, [playing, timeLeft])

  useEffect(() => clearAnimationTimers, [clearAnimationTimers])

  useEffect(() => {
    if (!piUser?.accessToken || piUser.fallbackMode) return

    let cancelled = false

    async function loadVipStatus() {
      setIsCheckingVipStatus(true)

      try {
        const status = await checkVipPass(piUser!.accessToken)

        if (cancelled) return

        setIsVip(Boolean(status.active))

        if (status.active) {
          setSecurityNote('VIP Pass restored from server.')
        }
      } catch (error) {
        console.warn('[PiTiles] VIP status check failed:', error)
      } finally {
        if (!cancelled) setIsCheckingVipStatus(false)
      }
    }

    void loadVipStatus()

    return () => {
      cancelled = true
    }
  }, [piUser])

  useEffect(() => {
    if (playing) return

    let cancelled = false

    async function loadLeaderboard() {
      if (document.visibilityState === 'hidden') return
      const requestedRevision = leaderboardRevision.current

      try {
        const weeklyLeaderboard = await fetchWeeklyLeaderboard()

        if (cancelled || requestedRevision !== leaderboardRevision.current) return

        setLeaderboard(weeklyLeaderboard.entries)
        setLeaderboardWeek(weeklyLeaderboard.week)
        setRewardPool(weeklyLeaderboard.rewards)
      } catch (error) {
        console.warn('[PiTiles] leaderboard fetch failed:', error)
      }
    }

    void loadLeaderboard()
    const timer = window.setInterval(() => {
      void loadLeaderboard()
    }, 120000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadLeaderboard()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [playing])

  useEffect(() => {
    if (!piUser?.piUid) return

    const playerBest = leaderboard.reduce(
      (highestScore, entry) =>
        entry.piUid === piUser.piUid ? Math.max(highestScore, entry.score) : highestScore,
      0,
    )

    if (playerBest > 0) {
      setBest((currentBest) => Math.max(currentBest, playerBest))
    }
  }, [leaderboard, piUser?.piUid])

  const start = useCallback(() => {
    clearAnimationTimers()
    playStartSound()
    lastDangerTick.current = null
    setBoard(makeBoard())
    setSelected(null)
    setLastSwap([])
    setInvalidSwap([])
    setLastMatches([])
    setFallDistances([])
    setNewTiles([])
    setIsRefilling(false)
    setRefillCascadeStep(0)
    setIsAnimatingResolution(false)
    setScore(0)
    setCombo(0)
    setTimeLeft(ROUND_SECONDS)
    setPlaying(true)
    setSubmitted(false)
    submitInFlight.current = false
    setValidMoves(0)
    setLastPayload(null)
    setComboBurst(0)
    setComboCallout(null)
    setBonusBursts([])
    setIsBoardQuaking(false)
    setSecurityNote('Game running: valid swaps are being counted.')
    setMessage('Go! Match lines of 3+ to score.')
  }, [clearAnimationTimers])

  const submitScore = useCallback(
    async (finalScore = score, auto = false) => {
      if (submitted || submitInFlight.current || finalScore <= 0) return
      submitInFlight.current = true

      if (playing && !auto) {
        setSecurityNote('Submit blocked: finish the game first.')
        submitInFlight.current = false
        return
      }

      if (validMoves < MIN_VALID_MOVES) {
        setSecurityNote('Submit blocked: not enough activity for a valid game.')
        submitInFlight.current = false
        return
      }

      const safePiUser = piUser || createMockPiUser()

      const payload = buildScorePayload({
        player: {
          ...safePiUser,
          username: playerName.trim() || safePiUser.username || 'Guest',
        },
        score: finalScore,
        validMoves,
        board,
        week: currentWeekLabel(),
      })

      const result = await submitScoreToLeaderboard({
        payload,
        currentRows: leaderboard,
        isVip,
        board,
        accessToken: safePiUser.accessToken || undefined,
      })

      if (!result.accepted || !result.entry) {
        setSecurityNote(result.reason || 'Score rejected by anti-cheat checks.')
        submitInFlight.current = false
        return
      }

      playSuccessSound()
      leaderboardRevision.current += 1
      setLastPayload(payload)
      setBest((currentBest) => Math.max(currentBest, finalScore, result.entry!.score))
      setLeaderboard((rows) =>
        mergeLeaderboardEntry(result.leaderboard?.entries || rows, result.entry!),
      )
      setLeaderboardWeek(result.leaderboard?.week || payload.week)
      if (result.leaderboard?.rewards) setRewardPool(result.leaderboard.rewards)
      setSubmitted(true)
      setGamesPlayed((currentGames) => currentGames + 1)
      setSecurityNote(auto ? 'Score auto-submitted at game end.' : 'Score accepted: leaderboard updated.')
    },
    [board, isVip, leaderboard, piUser, playerName, playing, score, submitted, validMoves],
  )

  const handleRoundEnd = useCallback(() => {
    setPlaying(false)
    setBest((currentBest) => Math.max(currentBest, score))
    setSelected(null)

    if (score > 0 && validMoves >= MIN_VALID_MOVES && !submitted) {
      void submitScore(score, true)
      setMessage("Time's up! Score auto-submitted.")
      return
    }

    setSecurityNote('Auto-submit blocked: game was too short to validate.')
    setMessage("Time's up! Game not validated.")
  }, [score, submitScore, submitted, validMoves])

  const tickCountdown = useCallback((nextValue: number) => {
    setTimeLeft(nextValue)
  }, [])

  useCountdown({
    active: playing,
    value: timeLeft,
    onTick: tickCountdown,
  })

  useAutoSubmit({
    enabled: playing && timeLeft === 0,
    onAutoSubmit: handleRoundEnd,
  })

  async function resolveSwap(a: number, b: number) {
    clearAnimationTimers()

    const originalBoard = board
    const swapped = swapCells(board, a, b)
    const previewMatches = findMatches(swapped)

    setLastSwap([a, b])
    setInvalidSwap([])
    setSelected(null)

    if (previewMatches.length === 0) {
      setIsAnimatingResolution(true)
      setBoard(swapped)
      setLastMatches([])
      setFallDistances([])
      setNewTiles([])
      setIsRefilling(false)
      setComboCallout(null)
      setSecurityNote('No-match swap: combo count unchanged.')
      setMessage('No match — try another neighbor.')

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, INVALID_SWAP_PREVIEW_MS)
        animationTimers.current.push(timer)
      })

      setInvalidSwap([a, b])
      setBoard(originalBoard)

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, INVALID_SWAP_REWIND_MS)
        animationTimers.current.push(timer)
      })

      setLastSwap([])
      setInvalidSwap([])
      setIsAnimatingResolution(false)
      return
    }

    let currentBoard = swapped
    let cascadeMultiplier = 1
    let totalGained = 0
    let totalMatched = 0
    let cascadeCount = 0
    let reshuffled = false

    setIsAnimatingResolution(true)
    setBoard(swapped)

    for (let stepIndex = 0; stepIndex < MAX_CASCADE_STEPS; stepIndex += 1) {
      const step = resolveOneStep(currentBoard, cascadeMultiplier)

      if (!step.hasMatches) {
        if (step.wasReshuffled) {
          reshuffled = true
          currentBoard = step.board
          setBoard(step.board)
          setMessage('Board reshuffled — no moves available.')
        }

        break
      }

      cascadeCount += 1
      totalGained += step.gained
      totalMatched += step.matched
      reshuffled = reshuffled || step.wasReshuffled

      const isVisibleCascade = stepIndex < MAX_VISIBLE_CASCADES

      playMatchSound()

      if (step.combo >= 5 || step.matched >= 8) {
        playComboSound()
      }

      if (isVisibleCascade) {
        setLastMatches(step.matches)
        setFallDistances([])
        setIsRefilling(false)
      }

      if (isVisibleCascade) {
        const piBonusAnchor =
          step.matches.find((index) => getTileSymbol(currentBoard[index]) === 'π') || step.matches[0] || 0
        const bursts: Omit<BonusBurst, 'id'>[] = []

        if (step.piMatchBonus > 0) {
          bursts.push({
            index: piBonusAnchor,
            label: formatBonusBubble(step.piMatchBonus),
            kind: 'pi-bonus',
          })
        }

        const createdBombBonus = step.piBombsCreated > 0 ? Math.floor(step.piBombCreationBonus / step.piBombsCreated) : 0

        step.piBombCreatedIndexes.forEach((index) => {
          bursts.push({
            index,
            label: formatBonusBubble(createdBombBonus),
            kind: 'pi-bomb',
          })
        })

        showBonusBursts(bursts, step.combo >= 5 && (step.piBombCreatedIndexes.length > 0 || step.piBombExplodedIndexes.length > 0))
      }

      setCombo((currentCombo) => currentCombo + 1)
      setScore((currentScore) => currentScore + step.gained)
      setComboBurst((burst) => burst + 1)

      if (isVisibleCascade && (step.combo >= 5 || step.matched >= 8)) {
        const calloutIndex = (step.gained + step.matched + cascadeCount + validMoves) % COMBO_CALLOUTS.length
        setComboCallout(COMBO_CALLOUTS[calloutIndex])
      } else if (isVisibleCascade) {
        setComboCallout(null)
      }

      if (isVisibleCascade) {
        const cascadePace = Math.max(0.78, 1 - stepIndex * 0.055)
        const piBonusLabel = step.piBonus > 0 ? ` · PI BONUS +${step.piBonus}` : ''

        if (step.matched >= 8) {
          setMessage(`${step.matched} tiles blasted · AREA BLAST${piBonusLabel} · +${step.gained}`)
        } else if (step.piBombsCreated > 0) {
          setMessage(`Pi Bomb created · ${step.piMatched} Pi tiles${piBonusLabel} · +${step.gained}`)
        } else if (step.piBonus > 0) {
          setMessage(`${step.piMatched} Pi tiles matched${piBonusLabel} · +${step.gained}`)
        } else {
          setMessage(`${step.matched} tiles blasted · cascade ${cascadeCount} · +${step.gained}`)
        }

        await new Promise<void>((resolve) => {
          const matchDelay = Math.round((isAndroidApp ? 95 : MATCH_FLASH_MS) * cascadePace)
          const timer = setTimeout(resolve, matchDelay)
          animationTimers.current.push(timer)
        })

        setLastMatches([])
        setFallDistances(step.fallDistances)
        setNewTiles(step.newTileIndexes)
        setRefillCascadeStep(stepIndex)
        setIsRefilling(true)
        setBoard(step.board)

        await new Promise<void>((resolve) => {
          const refillDelay = Math.round((isAndroidApp ? 180 : REFILL_ANIMATION_MS) * cascadePace)
          const timer = setTimeout(resolve, refillDelay)
          animationTimers.current.push(timer)
        })

        setFallDistances([])
        setNewTiles([])
        setIsRefilling(false)
      } else {
        setBoard(step.board)
      }

      currentBoard = step.board
      cascadeMultiplier = step.combo
    }

    setValidMoves((currentMoves) => currentMoves + 1)
    setBoard(currentBoard)
    setIsAnimatingResolution(false)
    setRefillCascadeStep(0)
    setLastSwap([])

    if (findMatches(currentBoard).length > 0) {
      setSecurityNote('Long cascade paused without reshuffling; make another match to continue.')
    } else if (reshuffled) {
      setSecurityNote('No moves left: board reshuffled automatically after cascades.')
    } else {
      setSecurityNote('Matches validated: cascades resolved step by step.')
    }

    if (cascadeCount > 1) {
      setMessage(`${totalMatched} tiles blasted · ${cascadeCount} cascades · +${totalGained} points`)
    } else {
      setMessage(`${totalMatched} tiles blasted · +${totalGained} points`)
    }
  }

  function getSwipeTarget(index: number, deltaX: number, deltaY: number) {
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (Math.max(absX, absY) < SWIPE_THRESHOLD_PX) return null

    const row = Math.floor(index / BOARD_SIZE)
    const col = index % BOARD_SIZE

    if (absX > absY) {
      if (deltaX > 0 && col < BOARD_SIZE - 1) return index + 1
      if (deltaX < 0 && col > 0) return index - 1
      return null
    }

    if (deltaY > 0 && row < BOARD_SIZE - 1) return index + BOARD_SIZE
    if (deltaY < 0 && row > 0) return index - BOARD_SIZE
    return null
  }

  function handleTilePointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!playing || isAnimatingResolution) return

    if (!isAndroidApp) {
      event.preventDefault()
    }

    tileDragStart.current = {
      index,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      resolved: false,
    }
    suppressNextTileClick.current = false

    if (!isAndroidApp) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function resolveTileSwipe(event: PointerEvent<HTMLButtonElement>) {
    const dragStart = tileDragStart.current

    if (!dragStart || dragStart.pointerId !== event.pointerId) return
    if (!playing || isAnimatingResolution || dragStart.resolved) return

    const deltaX = event.clientX - dragStart.x
    const deltaY = event.clientY - dragStart.y
    const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY))
    const target = getSwipeTarget(dragStart.index, deltaX, deltaY)

    if (distance >= SWIPE_THRESHOLD_PX) {
      suppressNextTileClick.current = true
    }

    if (target === null || !areNeighbors(dragStart.index, target)) return

    dragStart.resolved = true
    tileDragStart.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setSelected(null)
    playSwapSound()
    void resolveSwap(dragStart.index, target)
  }

  function handleTilePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!isAndroidApp && tileDragStart.current?.pointerId === event.pointerId) {
      event.preventDefault()
    }

    resolveTileSwipe(event)
  }

  function handleTilePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!isAndroidApp && tileDragStart.current?.pointerId === event.pointerId) {
      event.preventDefault()
    }

    resolveTileSwipe(event)

    const dragStart = tileDragStart.current

    if (!dragStart || dragStart.pointerId !== event.pointerId) return

    tileDragStart.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleTilePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (!isAndroidApp && tileDragStart.current?.pointerId === event.pointerId) {
      event.preventDefault()
    }

    const dragStart = tileDragStart.current

    if (!dragStart || dragStart.pointerId !== event.pointerId) return

    tileDragStart.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleTileClick(index: number) {
    if (suppressNextTileClick.current) {
      suppressNextTileClick.current = false
      return
    }

    tapCell(index)
  }

  function tapCell(index: number) {
    if (!playing || isAnimatingResolution) return

    if (selected === null) {
      playTapSound()
      setSelected(index)
      setMessage('Pick a neighboring tile.')
      return
    }

    if (selected === index) {
      playTapSound()
      setSelected(null)
      setMessage('Pick a tile, then swap with a neighbor.')
      return
    }

    if (!areNeighbors(selected, index)) {
      playTapSound()
      setSelected(index)
      return
    }

    playSwapSound()
    void resolveSwap(selected, index)
  }

  async function handleVipPayment() {
    if (isOpeningVipPayment || isCheckingVipStatus) return

    if (isVip) {
      if (!piUser?.accessToken || piUser.fallbackMode) {
        setSecurityNote('VIP Pass is active for this session.')
        setMessage('VIP Pass active.')
        return
      }

      setIsCheckingVipStatus(true)
      setSecurityNote('Refreshing VIP Pass and rewards...')

      try {
        const [vipStatus, weeklyLeaderboard] = await Promise.all([
          checkVipPass(piUser.accessToken),
          fetchWeeklyLeaderboard(),
        ])

        setIsVip(Boolean(vipStatus.active))
        setLeaderboard(weeklyLeaderboard.entries)
        setLeaderboardWeek(weeklyLeaderboard.week)
        setRewardPool(weeklyLeaderboard.rewards)

        if (vipStatus.active) {
          setSecurityNote('VIP Pass and rewards refreshed.')
          setMessage('VIP rewards updated.')
        } else {
          setSecurityNote('VIP Pass has expired.')
          setMessage('VIP Pass expired. Tap VIP to renew.')
        }
      } catch (error) {
        console.warn('[PiTiles] VIP refresh failed:', error)
        setSecurityNote('VIP status could not be refreshed. Please try again.')
        setMessage('Unable to refresh VIP status.')
      } finally {
        setIsCheckingVipStatus(false)
      }

      return
    }

    if (!piUser || piUser.fallbackMode || !piUser.accessToken) {
      setSecurityNote('VIP payment blocked: connect with Pi before opening payment.')
      setMessage('Connect with Pi first.')
      return
    }

    setSecurityNote('Checking VIP status...')
    setIsCheckingVipStatus(true)

    try {
      const vipStatus = await checkVipPass(piUser.accessToken)

      if (vipStatus.active) {
        setIsVip(true)
        setSecurityNote('VIP Pass restored from server.')
        setMessage('VIP Pass active.')
        return
      }

      console.info('[PiTiles] VIP status checked before payment:', {
        piUid: vipStatus.piUid,
        username: vipStatus.username,
        active: vipStatus.active,
      })
    } catch (error) {
      console.warn('[PiTiles] VIP pre-payment status check failed:', error)
      setSecurityNote('VIP status could not be verified. Please try again.')
      setMessage('Unable to verify VIP status.')
      return
    } finally {
      setIsCheckingVipStatus(false)
    }

    setSecurityNote('Opening Pi payment…')
    setIsOpeningVipPayment(true)

    const result = await requestVipPayment({
      onStatus(status) {
        setSecurityNote(status)
        setMessage(status)
      },
    })
    setIsOpeningVipPayment(false)

    if (result.paid) {
      setIsVip(true)
      try {
        const weeklyLeaderboard = await fetchWeeklyLeaderboard()
        setLeaderboard(weeklyLeaderboard.entries)
        setLeaderboardWeek(weeklyLeaderboard.week)
        setRewardPool(weeklyLeaderboard.rewards)
      } catch (error) {
        console.warn('[PiTiles] leaderboard refresh after VIP payment failed:', error)
      }
      setSecurityNote(result.vipExpiresAt ? `VIP activated until ${new Date(result.vipExpiresAt).toLocaleDateString()}.` : 'VIP activated successfully.')
      setMessage('VIP Pass activated.')
      return
    }

    if (result.alreadyVip) {
      setIsVip(true)
      setSecurityNote(
        result.vipExpiresAt
          ? `VIP active until ${new Date(result.vipExpiresAt).toLocaleDateString()}.`
          : 'VIP Pass is already active.',
      )
      setMessage('VIP Pass active.')
      return
    }

    if (result.cancelled) {
      setSecurityNote('VIP payment cancelled.')
      setMessage('VIP payment cancelled.')
      return
    }

    setSecurityNote(result.error || 'VIP payment failed.')
    setMessage(result.error || 'VIP payment failed.')
  }

  return (
    <main
      className={`pi-shell ${isAndroidApp ? 'is-android-app' : ''} ${
        playing ? 'is-game-active' : ''
      } ${isCriticalTimer ? 'timer-danger' : ''}`}
    >
      <div className="pi-bg" />

      <div className="pi-particles" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <section className="pi-card" aria-label="Pi Tiles">
        <div className="pi-card-ribbon" />

        <div className="pi-card-content">
          <header className="pi-header">
            <div>
              <div className="pi-eyebrow">
                <Icon name="sparkles" tone="tone-amber" />
                <span>{isAndroidApp ? 'Neon Puzzle Arcade' : 'The arcade Tiles Game'}</span>
              </div>

              <h1>Pi Tiles</h1>

              <div className={`pi-user-badge ${isRealPiAuth ? 'is-sdk' : 'is-guest'}`}>
                <span>{isAndroidApp ? 'Guest Mode' : isRealPiAuth ? 'Hey ! Pioneer' : 'Guest Mode'}</span>
                <strong>{isAndroidApp ? 'Android' : playerName || piUser?.username || 'Guest'}</strong>
              </div>

              {!isAndroidApp && !isRealPiAuth && (
                <button
                  type="button"
                  onClick={() => void connectPioneer()}
                  className="ghost-button connect-pioneer-button"
                  disabled={isConnectingPi}
                >
                  {isConnectingPi ? 'Signing in...' : 'Sign in with Pi'}
                </button>
              )}
            </div>

            <div
              className={`time-badge ${playing ? 'is-playing' : ''} ${isCriticalTimer ? 'is-critical' : ''}`}
              aria-live="polite"
            >
              <div>{timeLeft}</div>
              <span>seconds</span>
            </div>
          </header>

          <div className="stats-grid">
            {[
              { label: 'Score', value: score },
              { label: 'Combo', value: `x${combo}` },
              { label: 'Best', value: best },
            ].map((item) => (
              <div
                key={item.label === 'Combo' ? `${item.label}-${comboBurst}` : item.label}
                className={`stat-card ${item.label === 'Combo' && combo > 1 ? 'combo-flash' : ''} ${
                  item.label === 'Combo' && isHotCombo ? 'combo-hot' : ''
                }`}
              >
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          {comboCallout && (
            <div key={`combo-callout-${comboBurst}`} className="combo-callout" aria-hidden="true">
              {comboCallout}
            </div>
          )}

          <div className="message-box">{message}</div>

          <div
            className={`board-wrap ${
              lastSwap.length > 0 && (lastMatches.length > 0 || isRefilling) ? 'has-swap-trail' : ''
            } ${lastMatches.length >= 8 ? 'blast-surge' : ''} ${isRefilling ? 'is-refilling' : ''} ${
              isAnimatingResolution ? 'is-resolving' : ''
            } ${isBoardQuaking ? 'combo-quake' : ''}`}
          >
            <div className="tile-board">
              {board.map((tile, index) => {
                const symbol = getTileSymbol(tile)
                const active = selected === index
                const neighborHint = playing && !isAnimatingResolution && selected !== null && areNeighbors(selected, index)
                const swapped = lastSwap.includes(index)
                const invalid = invalidSwap.includes(index)
                const matched = lastMatches.includes(index)
                const isNewTile = newTiles.includes(index)
                const fallDistance = fallDistances[index] || 0
                const cascadePace = Math.max(0.78, 1 - refillCascadeStep * 0.055)
                const fallDelay =
                  fallDistance > 0
                    ? COLUMN_FALL_DELAYS[index % BOARD_SIZE] + ((Math.floor(index / BOARD_SIZE) * 3 + fallDistance) % 7)
                    : 0
                const fallDuration =
                  fallDistance > 0 ? Math.round((180 + Math.min(5, fallDistance) * 12) * cascadePace) : 180
                const fallDrift =
                  fallDistance > 0
                    ? (index % BOARD_SIZE - 2) * 1.4 + (fallDistance % 2 === 0 ? 1.2 : -1.2)
                    : 0
                const swapMotion = getSwapMotion(index, invalid ? invalidSwap : lastSwap)
                const tilePower = getTilePower(tile)

                return (
                  <button
                    key={getTileId(tile, index)}
                    type="button"
                    onPointerDown={(event) => handleTilePointerDown(event, index)}
                    onPointerMove={handleTilePointerMove}
                    onPointerUp={handleTilePointerUp}
                    onPointerCancel={handleTilePointerCancel}
                    onClick={() => handleTileClick(index)}
                    style={
                      {
                        '--fall-y': `${-fallDistance * TILE_SIZE_PX}px`,
                        '--fall-delay': `${fallDelay}ms`,
                        '--fall-duration': `${fallDuration}ms`,
                        '--fall-drift': `${fallDrift}px`,
                        '--swap-col': swapMotion.col,
                        '--swap-row': swapMotion.row,
                      } as CSSProperties
                    }
                    className={`tile ${SYMBOL_STYLES[symbol]} ${active ? 'is-active' : ''} ${
                      neighborHint ? 'is-neighbor-hint' : ''
                    } ${swapped ? 'is-swapped' : ''} ${
                      invalid ? 'is-invalid-swap' : ''
                    } ${matched && lastMatches.length < 8 ? 'is-matched' : ''} ${tilePower === 'pi-bomb' ? 'is-pi-bomb' : ''} ${
                      matched && lastMatches.length >= 8 ? 'is-area-blast' : ''
                    } ${fallDistance > 0 ? 'is-falling' : ''} ${isNewTile ? 'is-new-tile' : ''}`}
                    aria-label={`Tile ${symbol} ${index + 1}${tilePower === 'pi-bomb' ? ' Pi Bomb' : ''}`}
                  >
                    <span>{symbol}</span>
                  </button>
                )
              })}
            </div>

            <div className="bonus-burst-layer" aria-hidden="true">
              {bonusBursts.map((burst) => {
                const position = getBonusBurstPosition(burst.index)

                return (
                  <div
                    key={burst.id}
                    className={`bonus-burst ${burst.kind}`}
                    style={
                      {
                        '--burst-x': `${position.x}%`,
                        '--burst-y': `${position.y}%`,
                      } as CSSProperties
                    }
                  >
                    <span>{burst.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="stats-grid">
            <div className="mini-card">
              <strong>{selectedLabel}</strong>
              <span>selected</span>
            </div>

            <div className="mini-card">
              <strong className="tone-emerald">{validMoves}</strong>
              <span>valid swaps</span>
            </div>

            <div className="mini-card">
              <strong className="tone-amber">{nextRewardPreview}</strong>
              <span>next gain</span>
            </div>
          </div>

          <div className={`actions-grid ${isAndroidApp ? 'android-actions' : ''}`}>
            <button type="button" onClick={start} className="primary-button">
              <Icon name="zap" />
              {playing ? 'Restart' : 'Start Game'}
            </button>

            {!isAndroidApp && (
              <button
                type="button"
                onClick={() => void handleVipPayment()}
                className="secondary-button"
                disabled={isOpeningVipPayment || isCheckingVipStatus}
                aria-pressed={isVip}
              >
                {isCheckingVipStatus ? 'Checking...' : isOpeningVipPayment ? 'Opening...' : isVip ? 'VIP Active' : 'VIP'}
              </button>
            )}
          </div>

          {isAndroidApp && <AndroidAdSlot />}

          {!isAndroidApp && (
            <section className={`panel panel-amber ${isVip ? 'vip-aura' : ''}`}>
              <div className="panel-title-row">
                <div className="panel-title">
                  <Icon name="crown" tone="tone-amber" />
                  <h2>VIP Pass</h2>
                </div>

                <div className="pill">{VIP_PRICE_PI} Pi / week</div>
              </div>

              <p>VIP Pass unlocks the weekly VIP reward circuit.</p>

              <div className="reward-grid">
                <div>
                  <strong className="tone-amber">{vipMembers}</strong>
                  <span>Active VIPs</span>
                </div>

                <div className="reward-pool-cell">
                  <strong className="tone-emerald">{weeklyPool.toFixed(2)} Pi</strong>
                  <span>Weekly Prize Pool</span>
                </div>
              </div>

              <div className="security-note">
                <Icon name="shield" tone="tone-emerald" />
                <span>
                  {securityNote} · Valid Swaps: {validMoves} · Games Submitted: {gamesPlayed}
                </span>
              </div>
            </section>
          )}

          {SHOW_PI_DEBUG_PANEL && !isAndroidApp && (
            <section className="panel panel-cyan">
              <div className="panel-title">
                <Icon name="server" tone="tone-cyan" />
                <h2>Pi Integration</h2>
              </div>

              <div className="integration-grid">
                <div>Auth Pi: {isRealPiAuth ? PI_INTEGRATION_STATUS.auth : 'guest'}</div>
                <div>Payments: {PI_INTEGRATION_STATUS.payments}</div>
                <div>Leaderboard: {PI_INTEGRATION_STATUS.leaderboard}</div>
                <div>Rewards: {PI_INTEGRATION_STATUS.rewards}</div>
              </div>

              <div className="payload-box">
                Last server payload: {lastPayload ? `${lastPayload.username} · ${lastPayload.score} pts · ${lastPayload.week}` : 'no score submitted'}
              </div>
            </section>
          )}

          <section className="panel panel-dark">
            <div className="leaderboard-head">
              <div>
                <h2>Global Leaderboard • VIP Circuit</h2>
                <p>{leaderboardWeek}</p>
              </div>

            </div>

            <div className="submit-row">
              <input
                value={leaderboardSearch}
                onChange={(event) => setLeaderboardSearch(event.target.value)}
                placeholder="Search player"
                aria-label="Search player in leaderboard"
              />
            </div>

            {selectedLeaderboardPlayer && (
              <div className="leaderboard-player-summary">
                <div>
                  <span>Player</span>
                  <strong>{selectedLeaderboardPlayer.name}</strong>
                </div>

                <div>
                  <span>Best rank</span>
                  <strong>#{selectedLeaderboardPlayer.bestRank}</strong>
                </div>

                <div>
                  <span>Best score</span>
                  <strong>{selectedLeaderboardPlayer.bestScore}</strong>
                </div>

                <div>
                  <span>Scores</span>
                  <strong>{selectedLeaderboardPlayer.scoresCount}</strong>
                </div>

                <div>
                  <span>Status</span>
                  <strong>{selectedLeaderboardPlayer.vip ? `VIP #${selectedLeaderboardPlayer.vipRank}` : 'Pioneer'}</strong>
                </div>

                <div>
                  <span>Reward</span>
                  <strong>{selectedLeaderboardPlayer.reward}</strong>
                </div>
              </div>
            )}

            <div className="leaderboard-list">
              {searchedLeaderboard.length === 0 && (
                <div className="leaderboard-empty">No player found.</div>
              )}

              {searchedLeaderboard.map((row) => {
                const rank = row.rank || leaderboard.findIndex((entry) => entry.id === row.id) + 1
                const vipRank = getVipRank(leaderboard, row)
                const reward = row.reward || rewardForVipRank(vipRank, weeklyPool)
                const rewardLabel = row.vip ? reward : 'No rewards'
                const status = getLeaderboardStatus(row, vipRank, reward)

                return (
                  <div
                    key={row.id}
                    className={`leaderboard-row ${row.isPlayer ? 'is-player' : ''} ${row.vip ? 'is-vip' : ''} ${
                      rank <= 3 ? 'is-podium' : ''
                    } ${leaderboardQuery ? 'is-search-match' : ''}`}
                  >
                    <div className="leaderboard-player">
                      <div className={`rank rank-${rank}`}>#{rank}</div>

                      <div className="player-copy">
                        <div className="player-name">
                          <span>{row.name}</span>
                          <em className={row.vip ? 'status-vip' : 'status-no-reward'}>{row.vip ? `VIP #${vipRank}` : 'No rewards'}</em>
                        </div>

                        <small>{status} · score #{row.games}</small>
                      </div>
                    </div>

                    <div className="leaderboard-score">
                      <strong>{row.score}</strong>
                      <span className={row.vip && vipRank && vipRank <= LEADERBOARD_LIMIT ? 'tone-emerald' : ''}>{rewardLabel}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {isAndroidApp && <AndroidPiBridge />}

          {!isAndroidApp && (
            <section className="panel panel-dark checklist">
              <div className="panel-title">
                <Icon name="wallet" tone="tone-amber" />
                <h2>Production checklist</h2>
              </div>

              <p>1. Pi username authentication enabled.</p>
              <p>2. VIP payment opens through the Pi SDK.</p>
              <p>3. Scores are protected by the anti-cheat MVP.</p>
              <p>4. Weekly VIP rewards are simulated for Testnet.</p>
            </section>
          )}
        </div>
      </section>
    </main>
  )
}
