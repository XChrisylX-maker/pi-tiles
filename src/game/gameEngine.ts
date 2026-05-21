export const BOARD_SIZE = 5
export const ROUND_SECONDS = 60
export const MAX_CASCADE_STEPS = 4
export const MIN_VALID_MOVES = 2
export const ANTI_CHEAT_VERSION = 'placeholder-v1'

export const SYMBOLS = ['π', '✦', '⬢', '◈', '⬡'] as const

export type TileSymbol = (typeof SYMBOLS)[number]

export type Tile = {
  id: string
  symbol: TileSymbol
}

export type Board = Tile[]

export type ResolveBoardResult = {
  board: Board
  gained: number
  matched: number
  cascades: number
  combo: number
  lastMatches: number[]
  fallDistances: number[]
  wasReshuffled: boolean
}

export type ResolveStepResult = {
  board: Board
  gained: number
  matched: number
  matches: number[]
  fallDistances: number[]
  combo: number
  hasMatches: boolean
  wasReshuffled: boolean
}

export type GravityRefillResult = {
  board: Board
  fallDistances: number[]
}

export type ScorePlayer = {
  piUid: string
  username: string
}

export type ScorePayload = {
  piUid: string
  username: string
  score: number
  validMoves: number
  finalBoardHash: string
  week: string
  clientTimestamp: string
  antiCheatVersion: string
}

export type AntiCheatResult = {
  valid: boolean
  reason?: string
}

export const SYMBOL_STYLES: Record<TileSymbol, string> = {
  π: 'tile-pi',
  '✦': 'tile-star',
  '⬢': 'tile-hex',
  '◈': 'tile-diamond',
  '⬡': 'tile-ring',
}

let tileIdCounter = 0

function createTileId(): string {
  tileIdCounter += 1

  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `tile-${Date.now()}-${tileIdCounter}`
}

export function randomSymbol(): TileSymbol {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
}

export function makeTile(symbol: TileSymbol = randomSymbol()): Tile {
  return {
    id: createTileId(),
    symbol,
  }
}

function symbolAt(board: Board, index: number): TileSymbol {
  return board[index].symbol
}

function indexOf(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

function isInside(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

function addIndex(target: Set<number>, row: number, col: number) {
  if (!isInside(row, col)) return
  target.add(indexOf(row, col))
}

function addLineBlast(target: Set<number>, row: number, col: number, horizontal: boolean) {
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    target.add(horizontal ? indexOf(row, i) : indexOf(i, col))
  }
}

function addCrossBlast(target: Set<number>, row: number, col: number) {
  addLineBlast(target, row, col, true)
  addLineBlast(target, row, col, false)
}

function addSquareBlast(target: Set<number>, centerRow: number, centerCol: number, radius = 1) {
  for (let row = centerRow - radius; row <= centerRow + radius; row += 1) {
    for (let col = centerCol - radius; col <= centerCol + radius; col += 1) {
      addIndex(target, row, col)
    }
  }
}

function addComboShockwave(target: Set<number>, combo: number) {
  if (combo < 9) return

  const center = Math.floor(BOARD_SIZE / 2)
  addSquareBlast(target, center, center, combo >= 10 ? 2 : 1)
}

type RunMatch = {
  indexes: number[]
  length: number
  row: number
  col: number
  horizontal: boolean
}

export function findMatchRuns(board: Board): RunMatch[] {
  const runs: RunMatch[] = []

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let runStart = 0

    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      const current = col < BOARD_SIZE ? symbolAt(board, indexOf(row, col)) : null
      const previous = symbolAt(board, indexOf(row, runStart))

      if (current !== previous) {
        const length = col - runStart

        if (length >= 3) {
          const indexes = Array.from({ length }, (_, offset) => indexOf(row, runStart + offset))
          runs.push({
            indexes,
            length,
            row,
            col: Math.floor(runStart + (length - 1) / 2),
            horizontal: true,
          })
        }

        runStart = col
      }
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let runStart = 0

    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      const current = row < BOARD_SIZE ? symbolAt(board, indexOf(row, col)) : null
      const previous = symbolAt(board, indexOf(runStart, col))

      if (current !== previous) {
        const length = row - runStart

        if (length >= 3) {
          const indexes = Array.from({ length }, (_, offset) => indexOf(runStart + offset, col))
          runs.push({
            indexes,
            length,
            row: Math.floor(runStart + (length - 1) / 2),
            col,
            horizontal: false,
          })
        }

        runStart = row
      }
    }
  }

  return runs
}

export function findMatches(board: Board, combo = 1): number[] {
  const matches = new Set<number>()
  const runs = findMatchRuns(board)

  // Important: combo shockwaves must only amplify a real match.
  // If we add shockwave tiles when runs.length === 0, combo >= 8 creates
  // endless fake cascades because findMatches() never returns an empty list.
  if (runs.length === 0) {
    return []
  }

  runs.forEach((run) => {
    run.indexes.forEach((index) => matches.add(index))

    const runSymbol = board[run.indexes[0]].symbol
    const isPiRun = runSymbol === 'π'

    // Standard match bonuses for all symbols.
    if (run.length === 4) {
      addLineBlast(matches, run.row, run.col, run.horizontal)
    }

    if (run.length >= 5) {
      addCrossBlast(matches, run.row, run.col)
      addSquareBlast(matches, run.row, run.col, 1)
    }

    if (run.length >= 6) {
      addSquareBlast(matches, run.row, run.col, 2)
    }

    // Pi-only special blasts.
    // These are instant effects, not persistent special tiles, so the board
    // logic stays simple and safe for V1.
    if (isPiRun && run.length >= 4) {
      // Pi Line Blast: a 4-Pi match clears both row and column.
      addCrossBlast(matches, run.row, run.col)
    }

    if (isPiRun && run.length >= 5) {
      // Pi Bomb: a 5-Pi match clears a large 5x5 zone around the match center.
      addSquareBlast(matches, run.row, run.col, 2)
    }

    if (isPiRun && run.length >= 6) {
      // Golden Pi Blast: a 6+ Pi match clears the full board.
      for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
        matches.add(index)
      }
    }
  })

  addComboShockwave(matches, combo)

  return Array.from(matches)
}

export function hasValidMoves(board: Board): boolean {
  if (findMatchRuns(board).length > 0) return true

  for (let index = 0; index < board.length; index += 1) {
    const row = Math.floor(index / BOARD_SIZE)
    const col = index % BOARD_SIZE
    const candidates = [
      [row, col + 1],
      [row + 1, col],
    ]

    for (const [nextRow, nextCol] of candidates) {
      if (!isInside(nextRow, nextCol)) continue

      const otherIndex = indexOf(nextRow, nextCol)
      const swapped = swapCells(board, index, otherIndex)

      if (findMatchRuns(swapped).length > 0) return true
    }
  }

  return false
}

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items]

  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }

  return next
}

export function shuffleBoard(board: Board): Board {
  return shuffleArray(board.map((tile) => tile.symbol)).map((symbol) => makeTile(symbol))
}

function makeRandomBoard(): Board {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => makeTile())
}

export function makePlayableBoard(maxAttempts = 80): Board {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const board = makeRandomBoard()

    if (findMatchRuns(board).length === 0 && hasValidMoves(board)) {
      return board
    }
  }

  return makeRandomBoard()
}

export function ensurePlayableBoard(board: Board, maxAttempts = 80): { board: Board; wasReshuffled: boolean } {
  if (hasValidMoves(board)) {
    return { board, wasReshuffled: false }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const shuffled = shuffleBoard(board)

    if (findMatchRuns(shuffled).length === 0 && hasValidMoves(shuffled)) {
      return { board: shuffled, wasReshuffled: true }
    }
  }

  return { board: makePlayableBoard(), wasReshuffled: true }
}

export function applyGravityRefill(board: Board, matches: number[]): GravityRefillResult {
  const next = [...board]
  const fallDistances = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => 0)
  const matched = new Set(matches)

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const survivors: Array<{ tile: Tile; row: number }> = []

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const index = row * BOARD_SIZE + col

      if (!matched.has(index)) {
        survivors.push({ tile: board[index], row })
      }
    }

    const spawnCount = BOARD_SIZE - survivors.length
    const newTiles = Array.from({ length: spawnCount }, (_, spawnIndex) => ({
      tile: makeTile(),
      row: -spawnCount + spawnIndex,
      isNew: true,
    }))

    const refilledColumn: Array<{ tile: Tile; row: number; isNew?: boolean }> = [
      ...newTiles,
      ...survivors,
    ]

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const cell = refilledColumn[row]
      const index = row * BOARD_SIZE + col

      next[index] = cell.tile

      fallDistances[index] = Math.max(0, row - cell.row)
    }
  }

  return { board: next, fallDistances }
}


export function resolveOneStep(board: Board, combo = 1): ResolveStepResult {
  const matches = findMatches(board, combo)

  if (matches.length === 0) {
    const playable = ensurePlayableBoard(board)

    return {
      board: playable.board,
      gained: 0,
      matched: 0,
      matches: [],
      fallDistances: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => 0),
      combo,
      hasMatches: false,
      wasReshuffled: playable.wasReshuffled,
    }
  }

  const gained = matches.length * matches.length * 10 * combo
  const refill = applyGravityRefill(board, matches)
  const nextCombo = combo + 1
  const playable = ensurePlayableBoard(refill.board)

  return {
    board: playable.board,
    gained,
    matched: matches.length,
    matches,
    fallDistances: refill.fallDistances,
    combo: nextCombo,
    hasMatches: true,
    wasReshuffled: playable.wasReshuffled,
  }
}

export function resolveBoard(board: Board, startingCombo = 1): ResolveBoardResult {
  let current = [...board]
  let totalGained = 0
  let totalMatched = 0
  let cascadeCount = 0
  let nextCombo = startingCombo
  let lastMatches: number[] = []
  let lastFallDistances = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => 0)

  for (let step = 0; step < MAX_CASCADE_STEPS; step += 1) {
    const matches = findMatches(current, nextCombo)
    if (matches.length === 0) break

    const gained = matches.length * matches.length * 10 * nextCombo
    totalGained += gained
    totalMatched += matches.length
    cascadeCount += 1
    lastMatches = matches

    const refill = applyGravityRefill(current, matches)
    current = refill.board
    lastFallDistances = refill.fallDistances
    nextCombo += 1
  }

  const playable = ensurePlayableBoard(current)

  return {
    board: playable.board,
    gained: totalGained,
    matched: totalMatched,
    cascades: cascadeCount,
    combo: nextCombo,
    lastMatches,
    fallDistances: lastFallDistances,
    wasReshuffled: playable.wasReshuffled,
  }
}

export function makeBoard(): Board {
  return makePlayableBoard()
}

export function areNeighbors(a: number, b: number): boolean {
  const rowA = Math.floor(a / BOARD_SIZE)
  const colA = a % BOARD_SIZE
  const rowB = Math.floor(b / BOARD_SIZE)
  const colB = b % BOARD_SIZE
  return Math.abs(rowA - rowB) + Math.abs(colA - colB) === 1
}

export function swapCells(board: Board, a: number, b: number): Board {
  const next = [...board]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

export function currentWeekLabel(date = new Date()): string {
  const firstDay = new Date(date.getFullYear(), 0, 1)
  const days = Math.floor((date.getTime() - firstDay.getTime()) / 86400000)
  const week = Math.ceil((days + firstDay.getDay() + 1) / 7)
  return `Week ${week} · ${date.getFullYear()}`
}

export function hashBoard(board: Board): string {
  const boardSignature = board.map((tile) => tile.symbol).join('')
  const bytes = new TextEncoder().encode(boardSignature)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
}

export function buildScorePayload({
  player,
  score,
  validMoves,
  board,
  week,
}: {
  player: ScorePlayer
  score: number
  validMoves: number
  board: Board
  week: string
}): ScorePayload {
  return {
    piUid: player.piUid,
    username: player.username,
    score,
    validMoves,
    finalBoardHash: hashBoard(board),
    week,
    clientTimestamp: new Date().toISOString(),
    antiCheatVersion: ANTI_CHEAT_VERSION,
  }
}

export function validateScoreSubmission({
  score,
  validMoves,
  board,
}: {
  score: number
  validMoves: number
  board: Board
}): AntiCheatResult {
  if (score <= 0) return { valid: false, reason: 'Score must be positive.' }
  if (validMoves < MIN_VALID_MOVES) return { valid: false, reason: 'Not enough valid moves.' }
  if (board.length !== BOARD_SIZE * BOARD_SIZE) return { valid: false, reason: 'Invalid board size.' }

  // Placeholder: production should replay signed moves server-side and compare score.
  return { valid: true }
}
