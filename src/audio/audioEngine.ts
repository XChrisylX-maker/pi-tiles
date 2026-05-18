let audioContext: AudioContext | null = null

type WebkitAudioWindow = Window & typeof globalThis & {
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
) {
  const ctx = getAudioContext()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

  gain.gain.setValueAtTime(volume, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.start()
  oscillator.stop(ctx.currentTime + duration)
}

function chord(
  frequencies: number[],
  duration = 0.12,
  type: OscillatorType = 'triangle',
  volume = 0.025,
) {
  frequencies.forEach((frequency, index) => {
    window.setTimeout(() => {
      tone(frequency, duration, type, volume)
    }, index * 35)
  })
}

export function playTapSound() {
  tone(520, 0.035, 'square', 0.018)
}

export function playSwapSound() {
  chord([560, 720], 0.055, 'triangle', 0.026)
}

export function playMatchSound() {
  chord([760, 940, 1160], 0.075, 'sawtooth', 0.032)
}

export function playComboSound() {
  chord([980, 1240, 1480], 0.1, 'square', 0.035)
}

export function playDangerSound() {
  tone(220, 0.045, 'sine', 0.018)
}

export function playStartSound() {
  chord([480, 680, 920], 0.075, 'triangle', 0.03)
}

export function playSuccessSound() {
  chord([880, 1180, 1560], 0.11, 'triangle', 0.035)
}
