import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = new URL('..', import.meta.url).pathname
const OUT_DIR = path.join(ROOT, 'pi-store-assets')
const PUBLIC_OUT_DIR = path.join(ROOT, 'public', 'pi-store-assets')
const WIDTH = 750
const HEIGHT = 1500

const tiles = [
  ['pi', 'violet', 'green', 'pink', 'cyan'],
  ['cyan', 'green', 'pi', 'violet', 'pink'],
  ['green', 'pink', 'pink', 'pi', 'violet'],
  ['violet', 'pi', 'cyan', 'cyan', 'green'],
  ['pink', 'cyan', 'violet', 'green', 'pi'],
]

const leaderRows = [
  ['#1', 'XChrisylX', '16,340', 'VIP'],
  ['#2', 'Sil29', '15,129', 'VIP'],
  ['#3', 'corsinux', '11,000', 'VIP'],
  ['#4', 'Kether33', '6,080', 'Pioneer'],
  ['#5', 'zakarisaeed602', '5,550', 'Pioneer'],
]

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tileFill(kind) {
  const fills = {
    pi: ['#45205f', '#f6c96a', '#ff49f8'],
    pink: ['#ff43d7', '#f7b7ff', '#8b1cff'],
    cyan: ['#14d7ff', '#c4ffff', '#126ef2'],
    green: ['#1df1b0', '#c0ffe4', '#077a5d'],
    violet: ['#a86cff', '#ffffff', '#3f10c9'],
  }

  return fills[kind] || fills.violet
}

function defs() {
  const gradients = ['pi', 'pink', 'cyan', 'green', 'violet']
    .map((kind) => {
      const [a, b, c] = tileFill(kind)
      return `
        <linearGradient id="tile-${kind}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${a}"/>
          <stop offset="38%" stop-color="${b}"/>
          <stop offset="100%" stop-color="${c}"/>
        </linearGradient>
      `
    })
    .join('')

  return `
    <defs>
      <radialGradient id="bg" cx="50%" cy="32%" r="78%">
        <stop offset="0%" stop-color="#34315c"/>
        <stop offset="42%" stop-color="#1a1b3f"/>
        <stop offset="100%" stop-color="#060713"/>
      </radialGradient>
      <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#777987"/>
        <stop offset="42%" stop-color="#3c404e"/>
        <stop offset="100%" stop-color="#171c29"/>
      </linearGradient>
      <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#ff46f6"/>
        <stop offset="50%" stop-color="#9c5dff"/>
        <stop offset="100%" stop-color="#22e8ff"/>
      </linearGradient>
      <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="12" result="blur"/>
        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.95 0 1 0 0 0.18 0 0 1 0 1 0 0 0 0.9 0"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="cyanGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="10" result="blur"/>
        <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.1 0 1 0 0 0.85 0 0 1 0 1 0 0 0 0.9 0"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
      ${gradients}
    </defs>
  `
}

function background(title, subtitle) {
  return `
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <circle cx="108" cy="270" r="138" fill="#34e7ff" opacity="0.13" filter="url(#cyanGlow)"/>
    <circle cx="636" cy="190" r="184" fill="#ff3be6" opacity="0.13" filter="url(#softGlow)"/>
    <circle cx="548" cy="1190" r="210" fill="#4f75ff" opacity="0.12" filter="url(#cyanGlow)"/>
    <g opacity="0.72">
      <circle cx="96" cy="138" r="3" fill="#ffd969"/>
      <circle cx="612" cy="332" r="3" fill="#43e8ff"/>
      <circle cx="204" cy="1258" r="3" fill="#ff5cf3"/>
      <circle cx="655" cy="1196" r="3" fill="#ffd969"/>
      <circle cx="76" cy="1032" r="2" fill="#ffffff"/>
    </g>
    <text x="70" y="116" font-family="Arial Black, Arial, sans-serif" font-size="26" letter-spacing="8" fill="#fff0b1" opacity="0.92">PI NETWORK ARCADE</text>
    <text x="70" y="194" font-family="Arial Black, Arial, sans-serif" font-size="76" fill="#f4ecff">${esc(title)}</text>
    <text x="73" y="244" font-family="Arial, sans-serif" font-size="31" fill="#d9faff">${esc(subtitle)}</text>
  `
}

function statBox(x, y, label, value, color = '#76f2ff') {
  return `
    <g filter="url(#shadow)">
      <rect x="${x}" y="${y}" width="176" height="104" rx="28" fill="#ffffff" opacity="0.12" stroke="${color}" stroke-opacity="0.44"/>
      <text x="${x + 88}" y="${y + 55}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="34" fill="#ffffff">${esc(value)}</text>
      <text x="${x + 88}" y="${y + 82}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="5" fill="#ffffff" opacity="0.62">${esc(label)}</text>
    </g>
  `
}

function tile(x, y, kind, extra = '') {
  const symbol =
    kind === 'pi'
      ? '<text x="36" y="48" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="38" fill="#ffd66e">π</text>'
      : kind === 'green'
        ? '<rect x="25" y="25" width="22" height="22" transform="rotate(45 36 36)" fill="none" stroke="#06101a" stroke-width="5"/>'
        : kind === 'cyan'
          ? '<path d="M36 12 L44 30 L62 36 L44 43 L36 62 L28 43 L10 36 L28 30 Z" fill="#ffffff" opacity="0.96"/>'
          : kind === 'pink'
            ? '<path d="M36 18 L52 27 L52 45 L36 54 L20 45 L20 27 Z" fill="#ffffff" opacity="0.9"/>'
            : '<path d="M36 19 L49 27 L49 45 L36 53 L23 45 L23 27 Z" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.92"/>'

  return `
    <g transform="translate(${x} ${y})" ${extra}>
      <rect width="72" height="72" rx="18" fill="url(#tile-${kind})" stroke="#ffffff" stroke-opacity="0.24" stroke-width="2"/>
      <path d="M9 8 C20 2 51 2 64 14" fill="none" stroke="#ffffff" stroke-width="10" opacity="0.28"/>
      <path d="M13 58 L60 13" stroke="#ffffff" stroke-width="7" opacity="0.11"/>
      ${symbol}
    </g>
  `
}

function board(x, y, scale = 1, variant = 0) {
  const cells = []
  const tileGap = 14
  const tileSize = 72
  const shifted = tiles.map((row, rowIndex) => row.map((cell, colIndex) => tiles[(rowIndex + variant) % 5][(colIndex + variant) % 5] || cell))

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      cells.push(tile(col * (tileSize + tileGap), row * (tileSize + tileGap), shifted[row][col]))
    }
  }

  return `
    <g transform="translate(${x} ${y}) scale(${scale})" filter="url(#shadow)">
      <rect x="-24" y="-24" width="476" height="476" rx="42" fill="#111923" stroke="#58ebff" stroke-opacity="0.28" stroke-width="2"/>
      ${cells.join('')}
    </g>
  `
}

function phoneFrame(content) {
  return `
    <g transform="translate(76 278)" filter="url(#shadow)">
      <rect width="598" height="1048" rx="54" fill="url(#card)" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>
      <rect x="0" y="0" width="598" height="7" rx="4" fill="url(#neon)" filter="url(#softGlow)"/>
      ${content}
    </g>
  `
}

function actionBurst() {
  return `
    <g transform="translate(374 744)" filter="url(#softGlow)">
      <path d="M0 -168 L35 -70 L124 -122 L72 -32 L170 0 L72 33 L124 122 L35 70 L0 168 L-35 70 L-124 122 L-72 33 L-170 0 L-72 -32 L-124 -122 L-35 -70 Z" fill="#ffdd33" stroke="#ff43e9" stroke-width="8"/>
      <circle r="84" fill="#160b28" opacity="0.84"/>
      <text y="-10" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="58" fill="#ffefff">+500</text>
      <text y="47" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="44" fill="#36ecff">!!!</text>
    </g>
  `
}

function previewOne() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${defs()}
    ${background('Pi Tiles', 'Swipe. Match. Climb the board.')}
    ${phoneFrame(`
      <text x="42" y="76" font-family="Arial Black, Arial, sans-serif" font-size="27" letter-spacing="7" fill="#fff0b1">PI NETWORK ARCADE</text>
      <text x="42" y="150" font-family="Arial Black, Arial, sans-serif" font-size="66" fill="#f3e8ff">Pi Tiles</text>
      <text x="45" y="190" font-family="Arial, sans-serif" font-size="28" fill="#ffffff">Hey ! Pioneer</text>
      <rect x="436" y="70" width="112" height="112" rx="30" fill="#22344b" stroke="#6ef1ff" stroke-opacity="0.55"/>
      <text x="492" y="126" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="42" fill="#7bf4ff">60</text>
      <text x="492" y="156" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" letter-spacing="4" fill="#ffffff" opacity="0.72">SECONDS</text>
      ${statBox(42, 240, 'SCORE', '0', '#ff42ea')}
      ${statBox(212, 240, 'COMBO', 'x0', '#b35cff')}
      ${statBox(382, 240, 'BEST', '9,730', '#38e8ff')}
      <rect x="42" y="380" width="514" height="76" rx="31" fill="#0d111a" opacity="0.62" stroke="#ffffff" stroke-opacity="0.16"/>
      <text x="299" y="428" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#ffffff">Pick a tile, then swap with a neighbor.</text>
      ${board(84, 520, 1, 0)}
      ${statBox(42, 930, 'SELECTED', '-', '#ffffff')}
      ${statBox(212, 930, 'VALID SWAPS', '22', '#79ffd8')}
      ${statBox(382, 930, 'NEXT GAIN', '90+', '#ffda4b')}
      <rect x="42" y="1080" width="240" height="82" rx="36" fill="url(#neon)" filter="url(#softGlow)"/>
      <text x="162" y="1132" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffffff">Start Game</text>
      <rect x="316" y="1080" width="240" height="82" rx="36" fill="#ffffff" opacity="0.13" stroke="#ffffff" stroke-opacity="0.25"/>
      <text x="436" y="1132" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffffff">VIP Active</text>
    `)}
  </svg>`
}

function previewTwo() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${defs()}
    ${background('Pi Bomb', 'Explosive combos and flashy bonuses.')}
    ${phoneFrame(`
      <text x="42" y="76" font-family="Arial Black, Arial, sans-serif" font-size="27" letter-spacing="7" fill="#fff0b1">PI NETWORK ARCADE</text>
      <text x="42" y="150" font-family="Arial Black, Arial, sans-serif" font-size="66" fill="#f3e8ff">Pi Tiles</text>
      <text x="45" y="190" font-family="Arial, sans-serif" font-size="28" fill="#ffffff">Combo chain active</text>
      <rect x="436" y="70" width="112" height="112" rx="30" fill="#22344b" stroke="#6ef1ff" stroke-opacity="0.55"/>
      <text x="492" y="126" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="42" fill="#7bf4ff">28</text>
      <text x="492" y="156" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" letter-spacing="4" fill="#ffffff" opacity="0.72">SECONDS</text>
      ${statBox(42, 240, 'SCORE', '5,420', '#ff42ea')}
      ${statBox(212, 240, 'COMBO', 'x5', '#c55cff')}
      ${statBox(382, 240, 'BEST', '16,340', '#38e8ff')}
      <rect x="42" y="380" width="514" height="76" rx="31" fill="#0d111a" opacity="0.62" stroke="#ffffff" stroke-opacity="0.16"/>
      <text x="299" y="428" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#ffffff">Pi Bomb triggered · board shake!</text>
      ${board(84, 520, 1, 2)}
      <g transform="translate(242 664)">${tile(0, 0, 'pi', 'filter="url(#softGlow)"')}</g>
      <g opacity="0.85" stroke="#ffdf5e" stroke-width="8" stroke-linecap="round">
        <line x1="376" y1="670" x2="470" y2="604"/>
        <line x1="376" y1="670" x2="512" y2="708"/>
        <line x1="376" y1="670" x2="326" y2="570"/>
        <line x1="376" y1="670" x2="279" y2="765"/>
      </g>
      ${actionBurst()}
      ${statBox(42, 930, 'SELECTED', 'π', '#ffffff')}
      ${statBox(212, 930, 'VALID SWAPS', '19', '#79ffd8')}
      ${statBox(382, 930, 'NEXT GAIN', '500+', '#ffda4b')}
      <rect x="42" y="1080" width="514" height="104" rx="34" fill="#2c1838" stroke="#ffdd46" stroke-opacity="0.55"/>
      <text x="299" y="1122" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffd94b">PI BONUS</text>
      <text x="299" y="1160" text-anchor="middle" font-family="Arial, sans-serif" font-size="23" fill="#ffffff">Match Pi tiles to unlock bigger bursts.</text>
    `)}
  </svg>`
}

function previewThree() {
  const rows = leaderRows
    .map(
      ([rank, name, score, status], index) => `
        <g transform="translate(42 ${476 + index * 92})">
          <rect width="514" height="74" rx="26" fill="${index < 3 ? '#ffd427' : '#ffffff'}" opacity="${index < 3 ? '0.98' : '0.12'}"/>
          <text x="28" y="47" font-family="Arial Black, Arial, sans-serif" font-size="24" fill="${index < 3 ? '#151720' : '#ffffff'}">${rank}</text>
          <text x="104" y="34" font-family="Arial Black, Arial, sans-serif" font-size="22" fill="${index < 3 ? '#151720' : '#ffffff'}">${esc(name)}</text>
          <text x="104" y="58" font-family="Arial, sans-serif" font-size="14" fill="${index < 3 ? '#3b3310' : '#d9faff'}">${esc(status)}</text>
          <text x="476" y="47" text-anchor="end" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="${index < 3 ? '#111827' : '#ffffff'}">${esc(score)}</text>
        </g>
      `,
    )
    .join('')

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${defs()}
    ${background('VIP Circuit', 'Compete weekly with Pioneers.')}
    ${phoneFrame(`
      <text x="42" y="76" font-family="Arial Black, Arial, sans-serif" font-size="27" letter-spacing="7" fill="#fff0b1">PI NETWORK ARCADE</text>
      <text x="42" y="150" font-family="Arial Black, Arial, sans-serif" font-size="66" fill="#f3e8ff">Pi Tiles</text>
      <text x="45" y="190" font-family="Arial, sans-serif" font-size="28" fill="#ffffff">Leaderboard ready</text>
      ${statBox(42, 240, 'ACTIVE VIPS', '3', '#ffd94b')}
      ${statBox(212, 240, 'WEEKLY POOL', '0.20 Pi', '#79ffd8')}
      ${statBox(382, 240, 'BEST', '16,340', '#38e8ff')}
      <rect x="42" y="382" width="514" height="72" rx="28" fill="#111923" stroke="#6ef1ff" stroke-opacity="0.34"/>
      <text x="70" y="428" font-family="Arial, sans-serif" font-size="23" fill="#d9faff">Search player or climb the ranking</text>
      ${rows}
      <rect x="42" y="975" width="240" height="82" rx="36" fill="url(#neon)" filter="url(#softGlow)"/>
      <text x="162" y="1027" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffffff">Play</text>
      <rect x="316" y="975" width="240" height="82" rx="36" fill="#ffffff" opacity="0.13" stroke="#ffffff" stroke-opacity="0.25"/>
      <text x="436" y="1027" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffffff">VIP Active</text>
      <rect x="42" y="1100" width="514" height="116" rx="36" fill="#4b3913" opacity="0.82" stroke="#ffdf5e" stroke-opacity="0.5"/>
      <text x="74" y="1146" font-family="Arial Black, Arial, sans-serif" font-size="25" fill="#ffffff">VIP Pass</text>
      <text x="74" y="1186" font-family="Arial, sans-serif" font-size="21" fill="#fff3b7">Weekly leaderboard rewards for top players.</text>
    `)}
  </svg>`
}

async function writePreview(filename, svg) {
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer()

  await fs.writeFile(path.join(OUT_DIR, filename), buffer)
  await fs.writeFile(path.join(PUBLIC_OUT_DIR, filename), buffer)
  console.log(`${filename}: ${(buffer.length / 1024).toFixed(1)} KB`)
}

await fs.mkdir(OUT_DIR, { recursive: true })
await fs.mkdir(PUBLIC_OUT_DIR, { recursive: true })

await writePreview('pitiles-preview-1.jpg', previewOne())
await writePreview('pitiles-preview-2.jpg', previewTwo())
await writePreview('pitiles-preview-3.jpg', previewThree())
