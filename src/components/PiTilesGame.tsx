import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  areNeighbors,
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
  getVipRank,
  makeSeededLeaderboard,
  mergeLeaderboardEntry,
  rewardForVipRank,
  submitScoreToLeaderboard,
  VIP_PRICE_PI,
} from '../api/leaderboardApi'
import type { LeaderboardEntry } from '../api/leaderboardApi'
import { authenticatePiUser, createMockPiUser, PI_INTEGRATION_STATUS, requestVipPayment } from '../pi/piClient'
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
const MATCH_FLASH_MS = 300
const REFILL_ANIMATION_MS = 430
const TILE_SIZE_PX = 58
const MAX_VISIBLE_CASCADES = 3

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

export function PiTilesGame() {
  const [piUser, setPiUser] = useState<PiUser | null>(null)
  const [isConnectingPi, setIsConnectingPi] = useState(false)

  const [board, setBoard] = useState<Board>(makeBoard)
  const [selected, setSelected] = useState<number | null>(null)
  const [lastSwap, setLastSwap] = useState<number[]>([])
  const [lastMatches, setLastMatches] = useState<number[]>([])
  const [fallDistances, setFallDistances] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('Pick a tile, then swap with a neighbor.')
  const [best, setBest] = useState(0)
  const [playerName, setPlayerName] = useState('')
  const [isVip, setIsVip] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(makeSeededLeaderboard)
  const [submitted, setSubmitted] = useState(false)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [validMoves, setValidMoves] = useState(0)
  const [lastPayload, setLastPayload] = useState<ScorePayload | null>(null)
  const [comboBurst, setComboBurst] = useState(0)
  const [comboCallout, setComboCallout] = useState<(typeof COMBO_CALLOUTS)[number] | null>(null)
  const [isRefilling, setIsRefilling] = useState(false)
  const [isAnimatingResolution, setIsAnimatingResolution] = useState(false)
  const [securityNote, setSecurityNote] = useState(
    'Connect Pioneer to enable Pi username and VIP payment.',
  )

  const animationTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const lastDangerTick = useRef<number | null>(null)
  const mounted = useRef(true)
  const connectRequest = useRef<Promise<PiUser> | null>(null)
  const [vipMembers] = useState(247)
  const { weeklyPool } = useMemo(() => calculateRewardPool(vipMembers), [vipMembers])

  const isRealPiAuth = piUser !== null && !piUser.fallbackMode && Boolean(piUser.accessToken)
  const selectedLabel = selected === null ? '—' : getTileSymbol(board[selected])
  const nextRewardPreview = useMemo(() => `${3 * 3 * 10}+`, [])
  const isCriticalTimer = playing && timeLeft <= 10
  const isHotCombo = combo >= 5

  const clearAnimationTimers = useCallback(() => {
    animationTimers.current.forEach((timer) => clearTimeout(timer))
    animationTimers.current = []
  }, [])

  const connectPioneer = useCallback(async () => {
    if (connectRequest.current) return connectRequest.current
    if (piUser?.isAuthenticated && piUser.accessToken) return piUser

    const request = (async () => {
      setIsConnectingPi(true)
      setSecurityNote('Opening Pi authentication...')

      try {
        const user = await authenticatePiUser()

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

  const start = useCallback(() => {
    clearAnimationTimers()
    playStartSound()
    lastDangerTick.current = null
    setBoard(makeBoard())
    setSelected(null)
    setLastSwap([])
    setLastMatches([])
    setFallDistances([])
    setIsRefilling(false)
    setIsAnimatingResolution(false)
    setScore(0)
    setCombo(0)
    setTimeLeft(ROUND_SECONDS)
    setPlaying(true)
    setSubmitted(false)
    setValidMoves(0)
    setLastPayload(null)
    setComboBurst(0)
    setComboCallout(null)
    setSecurityNote('Game running: valid swaps are being counted.')
    setMessage('Go! Match lines of 3+ to score.')
  }, [clearAnimationTimers])

  const submitScore = useCallback(
    async (finalScore = score, auto = false) => {
      if (submitted || finalScore <= 0) return

      if (playing && !auto) {
        setSecurityNote('Submit blocked: finish the game first.')
        return
      }

      if (validMoves < MIN_VALID_MOVES) {
        setSecurityNote('Submit blocked: not enough activity for a valid game.')
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
      })

      if (!result.accepted || !result.entry) {
        setSecurityNote(result.reason || 'Score rejected by anti-cheat checks.')
        return
      }

      playSuccessSound()
      setLastPayload(payload)
      setLeaderboard((rows) => mergeLeaderboardEntry(rows, result.entry!))
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

    const swapped = swapCells(board, a, b)
    const previewMatches = findMatches(swapped)

    setLastSwap([a, b])
    setSelected(null)

    if (previewMatches.length === 0) {
      setLastMatches([])
      setFallDistances([])
      setIsRefilling(false)
      setIsAnimatingResolution(false)
      setComboCallout(null)
      setSecurityNote('No-match swap: combo count unchanged.')
      setMessage('No match found.')
      return
    }

    let currentBoard = swapped
    let cascadeMultiplier = 1
    let totalGained = 0
    let totalMatched = 0
    let cascadeCount = 0
    let reshuffled = false
    let cascadeLimitReached = false

    setIsAnimatingResolution(true)
    setBoard(swapped)

    for (let stepIndex = 0; stepIndex < MAX_VISIBLE_CASCADES; stepIndex += 1) {
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

      playMatchSound()

      if (step.combo >= 5 || step.matched >= 8) {
        playComboSound()
      }

      setLastMatches(step.matches)
      setFallDistances([])
      setIsRefilling(false)
      setCombo((currentCombo) => currentCombo + 1)
      setScore((currentScore) => currentScore + step.gained)
      setComboBurst((burst) => burst + 1)

      if (step.combo >= 5 || step.matched >= 8) {
        const calloutIndex = (step.gained + step.matched + cascadeCount + validMoves) % COMBO_CALLOUTS.length
        setComboCallout(COMBO_CALLOUTS[calloutIndex])
      } else {
        setComboCallout(null)
      }

      if (step.matched >= 8) {
        setMessage(`${step.matched} tiles blasted · AREA BLAST · +${step.gained}`)
      } else {
        setMessage(`${step.matched} tiles blasted · cascade ${cascadeCount} · +${step.gained}`)
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, MATCH_FLASH_MS)
        animationTimers.current.push(timer)
      })

      setLastMatches([])
      setFallDistances(step.fallDistances)
      setIsRefilling(true)
      setBoard(step.board)

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, REFILL_ANIMATION_MS)
        animationTimers.current.push(timer)
      })

      setFallDistances([])
      setIsRefilling(false)

      currentBoard = step.board
      cascadeMultiplier = step.combo
    }

    if (cascadeCount >= MAX_VISIBLE_CASCADES && findMatches(currentBoard).length > 0) {
      cascadeLimitReached = true
      setLastMatches([])
      setFallDistances([])
      setIsRefilling(false)
      setBoard(currentBoard)
    }

    setValidMoves((currentMoves) => currentMoves + 1)
    setBoard(currentBoard)
    setIsAnimatingResolution(false)

    if (cascadeLimitReached) {
      setSecurityNote('Long cascade paused safely without replacing the board.')
    } else if (reshuffled) {
      setSecurityNote('No moves left: board reshuffled automatically after cascades.')
    } else {
      setSecurityNote('Matches validated: cascades resolved step by step.')
    }

    if (cascadeLimitReached) {
      setMessage(`${totalMatched} tiles cleared · cascade paused · +${totalGained} points`)
    } else if (cascadeCount > 1) {
      setMessage(`${totalMatched} tiles blasted · ${cascadeCount} cascades · +${totalGained} points`)
    } else {
      setMessage(`${totalMatched} tiles blasted · +${totalGained} points`)
    }
  }

  function tapCell(index: number) {
    if (!playing || isAnimatingResolution) return

    if (selected === null) {
      playTapSound()
      setSelected(index)
      return
    }

    if (selected === index) {
      playTapSound()
      setSelected(null)
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

  function rerollLeaderboard() {
    setLeaderboard(makeSeededLeaderboard())
    setSubmitted(false)
    setSecurityNote('Leaderboard refreshed.')
  }

  async function handleVipPayment() {
    if (isVip) {
      setSecurityNote('VIP Pass is already active.')
      setMessage('VIP Pass active.')
      return
    }

    let activePiUser = piUser

    if (!activePiUser || activePiUser.fallbackMode || !activePiUser.accessToken) {
      setSecurityNote('Connect Pioneer before opening VIP payment.')
      setMessage('Connecting Pioneer...')
      activePiUser = await connectPioneer()
    }

    if (!activePiUser || activePiUser.fallbackMode || !activePiUser.accessToken) {
      setSecurityNote('VIP payment blocked: valid Pi authentication required.')
      setMessage('Connect Pioneer first.')
      return
    }

    setSecurityNote('Opening Pi payment…')

    const result = await requestVipPayment()

    if (result.paid) {
      setIsVip(true)
      setSecurityNote('VIP activated successfully.')
      setMessage('VIP Pass activated.')
      return
    }

    if (result.cancelled) {
      setSecurityNote('VIP payment cancelled.')
      setMessage('VIP payment cancelled.')
      return
    }

    setSecurityNote(result.error || 'VIP payment failed.')
    setMessage('VIP payment failed.')
  }

  return (
    <main className={`pi-shell ${isCriticalTimer ? 'timer-danger' : ''}`}>
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
                <span>Pi Network Arcade</span>
              </div>

              <h1>Pi Tiles</h1>

              <div className={`pi-user-badge ${isRealPiAuth ? 'is-sdk' : 'is-guest'}`}>
                <span>{isRealPiAuth ? 'Hey ! Pioneer' : 'Guest Mode'}</span>
                <strong>{playerName || piUser?.username || 'Guest'}</strong>
              </div>

              {!isRealPiAuth && (
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
            } ${lastMatches.length >= 8 ? 'blast-surge' : ''} ${isRefilling ? 'is-refilling' : ''}`}
          >
            <div className="tile-board">
              {board.map((tile, index) => {
                const symbol = getTileSymbol(tile)
                const active = selected === index
                const swapped = lastSwap.includes(index)
                const matched = lastMatches.includes(index)
                const fallDistance = fallDistances[index] || 0
                const tilePower = getTilePower(tile)

                return (
                  <button
                    key={getTileId(tile, index)}
                    type="button"
                    onClick={() => tapCell(index)}
                    style={{ '--fall-y': `${-fallDistance * TILE_SIZE_PX}px` } as CSSProperties}
                    className={`tile ${SYMBOL_STYLES[symbol]} ${active ? 'is-active' : ''} ${swapped ? 'is-swapped' : ''} ${
                      matched ? 'is-matched' : ''
                    } ${tilePower === 'pi-bomb' ? 'is-pi-bomb' : ''} ${
                      matched && lastMatches.length >= 8 ? 'is-area-blast' : ''
                    } ${fallDistance > 0 ? 'is-falling' : ''}`}
                    aria-label={`Tile ${symbol} ${index + 1}${tilePower === 'pi-bomb' ? ' Pi Bomb' : ''}`}
                  >
                    <span>{symbol}</span>
                  </button>
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

          <div className="actions-grid">
            <button type="button" onClick={start} className="primary-button">
              <Icon name="zap" />
              {playing ? 'Restart' : 'Start Game'}
            </button>

            <button type="button" onClick={() => void handleVipPayment()} className="secondary-button">
              {isVip ? 'VIP Active' : 'VIP'}
            </button>
          </div>

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

          <section className="panel panel-dark">
            <div className="leaderboard-head">
              <div>
                <h2>Global Leaderboard • VIP Circuit</h2>
                <p>{currentWeekLabel()}</p>
              </div>

              <button type="button" onClick={rerollLeaderboard} className="ghost-button">
                Refresh
              </button>
            </div>

            <div className="submit-row">
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Pioneer Name"
                aria-label="Pioneer Name"
              />

              <button type="button" onClick={() => void submitScore()} disabled={submitted || score <= 0} className="submit-button">
                Submit
              </button>
            </div>

            <div className="leaderboard-list">
              {leaderboard.map((row, index) => {
                const vipRank = getVipRank(leaderboard, row)
                const reward = rewardForVipRank(vipRank, weeklyPool)

                return (
                  <div
                    key={row.id}
                    className={`leaderboard-row ${row.isPlayer ? 'is-player' : ''} ${row.vip ? 'is-vip' : ''} ${index < 3 ? 'is-podium' : ''}`}
                  >
                    <div className="leaderboard-player">
                      <div className={`rank rank-${index + 1}`}>#{index + 1}</div>

                      <div className="player-copy">
                        <div className="player-name">
                          <span>{row.name}</span>
                          {row.vip && <em>VIP #{vipRank}</em>}
                        </div>

                        <small>{row.games} games played</small>
                      </div>
                    </div>

                    <div className="leaderboard-score">
                      <strong>{row.score}</strong>
                      <span className={row.vip && vipRank && vipRank <= 10 ? 'tone-emerald' : ''}>{reward}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

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
        </div>
      </section>
    </main>
  )
}
