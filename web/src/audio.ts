export type GameSound = 'join' | 'start' | 'turn' | 'play' | 'draw' | 'win' | 'lose' | 'preview'

const SOUND_KEY = 'whot.sound'
let context: AudioContext | null = null

export function gameSoundsEnabled() {
  return localStorage.getItem(SOUND_KEY) !== 'off'
}

export function setGameSoundsEnabled(enabled: boolean) {
  localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off')
}

function getContext() {
  if (typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return null
  context ??= new AudioContextClass()
  return context
}

type Note = { frequency: number; offset: number; duration: number; volume?: number; wave?: OscillatorType }

const cues: Record<GameSound, Note[]> = {
  join: [
    { frequency: 440, offset: 0, duration: .07, volume: .035 },
    { frequency: 660, offset: .08, duration: .1, volume: .04 },
  ],
  start: [
    { frequency: 330, offset: 0, duration: .09, volume: .04 },
    { frequency: 440, offset: .1, duration: .09, volume: .04 },
    { frequency: 660, offset: .2, duration: .14, volume: .045 },
  ],
  turn: [
    { frequency: 587, offset: 0, duration: .1, volume: .045 },
    { frequency: 784, offset: .12, duration: .16, volume: .05 },
  ],
  play: [
    { frequency: 210, offset: 0, duration: .045, volume: .035, wave: 'triangle' },
    { frequency: 145, offset: .045, duration: .055, volume: .03, wave: 'triangle' },
  ],
  draw: [
    { frequency: 180, offset: 0, duration: .07, volume: .035, wave: 'sawtooth' },
    { frequency: 150, offset: .075, duration: .1, volume: .03, wave: 'sawtooth' },
  ],
  win: [
    { frequency: 523, offset: 0, duration: .12, volume: .045 },
    { frequency: 659, offset: .13, duration: .12, volume: .045 },
    { frequency: 784, offset: .26, duration: .12, volume: .045 },
    { frequency: 1047, offset: .39, duration: .24, volume: .055 },
  ],
  lose: [
    { frequency: 392, offset: 0, duration: .14, volume: .04 },
    { frequency: 330, offset: .15, duration: .14, volume: .04 },
    { frequency: 262, offset: .3, duration: .25, volume: .045 },
  ],
  preview: [
    { frequency: 523, offset: 0, duration: .08, volume: .04 },
    { frequency: 784, offset: .09, duration: .13, volume: .045 },
  ],
}

export function playGameSound(sound: GameSound) {
  if (!gameSoundsEnabled()) return
  const audio = getContext()
  if (!audio) return
  if (audio.state === 'suspended') void audio.resume()
  const start = audio.currentTime + .01
  for (const note of cues[sound]) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    const noteStart = start + note.offset
    const noteEnd = noteStart + note.duration
    oscillator.type = note.wave || 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, noteStart)
    gain.gain.setValueAtTime(.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(note.volume || .04, noteStart + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, noteEnd)
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteEnd + .02)
  }
}

export function primeGameAudio() {
  if (!gameSoundsEnabled()) return
  const audio = getContext()
  if (audio?.state === 'suspended') void audio.resume()
}
