export const BOARD_SIZE = 5
export const ROUND_SECONDS = 60
export const MAX_CASCADE_STEPS = 12
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

export function findMatches(board: Board): number[] {
  const matches = new Set<number>()

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let runStart = 0

    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      const current = col < BOARD_SIZE ? symbolAt(board, row * BOARD_SIZE + col) : null
      const previous = symbolAt(board, row * BOARD_SIZE + runStart)

      if (current !== previous) {
        const runLength = col - runStart

        if (runLength >= 3) {
          for (let x = runStart; x < col; x += 1) matches.add(row * BOARD_SIZE + x)
        }

        runStart = col
      }
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let runStart = 0

    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      const current = row < BOARD_SIZE ? symbolAt(board, row * BOARD_SIZE + col) : null
      const previous = symbolAt(board, runStart * BOARD_SIZE + col)

      if (current !== previous) {
        const runLength = row - runStart

        if (runLength >= 3) {
          for (let y = runStart; y < row; y += 1) matches.add(y * BOARD_SIZE + col)
        }

        runStart = row
      }
    }
  }

  return Array.from(matches)
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
    const newTiles = Array.from({ length: spawnCount }, () => ({
      tile: makeTile(),
      row: -1,
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

      if (cell.isNew) {
        fallDistances[index] = spawnCount - row
      } else {
        fallDistances[index] = Math.max(0, row - cell.row)
      }
    }
  }

  return { board: next, fallDistances }
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
    const matches = findMatches(current)
    if (matches.length === 0) break

    const gained = matches.length * matches.length * 10 * nextCombo
    totalGained += gained
    totalMatched += matches.length
    cascadeCount += 1
    lastMatches = matches

    const refill = applyGravityRefill(current, matches)
    current = refill.board
    lastFallDistances = refill.fallDistances
    nextCombo = Math.min(nextCombo + 1, 9)
  }

  return {
    board: current,
    gained: totalGained,
    matched: totalMatched,
    cascades: cascadeCount,
    combo: nextCombo,
    lastMatches,
    fallDistances: lastFallDistances,
  }
}

export function makeBoard(): Board {
  return resolveBoard(Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => makeTile())).board
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
