import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  areNeighbors,
  buildScorePayload,
  currentWeekLabel,
  findMatches,
  makeBoard,
  MIN_VALID_MOVES,
  resolveBoard,
  ROUND_SECONDS,
  swapCells,
  SYMBOL_STYLES,
} from '../game/gameEngine'
import type { Board, ScorePayload } from '../game/gameEngine'
import {
  calculateRewardPool,
  getVipRank,
  makeMockLeaderboard,
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

type IconName = 'sparkles' | 'shield' | 'zap' | 'crown' | 'server' | 'wallet'

const ICONS: Record<IconName, string> = {
  sparkles: '✦',
  shield: '✓',
  zap: '↯',
  crown: '♛',
  server: '▣',
  wallet: '◫',
}

const COMBO_CALLOUTS = ['CHAIN', 'MEGA', 'ULTRA'] as const
const MATCH_FLASH_MS = 300
const REFILL_ANIMATION_MS = 430

function Icon({ name, tone = '' }: { name: IconName; tone?: string }) {
  return (
    <span className={`pi-icon ${tone}`} aria-hidden="true">
      {ICONS[name]}
    </span>
  )
}

export function PiTilesGame() {
  const [piUser, setPiUser] = useState<PiUser>(createMockPiUser)
  const [board, setBoard] = useState<Board>(makeBoard)
  const [selected, setSelected] = useState<number | null>(null)
  const [lastSwap, setLastSwap] = useState<number[]>([])
  const [lastMatches, setLastMatches] = useState<number[]>([])
  const [fallDistances, setFallDistances] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(1)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('Pick a tile, then swap with a neighbor.')
  const [best, setBest] = useState(0)
  const [playerName, setPlayerName] = useState('You')
  const [isVip, setIsVip] = useState(true)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(makeMockLeaderboard)
  const [submitted, setSubmitted] = useState(false)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [validMoves, setValidMoves] = useState(0)
  const [lastPayload, setLastPayload] = useState<ScorePayload | null>(null)
  const [comboBurst, setComboBurst] = useState(0)
  const [comboCallout, setComboCallout] = useState<(typeof COMBO_CALLOUTS)[number] | null>(null)
  const [isRefilling, setIsRefilling] = useState(false)
  const [isAnimatingResolution, setIsAnimatingResolution] = useState(false)
  const [securityNote, setSecurityNote] = useState(
    'Anti-cheat MVP active: scores submit only after a real game.',
  )
  const animationTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const [vipMembers] = useState(247)
  const { weeklyPool, platformRevenue } = useMemo(() => calculateRewardPool(vipMembers), [vipMembers])

  useEffect(() => {
    let mounted = true

    authenticatePiUser().then((user) => {
      if (!mounted) return
      setPiUser(user)
      setPlayerName((currentName) => currentName || user.username)
    })

    return () => {
      mounted = false
    }
  }, [])

  const selectedLabel = selected === null ? '—' : board[selected]
  const nextRewardPreview = useMemo(() => `${3 * 3 * 10 * combo}+`, [combo])
  const isCriticalTimer = playing && timeLeft <= 10
  const isHotCombo = combo >= 5

  const clearAnimationTimers = useCallback(() => {
    animationTimers.current.forEach((timer) => clearTimeout(timer))
    animationTimers.current = []
  }, [])

  useEffect(() => clearAnimationTimers, [clearAnimationTimers])

  const start = useCallback(() => {
    clearAnimationTimers()
    setBoard(makeBoard())
    setSelected(null)
    setLastSwap([])
    setLastMatches([])
    setFallDistances([])
    setIsRefilling(false)
    setIsAnimatingResolution(false)
    setScore(0)
    setCombo(1)
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

      const payload = buildScorePayload({
        player: { ...piUser, username: playerName.trim() || piUser.username },
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

      const acceptedEntry = result.entry
      setLastPayload(payload)
      setLeaderboard((rows) => mergeLeaderboardEntry(rows, acceptedEntry))
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

  function resolveSwap(a: number, b: number) {
    clearAnimationTimers()
    const swapped = swapCells(board, a, b)
    const result = resolveBoard(swapped, combo)
    const firstMatches = findMatches(swapped)

    setLastSwap([a, b])
    setSelected(null)

    if (result.cascades === 0) {
      setCombo(1)
      setLastMatches([])
      setFallDistances([])
      setIsRefilling(false)
      setIsAnimatingResolution(false)
      setComboCallout(null)
      setSecurityNote('No-match swap: combo reset.')
      setMessage('No match found.')
      return
    }

    setBoard(swapped)
    setScore((currentScore) => currentScore + result.gained)
    setCombo(result.combo)
    setValidMoves((currentMoves) => currentMoves + 1)
    setLastMatches(firstMatches)
    setFallDistances([])
    setIsRefilling(false)
    setIsAnimatingResolution(true)
    setComboBurst((burst) => burst + 1)
    setComboCallout(
      result.combo >= 5 ? COMBO_CALLOUTS[(result.gained + result.matched + result.cascades + validMoves) % COMBO_CALLOUTS.length] : null,
    )
    setSecurityNote('Matches validated: gravity refill and cascades resolved.')
    setMessage(
      result.cascades > 1
        ? `${result.matched} tiles cleared · ${result.cascades} cascades · +${result.gained} points`
        : `${result.matched} tiles cleared · +${result.gained} points`,
    )

    animationTimers.current.push(
      setTimeout(() => {
        setBoard(result.board)
        setLastMatches([])
        setFallDistances(result.fallDistances)
        setIsRefilling(true)
      }, MATCH_FLASH_MS),
      setTimeout(() => {
        setFallDistances([])
        setIsRefilling(false)
        setIsAnimatingResolution(false)
      }, MATCH_FLASH_MS + REFILL_ANIMATION_MS),
    )
  }

  function tapCell(index: number) {
    if (!playing || isAnimatingResolution) return

    if (selected === null) {
      setSelected(index)
      return
    }

    if (selected === index) {
      setSelected(null)
      return
    }

    if (!areNeighbors(selected, index)) {
      setSelected(index)
      return
    }

    resolveSwap(selected, index)
  }

  function rerollLeaderboard() {
    setLeaderboard(makeMockLeaderboard())
    setSubmitted(false)
    setSecurityNote('Mock leaderboard refreshed.')
  }

  async function toggleVipMock() {
    if (!isVip) {
      await requestVipPayment()
    }

    setIsVip((value) => !value)
    setSecurityNote('Mock VIP status changed. In production, server-verified Pi payment controls VIP.')
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
            </div>

            <div className={`time-badge ${playing ? 'is-playing' : ''} ${isCriticalTimer ? 'is-critical' : ''}`} aria-live="polite">
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
            key={`board-fx-${comboBurst}`}
            className={`board-wrap ${lastSwap.length > 0 && (lastMatches.length > 0 || isRefilling) ? 'has-swap-trail combo-surge' : ''} ${
              isRefilling ? 'is-refilling' : ''
            }`}
          >
            <div className="tile-board">
              {board.map((symbol, index) => {
                const active = selected === index
                const swapped = lastSwap.includes(index)
                const matched = lastMatches.includes(index)

                return (
                  <button
                    key={`${index}-${symbol}-${comboBurst}`}
                    type="button"
                    onClick={() => tapCell(index)}
                    style={{ '--fall-y': `${-(fallDistances[index] || 0) * 58}px` } as CSSProperties}
                    className={`tile ${SYMBOL_STYLES[symbol]} ${active ? 'is-active' : ''} ${swapped ? 'is-swapped' : ''} ${
                      matched ? 'is-matched' : ''
                    }`}
                    aria-label={`Tile ${symbol} ${index + 1}`}
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
            <button type="button" onClick={() => void toggleVipMock()} className="secondary-button">
              {isVip ? 'VIP Mock' : 'Free Mock'}
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

            <p>
              20% of VIP revenue feeds the reward pool. Weekly rewards go to the top 10 VIP players on the board.
            </p>

            <div className="reward-grid">
              <div>
                <strong className="tone-amber">{vipMembers}</strong>
                <span>Active VIPs</span>
              </div>
              <div className="reward-pool-cell">
                <strong className="tone-emerald">{weeklyPool.toFixed(2)} Pi</strong>
                <span>Reward Pool</span>
              </div>
              <div>
                <strong className="tone-cyan">{platformRevenue.toFixed(2)} Pi</strong>
                <span>Platform Cut</span>
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
              <h2>Codex / Pi App Studio</h2>
            </div>
            <div className="integration-grid">
              <div>Auth Pi: {piUser.fallbackMode ? 'mock' : PI_INTEGRATION_STATUS.auth}</div>
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
                    className={`leaderboard-row ${row.isPlayer ? 'is-player' : ''} ${row.vip ? 'is-vip' : ''} ${
                      index < 3 ? 'is-podium' : ''
                    }`}
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
            <p>1. Replace mock user with Pi.authenticate().</p>
            <p>2. Replace VIP toggle with server-verified Pi payment.</p>
            <p>3. Send score payload to backend and rescore server-side.</p>
            <p>4. Calculate weekly top 10 VIPs and distribute the reward pool.</p>
          </section>
        </div>
      </section>
    </main>
  )
}
