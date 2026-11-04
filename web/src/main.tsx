import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BatteryFull, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Crown, DoorOpen, Gamepad2, History, Home, LogIn, LogOut, Menu, MessageCircle, Mic, MicOff, MoreHorizontal, Moon, Pause, Play, Plus, Radio, Settings, Share2, Shield, Signal, Smartphone, Sparkles, Sun, Table2, Trophy, UserRound, Users, Volume2, Wallet, Wifi, X } from 'lucide-react'
import './styles.css'
import './live-voice-control.css'
import './table-layout.css'
import './premium-table.css'
import { gameSoundsEnabled, playGameSound, primeGameAudio, setGameSoundsEnabled } from './audio'
import lagosPhoneWallpaper from './assets/lagos-phone-wallpaper.png'
import { SnookerGame } from './SnookerGame'

type Card = { id: string; shape: string; number: number }
type Player = { id: string; name: string; count: number; connected: boolean; team?: number | null; voice_ready?: boolean; voice_speaking?: boolean; reaction?: string | null; reaction_at?: number | null; coin_balance?: number; is_bot?: boolean; last_card_required?: boolean; table_theme?: string; card_back?: string; avatar?: string }
type GameRules = { cards_per_player: number; pick_two: number; pick_three: number; pick_three_enabled: boolean; general_market: number; penalty_stacking: boolean }
type VoiceMessage = { id: string; player_id: string; name: string; content_type: string; size: number; sent_at: number }
type ChatMessage = { id: string; player_id: string; name: string; text: string; sent_at: number }
type DirectMessage = { id: number; sender_username: string; recipient_username: string; text: string; sent_at: string; delivered_at?: string | null; read_at?: string | null }
type PlayerCard = { username: string; wins: number; matches_played: number; level: number; achievements: string[]; friend_status: string | null; friend_requested_by_you: boolean; blocked: boolean }
type MatchInvitation = { id: number; sender_username: string; recipient_username: string; room_code: string; status: string; created_at: string; incoming: boolean }
type PlayerSearchResult = { id: number; username: string; wins: number; matches_played: number }
type RtcSignal = { id: string; from: string; signal: { type: 'offer' | 'answer' | 'ice'; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }
type LiveAudioPacket = { id: string; from: string; audio: string }
type RoomView = {
  code: string; status: 'lobby' | 'playing' | 'finished'; host: string; you: string
  turn: string | null; players: Player[]; hand: Card[]; top: Card | null
  requested_shape: string | null; winner: string | null; last_action: string
  match_winner: string | null; round_number: number
  round_wins: Record<string, number>; match_points: Record<string, number>
  pending_draw: number
  pending_penalty: number | null
  final_scores: Record<string, number>
  market_count: number
  state_version: number
  turn_started_at: number
  turn_seconds_remaining: number
  is_paused: boolean
  pause_reason: 'disconnect' | 'manual' | null
  paused_by: string | null
  pause_seconds_remaining: number
  voice_messages: VoiceMessage[]
  chat_messages: ChatMessage[]
  wager: number; wager_locked: boolean; wager_pot: number; wager_admin_fee: number; wager_winner_payout: number
  is_public: boolean; team_mode: boolean; team_scores: Record<string, { round_wins: number; match_points: number }>; rules: GameRules
}
type Session = { player_id: string; code: string; reconnect_token: string }
type User = { id: number; username: string; email: string; wins: number; arena_coins: number; matches_played: number; xp: number; level: number; win_streak: number; best_win_streak: number; achievements: string[]; unlocked_themes: string[]; unlocked_card_backs: string[]; unlocked_avatars: string[]; selected_theme: string; selected_card_back: string; selected_avatar: string; is_admin?: boolean }
type MatchHistory = { room_code: string; result: 'win' | 'loss'; player_count: number; completed_at: string }
type SavedTable = {
  code: string
  status: 'lobby' | 'playing' | 'finished' | 'reconnecting'
  player_count: number
  total_seats: number
  wager: number
  wager_pot: number
  current_turn_name: string | null
  is_your_turn: boolean
  your_connected: boolean
  participation_status: 'active' | 'away' | 'left'
  players: Array<{ id: string; name: string; count: number; connected: boolean; is_bot: boolean; is_you: boolean }>
}
type TurnNotification = { room_code: string; status: string; id: number }
type GoogleCredentialResponse = { credential: string }
type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (response: GoogleCredentialResponse) => void
      }) => void
      renderButton: (element: HTMLElement, options: {
        theme: 'outline'
        size: 'large'
        text: 'signin_with' | 'signup_with'
        shape: 'rectangular'
        width: number
      }) => void
    }

  }
}
export function isCardPlayable(
  card: Card,
  pendingDraw: number,
  pendingPenalty: number | null,
  top: Card | null,
  requestedShape: string | null,
  penaltyStacking = true,
) {
  if (card.number === 20) return true
  if (pendingDraw > 0) return penaltyStacking && card.number === pendingPenalty
  return card.number === top?.number || card.shape === (requestedShape || top?.shape)
}

export function opponentSeatClass(index: number, opponentCount: number) {
  const seats = opponentCount === 1
    ? ['seat-top']
    : opponentCount === 2
      ? ['seat-left', 'seat-right']
      : ['seat-top', 'seat-left', 'seat-right']
  return seats[index] || 'seat-top'
}

function updateGameSoundsEnabled(enabled: boolean) {
  setGameSoundsEnabled(enabled)
  window.dispatchEvent(new CustomEvent('whot-sounds-change', { detail: enabled }))
}

declare global {
  interface Window {
    google?: GoogleIdentityServices
  }
}
type ArenaContextValue = {
  view: RoomView | null; session: Session | null; savedSession: Session | null; user: User | null; error: string
  connected: boolean; busy: boolean; clearError: () => void; updateUser: (user: User) => void
  voiceUrls: Record<string, string>; requestVoice: (messageId: string) => void
  rtcSignals: RtcSignal[]; sendRtcSignal: (target: string, signal: RtcSignal['signal']) => void
  subscribeLiveAudio: (listener: (packet: LiveAudioPacket) => void) => () => void
  connectRoom: (action: string, values?: Record<string, unknown>) => Promise<Session>
  send: (action: string, values?: Record<string, unknown>) => void
  leaveRoom: () => void
  switchAway: () => Promise<void>
  resumeSavedRoom: () => Promise<Session | null>
  switchActiveTable: (code: string) => Promise<Session | null>
  tables: SavedTable[]
  tablesError: string
  activeTableCount: number
  turnNotifications: TurnNotification[]
  dismissTurnNotification: (id: number) => void
  refreshTables: () => Promise<void>
  leaveTable: (code: string) => Promise<void>
  authenticate: (registering: boolean, values: Record<string, string>) => Promise<void>
  authenticateGoogle: (credential: string, username?: string) => Promise<boolean>
  signOut: () => void
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const WS_URL = import.meta.env.VITE_WS_URL || `${API_URL.replace(/^http/, 'ws')}/ws`
const NOTIFICATION_WS_URL = `${WS_URL.replace(/\/$/, '')}/notifications`
export function normalizeTurnUrl(value: string) {
  return value.trim().replace(/^(stuns?|turns?):\/\//i, '$1:')
}
const TURN_URLS = (import.meta.env.VITE_TURN_URL || '').split(',').map(normalizeTurnUrl).filter((value: string) => /^(stuns?|turns?):[^/]/i.test(value))
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME || ''
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL || ''
const CONFIGURED_TURN_URLS = TURN_USERNAME && TURN_CREDENTIAL ? TURN_URLS : []
const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(CONFIGURED_TURN_URLS.length ? [{
    urls: CONFIGURED_TURN_URLS,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  }] : []),
]
export function shouldUseRelayFallback(connectionState?: RTCPeerConnectionState) {
  return connectionState !== 'connected' && connectionState !== 'closed'
}
type TurnSnapshot = Pick<RoomView, 'code' | 'status' | 'turn' | 'is_paused'>
export function turnAnnouncement(previous: TurnSnapshot | null, current: TurnSnapshot, playerName?: string, viewerPlayerId?: string) {
  if (!previous || previous.code !== current.code || current.status !== 'playing'
      || current.is_paused || !current.turn) return null
  const started = previous.status !== 'playing' && current.status === 'playing'
  const changed = previous.status === 'playing' && previous.turn !== current.turn
  if (!started && !changed) return null
  if (current.turn === viewerPlayerId) return 'Your turn'
  return `${playerName || 'A player'}'s turn`
}
export function reconnectPauseGuidance(
  pauseReason: RoomView['pause_reason'],
  pausedBy: string | null,
  disconnectedPlayers: Pick<Player, 'name'>[],
  secondsRemaining: number,
) {
  if (pauseReason === 'disconnect') {
    const disconnectedNames = disconnectedPlayers.map(player => player.name)
    const waitingFor = disconnectedNames.length > 2
      ? `${disconnectedNames.slice(0, -1).join(', ')}, and ${disconnectedNames.at(-1)}`
      : disconnectedNames.join(' and ') || pausedBy || 'a player'
    const secondsLabel = `${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'} remaining`
    return {
      title: `Waiting for ${waitingFor} to reconnect`,
      detail: `Reconnect window · ${secondsLabel}`,
      instruction: 'Keep this table open. Cards and the turn timer are preserved. Play resumes when everyone reconnects; if time runs out, play continues automatically and an expired turn may be skipped.',
    }
  }
  return {
    title: `${pausedBy || 'The host'} paused the game`,
    detail: 'Turn timer frozen',
    instruction: 'No one needs to reconnect. Stay at the table; the host can resume the game when ready.',
  }
}
export function relayPlaybackStartAt(previousTime: number | undefined, now: number) {
  if (previousTime === undefined || previousTime > now + 0.75) return now + 0.18
  return Math.max(previousTime, now + 0.025)
}
export function microphoneFailureMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error
    && typeof error.name === 'string' ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone access was denied. Allow microphone access for this site in your browser settings, then tap the mic to retry.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect or enable a microphone, then tap the mic to retry.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is busy or unavailable. Close other apps using it, then tap the mic to retry.'
  }
  return 'Could not start the microphone. Check browser permissions and microphone settings, then tap the mic to retry.'
}
const Context = createContext<ArenaContextValue | null>(null)
const readStored = <T,>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null } catch { return null }
}
const accessToken = () => localStorage.getItem('whot.token') || sessionStorage.getItem('whot.token')
const legacySessionToken = sessionStorage.getItem('whot.token')
if (legacySessionToken && !localStorage.getItem('whot.token')) localStorage.setItem('whot.token', legacySessionToken)
type ColorTheme = 'light' | 'dark'
const preferredTheme = (): ColorTheme => {
  const saved = localStorage.getItem('whot.theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  localStorage.setItem('whot.theme', theme)
  window.dispatchEvent(new CustomEvent('whot-theme', { detail: theme }))
}

function ArenaProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<RoomView | null>(null)
  const [session, setSession] = useState<Session | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('whot.session') || 'null') as Session | null }
    catch { return null }
  })
  const [savedSession, setSavedSession] = useState<Session | null>(() => readStored<Session>('whot.session'))
  const [tables, setTables] = useState<SavedTable[]>([])
  const [tablesError, setTablesError] = useState('')
  const [turnNotifications, setTurnNotifications] = useState<TurnNotification[]>([])
  const [user, setUser] = useState<User | null>(() => accessToken() ? readStored<User>('whot.user') : null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({})
  const [rtcSignals, setRtcSignals] = useState<RtcSignal[]>([])
  const [busy, setBusy] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const notificationSocketRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<Session | null>(session)
  const retryRef = useRef<number | null>(null)
  const pendingSwitchRef = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: number } | null>(null)
  const pendingLeaveRef = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: number } | null>(null)
  const activeRef = useRef(true)
  const voiceUrlsRef = useRef(new Set<string>())
  const liveAudioListenersRef = useRef(new Set<(packet: LiveAudioPacket) => void>())
  const previousViewRef = useRef<RoomView | null>(null)
  sessionRef.current = session

  function saveSession(next: Session) {
    sessionRef.current = next
    setSession(next)
    setSavedSession(next)
    localStorage.setItem('whot.session', JSON.stringify(next))
    sessionStorage.setItem('whot.session', JSON.stringify(next))
  }

  async function refreshTables() {
    const token = accessToken()
    if (!token) {
      setTables([])
      setTablesError('')
      return
    }
    try {
      const response = await fetch(`${API_URL}/api/tables`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const message = response.status === 404
          ? 'The configured API does not have GET /api/tables (HTTP 404). Deploy the latest backend and verify VITE_API_URL.'
          : `Could not load your tables (HTTP ${response.status})`
        throw new Error(message)
      }
      const body = await response.json() as { tables: SavedTable[] }
      setTables(body.tables)
      const tableCodes = new Set(body.tables.map(table => table.code))
      setTurnNotifications(previous => previous.filter(item => tableCodes.has(item.room_code)))
      setTablesError('')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not load your tables'
      setTablesError(message)
      setError(message)
    }
  }

  async function leaveTable(code: string) {
    const token = accessToken()
    if (!token) throw new Error('Sign in to leave a table')
    try {
      if (sessionRef.current?.code === code && socketRef.current?.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            pendingLeaveRef.current = null
            reject(new Error('The server did not confirm leaving the table'))
          }, 5000)
          pendingLeaveRef.current = {
            resolve: () => {
              window.clearTimeout(timer)
              pendingLeaveRef.current = null
              resolve()
            },
            reject: error => {
              window.clearTimeout(timer)
              pendingLeaveRef.current = null
              reject(error)
            },
            timer,
          }
          socketRef.current?.send(JSON.stringify({ action: 'leave' }))
        })
      } else {
        const response = await fetch(`${API_URL}/api/tables/${code}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) throw new Error('Could not leave this table')
      }
      await refreshTables()
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error('Could not leave this table')
      setError(error.message)
      throw error
    }
  }

  function receiveTurnNotification(message: { room_code?: string; status?: string }) {
    if (!message.room_code) return
    setTurnNotifications(previous => {
      const notification = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        room_code: message.room_code!,
        status: message.status || 'playing',
      }
      return [...previous.filter(item => item.room_code !== notification.room_code), notification].slice(-5)
    })
    if (!document.hasFocus()) playGameSound('turn')
  }

  function switchAway() {
    const activeSession = sessionRef.current
    const socket = socketRef.current
    if (!activeSession || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Reconnect to your current table before switching'))
    }
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingSwitchRef.current = null
        reject(new Error('The server did not confirm the table switch'))
      }, 5000)
      pendingSwitchRef.current = {
        resolve: () => {
          window.clearTimeout(timer)
          pendingSwitchRef.current = null
          resolve()
        },
        reject: error => {
          window.clearTimeout(timer)
          pendingSwitchRef.current = null
          reject(error)
        },
        timer,
      }
      try {
        socket.send(JSON.stringify({ action: 'switch', code: activeSession.code }))
      } catch {
        pendingSwitchRef.current.reject(new Error('Could not switch away from this table'))
      }
    })
  }

  function openSocket(payload: Record<string, unknown>): Promise<Session> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket
      let settled = false
      let nextSession: Session | null = null
      let receivedState = false
      const resolveWhenReady = () => {
        if (!settled && nextSession && receivedState) {
          settled = true
          resolve(nextSession)
        }
      }
      socket.onopen = () => {
        setConnected(true)
        const token = accessToken()
        socket.send(JSON.stringify({ ...payload, ...(token ? { access_token: token } : {}) }))
      }
      socket.onmessage = event => {
        let message: { type?: string; data?: RoomView; message?: string; player_id?: string; code?: string; reconnect_token?: string; id?: string; content_type?: string; audio?: string; from?: string; signal?: RtcSignal['signal']; room_code?: string; status?: string }
        try { message = JSON.parse(String(event.data)) } catch { setError('Received an unreadable server message.'); return }
        if (message.type === 'session' && message.player_id && message.code && message.reconnect_token) {
          const next = { player_id: message.player_id, code: message.code, reconnect_token: message.reconnect_token }
          saveSession(next)
          nextSession = next
          resolveWhenReady()
        } else if (message.type === 'state' && message.data) {
          setView(message.data)
          const currentPlayer = message.data.players.find(player => player.id === sessionRef.current?.player_id)
          if (typeof currentPlayer?.coin_balance === 'number') {
            setUser(previous => {
              if (!previous || previous.arena_coins === currentPlayer.coin_balance) return previous
              const updated = { ...previous, arena_coins: currentPlayer.coin_balance! }
              localStorage.setItem('whot.user', JSON.stringify(updated))
              return updated
            })
          }
          receivedState = true
          resolveWhenReady()
        } else if (message.type === 'voice_audio' && message.id && message.content_type && message.audio) {
          const bytes = Uint8Array.from(atob(message.audio), character => character.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: message.content_type }))
          voiceUrlsRef.current.add(url)
          setVoiceUrls(previous => {
            const oldUrl = previous[message.id!]
            if (oldUrl) { URL.revokeObjectURL(oldUrl); voiceUrlsRef.current.delete(oldUrl) }
            return { ...previous, [message.id!]: url }
          })
        } else if (message.type === 'rtc_relay' && message.id && message.from && message.signal) {
          setRtcSignals(previous => [...previous.slice(-99), { id: message.id!, from: message.from!, signal: message.signal! }])
        } else if (message.type === 'rtc_audio' && message.id && message.from && message.audio) {
          const packet = { id: message.id, from: message.from, audio: message.audio }
          liveAudioListenersRef.current.forEach(listener => listener(packet))
        } else if (message.type === 'left') {
          socket.onclose = null
          socket.close()
          if (socketRef.current === socket) socketRef.current = null
          localStorage.removeItem('whot.session')
          sessionStorage.removeItem('whot.session')
          sessionRef.current = null
          setSession(null)
          setSavedSession(null)
          setView(null)
          setConnected(false)
          pendingLeaveRef.current?.resolve()
          void refreshTables()
        } else if (message.type === 'switched') {
          socket.onclose = null
          socket.close()
          if (socketRef.current === socket) socketRef.current = null
          localStorage.removeItem('whot.session')
          sessionStorage.removeItem('whot.session')
          setView(null)
          setSession(null)
          setSavedSession(null)
          sessionRef.current = null
          setConnected(false)
          pendingSwitchRef.current?.resolve()
          void refreshTables()
        } else if (message.type === 'turn_notification' && message.room_code) {
          receiveTurnNotification(message)
        } else if (message.type === 'error') {
          setError(message.message || 'The server rejected that action.')
          pendingSwitchRef.current?.reject(new Error(message.message || 'Could not switch tables'))
          pendingLeaveRef.current?.reject(new Error(message.message || 'Could not leave the table'))
          if (payload.action === 'reconnect' && message.message === 'Session not found') {
            localStorage.removeItem('whot.session')
            sessionStorage.removeItem('whot.session')
            sessionRef.current = null
            setSession(null)
            setSavedSession(null)
            setView(null)
            socket.onclose = null
          }
          if (!settled) { settled = true; reject(new Error(message.message || 'Unable to join room')) }
        }
      }
      socket.onerror = () => {
        setConnected(false)
        pendingSwitchRef.current?.reject(new Error('The game connection was lost before switching'))
        pendingLeaveRef.current?.reject(new Error('The game connection was lost before leaving'))
        if (!settled) { settled = true; reject(new Error('Could not connect to the game server.')) }
      }
      socket.onclose = () => {
        setConnected(false)
        pendingSwitchRef.current?.reject(new Error('The game connection was lost before switching'))
        pendingLeaveRef.current?.reject(new Error('The game connection was lost before leaving'))
        if (activeRef.current && sessionRef.current) {
          if (retryRef.current) window.clearTimeout(retryRef.current)
          retryRef.current = window.setTimeout(() => {
            const previous = sessionRef.current
            if (previous && activeRef.current) {
              void openSocket({ action: 'reconnect', code: previous.code, player_id: previous.player_id, reconnect_token: previous.reconnect_token }).catch(() => undefined)
            }
          }, 1200)
        }
      }
    })
  }

  useEffect(() => {
    activeRef.current = true
    const stored = sessionRef.current
    if (stored) {
      void openSocket({ action: 'reconnect', code: stored.code, player_id: stored.player_id, reconnect_token: stored.reconnect_token }).catch(() => undefined)
    }
    return () => {
      activeRef.current = false
      if (retryRef.current) window.clearTimeout(retryRef.current)
      if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
    }
  }, [])

  useEffect(() => {
    const token = accessToken()
    if (!user || !token) return
    let active = true
    let retryTimer: number | null = null
    let heartbeatTimer: number | null = null
    let authenticationRejected = false
    let socket: WebSocket | null = null
    const connect = () => {
      socket = new WebSocket(NOTIFICATION_WS_URL)
      notificationSocketRef.current = socket
      socket.onopen = () => {
        socket?.send(JSON.stringify({ access_token: token }))
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'ping' }))
        }, 30000)
      }
      socket.onmessage = event => {
        let message: { type?: string; message?: string; room_code?: string; status?: string }
        try {
          message = JSON.parse(String(event.data))
        } catch {
          setError('Received an unreadable turn notification.')
          return
        }
        if (message.type === 'turn_notification') receiveTurnNotification(message)
        if (message.type === 'error') {
          authenticationRejected = true
          setError(message.message || 'Turn notifications are unavailable.')
          socket?.close()
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = event => {
        if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
        heartbeatTimer = null
        if (notificationSocketRef.current === socket) notificationSocketRef.current = null
        if (active && !authenticationRejected && event.code !== 1008) {
          retryTimer = window.setTimeout(connect, 2000)
        }
      }
    }
    connect()
    return () => {
      active = false
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
      if (notificationSocketRef.current === socket) notificationSocketRef.current = null
      if (socket) {
        socket.onclose = null
        socket.close()
      }
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    void refreshTables()
    const timer = window.setInterval(() => void refreshTables(), 15000)
    return () => window.clearInterval(timer)
  }, [user?.id])

  useEffect(() => () => {
    for (const url of voiceUrlsRef.current) URL.revokeObjectURL(url)
    voiceUrlsRef.current.clear()
  }, [])

  useEffect(() => {
    const unlock = () => primeGameAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const previous = previousViewRef.current
    previousViewRef.current = view
    if (!view || !previous || previous.code !== view.code) return
    if (previous.status !== 'finished' && view.status === 'finished') {
      const currentPlayer = view.players.find(player => player.id === sessionRef.current?.player_id)
      const roundWinner = view.players.find(player => player.id === view.winner)
      const didWin = view.team_mode
        ? currentPlayer?.team === roundWinner?.team
        : view.winner === sessionRef.current?.player_id
      playGameSound(didWin ? 'win' : 'lose')
    } else if (previous.status === 'lobby' && view.status === 'playing') {
      playGameSound('start')
    } else if (previous.players.length < view.players.length) {
      playGameSound('join')
    } else if (previous.hand.length < view.hand.length) {
      playGameSound('draw')
    } else if (previous.top?.id !== view.top?.id) {
      playGameSound('play')
    } else if (previous.turn !== view.turn && view.turn === sessionRef.current?.player_id) {
      playGameSound('turn')
    }
  }, [view])

  async function connectRoom(action: string, values: Record<string, unknown> = {}) {
    setBusy(true); setError('')
    if (retryRef.current) window.clearTimeout(retryRef.current)
    try {
      if (sessionRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
        await switchAway()
      } else if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.close()
      }
      sessionRef.current = null
      const savedToken = accessToken()
      const next = await openSocket({ action, ...values, ...(savedToken ? { access_token: savedToken } : {}) })
      return next
    } finally { setBusy(false) }
  }

  async function resumeSavedRoom() {
    if (!savedSession) return null
    if (sessionRef.current?.player_id === savedSession.player_id) return savedSession
    setBusy(true); setError('')
    if (retryRef.current) window.clearTimeout(retryRef.current)
    try {
      if (sessionRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
        await switchAway()
      } else if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.close()
      }
      sessionRef.current = savedSession
      setSession(savedSession)
      sessionStorage.setItem('whot.session', JSON.stringify(savedSession))
      return await openSocket({ action: 'reconnect', code: savedSession.code, player_id: savedSession.player_id, reconnect_token: savedSession.reconnect_token })
    } catch (reason) {
      sessionRef.current = null
      setSession(null)
      sessionStorage.removeItem('whot.session')
      throw reason
    } finally { setBusy(false) }
  }

  async function switchActiveTable(code: string) {
    const token = accessToken()
    if (!token) throw new Error('Sign in to switch tables')
    if (sessionRef.current?.code === code && socketRef.current?.readyState === WebSocket.OPEN) {
      return sessionRef.current
    }
    setBusy(true); setError('')
    if (retryRef.current) window.clearTimeout(retryRef.current)
    let switchedAway = false
    try {
      const response = await fetch(`${API_URL}/api/tables/${code}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'You cannot resume that table')
      const data = await response.json()
      const next: Session = {
        code: data.code,
        player_id: data.player_id,
        reconnect_token: data.reconnect_token,
      }
      if (sessionRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
        await switchAway()
        switchedAway = true
      } else if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.close()
      }
      saveSession(next)
      return await openSocket({ action: 'reconnect', code: next.code, player_id: next.player_id, reconnect_token: next.reconnect_token })
    } catch (reason) {
      if (switchedAway) {
        sessionRef.current = null
        setSession(null)
        setSavedSession(null)
        setView(null)
        localStorage.removeItem('whot.session')
        sessionStorage.removeItem('whot.session')
      }
      const error = reason instanceof Error ? reason : new Error('Could not resume this table')
      setError(error.message)
      throw error
    } finally { setBusy(false) }
  }

  function dismissTurnNotification(id: number) {
    setTurnNotifications(previous => previous.filter(item => item.id !== id))
  }

  function send(action: string, values: Record<string, unknown> = {}) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ action, ...values }))
    else setError('Reconnecting to the room. Try that action again in a moment.')
  }

  function leaveRoom() {
    if (retryRef.current) window.clearTimeout(retryRef.current)
    localStorage.removeItem('whot.session')
    sessionStorage.removeItem('whot.session')
    sessionRef.current = null
    setSession(null)
    setSavedSession(null)
    setView(null)
    setConnected(false)
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.onclose = null
      socket.send(JSON.stringify({ action: 'leave' }))
    } else if (socket) {
      socket.onclose = null
      socket.close()
    }
  }

  function requestVoice(messageId: string) {
    send('voice_get', { message_id: messageId })
  }

  function sendRtcSignal(target: string, signal: RtcSignal['signal']) {
    send('rtc_signal', { target, signal })
  }

  function subscribeLiveAudio(listener: (packet: LiveAudioPacket) => void) {
    liveAudioListenersRef.current.add(listener)
    return () => { liveAudioListenersRef.current.delete(listener) }
  }

  async function authenticate(registering: boolean, values: Record<string, string>) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_URL}/api/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Authentication failed')
      localStorage.setItem('whot.token', body.access_token)
      sessionStorage.removeItem('whot.token')
      localStorage.setItem('whot.user', JSON.stringify(body.user))
      setUser(body.user)
      void refreshTables()
    } catch (reason) { throw reason instanceof Error ? reason : new Error('Authentication failed') }
    finally { setBusy(false) }
  }

  async function authenticateGoogle(credential: string, username?: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential, ...(username ? { username } : {}) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Google sign-in failed')
      if (body.requires_username === true) return true
      localStorage.setItem('whot.token', body.access_token)
      sessionStorage.removeItem('whot.token')
      localStorage.setItem('whot.user', JSON.stringify(body.user))
      setUser(body.user)
      void refreshTables()
      return false
    } catch (reason) { throw reason instanceof Error ? reason : new Error('Google sign-in failed') }
    finally { setBusy(false) }
  }

  function signOut() {
    sessionStorage.removeItem('whot.token'); localStorage.removeItem('whot.token'); localStorage.removeItem('whot.user')
    localStorage.removeItem('whot.session'); sessionStorage.removeItem('whot.session'); sessionRef.current = null
    setUser(null); setSession(null); setSavedSession(null); setView(null)
    setTables([]); setTurnNotifications([])
    if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
    if (notificationSocketRef.current) {
      notificationSocketRef.current.onclose = null
      notificationSocketRef.current.close()
      notificationSocketRef.current = null
    }
  }

  const updateUser = useCallback((nextUser: User) => {
    setUser(nextUser)
    localStorage.setItem('whot.user', JSON.stringify(nextUser))
  }, [])

  return <Context.Provider value={{ view, session, savedSession, user, error, connected, busy, voiceUrls, requestVoice, rtcSignals, sendRtcSignal, subscribeLiveAudio, clearError: () => setError(''), updateUser, connectRoom, send, leaveRoom, switchAway, resumeSavedRoom, switchActiveTable, tables, tablesError, activeTableCount: tables.filter(table => table.status !== 'finished').length, turnNotifications, dismissTurnNotification, refreshTables, leaveTable, authenticate, authenticateGoogle, signOut }}>{children}</Context.Provider>
}

function useArena() {
  const value = useContext(Context)
  if (!value) throw new Error('Arena context is missing')
  return value
}

function RequireLogin({ children }: { children: React.ReactNode }) {
  const { user } = useArena()
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/tables', label: 'My Tables', icon: Table2, badge: true },
  { to: '/create', label: 'Play a game', icon: Gamepad2 },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/history', label: 'Game history', icon: History },
]

const MUSIC_KEY = 'whot.music'
const MUSIC_CHANGE_EVENT = 'whot-music-change'
const backgroundMusicEnabled = () => localStorage.getItem(MUSIC_KEY) !== 'off'
function setBackgroundMusicEnabled(enabled: boolean) {
  localStorage.setItem(MUSIC_KEY, enabled ? 'on' : 'off')
  window.dispatchEvent(new CustomEvent(MUSIC_CHANGE_EVENT, { detail: enabled }))
}

function ArenaBackgroundMusic() {
  const { view } = useArena()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackAllowedRef = useRef(true)
  const [musicEnabled, setMusicEnabled] = useState(backgroundMusicEnabled)
  const location = useLocation()
  const inGame = location.pathname.startsWith('/game/')
  const playerLeftGame = Boolean(inGame && view && (view.pause_reason === 'disconnect' || view.players.some(player => !player.is_bot && !player.connected)))
  const liveVoiceActive = Boolean(inGame && view?.players.some(player => !player.is_bot && player.voice_speaking))
  const musicPaused = playerLeftGame || liveVoiceActive
  playbackAllowedRef.current = musicEnabled && !musicPaused

  useEffect(() => {
    const update = (event: Event) => setMusicEnabled((event as CustomEvent<boolean>).detail)
    window.addEventListener(MUSIC_CHANGE_EVENT, update)
    return () => window.removeEventListener(MUSIC_CHANGE_EVENT, update)
  }, [])

  useEffect(() => {
    const audio = new Audio('/audio/whot-background.mp3')
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = 0.01
    audioRef.current = audio
    let active = true
    const tryPlay = () => {
      if (!active || !playbackAllowedRef.current || !audio.paused) return
      void Promise.resolve(audio.play()).catch(() => {
        // Browsers may require a user gesture before playing audio.
      })
    }
    // Attempt immediately, then retry automatically on the first interaction.
    tryPlay()
    document.addEventListener('pointerdown', tryPlay)
    document.addEventListener('keydown', tryPlay)
    return () => {
      active = false
      document.removeEventListener('pointerdown', tryPlay)
      document.removeEventListener('keydown', tryPlay)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = 0.01
    if (!musicEnabled || musicPaused) {
      audio.pause()
      return
    }
    if (audio.paused) void Promise.resolve(audio.play()).catch(() => undefined)
  }, [inGame, musicEnabled, musicPaused])

  return null
}

function AppFrame() {
  const { user, session, view, connected, error, clearError, signOut, activeTableCount } = useArena()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<ColorTheme>(preferredTheme)
  const location = useLocation()
  const isTable = location.pathname.startsWith('/game/')
  useEffect(() => {
    if (!isTable) return
    const rootOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow = 'visible'
    return () => {
      document.documentElement.style.overflow = rootOverflow
      document.body.style.overflow = bodyOverflow
    }
  }, [isTable])
  useEffect(() => {
    applyColorTheme(theme)
    const syncTheme = (event: Event) => setTheme((event as CustomEvent<ColorTheme>).detail)
    window.addEventListener('whot-theme', syncTheme)
    return () => window.removeEventListener('whot-theme', syncTheme)
  }, [])
  useEffect(() => {
    const tap = (event: PointerEvent) => {
      const control = (event.target as Element | null)?.closest('button,a,[role="button"]')
      if (!control || (control instanceof HTMLButtonElement && control.disabled)) return
      playGameSound('tap')
    }
    document.addEventListener('pointerdown', tap)
    return () => document.removeEventListener('pointerdown', tap)
  }, [])
  return <div className={`app-frame ${isTable ? 'table-frame' : ''}`}>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link to="/" className="brand"><span className="brand-mark">W</span><span>WHOT<span className="brand-light">ARENA</span></span></Link>
      <div className="side-caption">PLAY</div>
      <nav className="side-nav">{navItems.map(({ to, label, icon: Icon, badge }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{badge && <span className="nav-count" aria-label={`${activeTableCount} active tables`}>{activeTableCount}</span>}</NavLink>)}</nav>
      <div className="side-caption second-caption">YOUR ACCOUNT</div>
      <nav className="side-nav">
        <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><UserRound size={18} /><span>Profile</span></NavLink>
        {user?.is_admin === true && (
          <NavLink
            to="/admin"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}
          >
            <Shield size={18} />
            <span>Admin dashboard</span>
          </NavLink>
        )}
        <NavLink to="/settings" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Settings size={18} /><span>Settings</span></NavLink>
        <NavLink to="/help" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><CircleHelp size={18} /><span>Help & rules</span></NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Game server connected' : 'Game server offline'}</div>
        {user ? <div className="account-mini"><Avatar name={user.username} avatar={user.selected_avatar} className="avatar-small" /><div className="account-copy"><strong>{user.username}</strong><span className="account-coins">₦{user.arena_coins.toLocaleString()} virtual</span></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={17} /></button></div> : <Link className="side-signin" to="/login"><LogIn size={16} /> Sign in to your account</Link>}
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="main-column">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><div className="crumb">{location.pathname === '/' ? 'Welcome to the arena' : location.pathname.split('/')[1]?.replace('-', ' ')}</div><div className="top-actions">{user && <Link to="/profile" className="top-coin-balance" aria-label={`${user.arena_coins} Virtual Naira`}>₦ <strong>{user.arena_coins.toLocaleString()}</strong></Link>}<span className="server-pill"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'LIVE' : 'READY'}</span><button type="button" className="icon-button theme-toggle" onClick={() => applyColorTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><Link className="top-avatar" to={user ? '/profile' : '/login'} aria-label="Open profile">{user ? <Avatar name={user.username} avatar={user.selected_avatar} /> : <UserRound size={17} />}</Link></div></header>
      {error && <div role="alert" className="toast-error"><span>{error}</span><button aria-label="Dismiss" onClick={clearError}><X size={16} /></button></div>}
      <main className="page-content"><Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage registering />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tables" element={<RequireLogin><MyTablesPage /></RequireLogin>} />
        <Route path="/create" element={<RequireLogin><CreateRoom /></RequireLogin>} />
        <Route path="/join" element={<RequireLogin><JoinRoom /></RequireLogin>} />
        <Route path="/lobby/:code" element={<RequireLogin><Lobby /></RequireLogin>} />
        <Route path="/game/:code" element={<RequireLogin><MobileGameOnly /></RequireLogin>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<RequireLogin><AdminDashboardFull /></RequireLogin>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></main>
      <TurnNotifications />
      <TurnChangePopup />
      {(user || (session && view)) && <VoicePanel messages={view?.voice_messages || []} chatMessages={view?.chat_messages || []} playerId={session?.player_id || ''} enabled={view?.status === 'playing'} players={view?.players || (user ? [{ id: 'account', name: user.username, count: 0, connected: true }] : [])} balance={view?.players.find(player => player.id === session?.player_id)?.coin_balance || user?.arena_coins || 0} wager={view?.wager || 0} pot={view?.wager_pot || 0} username={user?.username} roomCode={session?.code} />}
    </div>
  </div>
}

function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="eyebrow"><span />{children}</div> }
function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</div>
}

function Landing() {
  const { user } = useArena()
  return <div className="landing-page">
    <section className="landing-hero"><div className="hero-copy"><Eyebrow>NIGERIAN WHOT · REAL-TIME MULTIPLAYER</Eyebrow><h1>One table.<br /><span>Every move counts.</span></h1><p>Bring your people together for a quick round of WHOT. The cards stay hidden, the competition stays friendly, and every move is verified on the server.</p><div className="hero-actions"><Link className="button button-lime" to="/create"><Gamepad2 size={17} /> Play now <ArrowRight size={17} /></Link><Link className="button button-quiet" to="/help">How to play</Link></div><div className="hero-proof"><span><Shield size={15} /> Server-validated play</span><span><Users size={15} /> 2–4 players</span><span><Radio size={15} /> Live rooms</span></div></div><div className="hero-scene" aria-label="A WHOT card on a green game table"><div className="scene-ring ring-one" /><div className="scene-ring ring-two" /><div className="scene-card card-back"><span>WHOT</span><small>ARENA</small></div><div className="scene-card card-front"><span className="scene-number">20</span><span className="shape-symbol">✦</span><span className="shape-name">WILD CARD</span></div><div className="scene-note"><span className="note-dot" /> YOUR NEXT MOVE</div><div className="scene-score"><span>TABLE<br />OPEN</span><strong>04</strong></div></div></section>
    <section className="landing-lower"><div className="lower-heading"><div><span className="small-label">START HERE</span><h2>{user ? `Welcome back, ${user.username}.` : 'Your next round is one click away.'}</h2></div><span className="house-rule-tag"><Sparkles size={14} /> The Arena house rules</span></div><div className="quick-grid"><Link to="/create" className="quick-action"><span className="quick-icon lime"><Plus size={20} /></span><span><strong>Create a private room</strong><small>Invite friends with a room code</small></span><ArrowRight size={17} /></Link><Link to="/join" className="quick-action"><span className="quick-icon coral"><DoorOpen size={20} /></span><span><strong>Join a room</strong><small>Enter a code from your host</small></span><ArrowRight size={17} /></Link><Link to="/leaderboard" className="quick-action"><span className="quick-icon gold"><Trophy size={20} /></span><span><strong>See the standings</strong><small>Check the player leaderboard</small></span><ArrowRight size={17} /></Link></div></section>
  </div>
}

function Dashboard() {
  const { user, tables, activeTableCount, switchActiveTable, busy } = useArena()
  const navigate = useNavigate()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstOpenTable = tables.find(table => table.status !== 'finished')
  async function resumeFirstTable() {
    if (!firstOpenTable) return
    try {
      const session = await switchActiveTable(firstOpenTable.code)
      if (session) navigate(firstOpenTable.status === 'lobby' ? `/lobby/${session.code}` : `/game/${session.code}`)
    } catch { /* the provider displays the error */ }
  }
  return <><PageTitle eyebrow="PLAYER DASHBOARD" title={`${greeting}${user ? `, ${user.username}` : ''}.`} detail="Pick up a game or see how you stack up." action={<Link className="button button-lime" to="/tables"><Table2 size={17} /> My tables <span className="button-count">{activeTableCount}</span></Link>} />
    {activeTableCount > 0 && <div className="continue-table-banner"><span><Table2 size={16} /> You have {activeTableCount} {activeTableCount === 1 ? 'unfinished table' : 'unfinished tables'}. Resume any game without losing your cards.</span><div className="open-table-actions"><button type="button" className="button button-green" onClick={() => void resumeFirstTable()} disabled={busy}><Play size={15} /> Resume first table</button><Link className="button button-quiet" to="/tables">View all <ArrowRight size={15} /></Link></div></div>}
    <div className="dashboard-grid"><section className="content-panel feature-panel"><div className="panel-topline"><span className="small-label">YOUR NEXT GAME</span><span className="status-tag"><span className="status-dot online" /> OPEN</span></div><h2>Make the first move.</h2><p>Create a private table, invite up to three friends, and let the cards decide.</p><div className="panel-actions"><Link className="button button-green" to="/create"><Plus size={17} /> Create a room</Link><Link className="text-link" to="/join">Join with a code <ArrowRight size={15} /></Link></div><div className="panel-mark">W</div></section><section className="content-panel rank-panel"><div className="panel-topline"><span className="small-label">THE ARENA</span><Trophy size={18} /></div><h3>Play. Win. Climb.</h3><p>Rankings update after completed matches with registered players.</p><Link className="text-link" to="/leaderboard">View leaderboard <ArrowRight size={15} /></Link><div className="rank-decoration"><span /><span /><span /><span /><span /></div></section></div>
    <div className="section-heading"><div><span className="small-label">KEEP EXPLORING</span><h2>Make yourself at home</h2></div></div><div className="quick-grid"><Link to="/tables" className="quick-action"><span className="quick-icon green"><Table2 size={19} /></span><span><strong>My tables</strong><small>{activeTableCount} saved {activeTableCount === 1 ? 'table' : 'tables'}</small></span><ArrowRight size={17} /></Link><Link to="/help" className="quick-action"><span className="quick-icon green"><BookOpen size={19} /></span><span><strong>Rules at a glance</strong><small>Learn the Arena's house rules</small></span><ArrowRight size={17} /></Link><Link to="/profile" className="quick-action"><span className="quick-icon coral"><UserRound size={19} /></span><span><strong>Your player profile</strong><small>Account and match statistics</small></span><ArrowRight size={17} /></Link><Link to="/settings" className="quick-action"><span className="quick-icon gold"><Settings size={19} /></span><span><strong>Game settings</strong><small>Set your name and preferences</small></span><ArrowRight size={17} /></Link></div>
    <TablesPreview />
  </>
}

function TablesPreview() {
  const { tables, switchActiveTable, leaveTable, busy } = useArena()
  const navigate = useNavigate()
  if (!tables.length) return null
  return <section className="content-panel tables-preview-panel">
    <div className="tables-preview-head"><h2>Resume your tables</h2><span>{tables.length} {tables.length === 1 ? 'table' : 'tables'}</span></div>
    <div className="tables-preview-list">
      {tables.slice(0, 3).map(table => (
        <div className="tables-preview-row" key={table.code}>
          <div><strong>{table.code}</strong><small>{table.status || 'reconnecting'}</small></div>
          <div className="tables-preview-actions">
            <button type="button" className="button button-green" disabled={busy} onClick={() => void switchActiveTable(table.code).then(session => session && navigate(`/game/${session.code}`))}>Resume</button>
            <button type="button" className="button button-quiet" onClick={() => void leaveTable(table.code)}>Leave</button>
          </div>
        </div>
      ))}
    </div>
    <div className="tables-preview-foot"><Link to="/tables">Manage all tables <ArrowRight size={15} /></Link></div>
  </section>
}

function AuthPage({ registering = false }: { registering?: boolean }) {
  const { authenticate, authenticateGoogle, user, busy } = useArena()
  const navigate = useNavigate()
  const [formError, setFormError] = useState('')
  const [googleCredential, setGoogleCredential] = useState('')
  const [googleUsername, setGoogleUsername] = useState('')
  const googleButton = useRef<HTMLDivElement>(null)
  const authenticateGoogleRef = useRef(authenticateGoogle)
  authenticateGoogleRef.current = authenticateGoogle
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || user || !googleButton.current) return
    let active = true
    const handleScriptError = () => setFormError('Google sign-in could not be loaded. Please use email and password.')
    const renderGoogleButton = () => {
      if (!active || !googleButton.current) return
      if (!window.google) {
        setFormError('Google sign-in could not be loaded. Please use email and password.')
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: response => {
          if (!response.credential) return
          const credential = response.credential
          void authenticateGoogleRef.current(credential)
            .then(requiresUsername => {
              if (requiresUsername) setGoogleCredential(credential)
              else navigate('/dashboard')
            })
            .catch(error => setFormError(error instanceof Error ? error.message : 'Could not sign in with Google'))
        },
      })
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: 'outline',
        size: 'large',
        text: registering ? 'signup_with' : 'signin_with',
        shape: 'rectangular',
        width: Math.min(360, Math.floor(googleButton.current.clientWidth)),
      })
    }
    let script = document.getElementById('google-identity-services') as HTMLScriptElement | null
    if (window.google) {
      renderGoogleButton()
    } else {
      if (!script) {
        script = document.createElement('script')
        script.id = 'google-identity-services'
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', renderGoogleButton)
      script.addEventListener('error', handleScriptError)
    }
    return () => {
      active = false
      script?.removeEventListener('load', renderGoogleButton)
      script?.removeEventListener('error', handleScriptError)
      if (googleButton.current) googleButton.current.replaceChildren()
    }
  }, [googleCredential, navigate, registering, user])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
    try { await authenticate(registering, values); navigate('/dashboard') }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Could not sign in') }
  }
  async function submitGoogleUsername(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    try {
      const needsUsername = await authenticateGoogle(googleCredential, googleUsername.trim())
      if (needsUsername) throw new Error('Choose a username to finish creating your account.')
      navigate('/dashboard')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create your Google account')
    }
  }
  if (user) return <div className="center-state"><Check size={28} /><h2>You are signed in</h2><Link to="/dashboard" className="button button-green">Go to dashboard</Link></div>
  return <div className="auth-wrap"><Link to="/" className="back-link"><ArrowLeft size={15} /> Back to arena</Link><div className="auth-panel"><span className="auth-emblem">W</span><Eyebrow>{googleCredential ? 'CHOOSE YOUR PLAYER NAME' : registering ? 'JOIN THE ARENA' : 'WELCOME BACK'}</Eyebrow><h1>{googleCredential ? 'Choose a username.' : registering ? 'Create your player account.' : 'Good games start here.'}</h1><p>{googleCredential ? 'This name will appear to other players. Use 3–24 letters, numbers, or underscores.' : registering ? 'Save your player stats and take your wins across sessions.' : 'Sign in to keep track of your wins and player profile.'}</p>{googleCredential ? <form onSubmit={submitGoogleUsername} className="form-stack"><label className="field-label">Username<input name="username" value={googleUsername} onChange={event => setGoogleUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="nickname" required /></label>{formError && <p role="alert" className="form-error">{formError}</p>}<button disabled={busy} className="button button-lime full-button">{busy ? 'Creating account…' : 'Continue with Google'} <ArrowRight size={16} /></button><button type="button" className="button button-outline full-button" disabled={busy} onClick={() => { setGoogleCredential(''); setGoogleUsername(''); setFormError('') }}>Cancel</button></form> : <><form onSubmit={submit} className="form-stack">{registering && <Field label="Player name" name="username" placeholder="e.g. AdaPlays" minLength={3} maxLength={24} required />}<Field label="Email address" name="email" type="email" placeholder="you@example.com" required /><Field label="Password" name="password" type="password" placeholder="At least 8 characters" minLength={registering ? 8 : undefined} required />{formError && <p role="alert" className="form-error">{formError}</p>}<button disabled={busy} className="button button-lime full-button">{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button></form><div className="auth-switch">{registering ? 'Already have a player account?' : 'New to the Arena?'} <Link to={registering ? '/login' : '/register'}>{registering ? 'Sign in' : 'Create one'}</Link></div>{GOOGLE_CLIENT_ID ? <><div className="auth-divider"><span>OR</span></div><div className="google-signin" ref={googleButton} aria-label={registering ? 'Sign up with Google' : 'Sign in with Google'} /></> : <p className="google-unavailable">Google sign-in is not configured.</p>}</>}<div className="guest-note"><Shield size={15} /> Guest games are available without signing in.</div></div></div>
}

function Field({ label, name, type = 'text', placeholder, required, minLength, maxLength, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; minLength?: number; maxLength?: number; defaultValue?: string }) { return <label className="field-label">{label}<input name={name} type={type} placeholder={placeholder} minLength={minLength} maxLength={maxLength} required={required} defaultValue={defaultValue} autoComplete={name === 'password' ? 'current-password' : name === 'email' ? 'email' : 'nickname'} /></label> }

function CreateRoom() {
  const { connectRoom, busy, user } = useArena()
  const navigate = useNavigate()
  const [rules, setRules] = useState<GameRules>({
    cards_per_player: 5, pick_two: 2, pick_three: 3, pick_three_enabled: true, general_market: 1, penalty_stacking: true,
  })
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesError, setRulesError] = useState('')
  const [name, setName] = useState(user?.username || localStorage.getItem('whot.nickname') || 'Guest')
  const [roomError, setRoomError] = useState('')
  const [wager, setWager] = useState(0)
  const [playMode, setPlayMode] = useState<'free' | 'stake'>('free')
  const [teamMode, setTeamMode] = useState(false)
  const [rulesForAction, setRulesForAction] = useState<'create' | 'computer' | 'quick_match' | null>(null)
  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/game-rules`)
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the current game-rule defaults.')
        return await response.json() as GameRules
      })
      .then(defaultRules => { if (active) setRules(defaultRules) })
      .catch(reason => {
        if (active) setRulesError(reason instanceof Error ? reason.message : 'Could not load game-rule defaults.')
      })
      .finally(() => { if (active) setRulesLoading(false) })
    return () => { active = false }
  }, [])
  async function create(action: 'create' | 'quick_match' | 'computer') {
    setRoomError('')
    try {
      const next = await connectRoom(action, {
        name: name.trim() || 'Guest',
        ...(action === 'create' ? { wager: playMode === 'stake' ? wager : 0, team_mode: teamMode } : {}),
        rules,
      })
      navigate(action === 'computer' ? `/game/${next.code}` : `/lobby/${next.code}`)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not create room')
    }
  }
  function continueToRules(action: 'create' | 'computer' | 'quick_match') {
    setRoomError('')
    setRulesForAction(action)
  }
  if (rulesForAction) {
    const soloMatch = rulesForAction === 'computer'
    const quickMatch = rulesForAction === 'quick_match'
    return <><PageTitle eyebrow={soloMatch ? 'SOLO MATCH' : quickMatch ? 'QUICK MATCH' : 'PRIVATE ROOM'} title="Set your game rules." detail="Your match setup is ready. Choose the rules before the table opens." />
      <section className="content-panel player-rules-panel"><div><span className="small-label">TABLE RULES</span><h2>Choose your match rules</h2><p>{soloMatch ? 'These rules apply to your match against Arena Bot.' : quickMatch ? 'Quick matches pair players who chose the same rules.' : 'These rules will be used for the private room you are creating.'}</p></div>
        {rulesLoading ? <div className="table-empty">Loading game rules…</div> : <RulesEditor rules={rules} onChange={setRules} disabled={Boolean(rulesError)} />}
        {rulesError && <div role="alert" className="form-error">{rulesError} Refresh the page to try again.</div>}
        <div className="rules-step-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => { setRulesForAction(null); setRoomError('') }}>Back to table setup</button><button type="button" className="button button-green" disabled={busy || rulesLoading || Boolean(rulesError) || !isValidGameRules(rules)} onClick={() => void create(rulesForAction)}>{soloMatch ? 'Start solo match' : quickMatch ? 'Find a quick match' : 'Create private table'}</button></div>
      </section>
      {roomError && <div role="alert" className="form-error form-error-block">{roomError}</div>}
    </>
  }
  return <><PageTitle eyebrow="FIND YOUR TABLE" title="Let's play." detail="Play the computer, set up a private room, or find a quick match." />
    <div className="setup-layout setup-layout-three">
    <section className="content-panel setup-panel computer-match-panel"><span className="setup-number">01</span><span className="small-label">SOLO MATCH</span><h2>Challenge the computer.</h2><p>Jump straight into a two-player round against Arena Bot. No room code or waiting required.</p><label className="field-label">Your table name<input value={name} maxLength={20} onChange={event => setName(event.target.value)} onBlur={() => localStorage.setItem('whot.nickname', name)} placeholder="Choose a nickname" /></label><button disabled={busy} onClick={() => continueToRules('computer')} className="button button-green full-button"><Gamepad2 size={17} /> Set solo match rules</button></section>
    <section className="content-panel setup-panel"><span className="setup-number">02</span><span className="small-label">PRIVATE ROOM</span><h2>Bring your own crew.</h2><p>Choose a free match or set your own Virtual Naira stake.</p><label className="team-mode-toggle"><input type="checkbox" checked={teamMode} onChange={event => { setTeamMode(event.target.checked); if (event.target.checked) setPlayMode('free') }} /><span><strong>2v2 team match</strong><small>Four players · seats 1 & 3 vs seats 2 & 4</small></span></label><div className="play-mode-choice"><button type="button" className={playMode === 'free' ? 'active' : ''} onClick={() => setPlayMode('free')}>Play free</button><button type="button" className={playMode === 'stake' ? 'active' : ''} onClick={() => setPlayMode('stake')} disabled={!user || teamMode}>Play with Virtual Naira</button></div>{teamMode && <small className="stake-fee-note">Team matches are free to play. Invite exactly four players to start.</small>}{playMode === 'stake' && <label className="field-label">Stake per player<input type="number" min="10" max={user?.arena_coins || 1000000} step="1" value={wager || ''} onChange={event => setWager(Math.max(0, Number(event.target.value)))} placeholder="Enter amount, e.g. 500" /></label>}{user ? <div className="coin-balance">₦{user.arena_coins.toLocaleString()} available{playMode === 'stake' && wager > 0 ? ' · 90% winner payout' : ''}</div> : <Link className="text-link" to="/login">Sign in to enable Virtual Naira stakes <ArrowRight size={14} /></Link>}{playMode === 'stake' && <small className="stake-fee-note">A 10% admin fee is deducted from the total pot when the match ends.</small>}<button disabled={busy || (playMode === 'stake' && (wager < 10 || wager > (user?.arena_coins || 0)))} onClick={() => continueToRules('create')} className="button button-green full-button"><Plus size={17} /> Continue to game rules</button></section>
    <section className="content-panel setup-panel quick-match-panel"><span className="setup-number">03</span><span className="small-label">QUICK MATCH</span><h2>Meet at the table.</h2><p>Choose your rules, then pair with a player who chose the same setup.</p><div className="quick-match-meta"><span><Users size={15} /> 2–4 players</span><span><Clock3 size={15} /> Usually under a minute</span></div><button disabled={busy} onClick={() => continueToRules('quick_match')} className="button button-lime full-button"><Sparkles size={17} /> Set quick-match rules</button></section>
  </div>{roomError && <div role="alert" className="form-error form-error-block">{roomError}</div>}<div className="house-rule-callout"><Shield size={17} /><span><strong>Fair play is server-side.</strong> The game server deals cards, checks moves, and decides the winner.</span><Link to="/help">Rules <ArrowRight size={14} /></Link></div></>
}

function RulesEditor({ rules, onChange, disabled = false }: {
  rules: GameRules
  onChange: (rules: GameRules) => void
  disabled?: boolean
}) {
  const numericRules: Array<{ key: 'cards_per_player' | 'pick_two' | 'pick_three' | 'general_market'; label: string; min: number; max: number }> = [
    { key: 'cards_per_player', label: 'Cards dealt per player', min: 3, max: 10 },
    { key: 'pick_two', label: 'Cards drawn for Pick Two', min: 1, max: 10 },
    { key: 'pick_three', label: 'Cards drawn for Pick Three', min: 1, max: 10 },
    { key: 'general_market', label: 'General Market cards per opponent', min: 1, max: 5 },
  ]
  return <div className="rules-editor">
    {numericRules.map(({ key, label, min, max }) => <label className="field-label" key={key}>{label}<input type="number" min={min} max={max} step="1" value={rules[key]} disabled={disabled || (key === 'pick_three' && !rules.pick_three_enabled)} onChange={event => onChange({ ...rules, [key]: Number(event.target.value) })} /></label>)}
    <label className="team-mode-toggle rules-stacking-toggle"><input type="checkbox" checked={rules.pick_three_enabled} disabled={disabled} onChange={event => onChange({ ...rules, pick_three_enabled: event.target.checked })} /><span><strong>Enable Pick Three</strong><small>When disabled, a 5 is a regular card and does not make the next player draw cards.</small></span></label>
    <label className="team-mode-toggle rules-stacking-toggle"><input type="checkbox" checked={rules.penalty_stacking} disabled={disabled} onChange={event => onChange({ ...rules, penalty_stacking: event.target.checked })} /><span><strong>Allow penalty stacking</strong><small>Players may stack matching Pick Two or Pick Three penalties.</small></span></label>
  </div>
}

function isValidGameRules(rules: GameRules) {
  return Number.isInteger(rules.cards_per_player) && rules.cards_per_player >= 3 && rules.cards_per_player <= 10
    && Number.isInteger(rules.pick_two) && rules.pick_two >= 1 && rules.pick_two <= 10
    && Number.isInteger(rules.pick_three) && rules.pick_three >= 1 && rules.pick_three <= 10
    && Number.isInteger(rules.general_market) && rules.general_market >= 1 && rules.general_market <= 5
}

function JoinRoom() {
  const { connectRoom, busy, user } = useArena()
  const navigate = useNavigate()
  const location = useLocation()
  const inviteCode = new URLSearchParams(location.search).get('code')?.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || ''
  const [code, setCode] = useState(inviteCode)
  const [name, setName] = useState(user?.username || localStorage.getItem('whot.nickname') || 'Guest')
  const [formError, setFormError] = useState('')
  const inviteStartedRef = useRef(false)
  useEffect(() => {
    if (inviteCode.length !== 6 || inviteStartedRef.current) return
    inviteStartedRef.current = true
    void connectRoom('join', { code: inviteCode, name: name.trim() || 'Guest' })
      .then(next => navigate(`/lobby/${next.code}`, { replace: true }))
      .catch(error => setFormError(error instanceof Error ? error.message : 'Could not join invited room'))
  }, [inviteCode])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setFormError('')
    try { const next = await connectRoom('join', { code: code.trim().toUpperCase(), name: name.trim() || 'Guest' }); navigate(`/lobby/${next.code}`) }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Could not join room') }
  }
  return <><PageTitle eyebrow="JOIN A TABLE" title="Got a room code?" detail="Ask your host for the code and pull up a chair." /><form className="join-panel content-panel" onSubmit={submit}><div className="join-card-icon"><DoorOpen size={24} /></div><label className="field-label">Room code<input className="code-input" value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6))} placeholder="ABC123" maxLength={6} required autoCapitalize="characters" /></label><label className="field-label">Your table name<input value={name} maxLength={20} onChange={event => setName(event.target.value)} placeholder="Choose a nickname" /></label>{formError && <div role="alert" className="form-error">{formError}</div>}<button disabled={busy || code.length !== 6} className="button button-green full-button"><DoorOpen size={17} /> {busy ? 'Joining table…' : 'Join this room'}</button><p className="fine-print"><Shield size={14} /> You only see your own cards once play begins.</p></form>{busy && <LoadingScreen message="JOINING YOUR TABLE" action />}</>
}

function Lobby() {
  const { code = '' } = useParams()
  const { view, session, connected, send, leaveRoom } = useArena()
  const navigate = useNavigate()
  const [inviteShared, setInviteShared] = useState(false)
  useEffect(() => { if (view?.status === 'playing') navigate(`/game/${view.code}`, { replace: true }) }, [view?.status])
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Finding your table…</h2><p>Reconnecting to room {code.toUpperCase()}</p><button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/create') }}>Close open table</button></div>
  const isHost = view.host === session?.player_id
  const roomCode = view.code
  async function shareInvite() {
    const url = `${window.location.origin}/join?code=${roomCode}`
    try {
      if (navigator.share) await navigator.share({ title: 'Join my WHOT Arena table', text: `Join room ${roomCode}`, url })
      else await navigator.clipboard.writeText(url)
      setInviteShared(true)
      window.setTimeout(() => setInviteShared(false), 2200)
    } catch { /* Sharing can be cancelled by the player. */ }
  }
  return <><PageTitle eyebrow={view.is_public ? 'QUICK MATCH LOBBY' : 'PRIVATE ROOM'} title="The table is set." detail="Share your code and wait for everyone to join." action={<button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/dashboard') }}><ArrowLeft size={16} /> Leave table</button>} /><section className="lobby-room content-panel"><div className="lobby-code"><div><span className="small-label">ROOM CODE</span><strong>{view.code}</strong></div><div className="lobby-invite-actions"><button className="button button-outline" onClick={() => void navigator.clipboard?.writeText(view.code)}><Check size={15} /> Copy code</button><button className="button button-green" onClick={() => void shareInvite()}><Share2 size={16} /> {inviteShared ? 'Link shared' : 'Invite players'}</button></div></div>{view.wager > 0 && <div className="wager-banner"><span>₦ VIRTUAL NAIRA MATCH</span><strong>₦{view.wager.toLocaleString()} per player · ₦{view.wager_pot.toLocaleString()} current pot</strong><small>Virtual Naira locks when the host starts. The single-game winner takes the pot.</small></div>}<div className="lobby-divider" /><div className="lobby-player-heading"><span className="small-label">PLAYERS</span><span>{view.players.length} / 4 seats</span></div><div className="player-list">{Array.from({ length: 4 }, (_, index) => {
    const player = view.players[index]
    return player ? <div className="lobby-player" key={player.id}><Avatar name={player.name} avatar={player.avatar} className={player.id === view.host ? 'host-avatar' : ''} /><div className="player-copy"><strong>{player.name}{player.id === session?.player_id ? ' (You)' : ''}{view.team_mode && <em className={`team-tag team-tag-${player.team}`}>TEAM {player.team}</em>}</strong><span>{player.id === view.host ? 'Host' : 'Ready to play'} · {player.connected ? 'Connected' : 'Reconnecting'}{view.wager > 0 ? ` · ₦${(player.coin_balance ?? 0).toLocaleString()}` : ''}</span></div>{player.id === view.host && <Crown size={17} className="host-crown" />}{player.id === session?.player_id && <span className="you-tag">YOU</span>}</div> : <div className="lobby-player empty-seat" key={`empty-${index}`}><div className="avatar empty-avatar"><Plus size={16} /></div><div className="player-copy"><strong>Waiting for a player</strong><span>Share the room code to fill this seat</span></div></div>
  })}</div>{view.team_mode && <div className="team-mode-banner"><Users size={16} /><span><strong>2v2 team match</strong><small>Team 1: seats 1 & 3 · Team 2: seats 2 & 4 · free play only</small></span></div>}<div className="lobby-footer"><div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Room is live' : 'Connecting…'}</div>{isHost ? <button className="button button-lime" disabled={(view.team_mode ? view.players.length !== 4 : view.players.length < 2) || view.players.some(player => !player.connected)} onClick={() => send('start')}><Gamepad2 size={17} /> {view.team_mode && view.players.length !== 4 ? 'Need 4 players' : 'Start game'} <ArrowRight size={16} /></button> : <span className="waiting-label"><span className="pulse-dot" /> Waiting for host to start</span>}</div></section><div className="lobby-footnote"><Shield size={15} /> {view.team_mode ? 'Seats 1 & 3 play together against seats 2 & 4. Each partner takes their own turn.' : 'The server will privately deal five cards to each player when the host starts.'}</div></>
}

const shapes = ['circle', 'triangle', 'cross', 'square', 'star']
const shapeGlyph: Record<string, string> = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★', whot: 'W' }
const shapeTone: Record<string, string> = { circle: 'blue', triangle: 'red', cross: 'green', square: 'gold', star: 'coral', whot: 'dark' }
const avatarGlyph = (name: string, avatar?: string) => avatar === 'crown' ? '♛' : avatar === 'star' ? '★' : name.slice(0, 1).toUpperCase()
const avatarAssets = new Set(['initial', 'crown', 'star'])
const avatarNames: Record<string, string> = { initial: 'Arena Original', crown: 'Table Royalty', star: 'Star Player' }
export function Avatar({ name, avatar, className = '' }: { name: string; avatar?: string; className?: string }) {
  return <span className={`avatar ${className}`} role="img" aria-label={`${name} avatar`}>
    {avatar && avatarAssets.has(avatar) ? <img src={`/avatars/${avatar}.svg`} alt="" /> : avatarGlyph(name, avatar)}
  </span>
}
function CardFace({ card, large = false, back = false, selected = false, playable = false, onClick, index = 0 }: { card?: Card | null; large?: boolean; back?: boolean; selected?: boolean; playable?: boolean; onClick?: () => void; index?: number }) {
  if (back) return <div className={`whot-card card-back-face ${large ? 'card-large' : ''}`}><span className="back-mark mark-one"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-two"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-three"><strong>WHOT</strong><small>ARENA</small></span><span className="back-seal">W</span></div>
  if (!card) return <div className={`empty-card ${large ? 'card-large' : ''}`}><span>?</span></div>
  const isWhot = card.shape === 'whot'
  return (
    <button
      type="button"
      className={`whot-card ${large ? 'card-large' : ''} tone-${shapeTone[card.shape]} ${isWhot ? 'whot-value-card' : ''} ${selected ? 'card-selected' : ''} ${playable ? 'card-playable' : ''}`}
      onClick={onClick}
      disabled={!playable}
      style={{ '--card-index': index, '--card-angle': `${(index - 4) * 1.25}deg` } as React.CSSProperties}
      aria-label={`Play ${card.number} ${card.shape}`}
    >
      <span className={`card-glyph ${isWhot ? 'card-glyph-whot' : ''}`}>
        {isWhot ? 'WHOT' : shapeGlyph[card.shape]}
      </span>
      <span className={`card-corner top-corner ${isWhot ? 'whot-number-top' : ''}`}>
        <span>{card.number}</span>
        <small>{isWhot ? 'W' : shapeGlyph[card.shape]}</small>
      </span>
      <span className={`card-corner bottom-corner ${isWhot ? 'whot-number-bottom' : ''}`}>
        <span>{card.number}</span>
        <small>{isWhot ? 'W' : shapeGlyph[card.shape]}</small>
      </span>
    </button>
  )
}

export function RematchAction({ players, onRematch }: { players: Player[]; onRematch: () => void }) {
  const playersConnected = players.every(player => player.connected)
  return <button type="button" className="button button-green" disabled={!playersConnected} onClick={onRematch}>{playersConnected ? <>New match <ArrowRight size={16} /></> : 'Waiting for players to reconnect'}</button>
}

function WinnerCelebration({ name, champion = false }: { name: string; champion?: boolean }) {
  const sparks = Array.from({ length: 32 }, (_, index) => index)
  const bursts = [
    { x: '16%', y: '25%', delay: '0s', hue: 46, size: 1.15 },
    { x: '82%', y: '20%', delay: '.55s', hue: 335, size: 1 },
    { x: '68%', y: '67%', delay: '1.15s', hue: 195, size: .85 },
    { x: '29%', y: '72%', delay: '1.7s', hue: 112, size: .92 },
    { x: '50%', y: '14%', delay: '2.25s', hue: 275, size: 1.08 },
    { x: '91%', y: '48%', delay: '2.8s', hue: 28, size: .78 },
  ]
  return <div className="winner-celebration" role="status" aria-live="assertive" aria-label={`${name} wins the round`}>
    <div className="firework-sky" aria-hidden="true">{bursts.map((burst, index) => <div className="firework" key={index} style={{ left: burst.x, top: burst.y, '--delay': burst.delay, '--hue': burst.hue, '--firework-scale': burst.size } as React.CSSProperties}><i />{sparks.map(spark => <span key={spark} style={{ '--spark': spark, '--distance': `${72 + (spark % 5) * 11}px` } as React.CSSProperties} />)}</div>)}</div>
    <div className={`winner-announcement ${champion ? 'match-champion' : ''}`}><Crown size={34} /><span>{champion ? 'MATCH WINNER' : 'ROUND WINNER'}</span><strong>{name}</strong>{champion && <small>Single-game victory</small>}</div>
  </div>
}

function GameTable() {
  const { code = '' } = useParams()
  const { view, session, send, leaveRoom, switchAway, busy } = useArena()
  const [selectedWhot, setSelectedWhot] = useState<Card | null>(null)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [shape, setShape] = useState('circle')
  const [soundEnabled, setSoundEnabled] = useState(gameSoundsEnabled())
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceMicBusy, setVoiceMicBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [turnSeconds, setTurnSeconds] = useState(30)
  const [pauseSeconds, setPauseSeconds] = useState(0)
  const navigate = useNavigate()
  const myTurn = Boolean(view?.turn === session?.player_id && view?.status === 'playing' && !view?.is_paused)
  useEffect(() => {
    const updateVoice = (event: Event) => {
      const state = (event as CustomEvent<{ speaking: boolean; busy: boolean }>).detail
      setVoiceSpeaking(Boolean(state?.speaking))
      setVoiceMicBusy(Boolean(state?.busy))
    }
    window.addEventListener('whot-live-mic-state', updateVoice)
    return () => window.removeEventListener('whot-live-mic-state', updateVoice)
  }, [])
  useEffect(() => {
    if (view?.status !== 'finished') return
    const roundWinner = view.players.find(player => player.id === view.winner)
    const me = view.players.find(player => player.id === session?.player_id)
    const didWin = view.team_mode ? me?.team === roundWinner?.team : view.winner === session?.player_id
    setToast(didWin ? 'Your team takes the round!' : `${view.team_mode ? `Team ${roundWinner?.team || ''}` : roundWinner?.name || 'A player'} takes the round.`)
  }, [view?.status, view?.winner, view?.team_mode, session?.player_id])
  useEffect(() => {
    if (view?.status !== 'playing') { setTurnSeconds(0); return }
    if (view.is_paused) { setTurnSeconds(view.turn_seconds_remaining); return }
    setTurnSeconds(view.turn_seconds_remaining ?? 30)
    const timer = window.setInterval(() => setTurnSeconds(previous => Math.max(0, previous - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [view?.turn, view?.turn_started_at, view?.state_version, view?.turn_seconds_remaining, view?.status, view?.is_paused, view?.last_action, view?.top?.id, view?.market_count])
  useEffect(() => {
    if (!view?.is_paused) { setPauseSeconds(0); return }
    setPauseSeconds(view.pause_seconds_remaining)
    const timer = window.setInterval(() => setPauseSeconds(previous => Math.max(0, previous - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [view?.is_paused, view?.pause_seconds_remaining, view?.state_version])
  useEffect(() => {
    if (!myTurn) {
      setSelectedCard(null)
      setSelectedWhot(null)
    } else if (selectedCard && !view?.hand.some(card => card.id === selectedCard.id)) {
      setSelectedCard(null)
    }
  }, [view?.hand, myTurn, selectedCard?.id])
  useEffect(() => {
    if (!selectedWhot) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedWhot(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedWhot])
  useEffect(() => {
    const syncSounds = (event: Event) => {
      setSoundEnabled((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener('whot-sounds-change', syncSounds)
    return () => window.removeEventListener('whot-sounds-change', syncSounds)
  }, [])
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Restoring your game…</h2><p>Your hand stays private while the table reconnects.</p><button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/create') }}>Close open table</button></div>
  const me = view.players.find(player => player.id === session?.player_id)
  const opponents = view.players.filter(player => player.id !== session?.player_id)
  const disconnectedPlayers = view.players.filter(player => !player.connected && !player.is_bot)
  const pauseGuidance = reconnectPauseGuidance(
    view.pause_reason,
    view.paused_by,
    disconnectedPlayers,
    pauseSeconds,
  )
  const roundWinner = view.players.find(player => player.id === view.winner)
  const matchWinner = view.players.find(player => player.id === view.match_winner)
  const tableScores = view.team_mode
    ? [1, 2].map(team => ({
      id: `team-${team}`,
      name: `Team ${team}`,
      wins: view.round_wins[`team-${team}`] || 0,
      points: view.match_points[`team-${team}`] || 0,
    }))
    : view.players.map(player => ({
      id: player.id,
      name: player.name,
      wins: view.round_wins[player.id] || 0,
      points: view.match_points[player.id] || 0,
    }))
  const didWinRound = view.team_mode ? me?.team === roundWinner?.team : view.winner === session?.player_id
  const winnerName = view.team_mode ? `Team ${roundWinner?.team || ''}` : roundWinner?.name || 'Arena winner'
  const championName = view.team_mode ? `Team ${matchWinner?.team || ''}` : matchWinner?.name || winnerName
  const missedLastCard = view.players.find(player => player.id !== session?.player_id && player.last_card_required && (!view.team_mode || player.team !== me?.team))
  const isRoundOpening = view.last_action === 'Game started' || view.last_action.includes('started')
  const wagerLocked = view.wager_locked
  const isLegal = (card: Card) => isCardPlayable(
    card, view.pending_draw, view.pending_penalty, view.top, view.requested_shape,
    view.rules.penalty_stacking,
  )
  function playCard(card: Card) {
    if (!myTurn || !isLegal(card)) return
    if (card.number === 20) {
      setSelectedWhot(card)
      return
    }
    send('play', { card_id: card.id })
    setSelectedCard(null)
  }
  function play(card: Card) {
    if (!myTurn || !isLegal(card)) return
    if (selectedCard?.id === card.id) {
      playCard(card)
      return
    }
    setSelectedCard(card)
  }
  function confirmWhot() {
    if (selectedWhot && myTurn && isLegal(selectedWhot)) {
      send('play', { card_id: selectedWhot.id, shape })
    }
    setSelectedWhot(null)
    setSelectedCard(null)
  }
  function openTableChat() {
    window.dispatchEvent(new Event('whot-open-table-chat'))
  }
  function toggleTableMicrophone() {
    window.dispatchEvent(new Event('whot-toggle-live-mic'))
  }
  function toggleGameSounds() {
    const enabled = !gameSoundsEnabled()
    updateGameSoundsEnabled(enabled)
  }
  function exitRoom() {
    if (wagerLocked && !window.confirm('Leave this Virtual Naira match? Your locked stake remains in the pot.')) return
    leaveRoom()
    navigate('/dashboard')
  }
  async function switchTables() {
    if (wagerLocked && !window.confirm('Switch tables now? Your locked stake stays in the pot and your cards are preserved.')) return
    try {
      await switchAway()
      navigate('/tables')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : 'Could not switch tables')
    }
  }
  return (
    <div className={`game-page theme-${me?.table_theme || 'classic'} card-back-${me?.card_back || 'classic'}`}>
      {view.status === 'finished' && <WinnerCelebration name={view.match_winner ? championName : winnerName} champion={Boolean(view.match_winner)} />}
      <header className="game-topline premium-game-header">
        <div className="premium-header-room">
          <button type="button" className="premium-icon-button" onClick={exitRoom} aria-label="Leave table and return to dashboard"><ArrowLeft size={18} /></button>
          <div className="premium-room-copy">
          <Eyebrow>ROOM {view.code}</Eyebrow>
          <span className={`game-status ${myTurn ? 'turn-live' : ''}`} aria-live="polite">
            <span className={`status-dot ${view.is_paused ? '' : 'online'}`} />
            {view.status === 'finished' ? 'ROUND COMPLETE' : view.is_paused ? 'GAME PAUSED' : myTurn ? 'YOUR TURN' : `TURN: ${view.players.find(player => player.id === view.turn)?.name || 'OPPONENT'}`}
          </span>
          </div>
          <div className="premium-match-meta"><span>{view.is_public ? 'QUICK MATCH' : view.team_mode ? '2V2 TABLE' : opponents.every(player => player.is_bot) ? 'SOLO TABLE' : 'PRIVATE TABLE'}</span><b>{view.players.length} PLAYERS</b>{view.wager > 0 && <strong>₦{view.wager_pot.toLocaleString()} POT</strong>}</div>
        </div>
        <div className="premium-header-actions">
          <button type="button" className="premium-header-button" onClick={openTableChat} aria-label="Open table chat"><MessageCircle size={16} /><span>Chat</span></button>
          {!opponents.every(player => player.is_bot) && <button type="button" className={`premium-header-button premium-voice-button ${voiceSpeaking ? 'mic-speaking' : ''}`} disabled={view.status !== 'playing' || voiceMicBusy} onClick={toggleTableMicrophone} aria-label={voiceSpeaking ? 'Mute microphone' : 'Tap to speak'} title={voiceSpeaking ? 'Mute microphone' : 'Tap to speak'}><span className="premium-mic-wave">{voiceSpeaking ? <Mic size={16} /> : <MicOff size={16} />}</span><span>{voiceMicBusy ? 'Connecting…' : voiceSpeaking ? 'Mute' : 'Speak'}</span></button>}
          <button type="button" className="premium-icon-button" onClick={toggleGameSounds} aria-label={soundEnabled ? 'Mute game sounds' : 'Enable game sounds'} title={soundEnabled ? 'Mute game sounds' : 'Enable game sounds'}><Volume2 size={17} />{!soundEnabled && <i />}</button>
          <button type="button" className="premium-header-button" onClick={() => navigate('/tables')} aria-label="Open My Tables"><Table2 size={16} /><span>My Tables</span></button>
          <button type="button" className="premium-header-button premium-switch-button" disabled={busy} onClick={() => void switchTables()} aria-label="Switch to another table"><ArrowLeft size={15} /><span>Switch Table</span></button>
          <details className="premium-more-menu"><summary className="premium-icon-button" aria-label="More game options"><MoreHorizontal size={19} /></summary><div className="premium-menu-items">
            {view.host === session?.player_id && !view.is_public && view.status === 'playing' && <button type="button" disabled={view.is_paused && view.pause_reason !== 'manual'} onClick={() => send('pause')}>{view.is_paused && view.pause_reason === 'manual' ? <Play size={15} /> : <Pause size={15} />}{view.is_paused && view.pause_reason === 'manual' ? 'Resume game' : 'Pause game'}</button>}
            <button type="button" onClick={exitRoom}><DoorOpen size={15} /> Leave table</button>
          </div></details>
        </div>
      </header>
      <div className={`game-layout premium-game-layout ${opponents.every(player => player.is_bot) ? 'solo-layout' : ''}`}>
      <div className="table-column">
      <section className={`table-felt premium-table-felt ${view.pending_draw > 0 ? 'table-penalty-active' : ''} ${isRoundOpening ? 'table-dealing' : ''}`}>
        <div className="table-stitch" />
        <div className="match-scoreboard table-scoreboard" role="status" aria-label="Live match scoreboard">
          <span>SCOREBOARD</span>
          <div>{tableScores.map(score => <span key={score.id}><strong>{score.name}</strong><b>{score.points}</b><small>{score.wins} {score.wins === 1 ? 'win' : 'wins'}</small></span>)}</div>
        </div>
        {view.is_paused && <div className="reconnect-pause" role="status" aria-live="polite">{view.pause_reason === 'disconnect' ? <Wifi size={25} /> : <Pause size={25} />}<span>PRIVATE MATCH PAUSED</span><strong>{pauseGuidance.title}</strong><small>{pauseGuidance.detail}{view.pause_reason === 'disconnect' ? ` · turn timer frozen at ${turnSeconds}` : ` · ${turnSeconds} seconds left on the turn timer`}</small><p>{pauseGuidance.instruction}</p></div>}
        <div className={`opponents-row premium-opponents opponents-${opponents.length}`}>
          {opponents.map((player, index) => (
            <div className={`opponent premium-player-seat ${opponentSeatClass(index, opponents.length)} ${!player.connected ? 'player-away' : ''} ${view.turn === player.id ? 'opponent-turn' : ''}`} key={player.id}>
              <div className={`opponent-avatar-wrap ${player.voice_speaking ? 'voice-speaking' : ''}`}><Avatar name={player.name} avatar={player.avatar} className={`opponent-avatar avatar-${index}`} /><span className={`status-dot ${player.connected ? 'online' : ''}`} /></div>
              <strong>{player.name}{player.is_bot ? ' · CPU' : ''}{view.team_mode && <em className={`team-tag team-tag-${player.team}`}>TEAM {player.team}</em>}</strong><span className={player.count === 1 ? 'last-card-label' : ''}>{player.count === 1 ? 'LAST CARD' : `${player.count} cards`}</span>{view.wager > 0 && player.id === session?.player_id && !player.is_bot && <span className="player-wallet">₦{(player.coin_balance ?? 0).toLocaleString()}</span>}{view.turn === player.id && <span className="opponent-turn-label"><Clock3 size={12} />{player.is_bot ? 'THINKING' : `${turnSeconds}s · THEIR TURN`}</span>}
              <div className="opponent-card-fan">{Array.from({ length: Math.min(player.count, 3) }, (_, cardIndex) => <CardFace key={cardIndex} back />)}</div>
            </div>
          ))}
        </div>
        <div className="center-piles">
          <div className="pile-block"><span className="pile-label">DRAW DECK</span><button type="button" disabled={!myTurn} className={`pile-stack${view.market_count > 0 && view.market_count <= 5 ? ' pile-stack-low' : ''}`} onClick={() => myTurn && send('draw')} aria-label={view.pending_draw ? `Accept penalty and draw ${view.pending_draw} cards` : `Draw one card and pass. ${view.market_count} cards remain`}><CardFace back large /><span className="market-count">{view.market_count}</span><span className="pile-count">{myTurn ? view.pending_draw ? `PICK ${view.pending_draw}` : 'DRAW & PASS' : `${view.market_count} CARDS`}</span></button></div>
          <div className="table-arrow">{view.status === 'playing' ? <div className={`table-turn-timer ${!view.is_paused && turnSeconds <= 5 ? 'table-turn-timer-urgent' : ''}`} aria-live="polite" aria-label={view.is_paused ? view.pause_reason === 'disconnect' ? `${pauseSeconds} seconds to reconnect` : 'Game paused by host' : `${turnSeconds} seconds remaining`}><Clock3 size={16} /><strong>{view.is_paused ? view.pause_reason === 'disconnect' ? pauseSeconds : '‖' : turnSeconds}</strong><span>{view.is_paused ? 'PAUSE' : 'SEC'}</span></div> : <Sparkles size={19} />}</div>
          <div className="pile-block"><span className="pile-label">DISCARD PILE</span><div className="top-card-slot"><CardFace key={view.top?.id || 'empty-top'} card={view.top} large selected /><div className="top-glow" /></div></div>
        </div>
        {view.requested_shape && <div className="requested-shape"><span>SHAPE REQUESTED</span><strong>{shapeGlyph[view.requested_shape]} {view.requested_shape}</strong></div>}
        {view.pending_draw > 0 && <div className="requested-shape penalty-stack" role="status"><span>PENALTY</span><strong>Pick {view.pending_draw}{view.rules.penalty_stacking ? ` · Block with another ${view.pending_penalty}` : ' · Stacking is disabled'}</strong></div>}
        <div className="table-message" aria-live="polite">{toast || view.last_action}</div>
        {missedLastCard && view.status === 'playing' && !view.is_paused && <button type="button" className="button button-outline" onClick={() => send('call_last', { target_id: missedLastCard.id })} aria-label={`Call ${missedLastCard.name} for missing LAST CARD; they draw two cards`}>CALL LAST CARD · +2</button>}
        <div className={`you-at-table premium-you-seat ${myTurn ? 'you-seat-turn' : ''}`}><div className={`you-avatar-wrap ${me?.voice_speaking ? 'voice-speaking' : ''}`}><Avatar name={me?.name || 'You'} avatar={me?.avatar} className="you-avatar" /><span className={`status-dot ${me?.connected ? 'online' : ''}`} /></div><div><strong>{me?.name || 'You'} <span>(you)</span>{view.team_mode && <em className={`team-tag team-tag-${me?.team}`}>TEAM {me?.team}</em>}</strong><small>{myTurn ? 'Your move' : view.status === 'finished' ? 'Round over' : 'Waiting for your turn'}{view.wager > 0 ? ` · ₦${(me?.coin_balance ?? 0).toLocaleString()}` : ''}</small></div>{myTurn && <span className="turn-clock"><Clock3 size={15} /> {turnSeconds}s · YOUR TURN</span>}</div>
      </section>
      {view.status === 'finished' ? (
        <section className="round-result">
          <div className="result-icon">{didWinRound ? <Crown size={26} /> : <Trophy size={26} />}</div>
          <div><span className="small-label">{view.match_winner ? 'MATCH COMPLETE' : `ROUND ${view.round_number} COMPLETE`}</span><h2>{view.match_winner ? `${championName} won the match!` : view.team_mode ? didWinRound ? 'Your team won the round!' : `${winnerName} won the round.` : didWinRound ? 'You won the round!' : `${winnerName} won the round.`}</h2><p>{view.match_winner ? view.wager > 0 ? `The winner takes the ₦${view.wager_pot.toLocaleString()} Virtual Naira pot.` : 'The single-game match is complete. Any player can start a new game.' : 'Remaining cards determine the points awarded.'}</p>{Object.keys(view.final_scores || {}).length > 0 && <div className="final-scores">{view.players.map(player => { const key = view.team_mode ? `team-${player.team}` : player.id; return <span key={player.id}><strong>{view.team_mode ? `Team ${player.team} · ` : ''}{player.name}</strong> {view.final_scores[player.id]} left · {view.round_wins[key] || 0} wins · {view.match_points[key] || 0} pts</span> })}</div>}</div>
          <RematchAction players={view.players} onRematch={() => send('rematch')} />
        </section>
      ) : (
        <section className={`hand-panel ${view.pending_draw > 0 && myTurn ? 'penalty-hand' : ''}`}>
          <div className="hand-heading"><div><span className="small-label">YOUR HAND</span><strong className={view.hand.length === 1 ? 'last-card-label' : ''}>{view.hand.length === 1 ? 'LAST CARD' : `${view.hand.length} cards`}</strong></div>{me?.last_card_required ? <button type="button" className="last-card-button" onClick={() => send('declare_last')}><Sparkles size={15} /> LAST CARD!</button> : <span className="hand-hint">{myTurn ? view.pending_draw ? view.rules.penalty_stacking ? `Select another ${view.pending_penalty} or draw ${view.pending_draw}` : `Draw ${view.pending_draw} cards (or play WHOT)` : selectedCard ? `${selectedCard.number} ${selectedCard.shape} selected · click again to play` : 'Double-click or tap a playable card to play' : 'Cards only you can see'}</span>}</div>
          <div className="hand-cards">{view.hand.map((card, index) => <CardFace key={card.id} card={card} playable={myTurn && isLegal(card)} selected={selectedCard?.id === card.id} index={index} onClick={() => play(card)} />)}</div>
        </section>
      )}
      </div>
      {!opponents.every(player => player.is_bot) && <LiveVoicePanel players={view.players} playerId={session?.player_id || ''} enabled={view.status === 'playing'} />}
      </div>
      {selectedWhot && createPortal(<div className="shape-modal-backdrop" onMouseDown={() => setSelectedWhot(null)}><section className="shape-modal" role="dialog" aria-modal="true" aria-labelledby="shape-modal-title" onMouseDown={event => event.stopPropagation()}><button type="button" className="icon-button shape-modal-close" onClick={() => setSelectedWhot(null)} aria-label="Cancel shape selection"><X size={18} /></button><div className="shape-modal-card"><span>20</span><strong>WHOT</strong></div><span className="small-label">WHOT 20</span><h2 id="shape-modal-title">Choose the next shape</h2><p>Every player must match the shape you select.</p><div className="shape-modal-grid">{shapes.map(item => <button type="button" key={item} className={`shape-modal-choice shape-${item} ${shape === item ? 'shape-modal-choice-active' : ''}`} onClick={() => setShape(item)} aria-pressed={shape === item}><span>{shapeGlyph[item]}</span><strong>{item}</strong></button>)}</div><button type="button" className="button button-lime shape-modal-confirm" onClick={confirmWhot}><Check size={16} /> Play WHOT · {shapeGlyph[shape]} {shape}</button></section></div>, document.body)}
    </div>
  )
}

function LiveVoicePanel({ players, playerId, enabled }: { players: Player[]; playerId: string; enabled: boolean }) {
  const { rtcSignals, sendRtcSignal, subscribeLiveAudio, send } = useArena()
  const [muted, setMuted] = useState(true)
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'blocked' | 'unsupported' | 'failed'>('idle')
  const [connectedPeers, setConnectedPeers] = useState<string[]>([])
  const [directAudioPeers, setDirectAudioPeers] = useState<string[]>([])
  const [fallbackPeerIds, setFallbackPeerIds] = useState<string[]>([])
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const localStreamRef = useRef<MediaStream | null>(null)
  const startPromiseRef = useRef<Promise<MediaStream | null> | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const fallbackPeersRef = useRef(new Set<string>())
  const disconnectedTimersRef = useRef(new Map<string, number>())
  const audioRef = useRef(new Map<string, HTMLAudioElement>())
  const offeredRef = useRef(new Set<string>())
  const handledSignalsRef = useRef(new Set<string>())
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const relayContextRef = useRef<AudioContext | null>(null)
  const relayProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const relayPlaybackRef = useRef<AudioContext | null>(null)
  const directAudioPeersRef = useRef(new Set<string>())
  const relaySourcesRef = useRef(new Map<string, Set<AudioBufferSourceNode>>())
  // Each remote speaker needs an independent playback clock.
  const relayPlaybackTimesRef = useRef(new Map<string, number>())
  // React may batch incoming WebSocket packets into a single render.
  const handledAudioIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const toggleMicrophone = () => toggleMute()
    window.addEventListener('whot-toggle-live-mic', toggleMicrophone)
    return () => window.removeEventListener('whot-toggle-live-mic', toggleMicrophone)
  }, [muted, status])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('whot-live-mic-state', {
      detail: { speaking: status === 'live' && !muted, busy: status === 'starting' },
    }))
  }, [muted, status])

  function unlockLivePlayback() {
    const playback = relayPlaybackRef.current || new AudioContext({ latencyHint: 'playback' })
    relayPlaybackRef.current = playback
    if (playback.state !== 'running') {
      void playback.resume().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
    }
    audioRef.current.forEach(audio => { void Promise.resolve(audio.play()).catch(() => setPlaybackBlocked(true)) })
  }

  function startRelayCapture(stream: MediaStream) {
    if (relayProcessorRef.current) return
    const context = new AudioContext({ latencyHint: 'interactive' })
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(2048, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0
    processor.onaudioprocess = event => {
      if (mutedRef.current || !fallbackPeersRef.current.size) return
      const input = event.inputBuffer.getChannelData(0)
      const ratio = context.sampleRate / 24000
      const samples = new Int16Array(Math.floor(input.length / ratio))
      for (let index = 0; index < samples.length; index += 1) {
        const start = Math.floor(index * ratio)
        const end = Math.min(input.length, Math.floor((index + 1) * ratio))
        let total = 0
        for (let sample = start; sample < end; sample += 1) total += input[sample]
        const value = Math.max(-1, Math.min(1, total / Math.max(1, end - start)))
        samples[index] = value < 0 ? value * 0x8000 : value * 0x7fff
      }
      const bytes = new Uint8Array(samples.buffer)
      let binary = ''
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
      send('rtc_audio', { audio: btoa(binary), target_ids: [...fallbackPeersRef.current] })
    }
    source.connect(processor)
    processor.connect(silent)
    silent.connect(context.destination)
    relayContextRef.current = context
    relayProcessorRef.current = processor
    void context.resume().catch(() => setVoiceError('Tap the mic again to allow live audio.'))
  }

  function setRelayFallback(remoteId: string, enabled: boolean) {
    const alreadyFallback = fallbackPeersRef.current.has(remoteId)
    if (alreadyFallback === enabled) return
    if (enabled) {
      fallbackPeersRef.current.add(remoteId)
      if (localStreamRef.current) startRelayCapture(localStreamRef.current)
    } else {
      fallbackPeersRef.current.delete(remoteId)
      if (!fallbackPeersRef.current.size) {
        relayProcessorRef.current?.disconnect()
        relayProcessorRef.current = null
        void relayContextRef.current?.close()
        relayContextRef.current = null
      }
    }
    setFallbackPeerIds([...fallbackPeersRef.current])
  }

  async function startMicrophone() {
    if (localStreamRef.current) return localStreamRef.current
    if (startPromiseRef.current) return startPromiseRef.current
    setVoiceError('')
    if (!window.isSecureContext) {
      setStatus('unsupported')
      setVoiceError('Microphone access requires a secure HTTPS connection (or localhost).')
      return null
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setStatus('unsupported')
      setVoiceError('Live voice is not supported by this browser. Try a current browser on HTTPS.')
      return null
    }
    startPromiseRef.current = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
      video: false,
    }).then(stream => {
      const tracks = stream.getAudioTracks()
      if (!tracks.length) {
        stream.getTracks().forEach(track => track.stop())
        throw new DOMException('No microphone audio track was returned.', 'NotFoundError')
      }
      localStreamRef.current = stream
      tracks.forEach(track => {
        track.enabled = true
        track.addEventListener('ended', () => {
          if (localStreamRef.current !== stream || !enabled) return
          send('rtc_speaking', { speaking: false })
          setMuted(true)
          setStatus('blocked')
          setVoiceError('The microphone stopped. Check the device or browser permission, then tap the mic to retry.')
          localStreamRef.current = null
          startPromiseRef.current = null
        }, { once: true })
      })
      for (const [remoteId, peer] of peersRef.current) {
        const senderTracks = peer.getSenders().map(sender => sender.track).filter(Boolean)
        stream.getAudioTracks().forEach(track => { if (!senderTracks.includes(track)) peer.addTrack(track, stream) })
        void peer.createOffer().then(offer => peer.setLocalDescription(offer)).then(() => {
          if (peer.localDescription) sendRtcSignal(remoteId, { type: 'offer', sdp: { type: peer.localDescription.type, sdp: peer.localDescription.sdp } })
        }).catch(() => undefined)
      }
      setMuted(false)
      setStatus('live')
      setVoiceError('')
      send('rtc_speaking', { speaking: true })
      if (fallbackPeersRef.current.size) startRelayCapture(stream)
      return stream
    }).catch(reason => {
      send('rtc_speaking', { speaking: false })
      localStreamRef.current?.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
      setStatus('blocked')
      setVoiceError(microphoneFailureMessage(reason))
      startPromiseRef.current = null
      return null
    })
    return startPromiseRef.current
  }

  function createPeer(remoteId: string, stream: MediaStream | null): RTCPeerConnection | null {
    const existing = peersRef.current.get(remoteId)
    if (existing) return existing
    let peer: RTCPeerConnection
    try {
      peer = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS })
    } catch (reason) {
      setVoiceError(reason instanceof Error ? reason.message : 'The browser rejected the voice connection settings.')
      setStatus('failed')
      return null
    }
    if (stream) stream.getAudioTracks().forEach(track => peer.addTrack(track, stream))
    else peer.addTransceiver('audio', { direction: 'recvonly' })
    peer.onicecandidate = event => {
      if (event.candidate) {
        const candidate = typeof event.candidate.toJSON === 'function' ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        }
        sendRtcSignal(remoteId, { type: 'ice', candidate })
      }
    }
    peer.ontrack = event => {
      directAudioPeersRef.current.add(remoteId)
      setRelayFallback(remoteId, false)
      relaySourcesRef.current.get(remoteId)?.forEach(source => { try { source.stop() } catch { /* already stopped */ } })
      relaySourcesRef.current.delete(remoteId)
      relayPlaybackTimesRef.current.delete(remoteId)
      const audio = audioRef.current.get(remoteId) || new Audio()
      audio.autoplay = true
      audio.srcObject = event.streams[0]
      audioRef.current.set(remoteId, audio)
      setDirectAudioPeers(previous => previous.includes(remoteId) ? previous : [...previous, remoteId])
      void audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
    }
    peer.onconnectionstatechange = () => {
      const disconnectedTimer = disconnectedTimersRef.current.get(remoteId)
      if (disconnectedTimer !== undefined) {
        window.clearTimeout(disconnectedTimer)
        disconnectedTimersRef.current.delete(remoteId)
      }
      if (peer.connectionState === 'connected') {
        setRelayFallback(remoteId, false)
        setConnectedPeers(previous => previous.includes(remoteId) ? previous : [...previous, remoteId])
        playGameSound('join')
      } else if (peer.connectionState === 'failed') {
        setRelayFallback(remoteId, true)
        setConnectedPeers(previous => previous.filter(id => id !== remoteId))
        setDirectAudioPeers(previous => previous.filter(id => id !== remoteId))
        directAudioPeersRef.current.delete(remoteId)
      } else if (peer.connectionState === 'disconnected') {
        const timer = window.setTimeout(() => {
          disconnectedTimersRef.current.delete(remoteId)
          if (peer.connectionState === 'disconnected') {
            setRelayFallback(remoteId, true)
            setConnectedPeers(previous => previous.filter(id => id !== remoteId))
            setDirectAudioPeers(previous => previous.filter(id => id !== remoteId))
            directAudioPeersRef.current.delete(remoteId)
          }
        }, 5000)
        disconnectedTimersRef.current.set(remoteId, timer)
      } else if (peer.connectionState === 'closed') {
        setRelayFallback(remoteId, false)
        setConnectedPeers(previous => previous.filter(id => id !== remoteId))
        setDirectAudioPeers(previous => previous.filter(id => id !== remoteId))
        directAudioPeersRef.current.delete(remoteId)
      }
    }
    peersRef.current.set(remoteId, peer)
    return peer
  }

  useEffect(() => {
    if (enabled) send('rtc_ready')
    return () => {
      send('rtc_speaking', { speaking: false })
      const localStream = localStreamRef.current
      localStreamRef.current = null
      localStream?.getTracks().forEach(track => track.stop())
      peersRef.current.forEach(peer => {
        peer.onconnectionstatechange = null
        peer.ontrack = null
        peer.close()
      })
      disconnectedTimersRef.current.forEach(timer => window.clearTimeout(timer))
      disconnectedTimersRef.current.clear()
      fallbackPeersRef.current.clear()
      audioRef.current.forEach(audio => { audio.pause(); audio.srcObject = null })
      relayProcessorRef.current?.disconnect()
      relayProcessorRef.current = null
      void relayContextRef.current?.close()
      relayContextRef.current = null
      void relayPlaybackRef.current?.close()
      relayPlaybackRef.current = null
      relayPlaybackTimesRef.current.clear()
      relaySourcesRef.current.forEach(sources => sources.forEach(source => { try { source.stop() } catch { /* already stopped */ } }))
      relaySourcesRef.current.clear()
      directAudioPeersRef.current.clear()
      handledAudioIdsRef.current.clear()
      peersRef.current.clear()
      audioRef.current.clear()
    }
  }, [enabled])

  useEffect(() => {
    const stream = localStreamRef.current
    if (!enabled || !playerId) return
    const remoteIds = players.filter(player => player.id !== playerId && player.connected && player.voice_ready).map(player => player.id)
    for (const [remoteId, peer] of peersRef.current) {
      if (!remoteIds.includes(remoteId)) {
        peer.close()
        peersRef.current.delete(remoteId)
        offeredRef.current.delete(remoteId)
        const timer = disconnectedTimersRef.current.get(remoteId)
        if (timer !== undefined) window.clearTimeout(timer)
        disconnectedTimersRef.current.delete(remoteId)
        setRelayFallback(remoteId, false)
        setConnectedPeers(previous => previous.filter(id => id !== remoteId))
        setDirectAudioPeers(previous => previous.filter(id => id !== remoteId))
        directAudioPeersRef.current.delete(remoteId)
      }
    }
    for (const remoteId of remoteIds) {
      const peer = createPeer(remoteId, stream)
      if (!peer) continue
      if (playerId < remoteId && !offeredRef.current.has(remoteId)) {
        offeredRef.current.add(remoteId)
        void peer.createOffer().then(offer => peer.setLocalDescription(offer)).then(() => {
          if (peer.localDescription) sendRtcSignal(remoteId, { type: 'offer', sdp: { type: peer.localDescription.type, sdp: peer.localDescription.sdp } })
        }).catch(() => offeredRef.current.delete(remoteId))
      }
    }
  }, [players, playerId, enabled, status])

  useEffect(() => {
    for (const message of rtcSignals) {
      if (handledSignalsRef.current.has(message.id) || !players.some(player => player.id === message.from)) continue
      handledSignalsRef.current.add(message.id)
      void (async () => {
        const peer = createPeer(message.from, localStreamRef.current)
        if (!peer) return
        if (message.signal.type === 'offer' && message.signal.sdp) {
          await peer.setRemoteDescription(message.signal.sdp)
          for (const candidate of pendingIceRef.current.get(message.from) || []) await peer.addIceCandidate(candidate)
          pendingIceRef.current.delete(message.from)
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          if (peer.localDescription) sendRtcSignal(message.from, { type: 'answer', sdp: { type: peer.localDescription.type, sdp: peer.localDescription.sdp } })
        } else if (message.signal.type === 'answer' && message.signal.sdp) {
          await peer.setRemoteDescription(message.signal.sdp)
          for (const candidate of pendingIceRef.current.get(message.from) || []) await peer.addIceCandidate(candidate)
          pendingIceRef.current.delete(message.from)
        } else if (message.signal.type === 'ice' && message.signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(message.signal.candidate)
          else pendingIceRef.current.set(message.from, [...(pendingIceRef.current.get(message.from) || []), message.signal.candidate])
        }
      })().catch(() => setConnectedPeers(previous => previous.filter(id => id !== message.from)))
    }
  }, [rtcSignals, players])

  useEffect(() => subscribeLiveAudio(packet => {
    if (handledAudioIdsRef.current.has(packet.id) || packet.from === playerId || directAudioPeersRef.current.has(packet.from)) return
    handledAudioIdsRef.current.add(packet.id)
    if (handledAudioIdsRef.current.size > 500) {
      handledAudioIdsRef.current = new Set([...handledAudioIdsRef.current].slice(-250))
    }

    const context = relayPlaybackRef.current || new AudioContext({ latencyHint: 'playback' })
    relayPlaybackRef.current = context
    if (context.state !== 'running') {
      setPlaybackBlocked(true)
      return
    }

    try {
      const bytes = Uint8Array.from(atob(packet.audio), character => character.charCodeAt(0))
      if (bytes.byteLength < 2 || bytes.byteLength % 2 !== 0) return
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
      const buffer = context.createBuffer(1, samples.length, 24000)
      const channel = buffer.getChannelData(0)
      for (let index = 0; index < samples.length; index += 1) {
        channel[index] = samples[index] / 0x8000
      }

      const now = context.currentTime
      const startAt = relayPlaybackStartAt(relayPlaybackTimesRef.current.get(packet.from), now)
      const source = context.createBufferSource()
      const smoothing = context.createGain()
      const fade = Math.min(.004, buffer.duration / 4)
      source.buffer = buffer
      source.connect(smoothing)
      smoothing.connect(context.destination)
      smoothing.gain.setValueAtTime(0, startAt)
      smoothing.gain.linearRampToValueAtTime(1, startAt + fade)
      smoothing.gain.setValueAtTime(1, startAt + buffer.duration - fade)
      smoothing.gain.linearRampToValueAtTime(0, startAt + buffer.duration)
      const sources = relaySourcesRef.current.get(packet.from) || new Set<AudioBufferSourceNode>()
      sources.add(source)
      relaySourcesRef.current.set(packet.from, sources)
      source.onended = () => {
        sources.delete(source)
        if (!sources.size) relaySourcesRef.current.delete(packet.from)
      }
      source.start(startAt)
      relayPlaybackTimesRef.current.set(packet.from, startAt + buffer.duration)
    } catch {
      // A damaged packet should not stop playback of subsequent packets.
    }
  }), [playerId, subscribeLiveAudio])

  useEffect(() => {
    const waitingPlayers = players.filter(player => player.id !== playerId && player.connected && player.voice_ready
      && !connectedPeers.includes(player.id) && !directAudioPeers.includes(player.id)
      && !fallbackPeerIds.includes(player.id))
    if (!waitingPlayers.length) return
    const timer = window.setTimeout(() => {
      for (const player of waitingPlayers) {
        if (shouldUseRelayFallback(peersRef.current.get(player.id)?.connectionState)) {
          setRelayFallback(player.id, true)
        }
      }
    }, 12000)
    return () => window.clearTimeout(timer)
  }, [players, playerId, connectedPeers, directAudioPeers, fallbackPeerIds])

  function toggleMute() {
    unlockLivePlayback()
    if (!localStreamRef.current) {
      setStatus('starting')
      startPromiseRef.current = null
      void startMicrophone()
      return
    }
    const next = !muted
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next })
    audioRef.current.forEach(audio => { void audio.play().catch(() => undefined) })
    send('rtc_speaking', { speaking: !next })
    setMuted(next)
  }

  function enablePlayback() {
    const relayPlayback = relayPlaybackRef.current
    void Promise.all([...audioRef.current.values()].map(audio => audio.play()).concat(relayPlayback ? [relayPlayback.resume()] : [])).then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
  }

  return <>
    {voiceError && <div className="live-mic-error-toast" role="status">{voiceError}</div>}
    {playbackBlocked && <button type="button" className="live-speaker-unlock" onClick={enablePlayback}><Volume2 size={15} /> Enable speaker</button>}
  </>
}

function SocialOverlay({ recipient, roomCode }: { recipient: string; roomCode?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState<'profile' | 'invites' | null>(null)
  const [profile, setProfile] = useState<PlayerCard | null>(null)
  const [invites, setInvites] = useState<MatchInvitation[]>([])
  const headers = { Authorization: `Bearer ${accessToken()}` }
  const loadProfile = async () => { const response = await fetch(`${API_URL}/api/players/${encodeURIComponent(recipient)}/card`, { headers }); if (response.ok) setProfile(await response.json()); setOpen('profile') }
  const loadInvites = async () => { const response = await fetch(`${API_URL}/api/match-invitations`, { headers }); if (response.ok) setInvites(await response.json()); setOpen('invites') }
  const socialAction = async (path: string, method = 'POST') => { await fetch(`${API_URL}${path}`, { method, headers }); await loadProfile() }
  const invite = async () => { if (!roomCode) return; await fetch(`${API_URL}/api/match-invitations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_username: recipient, room_code: roomCode }) }); setOpen(null) }
  const respond = async (item: MatchInvitation, decision: 'accept' | 'decline') => { await fetch(`${API_URL}/api/match-invitations/${item.id}/${decision}`, { method: 'POST', headers }); if (decision === 'accept') navigate(`/join?code=${item.room_code}`); else void loadInvites() }
  return <div className="social-overlay-tools">{recipient.length >= 3 && <button onClick={() => void loadProfile()}>Profile</button>}<button onClick={() => void loadInvites()}>Invites</button>{open && <div className="social-modal"><button className="social-close" onClick={() => setOpen(null)}><X size={15} /></button>{open === 'profile' && profile ? <><span className="whatsapp-avatar profile">{profile.username.slice(0, 1).toUpperCase()}</span><h3>@{profile.username}</h3><p>Level {profile.level} · {profile.wins} wins · {profile.matches_played} games</p><div className="social-achievements">{profile.achievements.length ? profile.achievements.map(item => <span key={item}>{item.replace('_', ' ')}</span>) : <small>No achievements yet</small>}</div><div className="social-actions">{profile.blocked ? <button onClick={() => void socialAction(`/api/blocks/${profile.username}`, 'DELETE')}>Unblock</button> : <button onClick={() => void socialAction(`/api/blocks/${profile.username}`)}>Block</button>}{profile.friend_status === 'accepted' ? <button onClick={() => void socialAction(`/api/friends/${profile.username}`, 'DELETE')}>Remove friend</button> : profile.friend_status === 'pending' && !profile.friend_requested_by_you ? <button onClick={() => void socialAction(`/api/friends/${profile.username}/accept`)}>Accept friend</button> : <button disabled={profile.friend_status === 'pending'} onClick={() => void socialAction(`/api/friends/${profile.username}`)}>{profile.friend_status === 'pending' ? 'Request sent' : 'Add friend'}</button>}{roomCode && <button className="invite-action" onClick={() => void invite()}>Invite to match</button>}</div></> : <><h3>Match invitations</h3><div className="invitation-list">{invites.filter(item => item.incoming && item.status === 'pending').map(item => <div key={item.id}><strong>@{item.sender_username}</strong><small>Room {item.room_code}</small><span><button onClick={() => void respond(item, 'accept')}>Accept</button><button onClick={() => void respond(item, 'decline')}>Decline</button></span></div>)}{!invites.some(item => item.incoming && item.status === 'pending') && <p>No pending invitations.</p>}</div></>}</div>}</div>
}

function MessengerApp({ username, playerId, enabled, directMessages, recipient, setRecipient, directText, setDirectText, directError, playerMatches, setPlayerMatches, sendDirectMessage, chatMessages, textMessage, setTextMessage, sendTextMessage }: { username?: string; playerId: string; enabled: boolean; directMessages: DirectMessage[]; recipient: string; setRecipient: (value: string) => void; directText: string; setDirectText: (value: string) => void; directError: string; playerMatches: PlayerSearchResult[]; setPlayerMatches: (value: PlayerSearchResult[]) => void; sendDirectMessage: (event: React.FormEvent) => Promise<void>; chatMessages: ChatMessage[]; textMessage: string; setTextMessage: (value: string) => void; sendTextMessage: (event: React.FormEvent) => void }) {
  const [tableOpen, setTableOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [presence, setPresence] = useState<{ online: boolean; typing: boolean; last_seen_at?: string | null }>({ online: false, typing: false })
  const contacts = Array.from(new Set(directMessages.map(message => message.sender_username === username ? message.recipient_username : message.sender_username)))
  const conversation = directMessages.filter(message => username && ((message.sender_username === username && message.recipient_username.toLowerCase() === recipient.toLowerCase()) || (message.recipient_username === username && message.sender_username.toLowerCase() === recipient.toLowerCase())))
  useEffect(() => {
    if (!chatOpen || !recipient) return
    void fetch(`${API_URL}/api/messages/read/${encodeURIComponent(recipient)}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken()}` } })
    const load = () => void fetch(`${API_URL}/api/players/${encodeURIComponent(recipient)}/presence`, { headers: { Authorization: `Bearer ${accessToken()}` } }).then(async response => { if (response.ok) setPresence(await response.json()) }).catch(() => undefined)
    load(); const timer = window.setInterval(load, 3000)
    return () => window.clearInterval(timer)
  }, [chatOpen, recipient])
  useEffect(() => {
    if (!chatOpen || !recipient) return
    const typing = Boolean(directText.trim())
    const timer = window.setTimeout(() => { void fetch(`${API_URL}/api/messages/typing`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_username: recipient, typing }) }) }, 250)
    return () => window.clearTimeout(timer)
  }, [chatOpen, directText, recipient])
  if (tableOpen) return <div className="whatsapp-shell"><div className="whatsapp-chat-title"><button type="button" onClick={() => setTableOpen(false)}><ArrowLeft size={18} /></button><span className="whatsapp-avatar"><Users size={16} /></span><div><strong>WHOT Table</strong><small>{enabled ? 'Match chat' : 'Waiting for match'}</small></div></div><div className="whatsapp-messages">{chatMessages.length ? chatMessages.map(message => <div key={message.id} className={`chat-bubble ${message.player_id === playerId ? 'chat-bubble-mine' : ''}`}><strong>{message.name}</strong><p>{message.text}</p><time>{new Date(message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>) : <div className="voice-empty"><MessageCircle size={20} /><span>No table messages yet</span></div>}</div><div className="voice-compose chat-compose"><form onSubmit={sendTextMessage}><input value={textMessage} maxLength={500} onChange={event => setTextMessage(event.target.value)} placeholder="Message the table" disabled={!enabled} /><button className="icon-button iphone-send" disabled={!enabled || !textMessage.trim()}><ArrowRight size={17} /></button></form></div></div>
  if (chatOpen && recipient) return <div className="whatsapp-shell"><div className="whatsapp-chat-title"><button type="button" onClick={() => { setChatOpen(false); setRecipient(''); setPlayerMatches([]) }}><ArrowLeft size={18} /></button><span className="whatsapp-avatar">{recipient.slice(0, 1).toUpperCase()}</span><div><strong>@{recipient}</strong><small>{presence.typing ? 'typing…' : presence.online ? 'Online' : presence.last_seen_at ? `Last seen ${new Date(presence.last_seen_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Offline'}</small></div></div><div className="whatsapp-messages">{conversation.length ? conversation.map(message => { const mine = message.sender_username === username; return <div key={message.id} className={`chat-bubble ${mine ? 'chat-bubble-mine' : ''}`}><p>{message.text}</p><time>{new Date(message.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{mine && <b className={message.read_at ? 'message-read' : ''}>{message.read_at ? '✓✓' : message.delivered_at ? '✓✓' : '✓'}</b>}</time></div> }) : <div className="voice-empty"><MessageCircle size={20} /><span>Start your chat with @{recipient}</span></div>}</div><div className="voice-compose chat-compose direct-compose"><form onSubmit={sendDirectMessage}><input autoFocus value={directText} maxLength={500} onChange={event => setDirectText(event.target.value)} placeholder={`Message @${recipient}`} /><button className="icon-button iphone-send" disabled={!directText.trim()}><ArrowRight size={17} /></button></form>{directError && <span className="voice-error">{directError}</span>}</div></div>
  return <div className="whatsapp-shell whatsapp-list"><div className="whatsapp-search"><MessageCircle size={15} /><input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Search a username" aria-label="Search players" /></div>{playerMatches.length > 0 && <div className="whatsapp-search-results">{playerMatches.map(player => <button key={player.id} onClick={() => { setRecipient(player.username); setPlayerMatches([]); setChatOpen(true) }}><span className="whatsapp-avatar">{player.username.slice(0, 1).toUpperCase()}</span><strong>@{player.username}</strong><small>Start chat</small></button>)}</div>}<div className="whatsapp-contact-list">{playerId && <button onClick={() => setTableOpen(true)}><span className="whatsapp-avatar table"><Users size={17} /></span><div><strong>WHOT Table</strong><small>Chat with players in your match</small></div><ArrowRight size={15} /></button>}{contacts.map(contact => { const latest = [...directMessages].reverse().find(message => message.sender_username === contact || message.recipient_username === contact); const unreadCount = directMessages.filter(message => message.sender_username === contact && message.recipient_username === username && !message.read_at).length; return <button key={contact} onClick={() => { setRecipient(contact); setChatOpen(true) }}><span className="whatsapp-avatar">{contact.slice(0, 1).toUpperCase()}</span><div><strong>@{contact}</strong><small>{latest?.text || 'Tap to chat'}</small></div><time>{latest ? new Date(latest.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}{unreadCount > 0 && <b className="conversation-unread">{Math.min(unreadCount, 99)}</b>}</time></button> })}{!contacts.length && !playerId && <div className="voice-empty"><MessageCircle size={21} /><span>No chats yet</span><small>Search a username to start talking.</small></div>}</div></div>
}

function VoicePanel({ messages, chatMessages, playerId, enabled, players, balance, wager, pot, username, roomCode }: { messages: VoiceMessage[]; chatMessages: ChatMessage[]; playerId: string; enabled: boolean; players: Player[]; balance: number; wager: number; pot: number; username?: string; roomCode?: string }) {
  const { voiceUrls, requestVoice, send } = useArena()
  const [notification, setNotification] = useState('')
  const [open, setOpen] = useState(false)
  const [textMessage, setTextMessage] = useState('')
  const [unread, setUnread] = useState(0)
  const [phoneApp, setPhoneApp] = useState<'home' | 'messenger' | 'bank' | 'settings' | 'snooker'>('home')
  const [phoneMusic, setPhoneMusic] = useState(backgroundMusicEnabled)
  const [phoneSounds, setPhoneSounds] = useState(gameSoundsEnabled)
  const [phoneTheme, setPhoneTheme] = useState<ColorTheme>(preferredTheme)
  const [messageMode, setMessageMode] = useState<'direct' | 'table'>(username ? 'direct' : 'table')
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([])
  const [recipient, setRecipient] = useState('')
  const [directText, setDirectText] = useState('')
  const [directError, setDirectError] = useState('')
  const [playerMatches, setPlayerMatches] = useState<PlayerSearchResult[]>([])
  const [updateReady, setUpdateReady] = useState(true)
  const previousMessageCountRef = useRef(messages.length)
  const previousChatCountRef = useRef(chatMessages.length)
  const directMessageIdsRef = useRef<Set<number> | null>(null)

  useEffect(() => {
    const openTableChat = () => {
      setOpen(true)
      setPhoneApp('messenger')
      setMessageMode('table')
    }
    window.addEventListener('whot-open-table-chat', openTableChat)
    return () => window.removeEventListener('whot-open-table-chat', openTableChat)
  }, [])

  useEffect(() => {
    const syncSounds = (event: Event) => {
      setPhoneSounds((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener('whot-sounds-change', syncSounds)
    return () => window.removeEventListener('whot-sounds-change', syncSounds)
  }, [])

  useEffect(() => {
    if (!username) return
    let active = true
    const load = () => fetch(`${API_URL}/api/messages?limit=100`, { headers: { Authorization: `Bearer ${accessToken()}` } })
      .then(async response => { if (response.ok && active) { const next = await response.json() as DirectMessage[]; const known = directMessageIdsRef.current; if (known && next.some(message => !known.has(message.id) && message.recipient_username === username)) { playGameSound('join'); setUnread(previous => previous + 1) } directMessageIdsRef.current = new Set(next.map(message => message.id)); setDirectMessages(next) } })
      .catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [username])

  useEffect(() => {
    if (!username || recipient.trim().length < 2) { setPlayerMatches([]); return }
    const timer = window.setTimeout(() => {
      void fetch(`${API_URL}/api/players/search?q=${encodeURIComponent(recipient.trim())}`, { headers: { Authorization: `Bearer ${accessToken()}` } })
        .then(async response => { if (response.ok) setPlayerMatches(await response.json() as PlayerSearchResult[]) })
        .catch(() => undefined)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [recipient, username])

  useEffect(() => {
    if (messages.length > previousMessageCountRef.current) {
      const latest = messages[messages.length - 1]
      setNotification(`New voice note from ${latest.name}`)
      if ((!open || phoneApp !== 'messenger') && latest.player_id !== playerId) setUnread(previous => previous + 1)
      playGameSound('join')
      const timer = window.setTimeout(() => setNotification(''), 3500)
      previousMessageCountRef.current = messages.length
      return () => window.clearTimeout(timer)
    }
    previousMessageCountRef.current = messages.length
  }, [messages, open, phoneApp, playerId])

  useEffect(() => {
    if (chatMessages.length > previousChatCountRef.current) {
      const latest = chatMessages[chatMessages.length - 1]
      if ((!open || phoneApp !== 'messenger') && latest.player_id !== playerId) {
        setUnread(previous => previous + 1)
        playGameSound('join')
      }
    }
    previousChatCountRef.current = chatMessages.length
  }, [chatMessages, open, phoneApp, playerId])

  function sendTextMessage(event: React.FormEvent) {
    event.preventDefault()
    const text = textMessage.trim()
    if (!text) return
    send('chat', { text })
    setTextMessage('')
  }

  async function sendDirectMessage(event: React.FormEvent) {
    event.preventDefault()
    if (!recipient.trim() || !directText.trim()) return
    setDirectError('')
    try {
      const response = await fetch(`${API_URL}/api/messages`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_username: recipient.trim(), text: directText.trim() }) })
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not send message')
      const message = await response.json() as DirectMessage
      setDirectMessages(previous => [...previous, message])
      setDirectText('')
    } catch (error) { setDirectError(error instanceof Error ? error.message : 'Could not send message') }
  }

  function toggleChat() {
    setOpen(previous => !previous)
    if (!open) setPhoneApp('home')
  }

  function openPhoneApp(app: 'home' | 'messenger' | 'bank' | 'settings' | 'snooker') {
    setPhoneApp(app)
    if (app === 'messenger') setUnread(0)
  }

  const feed = [
    ...chatMessages.map(message => ({ kind: 'text' as const, sent_at: message.sent_at, message })),
    ...messages.map(message => ({ kind: 'voice' as const, sent_at: message.sent_at, message })),
  ].sort((a, b) => a.sent_at - b.sent_at)
  const phoneTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const lagosNow = new Date()
  const phoneHomeTime = lagosNow.toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: false })
  const phoneHomeDate = lagosNow.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' })

  const appTitle = phoneApp === 'home' ? 'WHOT Phone' : phoneApp === 'messenger' ? 'WhatsApp' : phoneApp === 'bank' ? 'Arena Bank' : phoneApp === 'settings' ? 'Game Settings' : 'Snooker'
  return createPortal(<div className="table-chat-shell">
    <button type="button" className={`chat-fab ${open ? 'chat-fab-open' : ''}`} onClick={toggleChat} aria-label={open ? 'Close game phone' : 'Open game phone'}>{open ? <X size={21} /> : <><Smartphone size={22} />{unread > 0 && <span>{Math.min(unread, 9)}</span>}</>}</button>
    {open && <aside className="table-chat-phone" aria-label="WHOT game phone">
      <div className="iphone-screen">
        <div className="iphone-statusbar" aria-hidden="true"><strong>{phoneTime}</strong><span className="iphone-island" /><span className="iphone-signals"><Signal size={12} fill="currentColor" /><Wifi size={13} /><BatteryFull size={16} /></span></div>
        {phoneApp === 'messenger' && <MessengerApp username={username} playerId={playerId} enabled={enabled} directMessages={directMessages} recipient={recipient} setRecipient={setRecipient} directText={directText} setDirectText={setDirectText} directError={directError} playerMatches={playerMatches} setPlayerMatches={setPlayerMatches} sendDirectMessage={sendDirectMessage} chatMessages={chatMessages} textMessage={textMessage} setTextMessage={setTextMessage} sendTextMessage={sendTextMessage} />}
        {phoneApp === 'messenger' && <SocialOverlay recipient={recipient} roomCode={roomCode} />}
        {phoneApp !== 'home' && <div className={`iphone-chat-header ${phoneApp === 'messenger' ? 'whatsapp-header' : ''}`}><button type="button" className="icon-button iphone-back" onClick={() => openPhoneApp('home')} aria-label="Phone home"><ArrowLeft size={19} /></button><span className="iphone-contact">{phoneApp === 'messenger' ? <MessageCircle size={17} /> : phoneApp === 'bank' ? <Wallet size={17} /> : phoneApp === 'settings' ? <Settings size={17} /> : <span className="snooker-header-eight">8</span>}</span><div><strong>{appTitle}</strong><small><span /> {phoneApp === 'messenger' ? notification || `${players.filter(player => player.connected && !player.is_bot).length} players online` : phoneApp === 'snooker' ? 'Local two-player frame' : 'WHOT Arena'}</small></div><button type="button" className="icon-button" onClick={toggleChat} aria-label="Close phone"><X size={17} /></button></div>}
        {phoneApp === 'home' && <div className="phone-home phone-home-wallpaper" style={{ backgroundImage: `linear-gradient(180deg, #06291e59 0%, #0821181f 48%, #061a12a8 100%), url(${lagosPhoneWallpaper})` }}><button type="button" className="phone-home-close" onClick={toggleChat} aria-label="Close phone"><X size={16} /></button><div className="phone-home-clock"><strong>{phoneHomeTime}</strong><span>{phoneHomeDate} · Lagos</span><small>{phoneTheme === 'dark' ? '🌙 Night mode' : '☀️ Day mode'}</small></div>{updateReady && <div className="phone-update-card"><span>✨</span><div><strong>A new update is ready</strong><small>Fresh Arena improvements available</small></div><button type="button" onClick={() => setUpdateReady(false)}>Refresh</button></div>}<div className="phone-app-grid floating-apps"><button onClick={() => openPhoneApp('bank')}><span className="phone-app-icon bank"><Wallet size={23} /></span><strong>Bank</strong></button><button onClick={() => openPhoneApp('messenger')}><span className="phone-app-icon messenger"><MessageCircle size={23} />{unread > 0 && <i>{Math.min(unread, 9)}</i>}</span><strong>WhatsApp</strong></button><button onClick={() => openPhoneApp('settings')}><span className="phone-app-icon settings"><Settings size={23} /></span><strong>Settings</strong></button><button type="button" className="snooker-app-launch" onClick={() => openPhoneApp('snooker')} aria-label="Open Snooker"><span className="phone-app-icon snooker"><b>8</b></span><strong>Snooker</strong></button></div><div className="phone-home-dock"><span><Gamepad2 size={18} /></span><strong>WHOT Arena</strong><small>{players.find(player => player.id === playerId)?.name || username || 'Player'}</small></div></div>}
        {phoneApp === 'snooker' && <SnookerGame />}
        {phoneApp === 'messenger' && <div className="phone-messenger">{username && <div className="messenger-tabs"><button className={messageMode === 'direct' ? 'active' : ''} onClick={() => setMessageMode('direct')}>Direct messages</button><button className={messageMode === 'table' ? 'active' : ''} onClick={() => setMessageMode('table')} disabled={!playerId}>Table chat</button></div>}{messageMode === 'direct' && username ? <><div className="direct-recipient"><input value={recipient} maxLength={24} onChange={event => setRecipient(event.target.value)} placeholder="Player username" aria-label="Recipient username" />{playerMatches.length > 0 && <div>{playerMatches.slice(0, 4).map(player => <button key={player.id} onClick={() => { setRecipient(player.username); setPlayerMatches([]) }}>@{player.username}</button>)}</div>}</div><div className="voice-feed chat-feed direct-feed" aria-live="polite">{directMessages.length ? directMessages.map(message => { const mine = message.sender_username === username; return <div className={`chat-bubble ${mine ? 'chat-bubble-mine' : ''}`} key={`direct-${message.id}`}><div className="voice-message-meta"><strong>{mine ? `To @${message.recipient_username}` : `@${message.sender_username}`}</strong><time>{new Date(message.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{message.text}</p></div> }) : <div className="voice-empty"><MessageCircle size={19} /><span>No direct messages yet.</span><small>Enter a username to start a conversation.</small></div>}</div><div className="voice-compose chat-compose direct-compose"><form onSubmit={sendDirectMessage}><input value={directText} maxLength={500} onChange={event => setDirectText(event.target.value)} placeholder={recipient ? `Message @${recipient}` : 'Choose a username first'} aria-label="Direct message" disabled={!recipient.trim()} /><button type="submit" className="icon-button iphone-send" disabled={!recipient.trim() || !directText.trim()} aria-label="Send direct message"><ArrowRight size={17} /></button></form>{directError && <span className="voice-error">{directError}</span>}</div></> : <><div className="iphone-chat-date">Table</div><div className="voice-feed chat-feed" aria-live="polite">{feed.length ? feed.map(item => item.kind === 'text' ? <div className={`chat-bubble ${item.message.player_id === playerId ? 'chat-bubble-mine' : ''}`} key={`text-${item.message.id}`}><div className="voice-message-meta"><strong>{item.message.name}</strong><time>{new Date(item.message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{item.message.text}</p></div> : <div className={`voice-message ${item.message.player_id === playerId ? 'chat-bubble-mine' : ''}`} key={`voice-${item.message.id}`}><div className="voice-message-meta"><strong>{item.message.name}</strong><time>{new Date(item.message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>{voiceUrls[item.message.id] ? <audio controls preload="none" src={voiceUrls[item.message.id]} aria-label={`Voice message from ${item.message.name}`} /> : <button className="voice-play" onClick={() => requestVoice(item.message.id)}><Volume2 size={14} /> Listen <span>{Math.max(1, Math.round(item.message.size / 16_000))} KB</span></button>}</div>) : <div className="voice-empty"><MessageCircle size={19} /><span>No table messages yet.</span><small>{enabled ? 'Say hello to the table.' : 'Table chat opens when the match starts.'}</small></div>}</div><div className="voice-compose chat-compose"><form onSubmit={sendTextMessage}><input value={textMessage} maxLength={500} onChange={event => setTextMessage(event.target.value)} placeholder={enabled ? 'Message the table' : 'Available when match starts'} aria-label="Message the table" disabled={!enabled} /><button type="submit" className="icon-button iphone-send" disabled={!enabled || !textMessage.trim()} aria-label="Send message"><ArrowRight size={17} /></button></form></div></>}</div>}
        {phoneApp === 'bank' && <div className="phone-bank"><span className="phone-bank-mark">₦</span><small>TOTAL VIRTUAL NAIRA</small><strong>₦{balance.toLocaleString()}</strong><div><span>Current stake<b>{wager ? `₦${wager.toLocaleString()}` : 'Free match'}</b></span><span>Table pot<b>{pot ? `₦${pot.toLocaleString()}` : 'No pot'}</b></span></div><p>Virtual Naira has no cash value and cannot be purchased, transferred, or withdrawn.</p></div>}
        {phoneApp === 'settings' && <div className="phone-settings"><label className="toggle-row"><span><strong>Background music</strong><small>Game soundtrack</small></span><input type="checkbox" checked={phoneMusic} onChange={event => { setPhoneMusic(event.target.checked); setBackgroundMusicEnabled(event.target.checked) }} /></label><label className="toggle-row"><span><strong>Game sounds</strong><small>Cards, turns, and taps</small></span><input type="checkbox" checked={phoneSounds} onChange={event => { setPhoneSounds(event.target.checked); updateGameSoundsEnabled(event.target.checked) }} /></label><div className="phone-theme"><span>COLOR MODE</span><button className={phoneTheme === 'light' ? 'active' : ''} onClick={() => { setPhoneTheme('light'); applyColorTheme('light') }}><Sun size={16} /> Light</button><button className={phoneTheme === 'dark' ? 'active' : ''} onClick={() => { setPhoneTheme('dark'); applyColorTheme('dark') }}><Moon size={16} /> Dark</button></div></div>}
        <span className="iphone-homebar" aria-hidden="true" />
      </div>
    </aside>}
  </div>, document.body)
}

function Profile() {
  const { user, updateUser } = useArena()
  const [profile, setProfile] = useState<User | null>(user)
  const [status, setStatus] = useState('')
  const [usernameDraft, setUsernameDraft] = useState(user?.username || '')
  const [savingUsername, setSavingUsername] = useState(false)
  useEffect(() => {
    const token = accessToken()
    if (!token) return
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } }).then(async response => {
      if (!response.ok) throw new Error('Sign in to view your account profile.')
      const result = await response.json() as User
      setProfile(result)
      setUsernameDraft(result.username)
      updateUser(result)
    }).catch(error => setStatus(error instanceof Error ? error.message : 'Profile unavailable'))
  }, [updateUser])
  async function saveUsername(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || savingUsername) return
    const username = usernameDraft.trim()
    setSavingUsername(true)
    setStatus('')
    try {
      const response = await fetch(`${API_URL}/api/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not update your username')
      const result = await response.json() as User
      setProfile(result)
      setUsernameDraft(result.username)
      updateUser(result)
      setStatus('Your username was updated.')
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Could not update your username')
    } finally {
      setSavingUsername(false)
    }
  }
  async function saveCosmetics(field: 'theme' | 'card_back' | 'avatar', value: string) {
    if (!profile) return
    setStatus('Saving your Arena style…')
    const payload = { theme: profile.selected_theme, card_back: profile.selected_card_back, avatar: profile.selected_avatar, [field]: value }
    try {
      const response = await fetch(`${API_URL}/api/profile/cosmetics`, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not save cosmetics')
      const result = await response.json() as User
      setProfile(result); updateUser(result); setStatus('Arena style saved.')
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : 'Could not save cosmetics') }
  }
  const xpInLevel = (profile?.xp || 0) % 500
  const achievementNames: Record<string, string> = { first_win: 'First Victory', hot_streak: 'Hot Streak', arena_regular: 'Arena Regular', level_five: 'Level Five' }
  return <><PageTitle eyebrow="PLAYER PROGRESSION" title={profile?.username || 'Your player card'} detail="Play matches, earn XP, build streaks, and unlock your Arena style." />
    <section className="profile-panel content-panel"><Avatar name={profile?.username || 'Guest player'} avatar={profile?.selected_avatar} className={`profile-avatar avatar-cosmetic-${profile?.selected_avatar || 'initial'}`} /><div className="profile-main"><span className="small-label">LEVEL {profile?.level || 1} ARENA PLAYER</span><h2>{profile?.username || 'Guest player'}</h2><p>{profile?.email || 'Sign in to save progression and unlock cosmetics.'}</p><div className="xp-track"><span style={{ width: `${xpInLevel / 5}%` }} /><small>{xpInLevel} / 500 XP to next level</small></div><div className="profile-stats"><div><strong>{profile?.wins ?? '—'}</strong><span>Wins</span></div><div><strong>{profile?.win_streak ?? '—'}</strong><span>Current streak</span></div><div><strong>{profile?.best_win_streak ?? '—'}</strong><span>Best streak</span></div><div><strong>{profile?.xp ?? '—'}</strong><span>Total XP</span></div></div></div>{!profile && <Link className="button button-green" to="/login">Sign in <ArrowRight size={15} /></Link>}</section>
    {profile && <section className="content-panel profile-edit-panel"><div><span className="small-label">ACCOUNT DETAILS</span><h2>Edit your username</h2><p>Your username appears on your Arena profile and player listings.</p></div><form onSubmit={event => void saveUsername(event)}><label className="field-label">Username<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={usernameDraft} onChange={event => setUsernameDraft(event.target.value)} aria-describedby="profile-username-hint" /></label><small id="profile-username-hint">3–24 letters, numbers, or underscores.</small><button type="submit" className="button button-green" disabled={savingUsername || usernameDraft.trim() === profile.username}>{savingUsername ? 'Saving…' : 'Save username'}</button></form></section>}
    {profile && <div className="progression-grid"><section className="content-panel achievement-panel"><span className="small-label">ACHIEVEMENTS</span><h2>Your trophy shelf</h2><div className="achievement-list">{Object.entries(achievementNames).map(([id, label]) => <span className={profile.achievements.includes(id) ? 'achievement-earned' : ''} key={id}><Trophy size={16} /><strong>{label}</strong><small>{profile.achievements.includes(id) ? 'Earned' : 'Locked'}</small></span>)}</div></section><section className="content-panel cosmetic-panel"><span className="small-label">UNLOCKABLE STYLE</span><h2>Equip your rewards</h2><label>Table theme<select value={profile.selected_theme} onChange={event => void saveCosmetics('theme', event.target.value)}>{profile.unlocked_themes.map(item => <option key={item}>{item}</option>)}</select></label><label>Card back<select value={profile.selected_card_back} onChange={event => void saveCosmetics('card_back', event.target.value)}>{profile.unlocked_card_backs.map(item => <option key={item}>{item}</option>)}</select></label><fieldset className="avatar-picker"><legend>Avatar</legend><div className="avatar-choices">{profile.unlocked_avatars.map(item => <button type="button" key={item} className="avatar-choice" aria-label={avatarNames[item] || item} aria-pressed={profile.selected_avatar === item} onClick={() => void saveCosmetics('avatar', item)}><Avatar name={profile.username} avatar={item} className="avatar-choice-image" /><span>{avatarNames[item] || item}</span></button>)}</div></fieldset><p>New rewards unlock at levels 2, 3, 4, and 5.</p></section></div>}
    {status && <div className="info-banner"><Shield size={16} />{status}</div>}</>
}

function HistoryPage() {
  const { user } = useArena()
  const [matches, setMatches] = useState<MatchHistory[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  const [error, setError] = useState('')
  useEffect(() => {
    const token = accessToken()
    if (!token) return
    fetch(`${API_URL}/api/history?limit=50`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (!response.ok) throw new Error('Could not load match history'); setMatches(await response.json() as MatchHistory[]) })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'History unavailable'))
      .finally(() => setLoading(false))
  }, [])
  return <><PageTitle eyebrow="MATCH ARCHIVE" title="Your game history." detail="A look back at the rounds that made your stats." />{!user ? <section className="history-empty content-panel"><div className="history-icon"><History size={26} /></div><span className="small-label">PLAYER ACCOUNT REQUIRED</span><h2>Sign in to see your matches.</h2><p>Only completed matches played while signed in are associated with your profile.</p><Link className="button button-green" to="/login">Sign in <LogIn size={15} /></Link></section> : loading ? <div className="table-empty">Loading your matches…</div> : error ? <div role="alert" className="info-banner">{error}</div> : matches.length ? <section className="leaderboard content-panel history-table"><div className="leaderboard-head history-head"><span>ROOM</span><span>PLAYERS</span><span>RESULT</span><span>COMPLETED</span></div>{matches.map((match, index) => <div className="leaderboard-row history-row" key={`${match.room_code}-${match.completed_at}-${index}`}><strong className="history-code">{match.room_code}</strong><span>{match.player_count}</span><strong className={match.result === 'win' ? 'history-win' : 'history-loss'}>{match.result.toUpperCase()}</strong><time>{new Date(match.completed_at).toLocaleDateString()}</time></div>)}</section> : <section className="history-empty content-panel"><div className="history-icon"><History size={26} /></div><span className="small-label">NO MATCHES YET</span><h2>Your first round is waiting.</h2><p>Matches played while signed in will appear here after the game is complete.</p><Link className="button button-green" to="/create">Start a game <ArrowRight size={15} /></Link></section>}</>
}

function Leaderboard() {
  const [players, setPlayers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${API_URL}/api/leaderboard?limit=50`).then(async response => { if (!response.ok) throw new Error('Leaderboard unavailable'); setPlayers(await response.json() as User[]) }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load leaderboard')).finally(() => setLoading(false)) }, [])
  return <><PageTitle eyebrow="ARENA RANKINGS" title="The leaderboard." detail="Wins first. Every completed match counts." action={<span className="live-label"><span className="status-dot online" /> LIVE STATS</span>} /><section className="leaderboard content-panel"><div className="leaderboard-head"><span>RANK / PLAYER</span><span>MATCHES</span><span>WINS</span><span>WIN RATE</span></div>{loading ? <div className="table-empty">Loading player standings…</div> : error ? <div role="alert" className="table-empty">{error}</div> : players.length ? players.map((player, index) => <div className="leaderboard-row" key={player.id}><div className="rank-player"><span className={`rank-number ${index < 3 ? `rank-${index + 1}` : ''}`}>{String(index + 1).padStart(2, '0')}</span><span className="avatar rank-avatar">{player.username.slice(0, 1).toUpperCase()}</span><strong>{player.username}</strong>{index === 0 && <Crown size={15} className="host-crown" />}</div><span>{player.matches_played}</span><strong>{player.wins}</strong><span>{player.matches_played ? `${Math.round(player.wins / player.matches_played * 100)}%` : '—'}</span></div>) : <div className="table-empty">No ranked players yet. Sign in and win your first match.</div>}<div className="leaderboard-foot"><Shield size={14} /> Guest matches do not contribute to player rankings.</div></section></>
}

type AdminOverview = { users: number; active_rooms: number; active_players: number; completed_matches: number; admin_fees: number; rooms: Array<{ code: string; status: string; players: number; wager: number; pot: number }> }
function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${API_URL}/api/admin/overview`, { headers: { Authorization: `Bearer ${accessToken()}` } }).then(async response => { if (!response.ok) throw new Error((await response.json()).detail || 'Admin dashboard unavailable'); setOverview(await response.json() as AdminOverview) }).catch(reason => setError(reason instanceof Error ? reason.message : 'Admin dashboard unavailable')) }, [])
  return <><PageTitle eyebrow="ARENA ADMINISTRATION" title="Admin dashboard." detail="Live platform activity and Virtual Naira fee totals." />{error ? <div className="info-banner"><Shield size={16} />{error}</div> : !overview ? <div className="table-empty">Loading administrator data…</div> : <><div className="stats-row"><div className="stat-card"><span className="stat-label">USERS</span><strong>{overview.users}</strong></div><div className="stat-card"><span className="stat-label">ACTIVE ROOMS</span><strong>{overview.active_rooms}</strong></div><div className="stat-card"><span className="stat-label">ONLINE PLAYERS</span><strong>{overview.active_players}</strong></div><div className="stat-card"><span className="stat-label">ADMIN FEES</span><strong>₦{overview.admin_fees.toLocaleString()}</strong></div></div><section className="leaderboard content-panel"><div className="leaderboard-head"><span>ROOM</span><span>STATUS</span><span>PLAYERS</span><span>POT</span></div>{overview.rooms.length ? overview.rooms.map(room => <div className="leaderboard-row" key={room.code}><strong>{room.code}</strong><span>{room.status.toUpperCase()}</span><span>{room.players}</span><strong>₦{room.pot.toLocaleString()}</strong></div>) : <div className="table-empty">No active rooms right now.</div>}</section></>}</>
}

type AdminUser = { id: number; username: string; email: string; arena_coins: number; matches_played: number; wins: number; is_admin: boolean }
type AdminUsersPage = { items: AdminUser[]; total: number }
type AdminWalletEntry = { id: number; admin: string; action: 'fund' | 'debit'; amount: number; balance_after: number; reason: string; created_at: string }

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem('whot.token')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  const data = await response.json().catch(() => ({})) as { detail?: string } & T
  if (!response.ok) throw new Error(data.detail || `Admin request failed (${response.status})`)
  return data
}

function AdminDashboardFull() {
  return <><AdminDashboard /><AdminRulesManagement /><AdminAccountManagement /></>
}

function AdminRulesManagement() {
  const [rules, setRules] = useState<GameRules | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    adminRequest<GameRules>('/api/admin/rules')
      .then(result => { if (active) setRules(result) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load game rules') })
    return () => { active = false }
  }, [])

  async function saveRules() {
    if (!rules) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const saved = await adminRequest<GameRules>('/api/admin/rules', {
        method: 'PUT',
        body: JSON.stringify(rules),
      })
      setRules(saved)
      setNotice('Default game rules saved. They will apply to new tables and quick matches.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save game rules')
    } finally {
      setBusy(false)
    }
  }

  return <section className="content-panel admin-rules-panel">
    <div><span className="small-label">GAME CONFIGURATION</span><h2>Default house rules</h2><p>These server-side defaults apply to quick matches and new players’ rule forms. Existing games keep their current rules.</p></div>
    {error && <div role="alert" className="info-banner">{error}</div>}
    {notice && <div role="status" className="info-banner">{notice}</div>}
    {!rules ? <div className="table-empty">Loading game rules…</div> : <RulesEditor rules={rules} onChange={setRules} disabled={busy} />}
    <button type="button" className="button button-green" disabled={!rules || !isValidGameRules(rules) || busy} onClick={() => void saveRules()}>{busy ? 'Saving rules…' : 'Save default rules'}</button>
  </section>
}

function AdminAccountManagement() {
  const pageSize = 25
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [walletAction, setWalletAction] = useState<{ user: AdminUser; action: 'fund' | 'debit' } | null>(null)
  const [walletAmount, setWalletAmount] = useState('')
  const [walletReason, setWalletReason] = useState('')
  const [historyUser, setHistoryUser] = useState<AdminUser | null>(null)
  const [walletHistory, setWalletHistory] = useState<AdminWalletEntry[]>([])
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    const params = new URLSearchParams({ q: search.trim(), limit: String(pageSize), offset: String(page * pageSize) })
    adminRequest<AdminUsersPage>(`/api/admin/users?${params}`)
      .then(data => {
        if (!active) return
        setUsers(data.items)
        setUserTotal(data.total)
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load accounts') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, page, revision])

  function closeActions() {
    setEditing(null)
    setWalletAction(null)
    setHistoryUser(null)
    setWalletHistory([])
    setPendingDelete(null)
  }

  async function saveUser() {
    if (!editing) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await adminRequest(`/api/admin/users/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ username: editUsername, email: editEmail }),
      })
      setEditing(null)
      setNotice('Account details updated.')
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update account')
    } finally {
      setBusy(false)
    }
  }

  async function adjustWallet() {
    if (!walletAction) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await adminRequest<{ message: string }>(`/api/admin/users/${walletAction.user.id}/${walletAction.action}`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(walletAmount), reason: walletReason }),
      })
      setNotice(result.message)
      setWalletAction(null)
      setWalletAmount('')
      setWalletReason('')
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not adjust account balance')
    } finally {
      setBusy(false)
    }
  }

  async function showHistory(user: AdminUser) {
    setError('')
    setHistoryUser(user)
    try {
      setWalletHistory(await adminRequest<AdminWalletEntry[]>(`/api/admin/users/${user.id}/wallet-history`))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load wallet history')
    }
  }

  async function deleteAccount() {
    if (!pendingDelete) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await adminRequest(`/api/admin/users/${pendingDelete.id}`, { method: 'DELETE' })
      setNotice(`${pendingDelete.username}'s account was deleted and anonymized.`)
      setPendingDelete(null)
      if (page > 0 && userTotal - 1 <= page * pageSize) setPage(value => value - 1)
      setUserTotal(value => Math.max(0, value - 1))
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete account')
    } finally {
      setBusy(false)
    }
  }

  return <section className="leaderboard content-panel admin-accounts">
    <div className="admin-section-heading"><div><span className="small-label">ACCOUNT MANAGEMENT</span><h2>Player accounts</h2><p>Update account details, manage Virtual Naira, and remove accounts.</p></div><strong>{userTotal.toLocaleString()} accounts</strong></div>
    {error && <div role="alert" className="info-banner">{error}<button type="button" className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {notice && <div role="status" className="info-banner">{notice}<button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    <label className="field-label admin-search">Search accounts<input type="search" value={search} placeholder="Username or email" onChange={event => { setSearch(event.target.value); setPage(0); closeActions() }} /></label>
    <div className="admin-account-scroll">
      <div className="admin-account-header"><span>PLAYER</span><span>ID</span><span>BALANCE</span><span>RECORD</span><span>ADMIN ACTIONS</span></div>
      {loading ? <div className="table-empty">Loading accounts…</div> : !users.length ? <div className="table-empty">No accounts match your search.</div> : users.map(user => <div className="admin-account-entry" key={user.id}>
        <div className="admin-account-row">
          <div className="admin-account-player"><strong>{user.username}</strong><small>{user.email}</small></div>
          <span>#{user.id}</span>
          <strong>₦{user.arena_coins.toLocaleString()}</strong>
          <span>{user.wins} wins · {user.matches_played} matches</span>
          <div className="admin-account-actions">
            <button type="button" className="button button-outline" disabled={user.is_admin || busy} onClick={() => { setEditing(user); setEditUsername(user.username); setEditEmail(user.email); setWalletAction(null); setHistoryUser(null); setPendingDelete(null) }}>Edit</button>
            <button type="button" className="button button-outline" disabled={user.is_admin || busy} onClick={() => { setWalletAction({ user, action: 'fund' }); setWalletAmount(''); setWalletReason(''); setEditing(null); setHistoryUser(null); setPendingDelete(null) }}>Fund</button>
            <button type="button" className="button button-outline" disabled={user.is_admin || busy} onClick={() => { setWalletAction({ user, action: 'debit' }); setWalletAmount(''); setWalletReason(''); setEditing(null); setHistoryUser(null); setPendingDelete(null) }}>Debit</button>
            <button type="button" className="button button-outline" disabled={user.is_admin || busy} onClick={() => void showHistory(user)}>History</button>
            <button type="button" className="button button-danger" disabled={user.is_admin || busy} onClick={() => { setPendingDelete(user); setEditing(null); setWalletAction(null); setHistoryUser(null) }}>Delete</button>
            {user.is_admin && <small className="admin-protected-label">Protected</small>}
          </div>
        </div>
        {editing?.id === user.id && <form className="admin-action-panel" onSubmit={event => { event.preventDefault(); void saveUser() }}>
          <strong>Edit {user.username}</strong>
          <label className="field-label">Username<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={editUsername} onChange={event => setEditUsername(event.target.value)} /></label>
          <label className="field-label">Email<input required type="email" maxLength={320} value={editEmail} onChange={event => setEditEmail(event.target.value)} /></label>
          <div className="admin-action-buttons"><button className="button button-green" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button><button type="button" className="button button-outline" onClick={closeActions}>Cancel</button></div>
        </form>}
        {walletAction?.user.id === user.id && <form className="admin-action-panel" onSubmit={event => { event.preventDefault(); void adjustWallet() }}>
          <strong>{walletAction.action === 'fund' ? 'Fund' : 'Debit'} {user.username}</strong>
          <label className="field-label">Amount in Virtual Naira<input required type="number" min="1" max="1000000" step="1" value={walletAmount} onChange={event => setWalletAmount(event.target.value)} /></label>
          <label className="field-label">Reason<input required minLength={3} maxLength={200} value={walletReason} onChange={event => setWalletReason(event.target.value)} placeholder="Add an audit note" /></label>
          <div className="admin-action-buttons"><button className="button button-green" disabled={busy}>{busy ? 'Processing…' : `Confirm ${walletAction.action}`}</button><button type="button" className="button button-outline" onClick={closeActions}>Cancel</button></div>
        </form>}
        {historyUser?.id === user.id && <div className="admin-action-panel"><strong>Wallet history · {user.username}</strong>{walletHistory.length ? <div className="admin-history-list">{walletHistory.map(entry => <div className="admin-history-row" key={entry.id}><span>{new Date(entry.created_at).toLocaleString()}</span><strong>{entry.action.toUpperCase()} ₦{entry.amount.toLocaleString()}</strong><span>Balance ₦{entry.balance_after.toLocaleString()}</span><small>{entry.reason} · by {entry.admin}</small></div>)}</div> : <p>No administrator wallet adjustments recorded.</p>}<button type="button" className="button button-outline" onClick={closeActions}>Close history</button></div>}
        {pendingDelete?.id === user.id && <div className="admin-action-panel admin-delete-confirm" role="alertdialog" aria-labelledby={`delete-account-heading-${user.id}`} aria-describedby={`delete-account-description-${user.id}`}><strong id={`delete-account-heading-${user.id}`}>Delete {user.username}?</strong><p id={`delete-account-description-${user.id}`}>This removes account access and anonymizes their details while retaining historical match records. This action cannot be undone.</p><div className="admin-action-buttons"><button type="button" className="button button-danger" disabled={busy} onClick={() => void deleteAccount()}>{busy ? 'Deleting…' : 'Delete account'}</button><button type="button" className="button button-outline" disabled={busy} onClick={closeActions}>Cancel</button></div></div>}
      </div>)}
    </div>
    <div className="admin-pagination"><span>Showing {userTotal ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, userTotal)} of {userTotal}</span><div><button type="button" className="button button-outline" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className="button button-outline" disabled={(page + 1) * pageSize >= userTotal || loading} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
  </section>
}

function SettingsPage() {
  const { user } = useArena()
  const [nickname, setNickname] = useState(localStorage.getItem('whot.nickname') || user?.username || 'Guest')
  const [sound, setSound] = useState(gameSoundsEnabled)
  const [music, setMusic] = useState(backgroundMusicEnabled)
  const [theme, setTheme] = useState<ColorTheme>(preferredTheme)
  const [saved, setSaved] = useState(false)
  function save() { localStorage.setItem('whot.nickname', nickname.slice(0, 20)); setSaved(true); window.setTimeout(() => setSaved(false), 2200) }
  function toggleSound(enabled: boolean) { setSound(enabled); updateGameSoundsEnabled(enabled); if (enabled) playGameSound('preview') }
  function toggleMusic(enabled: boolean) { setMusic(enabled); setBackgroundMusicEnabled(enabled) }
  function changeTheme(next: ColorTheme) { setTheme(next); applyColorTheme(next) }
  return <><PageTitle eyebrow="PREFERENCES" title="Make it yours." detail="Local settings for this browser. Your account data stays on the server." /><div className="settings-layout"><section className="content-panel settings-panel"><span className="small-label">PLAYER IDENTITY</span><h2>Table name</h2><p>This name appears to other players when you join as a guest.</p><label className="field-label">Display name<input value={nickname} maxLength={20} onChange={event => setNickname(event.target.value)} /></label><button className="button button-green" onClick={save}><Check size={16} /> {saved ? 'Saved' : 'Save preference'}</button></section><section className="content-panel settings-panel"><span className="small-label">APPEARANCE</span><h2>Color mode</h2><p>Choose the Arena appearance that is most comfortable for you.</p><div className="theme-options"><button type="button" className={`theme-option ${theme === 'light' ? 'theme-option-active' : ''}`} onClick={() => changeTheme('light')}><Sun size={18} /><span><strong>Light</strong><small>Bright and clean</small></span></button><button type="button" className={`theme-option ${theme === 'dark' ? 'theme-option-active' : ''}`} onClick={() => changeTheme('dark')}><Moon size={18} /><span><strong>Dark</strong><small>Easy on the eyes</small></span></button></div></section><section className="content-panel settings-panel"><span className="small-label">GAME EXPERIENCE</span><h2>Audio controls</h2><p>Control background music separately from card and match sound effects.</p><label className="toggle-row"><span><strong>Background music</strong><small>Turn the Arena music on or off</small></span><input type="checkbox" checked={music} onChange={event => toggleMusic(event.target.checked)} /></label><label className="toggle-row"><span><strong>Enable game sounds</strong><small>Card, turn, and victory effects</small></span><input type="checkbox" checked={sound} onChange={event => toggleSound(event.target.checked)} /></label><button type="button" className="button button-outline" disabled={!sound} onClick={() => playGameSound('preview')}><Volume2 size={16} /> Test sound</button></section><div className="info-banner"><Shield size={16} /> Account email and password are managed by your player account, not stored in these local settings.</div></div></>
}

const rules = [
  ['1', 'Hold On', 'Keep the turn and play again.'],
  ['2', 'Pick Two', 'The next player draws the table-configured penalty. Matching Pick Two cards can stack when enabled.'],
  ['5', 'Pick Three', 'When enabled by the table rules, the next player draws the configured penalty. Otherwise, 5 is a regular card.'],
  ['8', 'Suspension', 'Skip the next player.'],
  ['14', 'General Market', 'Every opponent draws the table-configured number of cards, then you play again.'],
  ['20', 'WHOT', 'Choose the next shape. WHOT can be played at any time.'],
]
function MyTablesPage() {
  const { tables, tablesError, switchActiveTable, leaveTable, refreshTables, busy } = useArena()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState<string | null>(null)
  async function resume(table: SavedTable) {
    try {
      const session = await switchActiveTable(table.code)
      if (session) navigate(table.status === 'lobby' ? `/lobby/${session.code}` : `/game/${session.code}`)
    } catch { /* error already surfaced */ }
  }
  function confirmLeave(code: string) {
    setConfirming(code)
  }
  async function doLeave(code: string) {
    try {
      await leaveTable(code)
      setConfirming(null)
    } catch {
      return
    }
  }
  return <><PageTitle eyebrow="MY TABLES" title="Your active tables." detail="Resume any unfinished game. Your cards, turn position and Virtual Naira stakes are preserved." action={<button type="button" className="button button-outline" onClick={() => void refreshTables()} disabled={busy}><Check size={16} /> Refresh</button>} />
    {confirming && <div className="leave-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title">
      <div className="leave-confirm-card">
        <h2 id="leave-confirm-title">Leave this table?</h2>
        <p>Your membership will be removed. Leaving a private match may trigger its existing reconnect pause; any locked stake remains in the room.</p>
        <div className="leave-confirm-actions">
          <button type="button" className="button button-quiet" onClick={() => setConfirming(null)}>Cancel</button>
          <button type="button" className="button button-coral" onClick={() => void doLeave(confirming)}>Leave table</button>
        </div>
      </div>
    </div>}
    {tablesError ? <section className="content-panel tables-empty" role="alert"><div className="tables-empty-icon"><Table2 size={26} /></div><span className="small-label">TABLE LIST UNAVAILABLE</span><h2>We could not load your tables.</h2><p>{tablesError}</p><button type="button" className="button button-outline" onClick={() => void refreshTables()} disabled={busy}><Check size={16} /> Try again</button></section> : !tables.length ? <section className="content-panel tables-empty"><div className="tables-empty-icon"><Table2 size={26} /></div><span className="small-label">NO SAVED TABLES</span><h2>You are not at any table right now.</h2><p>Join or create a room and it will appear here so you can resume later.</p><div className="tables-empty-actions"><Link className="button button-green" to="/create"><Plus size={17} /> Create a room</Link><Link className="button button-quiet" to="/join">Join with a code</Link></div></section> : <div className="tables-grid">{tables.map(table => {
      const statusLabel = table.status === 'playing' ? 'In progress' : table.status === 'lobby' ? 'Lobby' : table.status === 'finished' ? 'Finished' : 'Reconnecting'
      const statusClass = table.status === 'playing' ? 'tables-status-playing' : table.status === 'lobby' ? 'tables-status-lobby' : ''
      return <section className="content-panel table-card" key={table.code}>
        <div className="table-card-head"><div><span className="small-label">ROOM CODE</span><strong>{table.code}</strong></div><span className={`status-tag ${statusClass}`}>{statusLabel}</span></div>
        <div className="table-card-meta"><span><Users size={15} /> {table.player_count}/{table.total_seats || 4} players</span><span><Clock3 size={15} /> {table.current_turn_name ? `${table.current_turn_name}'s turn` : 'Waiting for host'}</span></div>
        <div className="table-card-meta"><span className="table-participation">{table.participation_status === 'away' || !table.your_connected ? 'You are away' : 'You are participating'}</span>{table.wager > 0 && <span className="table-stake">₦{table.wager.toLocaleString()} stake · ₦{table.wager_pot.toLocaleString()} pot</span>}</div>
        {table.players.length > 0 && <div className="table-player-list">{table.players.map(player => <span className={player.is_you ? 'table-player-you' : ''} key={player.id}>{player.name}{player.is_you ? ' (you)' : ''}{player.connected ? '' : ' · away'}</span>)}</div>}
        <div className="table-card-actions">
          <button type="button" className="button button-green" disabled={busy} onClick={() => void resume(table)}><Play size={15} /> Resume table</button>
          <button type="button" className="button button-quiet" onClick={() => confirmLeave(table.code)}><DoorOpen size={15} /> Leave table</button>
        </div>
      </section>
    })}</div>}
    <p className="tables-footnote"><Shield size={15} /> Your Virtual Naira balance is never charged again when you resume a table. Switching rooms keeps your cards and turn position intact.</p>
  </>
}

function TurnNotifications() {
  const { turnNotifications, dismissTurnNotification, switchActiveTable, busy } = useArena()
  const navigate = useNavigate()
  if (!turnNotifications.length) return null
  return <div className="turn-notifications" aria-live="polite">
    {turnNotifications.map(notification => (
      <div className="turn-notification" key={notification.id}>
        <div><strong>It is your turn</strong><span>Room {notification.room_code} · {notification.status === 'playing' ? 'Game in progress' : 'Table update'}</span></div>
        <div className="turn-notification-actions">
          <button type="button" className="button button-green" disabled={busy} onClick={() => void switchActiveTable(notification.room_code).then(session => session && navigate(`/game/${session.code}`)).catch(() => undefined)}>Switch</button>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismissTurnNotification(notification.id)}><X size={16} /></button>
        </div>
      </div>
    ))}
  </div>
}

function TurnChangePopup() {
  const { view, session } = useArena()
  const [announcement, setAnnouncement] = useState('')
  const previousTurnRef = useRef<TurnSnapshot | null>(null)

  useEffect(() => {
    if (!view) return
    const previous = previousTurnRef.current
    const current: TurnSnapshot = {
      code: view.code,
      status: view.status,
      turn: view.turn,
      is_paused: view.is_paused,
    }
    previousTurnRef.current = current
    const playerName = view.players.find(player => player.id === view.turn)?.name
    const nextAnnouncement = turnAnnouncement(previous, current, playerName, session?.player_id)
    if (nextAnnouncement) setAnnouncement(nextAnnouncement)
  }, [view?.code, view?.status, view?.turn, view?.is_paused, view?.players, session?.player_id])

  useEffect(() => {
    if (!announcement) return
    const timer = window.setTimeout(() => setAnnouncement(''), 2600)
    return () => window.clearTimeout(timer)
  }, [announcement])

  if (!announcement) return null
  return <div className="turn-change-popup" role="status" aria-live="polite"><span>PLAYER TURN</span><strong>{announcement}</strong></div>
}

function MobileGameOnly() {
  return <GameTable />
}

function HelpPage() {
  return <><PageTitle eyebrow="HOW TO PLAY" title="Know the table." detail="The game server enforces the Arena defaults or the rules selected by the private-room host." /><section className="rules-intro"><div><span className="small-label">THE OBJECT</span><h2>Be the first to play every card in your hand.</h2><p>Match the top card by shape or number, or draw one card and pass.</p></div><div className="rule-visual"><span className="rule-number">20</span><span>✦</span><small>WILD</small></div></section><div className="rules-grid">{rules.map(([number, title, description]) => <article className="rule-row" key={number}><span className={`rule-token tone-${shapeTone[number === '20' ? 'whot' : 'star']}`}>{number}</span><div><strong>{title}</strong><p>{description}</p></div><ChevronDown size={16} /></article>)}</div><div className="rules-note"><BookOpen size={17} /><div><strong>Penalty blocking and Last Card</strong><p>Penalty amounts and whether matching penalties may stack depend on the rules selected for the table. When a penalty cannot be continued, the player draws the accumulated total and loses their turn. When you reach one card, press LAST CARD before the next game action or pick two cards. The CPU must declare too. Special cards 1, 2, 5, 8, 14, and 20 cannot finish a round.</p></div></div><div className="help-actions"><Link className="button button-green" to="/create"><Gamepad2 size={16} /> Start a game</Link><Link className="text-link" to="/settings">Game settings <ArrowRight size={15} /></Link></div></>
}

function LoadingScreen({ message, action = false }: { message: string; action?: boolean }) {
  return (
    <div
      className={`launch-screen ${action ? 'table-loading' : ''}`}
      role="status"
      aria-label={message}
    >
      <div className="launch-glow" />
      <div className="launch-card" aria-hidden="true"><span>W</span></div>
      <div className="launch-wordmark"><strong>WHOT</strong><span>ARENA</span></div>
      <div className="launch-progress" aria-hidden="true"><span /></div>
      <small>{message}</small>
    </div>
  )
}

function LaunchScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2500)
    return () => window.clearTimeout(timer)
  }, [onDone])
  return <LoadingScreen message="SETTING THE TABLE" />
}

function App() {
  const [launching, setLaunching] = useState(true)
  const finishLaunch = React.useCallback(() => setLaunching(false), [])
  return <BrowserRouter><ArenaProvider><AppFrame /><ArenaBackgroundMusic />{launching && <LaunchScreen onDone={finishLaunch} />}</ArenaProvider></BrowserRouter>
}

export { App, CardFace, LiveVoicePanel, VoicePanel }

const rootElement = document.getElementById('root')
if (rootElement) createRoot(rootElement).render(<React.StrictMode><App /></React.StrictMode>)
