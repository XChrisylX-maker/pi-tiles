let audioContext: AudioContext | null = null

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

function getAudioContext() {
  if (typeof window === 'undefined') return null

  const AudioContextClass = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext
  if (!AudioContextClass) return null

  if (!audioContext) {
    audioContext = new AudioContextClass()
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }

  return audioContext
}

function tone(
  frequency: number,
  duration = 0.08,
  type: OscillatorType = 'sine',
  volume = 0.03,
  delay = 0,
) {
  const ctx = getAudioContext()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const startAt = ctx.currentTime + delay

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startAt)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.start(startAt)
  oscillator.stop(startAt + duration)
}

function sweep(
  from: number,
  to: number,
  duration = 0.16,
  type: OscillatorType = 'sine',
  volume = 0.025,
  delay = 0,
) {
  const ctx = getAudioContext()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const startAt = ctx.currentTime + delay

  oscillator.type = type
  oscillator.frequency.setValueAtTime(from, startAt)
  oscillator.frequency.exponentialRampToValueAtTime(to, startAt + duration)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.014)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.start(startAt)
  oscillator.stop(startAt + duration)
}

function chord(
  frequencies: number[],
  duration = 0.12,
  type: OscillatorType = 'triangle',
  volume = 0.025,
  stagger = 0.035,
) {
  frequencies.forEach((frequency, index) => {
    tone(frequency, duration, type, volume, index * stagger)
  })
}

function sparkle(base: number, count = 4) {
  Array.from({ length: count }).forEach((_, index) => {
    tone(base + index * 170, 0.045, 'triangle', 0.014, index * 0.022)
  })
}

export function playTapSound() {
  tone(620, 0.035, 'triangle', 0.014)
}

export function playSwapSound() {
  chord([560, 720, 920], 0.058, 'triangle', 0.022, 0.028)
}

export function playMatchSound() {
  chord([760, 980, 1240], 0.07, 'triangle', 0.026, 0.026)
  sparkle(1120, 3)
}

export function playComboSound() {
  sweep(520, 1320, 0.18, 'triangle', 0.026)
  chord([980, 1240, 1560, 1860], 0.095, 'square', 0.026, 0.024)
  tone(92, 0.12, 'sine', 0.018, 0.018)
}

export function playDangerSound() {
  tone(220, 0.055, 'sine', 0.016)
  tone(165, 0.045, 'sine', 0.01, 0.045)
}

export function playStartSound() {
  chord([480, 680, 920, 1220], 0.075, 'triangle', 0.026, 0.03)
  sparkle(1320, 3)
}

export function playSuccessSound() {
  chord([880, 1180, 1560, 1960], 0.11, 'triangle', 0.03, 0.035)
  sweep(720, 1760, 0.22, 'sine', 0.02, 0.02)
}
