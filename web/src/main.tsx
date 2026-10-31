import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BatteryFull, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Crown, DoorOpen, Gamepad2, History, Home, LogIn, LogOut, Menu, MessageCircle, Mic, MicOff, Moon, Pause, Play, Plus, Radio, Settings, Shield, Signal, Sparkles, Sun, Trophy, UserRound, Users, Volume2, Wifi, X } from 'lucide-react'
import './styles.css'
import { gameSoundsEnabled, playGameSound, primeGameAudio, setGameSoundsEnabled } from './audio'

type Card = { id: string; shape: string; number: number }
type Player = { id: string; name: string; count: number; connected: boolean; voice_ready?: boolean; is_bot?: boolean; last_card_required?: boolean; table_theme?: string; card_back?: string; avatar?: string }
type VoiceMessage = { id: string; player_id: string; name: string; content_type: string; size: number; sent_at: number }
type ChatMessage = { id: string; player_id: string; name: string; text: string; sent_at: number }
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
  is_public: boolean; rules: { cards_per_player: number; pick_two: number; pick_three: number; general_market: number; penalty_stacking: boolean }
}
type Session = { player_id: string; code: string; reconnect_token: string }
type User = { id: number; username: string; email: string; wins: number; matches_played: number; xp: number; level: number; win_streak: number; best_win_streak: number; achievements: string[]; unlocked_themes: string[]; unlocked_card_backs: string[]; unlocked_avatars: string[]; selected_theme: string; selected_card_back: string; selected_avatar: string }
type MatchHistory = { room_code: string; result: 'win' | 'loss'; player_count: number; completed_at: string }
type ArenaContextValue = {
  view: RoomView | null; session: Session | null; savedSession: Session | null; user: User | null; error: string
  connected: boolean; busy: boolean; clearError: () => void
  voiceUrls: Record<string, string>; requestVoice: (messageId: string) => void
  rtcSignals: RtcSignal[]; sendRtcSignal: (target: string, signal: RtcSignal['signal']) => void
  liveAudioPackets: LiveAudioPacket[]
  connectRoom: (action: string, values?: Record<string, unknown>) => Promise<Session>
  send: (action: string, values?: Record<string, unknown>) => void
  leaveRoom: () => void
  resumeSavedRoom: () => Promise<Session | null>
  authenticate: (registering: boolean, values: Record<string, string>) => Promise<void>
  signOut: () => void
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const WS_URL = import.meta.env.VITE_WS_URL || `${API_URL.replace(/^http/, 'ws')}/ws`
const TURN_URLS = (import.meta.env.VITE_TURN_URL || '').split(',').map(value => value.trim()).filter(value => /^(stun|turn|turns):/.test(value))
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
const Context = createContext<ArenaContextValue | null>(null)
const readStored = <T,>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null } catch { return null }
}
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
  const [user, setUser] = useState<User | null>(() => readStored<User>('whot.user'))
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({})
  const [rtcSignals, setRtcSignals] = useState<RtcSignal[]>([])
  const [liveAudioPackets, setLiveAudioPackets] = useState<LiveAudioPacket[]>([])
  const [busy, setBusy] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<Session | null>(session)
  const retryRef = useRef<number | null>(null)
  const activeRef = useRef(true)
  const voiceUrlsRef = useRef(new Set<string>())
  const previousViewRef = useRef<RoomView | null>(null)
  sessionRef.current = session

  function saveSession(next: Session) {
    sessionRef.current = next
    setSession(next)
    setSavedSession(next)
    localStorage.setItem('whot.session', JSON.stringify(next))
    sessionStorage.setItem('whot.session', JSON.stringify(next))
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
        socket.send(JSON.stringify(payload))
      }
      socket.onmessage = event => {
        let message: { type?: string; data?: RoomView; message?: string; player_id?: string; code?: string; reconnect_token?: string; id?: string; content_type?: string; audio?: string; from?: string; signal?: RtcSignal['signal'] }
        try { message = JSON.parse(String(event.data)) } catch { setError('Received an unreadable server message.'); return }
        if (message.type === 'session' && message.player_id && message.code && message.reconnect_token) {
          const next = { player_id: message.player_id, code: message.code, reconnect_token: message.reconnect_token }
          saveSession(next)
          nextSession = next
          resolveWhenReady()
        } else if (message.type === 'state' && message.data) {
          setView(message.data)
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
          setLiveAudioPackets(previous => [...previous.slice(-39), { id: message.id!, from: message.from!, audio: message.audio! }])
        } else if (message.type === 'left') {
          socket.onclose = null
          socket.close()
          if (socketRef.current === socket) socketRef.current = null
        } else if (message.type === 'error') {
          setError(message.message || 'The server rejected that action.')
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
        if (!settled) { settled = true; reject(new Error('Could not connect to the game server.')) }
      }
      socket.onclose = () => {
        setConnected(false)
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
      playGameSound(view.winner === sessionRef.current?.player_id ? 'win' : 'lose')
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
    if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
    sessionRef.current = null
    try {
      const savedToken = sessionStorage.getItem('whot.token')
      const next = await openSocket({ action, ...values, ...(savedToken ? { access_token: savedToken } : {}) })
      return next
    } finally { setBusy(false) }
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

  async function resumeSavedRoom() {
    if (!savedSession) return null
    if (sessionRef.current?.player_id === savedSession.player_id) return savedSession
    setBusy(true); setError('')
    if (retryRef.current) window.clearTimeout(retryRef.current)
    if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
    sessionRef.current = savedSession
    setSession(savedSession)
    sessionStorage.setItem('whot.session', JSON.stringify(savedSession))
    try {
      return await openSocket({ action: 'reconnect', code: savedSession.code, player_id: savedSession.player_id, reconnect_token: savedSession.reconnect_token })
    } catch (reason) {
      sessionRef.current = null
      setSession(null)
      sessionStorage.removeItem('whot.session')
      throw reason
    } finally { setBusy(false) }
  }

  function requestVoice(messageId: string) {
    send('voice_get', { message_id: messageId })
  }

  function sendRtcSignal(target: string, signal: RtcSignal['signal']) {
    send('rtc_signal', { target, signal })
  }

  async function authenticate(registering: boolean, values: Record<string, string>) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_URL}/api/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Authentication failed')
      sessionStorage.setItem('whot.token', body.access_token)
      localStorage.setItem('whot.user', JSON.stringify(body.user))
      setUser(body.user)
    } catch (reason) { throw reason instanceof Error ? reason : new Error('Authentication failed') }
    finally { setBusy(false) }
  }

  function signOut() {
    sessionStorage.removeItem('whot.token'); localStorage.removeItem('whot.user')
    localStorage.removeItem('whot.session'); sessionStorage.removeItem('whot.session'); sessionRef.current = null
    setUser(null); setSession(null); setSavedSession(null); setView(null)
    if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
  }

  return <Context.Provider value={{ view, session, savedSession, user, error, connected, busy, voiceUrls, requestVoice, rtcSignals, sendRtcSignal, liveAudioPackets, clearError: () => setError(''), connectRoom, send, leaveRoom, resumeSavedRoom, authenticate, signOut }}>{children}</Context.Provider>
}

function useArena() {
  const value = useContext(Context)
  if (!value) throw new Error('Arena context is missing')
  return value
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/create', label: 'Play a game', icon: Gamepad2 },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/history', label: 'Game history', icon: History },
]


function ArenaBackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const location = useLocation()
  const inGame = location.pathname.startsWith('/game/')

  useEffect(() => {
    const audio = new Audio('/audio/whot-background.mp3')
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = 0.015
    audioRef.current = audio
    let active = true
    const tryPlay = () => {
      if (!active || !audio.paused) return
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
    if (audioRef.current) audioRef.current.volume = inGame ? 0.004 : 0.015
  }, [inGame])

  return null
}

function AppFrame() {
  const { user, session, savedSession, view, connected, error, clearError, resumeSavedRoom, signOut } = useArena()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<ColorTheme>(preferredTheme)
  const location = useLocation()
  const navigate = useNavigate()
  const isTable = location.pathname.startsWith('/game/')
  useEffect(() => {
    applyColorTheme(theme)
    const syncTheme = (event: Event) => setTheme((event as CustomEvent<ColorTheme>).detail)
    window.addEventListener('whot-theme', syncTheme)
    return () => window.removeEventListener('whot-theme', syncTheme)
  }, [])
  async function resumePreviousTable() {
    if (!savedSession) return
    try { const restored = await resumeSavedRoom(); if (restored) navigate(`/lobby/${restored.code}`) }
    catch { /* The provider displays the reconnect error. */ }
  }
  return <div className={`app-frame ${isTable ? 'table-frame' : ''}`}>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link to="/" className="brand"><span className="brand-mark">W</span><span>WHOT<span className="brand-light">ARENA</span></span></Link>
      <div className="side-caption">PLAY</div>
      <nav className="side-nav">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></NavLink>)}</nav>
      <div className="side-caption second-caption">YOUR ACCOUNT</div>
      <nav className="side-nav">
        <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><UserRound size={18} /><span>Profile</span></NavLink>
        <NavLink to="/settings" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Settings size={18} /><span>Settings</span></NavLink>
        <NavLink to="/help" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><CircleHelp size={18} /><span>Help & rules</span></NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Game server connected' : 'Game server offline'}</div>
        {user ? <div className="account-mini"><div className="avatar avatar-small">{user.username.slice(0, 1).toUpperCase()}</div><div className="account-copy"><strong>{user.username}</strong><span>Player account</span></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={17} /></button></div> : <Link className="side-signin" to="/login"><LogIn size={16} /> Sign in to your account</Link>}
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="main-column">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><div className="crumb">{location.pathname === '/' ? 'Welcome to the arena' : location.pathname.split('/')[1]?.replace('-', ' ')}</div><div className="top-actions"><span className="server-pill"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'LIVE' : 'READY'}</span><button type="button" className="icon-button theme-toggle" onClick={() => applyColorTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><Link className="top-avatar" to={user ? '/profile' : '/login'} aria-label="Open profile">{user ? user.username.slice(0, 1).toUpperCase() : <UserRound size={17} />}</Link></div></header>
      {!session && savedSession && <div className="saved-room-bar"><span><Radio size={15} /><strong>Unfinished table {savedSession.code}</strong></span><button type="button" className="button button-lime" onClick={() => void resumePreviousTable()}>Resume table <ArrowRight size={15} /></button></div>}
      {error && <div role="alert" className="toast-error"><span>{error}</span><button aria-label="Dismiss" onClick={clearError}><X size={16} /></button></div>}
      <main className="page-content"><Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage registering />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/join" element={<JoinRoom />} />
        <Route path="/lobby/:code" element={<Lobby />} />
        <Route path="/game/:code" element={<GameTable />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></main>
      {session && <Link to={view?.status === 'lobby' ? `/lobby/${session.code}` : `/game/${session.code}`} className="room-chip" title="Continue your open table"><Radio size={14} /> Continue room {session.code}<span className={`status-dot ${connected ? 'online' : ''}`} /></Link>}
    </div>
  </div>
}

function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="eyebrow"><span />{children}</div> }
function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</div>
}

function Landing() {
  const { user, session, view } = useArena()
  const resumePath = session && view?.status !== 'lobby' ? `/game/${session.code}` : session ? `/lobby/${session.code}` : '/create'
  return <div className="landing-page">
    {session && <div className="continue-table-banner"><span><Radio size={16} /><strong>Unfinished table {session.code}</strong></span><Link className="button button-lime" to={resumePath}>Continue table <ArrowRight size={16} /></Link></div>}
    <section className="landing-hero"><div className="hero-copy"><Eyebrow>NIGERIAN WHOT · REAL-TIME MULTIPLAYER</Eyebrow><h1>One table.<br /><span>Every move counts.</span></h1><p>Bring your people together for a quick round of WHOT. The cards stay hidden, the competition stays friendly, and every move is verified on the server.</p><div className="hero-actions"><Link className="button button-lime" to="/create"><Gamepad2 size={17} /> Play now <ArrowRight size={17} /></Link><Link className="button button-quiet" to="/help">How to play</Link></div><div className="hero-proof"><span><Shield size={15} /> Server-validated play</span><span><Users size={15} /> 2–4 players</span><span><Radio size={15} /> Live rooms</span></div></div><div className="hero-scene" aria-label="A WHOT card on a green game table"><div className="scene-ring ring-one" /><div className="scene-ring ring-two" /><div className="scene-card card-back"><span>WHOT</span><small>ARENA</small></div><div className="scene-card card-front"><span className="scene-number">20</span><span className="shape-symbol">✦</span><span className="shape-name">WILD CARD</span></div><div className="scene-note"><span className="note-dot" /> YOUR NEXT MOVE</div><div className="scene-score"><span>TABLE<br />OPEN</span><strong>04</strong></div></div></section>
    <section className="landing-lower"><div className="lower-heading"><div><span className="small-label">START HERE</span><h2>{user ? `Welcome back, ${user.username}.` : 'Your next round is one click away.'}</h2></div><span className="house-rule-tag"><Sparkles size={14} /> The Arena house rules</span></div><div className="quick-grid"><Link to="/create" className="quick-action"><span className="quick-icon lime"><Plus size={20} /></span><span><strong>Create a private room</strong><small>Invite friends with a room code</small></span><ArrowRight size={17} /></Link><Link to="/join" className="quick-action"><span className="quick-icon coral"><DoorOpen size={20} /></span><span><strong>Join a room</strong><small>Enter a code from your host</small></span><ArrowRight size={17} /></Link><Link to="/leaderboard" className="quick-action"><span className="quick-icon gold"><Trophy size={20} /></span><span><strong>See the standings</strong><small>Check the player leaderboard</small></span><ArrowRight size={17} /></Link></div></section>
  </div>
}

function Dashboard() {
  const { user, session, view, connected, leaveRoom } = useArena()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(user)
  useEffect(() => {
    const token = sessionStorage.getItem('whot.token')
    if (!token) return
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (response.ok) setProfile(await response.json() as User) })
      .catch(() => undefined)
  }, [user?.id])
  const resumePath = session && view?.status !== 'lobby' ? `/game/${session.code}` : session ? `/lobby/${session.code}` : '/create'
  return <><PageTitle eyebrow="PLAYER DASHBOARD" title={`Good to see you${user ? `, ${user.username}` : ''}.`} detail="Pick up a game or see how you stack up." action={<Link className="button button-lime" to="/create"><Plus size={17} /> New game</Link>} />
    <div className="stats-row"><Stat icon={<Trophy />} label="Wins" value={profile?.wins ?? '—'} tone="gold" /><Stat icon={<Gamepad2 />} label="Games played" value={profile?.matches_played ?? '—'} tone="green" /><Stat icon={<Radio />} label="Room status" value={session ? 'In room' : 'Ready'} tone="coral" /></div>
    {session && <section className="open-table-banner content-panel"><div className="open-table-icon"><Radio size={19} /></div><div><span className="small-label">OPEN TABLE · {session.code}</span><h2>{connected && view ? 'Your table is ready to resume.' : 'Reconnecting to your table…'}</h2><p>{connected && view ? 'Continue from where you left off.' : 'Wait for the connection, or close this saved table session.'}</p></div><div className="open-table-actions"><Link className="button button-green" to={resumePath}><Gamepad2 size={16} /> Resume table</Link><button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/create') }}>Close open table</button></div></section>}
    <div className="dashboard-grid"><section className="content-panel feature-panel"><div className="panel-topline"><span className="small-label">YOUR NEXT GAME</span><span className="status-tag"><span className="status-dot online" /> OPEN</span></div><h2>Make the first move.</h2><p>Create a private table, invite up to three friends, and let the cards decide.</p><div className="panel-actions"><Link className="button button-green" to="/create"><Plus size={17} /> Create a room</Link><Link className="text-link" to="/join">Join with a code <ArrowRight size={15} /></Link></div><div className="panel-mark">W</div></section><section className="content-panel rank-panel"><div className="panel-topline"><span className="small-label">THE ARENA</span><Trophy size={18} /></div><h3>Play. Win. Climb.</h3><p>Rankings update after completed matches with registered players.</p><Link className="text-link" to="/leaderboard">View leaderboard <ArrowRight size={15} /></Link><div className="rank-decoration"><span /><span /><span /><span /><span /></div></section></div>
    <div className="section-heading"><div><span className="small-label">KEEP EXPLORING</span><h2>Make yourself at home</h2></div></div><div className="quick-grid"><Link to="/help" className="quick-action"><span className="quick-icon green"><BookOpen size={19} /></span><span><strong>Rules at a glance</strong><small>Learn the Arena's house rules</small></span><ArrowRight size={17} /></Link><Link to="/profile" className="quick-action"><span className="quick-icon coral"><UserRound size={19} /></span><span><strong>Your player profile</strong><small>Account and match statistics</small></span><ArrowRight size={17} /></Link><Link to="/settings" className="quick-action"><span className="quick-icon gold"><Settings size={19} /></span><span><strong>Game settings</strong><small>Set your name and preferences</small></span><ArrowRight size={17} /></Link></div>
  </>
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string }) { return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></div> }

function AuthPage({ registering = false }: { registering?: boolean }) {
  const { authenticate, user, busy } = useArena()
  const navigate = useNavigate()
  const [formError, setFormError] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
    try { await authenticate(registering, values); navigate('/dashboard') }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Could not sign in') }
  }
  if (user) return <div className="center-state"><Check size={28} /><h2>You are signed in</h2><Link to="/dashboard" className="button button-green">Go to dashboard</Link></div>
  return <div className="auth-wrap"><Link to="/" className="back-link"><ArrowLeft size={15} /> Back to arena</Link><div className="auth-panel"><span className="auth-emblem">W</span><Eyebrow>{registering ? 'JOIN THE ARENA' : 'WELCOME BACK'}</Eyebrow><h1>{registering ? 'Create your player account.' : 'Good games start here.'}</h1><p>{registering ? 'Save your player stats and take your wins across sessions.' : 'Sign in to keep track of your wins and player profile.'}</p><form onSubmit={submit} className="form-stack">{registering && <Field label="Player name" name="username" placeholder="e.g. AdaPlays" minLength={3} maxLength={24} required />}<Field label="Email address" name="email" type="email" placeholder="you@example.com" required /><Field label="Password" name="password" type="password" placeholder="At least 8 characters" minLength={registering ? 8 : undefined} required />{formError && <p role="alert" className="form-error">{formError}</p>}<button disabled={busy} className="button button-lime full-button">{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button></form><div className="auth-switch">{registering ? 'Already have a player account?' : 'New to the Arena?'} <Link to={registering ? '/login' : '/register'}>{registering ? 'Sign in' : 'Create one'}</Link></div><div className="guest-note"><Shield size={15} /> Guest games are available without signing in.</div></div></div>
}

function Field({ label, name, type = 'text', placeholder, required, minLength, maxLength, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; minLength?: number; maxLength?: number; defaultValue?: string }) { return <label className="field-label">{label}<input name={name} type={type} placeholder={placeholder} minLength={minLength} maxLength={maxLength} required={required} defaultValue={defaultValue} autoComplete={name === 'password' ? 'current-password' : name === 'email' ? 'email' : 'nickname'} /></label> }

function CreateRoom() {
  const { connectRoom, busy, user } = useArena()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.username || localStorage.getItem('whot.nickname') || 'Guest')
  const [roomError, setRoomError] = useState('')
  const [loadingLabel, setLoadingLabel] = useState('')
  async function create(action: 'create' | 'quick_match' | 'computer') {
    setRoomError('')
    setLoadingLabel(action === 'create' ? 'OPENING YOUR TABLE' : action === 'computer' ? 'DEALING AGAINST THE COMPUTER' : 'FINDING YOUR MATCH')
    try {
      const [next] = await Promise.all([
        connectRoom(action, { name: name.trim() || 'Guest' }),
        new Promise(resolve => window.setTimeout(resolve, 1200)),
      ])
      navigate(action === 'computer' ? `/game/${next.code}` : `/lobby/${next.code}`)
    } catch (error) {
      setLoadingLabel('')
      setRoomError(error instanceof Error ? error.message : 'Could not create room')
    }
  }
  return <><PageTitle eyebrow="FIND YOUR TABLE" title="Let's play." detail="Play the computer, set up a private room, or find a quick match." /><div className="setup-layout setup-layout-three">
    <section className="content-panel setup-panel computer-match-panel"><span className="setup-number">01</span><span className="small-label">SOLO MATCH</span><h2>Challenge the computer.</h2><p>Jump straight into a two-player round against Arena Bot. No room code or waiting required.</p><label className="field-label">Your table name<input value={name} maxLength={20} onChange={event => setName(event.target.value)} onBlur={() => localStorage.setItem('whot.nickname', name)} placeholder="Choose a nickname" /></label><button disabled={busy} onClick={() => void create('computer')} className="button button-green full-button"><Gamepad2 size={17} /> {busy ? 'Dealing cards…' : 'Play vs computer'}</button></section>
    <section className="content-panel setup-panel"><span className="setup-number">02</span><span className="small-label">PRIVATE ROOM</span><h2>Bring your own crew.</h2><p>Create a room and share its six-character code. Friends can join from web or mobile.</p><button disabled={busy} onClick={() => void create('create')} className="button button-green full-button"><Plus size={17} /> {busy ? 'Opening table…' : 'Create private room'}</button></section>
    <section className="content-panel setup-panel quick-match-panel"><span className="setup-number">03</span><span className="small-label">QUICK MATCH</span><h2>Meet at the table.</h2><p>Pair up with the next player who joins quick match.</p><div className="quick-match-meta"><span><Users size={15} /> 2–4 players</span><span><Clock3 size={15} /> Usually under a minute</span></div><button disabled={busy} onClick={() => void create('quick_match')} className="button button-lime full-button"><Sparkles size={17} /> {busy ? 'Finding players…' : 'Find a quick match'}</button></section>
  </div>{roomError && <div role="alert" className="form-error form-error-block">{roomError}</div>}<div className="house-rule-callout"><Shield size={17} /><span><strong>Fair play is server-side.</strong> The game server deals cards, checks moves, and decides the winner.</span><Link to="/help">Rules <ArrowRight size={14} /></Link></div>{loadingLabel && <LoadingScreen message={loadingLabel} action />}</>
}

function JoinRoom() {
  const { connectRoom, busy, user } = useArena()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [name, setName] = useState(user?.username || localStorage.getItem('whot.nickname') || 'Guest')
  const [formError, setFormError] = useState('')
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
  useEffect(() => { if (view?.status === 'playing') navigate(`/game/${view.code}`, { replace: true }) }, [view?.status])
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Finding your table…</h2><p>Reconnecting to room {code.toUpperCase()}</p><button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/create') }}>Close open table</button></div>
  const isHost = view.host === session?.player_id
  return <><PageTitle eyebrow={view.is_public ? 'QUICK MATCH LOBBY' : 'PRIVATE ROOM'} title="The table is set." detail="Share your code and wait for everyone to join." action={<button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/dashboard') }}><ArrowLeft size={16} /> Leave table</button>} /><section className="lobby-room content-panel"><div className="lobby-code"><div><span className="small-label">ROOM CODE</span><strong>{view.code}</strong></div><button className="button button-outline" onClick={() => void navigator.clipboard?.writeText(view.code)}><Check size={15} /> Copy code</button></div><div className="lobby-divider" /><div className="lobby-player-heading"><span className="small-label">PLAYERS</span><span>{view.players.length} / 4 seats</span></div><div className="player-list">{Array.from({ length: 4 }, (_, index) => {
    const player = view.players[index]
    return player ? <div className="lobby-player" key={player.id}><div className={`avatar ${player.id === view.host ? 'host-avatar' : ''}`}>{player.name.slice(0, 1).toUpperCase()}</div><div className="player-copy"><strong>{player.name}{player.id === session?.player_id ? ' (You)' : ''}</strong><span>{player.id === view.host ? 'Host' : 'Ready to play'} · {player.connected ? 'Connected' : 'Reconnecting'}</span></div>{player.id === view.host && <Crown size={17} className="host-crown" />}{player.id === session?.player_id && <span className="you-tag">YOU</span>}</div> : <div className="lobby-player empty-seat" key={`empty-${index}`}><div className="avatar empty-avatar"><Plus size={16} /></div><div className="player-copy"><strong>Waiting for a player</strong><span>Share the room code to fill this seat</span></div></div>
  })}</div><div className="lobby-footer"><div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Room is live' : 'Connecting…'}</div>{isHost ? <button className="button button-lime" disabled={view.players.length < 2 || view.players.some(player => !player.connected)} onClick={() => send('start')}><Gamepad2 size={17} /> Start game <ArrowRight size={16} /></button> : <span className="waiting-label"><span className="pulse-dot" /> Waiting for host to start</span>}</div></section><div className="lobby-footnote"><Shield size={15} /> The server will privately deal five cards to each player when the host starts.</div></>
}

const shapes = ['circle', 'triangle', 'cross', 'square', 'star']
const shapeGlyph: Record<string, string> = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★', whot: 'W' }
const shapeTone: Record<string, string> = { circle: 'blue', triangle: 'red', cross: 'green', square: 'gold', star: 'coral', whot: 'dark' }
const avatarGlyph = (name: string, avatar?: string) => avatar === 'crown' ? '♛' : avatar === 'star' ? '★' : name.slice(0, 1).toUpperCase()
function CardFace({ card, large = false, back = false, selected = false, playable = false, onClick, index = 0 }: { card?: Card | null; large?: boolean; back?: boolean; selected?: boolean; playable?: boolean; onClick?: () => void; index?: number }) {
  if (back) return <div className={`whot-card card-back-face ${large ? 'card-large' : ''}`}><span className="back-mark mark-one"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-two"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-three"><strong>WHOT</strong><small>ARENA</small></span><span className="back-seal">W</span></div>
  if (!card) return <div className={`empty-card ${large ? 'card-large' : ''}`}><span>?</span></div>
  return <button type="button" className={`whot-card ${large ? 'card-large' : ''} tone-${shapeTone[card.shape]} ${selected ? 'card-selected' : ''} ${playable ? 'card-playable' : ''}`} onClick={onClick} disabled={!playable} style={{ '--card-index': index } as React.CSSProperties} aria-label={`Play ${card.number} ${card.shape}`}><span className="card-corner top-corner"><span>{card.number}</span><small>{shapeGlyph[card.shape]}</small></span><span className="card-glyph">{shapeGlyph[card.shape]}</span><span className="card-corner bottom-corner"><span>{card.number}</span><small>{shapeGlyph[card.shape]}</small></span></button>
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
    <div className={`winner-announcement ${champion ? 'match-champion' : ''}`}><Crown size={34} /><span>{champion ? 'BEST OF THREE CHAMPION' : 'ROUND WINNER'}</span><strong>{name}</strong>{champion && <small>Match victory · two rounds won</small>}</div>
  </div>
}

function GameTable() {
  const { code = '' } = useParams()
  const { view, session, send, leaveRoom } = useArena()
  const [selectedWhot, setSelectedWhot] = useState<Card | null>(null)
  const [shape, setShape] = useState('circle')
  const [toast, setToast] = useState('')
  const [turnSeconds, setTurnSeconds] = useState(30)
  const [pauseSeconds, setPauseSeconds] = useState(0)
  const navigate = useNavigate()
  useEffect(() => { if (view?.status === 'finished') setToast(view.winner === session?.player_id ? 'You emptied your hand. What a finish!' : `${view.players.find(player => player.id === view.winner)?.name || 'A player'} takes the round.`) }, [view?.status, view?.winner])
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
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Restoring your game…</h2><p>Your hand stays private while the table reconnects.</p><button type="button" className="button button-outline" onClick={() => { leaveRoom(); navigate('/create') }}>Close open table</button></div>
  const me = view.players.find(player => player.id === session?.player_id)
  const opponents = view.players.filter(player => player.id !== session?.player_id)
  const winnerName = view.players.find(player => player.id === view.winner)?.name || 'Arena winner'
  const championName = view.players.find(player => player.id === view.match_winner)?.name || winnerName
  const myTurn = view.turn === session?.player_id && view.status === 'playing' && !view.is_paused
  const isRoundOpening = view.last_action === 'Game started' || view.last_action.includes('started')
  const isLegal = (card: Card) => view.pending_draw > 0 ? card.number === view.pending_penalty : card.number === 20 || card.number === view.top?.number || card.shape === (view.requested_shape || view.top?.shape)
  function play(card: Card) {
    if (!myTurn) return
    if (card.number === 20) { setSelectedWhot(card); return }
    send('play', { card_id: card.id })
  }
  function confirmWhot() { if (selectedWhot) { send('play', { card_id: selectedWhot.id, shape }); setSelectedWhot(null) } }
  return (
    <div className={`game-page theme-${me?.table_theme || 'classic'} card-back-${me?.card_back || 'classic'}`}>
      {view.status === 'finished' && <WinnerCelebration name={view.match_winner ? championName : winnerName} champion={Boolean(view.match_winner)} />}
      <div className="game-topline">
        <div>
          <Eyebrow>ROOM {view.code}</Eyebrow>
          <span className={`game-status ${myTurn ? 'turn-live' : ''}`}>
            <span className="status-dot online" />
            {view.status === 'finished' ? 'ROUND COMPLETE' : view.is_paused ? 'GAME PAUSED' : myTurn ? 'YOUR TURN' : `TURN: ${view.players.find(player => player.id === view.turn)?.name || 'OPPONENT'}`}
          </span>
        </div>
        <div className="match-scoreboard" aria-label={`Best of three match score, round ${view.round_number}`}><span>ROUND {view.round_number} · BEST OF 3</span><div>{view.players.map(player => <span className={player.id === view.match_winner ? 'score-champion' : ''} key={player.id}><strong>{player.name}</strong><b>{view.round_wins[player.id] || 0}</b><small>{view.match_points[player.id] || 0} pts</small></span>)}</div></div>
        <div className="game-actions">{view.host === session?.player_id && !view.is_public && view.status === 'playing' && <button type="button" className="button button-outline game-pause" disabled={view.is_paused && view.pause_reason !== 'manual'} onClick={() => send('pause')}>{view.is_paused && view.pause_reason === 'manual' ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}</button>}<button className="icon-button game-exit" title="Leave table and return to dashboard" onClick={() => { leaveRoom(); navigate('/dashboard') }}><ArrowLeft size={18} /></button></div>
      </div>
      <div className={`game-layout ${opponents.every(player => player.is_bot) ? 'solo-layout' : ''}`}>
      <div className="table-column">
      <section className={`table-felt ${view.pending_draw > 0 ? 'table-penalty-active' : ''} ${isRoundOpening ? 'table-dealing' : ''}`}>
        <div className="table-stitch" />
        {view.is_paused && <div className="reconnect-pause" role="status" aria-live="polite">{view.pause_reason === 'disconnect' ? <Wifi size={25} /> : <Pause size={25} />}<span>PRIVATE MATCH PAUSED</span><strong>{view.pause_reason === 'disconnect' ? `Waiting for ${view.paused_by || 'a player'} to reconnect` : `${view.paused_by || 'The host'} paused the game`}</strong><small>{view.pause_reason === 'disconnect' ? `${pauseSeconds} seconds remaining · turn timer frozen at ${turnSeconds}` : `Turn timer frozen at ${turnSeconds} · the host can resume`}</small></div>}
        <div className="opponents-row">
          {opponents.map((player, index) => (
            <div className={`opponent ${!player.connected ? 'player-away' : ''} ${view.turn === player.id ? 'opponent-turn' : ''}`} key={player.id}>
              <div className="opponent-avatar-wrap"><div className={`avatar opponent-avatar avatar-${index}`}>{avatarGlyph(player.name, player.avatar)}</div><span className={`status-dot ${player.connected ? 'online' : ''}`} /></div>
              <strong>{player.name}{player.is_bot ? ' · CPU' : ''}</strong><span className={player.count === 1 ? 'last-card-label' : ''}>{player.count === 1 ? 'LAST CARD' : `${player.count} cards`}</span>{view.turn === player.id && <span className="opponent-turn-label">{player.is_bot ? 'THINKING' : 'THEIR TURN'}</span>}
              <div className="opponent-card-fan">{Array.from({ length: Math.min(player.count, 3) }, (_, cardIndex) => <CardFace key={cardIndex} back />)}</div>
            </div>
          ))}
        </div>
        <div className="center-piles">
          <div className="pile-block"><span className="pile-label">DRAW PILE</span><div className={`pile-stack${view.market_count > 0 && view.market_count <= 5 ? ' pile-stack-low' : ''}`} onClick={() => myTurn && send('draw')} role="button" tabIndex={0} onKeyDown={event => event.key === 'Enter' && myTurn && send('draw')} aria-label={view.pending_draw ? `Accept penalty and draw ${view.pending_draw} cards` : `Draw one card and pass. ${view.market_count} cards remain`}><CardFace back large /><span className="market-count">{view.market_count}</span><span className="pile-count">{myTurn ? view.pending_draw ? `PICK ${view.pending_draw}` : 'TAP TO DRAW' : `${view.market_count} CARDS`}</span></div></div>
          <div className="table-arrow">{view.status === 'playing' ? <div className={`table-turn-timer ${!view.is_paused && turnSeconds <= 5 ? 'table-turn-timer-urgent' : ''}`} aria-live="polite" aria-label={view.is_paused ? view.pause_reason === 'disconnect' ? `${pauseSeconds} seconds to reconnect` : 'Game paused by host' : `${turnSeconds} seconds remaining`}><Clock3 size={16} /><strong>{view.is_paused ? view.pause_reason === 'disconnect' ? pauseSeconds : '‖' : turnSeconds}</strong><span>{view.is_paused ? 'PAUSE' : 'SEC'}</span></div> : <Sparkles size={19} />}</div>
          <div className="pile-block"><span className="pile-label">ON THE TABLE</span><div className="top-card-slot"><CardFace key={view.top?.id || 'empty-top'} card={view.top} large selected /><div className="top-glow" /></div></div>
        </div>
        {view.requested_shape && <div className="requested-shape"><span>SHAPE REQUESTED</span><strong>{shapeGlyph[view.requested_shape]} {view.requested_shape}</strong></div>}
        {view.pending_draw > 0 && <div className="requested-shape penalty-stack" role="status"><span>PENALTY STACK</span><strong>Pick {view.pending_draw} · Block with another {view.pending_penalty}</strong></div>}
        <div className="table-message" aria-live="polite">{toast || view.last_action}</div>
        <div className="you-at-table"><div className="avatar you-avatar">{avatarGlyph(me?.name || 'You', me?.avatar)}</div><div><strong>{me?.name || 'You'} <span>(you)</span></strong><small>{myTurn ? 'Your move' : view.status === 'finished' ? 'Round over' : 'Waiting for your turn'}</small></div>{myTurn && <span className="turn-clock"><Clock3 size={15} /> PLAY NOW</span>}</div>
      </section>
      {view.status === 'finished' ? (
        <section className="round-result">
          <div className="result-icon">{view.winner === session?.player_id ? <Crown size={26} /> : <Trophy size={26} />}</div>
          <div><span className="small-label">{view.match_winner ? 'MATCH COMPLETE' : `ROUND ${view.round_number} COMPLETE`}</span><h2>{view.match_winner ? `${championName} won the match!` : view.winner === session?.player_id ? 'You won the round!' : `${winnerName} won the round.`}</h2><p>{view.match_winner ? 'The best-of-three match is complete. The host can start a fresh match.' : 'First to two round wins takes the match. Remaining cards determine the points awarded.'}</p>{Object.keys(view.final_scores || {}).length > 0 && <div className="final-scores">{view.players.map(player => <span key={player.id}><strong>{player.name}</strong> {view.final_scores[player.id]} left · {view.round_wins[player.id] || 0} wins · {view.match_points[player.id] || 0} pts</span>)}</div>}</div>
          {view.host === session?.player_id && view.players.every(player => player.connected)
            ? <button className="button button-green" onClick={() => send('rematch')}>{view.match_winner ? 'New match' : 'Next round'} <ArrowRight size={16} /></button>
            : <Link to="/create" className="button button-green">New table <ArrowRight size={16} /></Link>}
        </section>
      ) : (
        <section className={`hand-panel ${view.pending_draw > 0 && myTurn ? 'penalty-hand' : ''}`}>
          <div className="hand-heading"><div><span className="small-label">YOUR HAND</span><strong className={view.hand.length === 1 ? 'last-card-label' : ''}>{view.hand.length === 1 ? 'LAST CARD' : `${view.hand.length} cards`}</strong></div>{me?.last_card_required ? <button type="button" className="last-card-button" onClick={() => send('declare_last')}><Sparkles size={15} /> LAST CARD!</button> : <span className="hand-hint">{myTurn ? view.pending_draw ? `Play another ${view.pending_penalty} or pick ${view.pending_draw}` : 'Choose a matching card or draw to pass' : 'Cards only you can see'}</span>}</div>
          <div className="hand-cards">{view.hand.map((card, index) => <CardFace key={card.id} card={card} playable={myTurn && isLegal(card)} selected={selectedWhot?.id === card.id} index={index} onClick={() => play(card)} />)}</div>
        </section>
      )}
      </div>
      {!opponents.every(player => player.is_bot) && <LiveVoicePanel players={view.players} playerId={session?.player_id || ''} enabled={view.status === 'playing'} />}
      <VoicePanel messages={view.voice_messages || []} chatMessages={view.chat_messages || []} playerId={session?.player_id || ''} enabled={view.status === 'playing'} />
      </div>
      {selectedWhot && createPortal(<div className="shape-modal-backdrop" onMouseDown={() => setSelectedWhot(null)}><section className="shape-modal" role="dialog" aria-modal="true" aria-labelledby="shape-modal-title" onMouseDown={event => event.stopPropagation()}><button type="button" className="icon-button shape-modal-close" onClick={() => setSelectedWhot(null)} aria-label="Cancel shape selection"><X size={18} /></button><div className="shape-modal-card"><span>20</span><strong>WHOT</strong></div><span className="small-label">WHOT 20</span><h2 id="shape-modal-title">Choose the next shape</h2><p>Every player must match the shape you select.</p><div className="shape-modal-grid">{shapes.map(item => <button type="button" key={item} className={`shape-modal-choice shape-${item} ${shape === item ? 'shape-modal-choice-active' : ''}`} onClick={() => setShape(item)} aria-pressed={shape === item}><span>{shapeGlyph[item]}</span><strong>{item}</strong></button>)}</div><button type="button" className="button button-lime shape-modal-confirm" onClick={confirmWhot}><Check size={16} /> Play WHOT · {shapeGlyph[shape]} {shape}</button></section></div>, document.body)}
    </div>
  )
}

function LiveVoicePanel({ players, playerId, enabled }: { players: Player[]; playerId: string; enabled: boolean }) {
  const { rtcSignals, sendRtcSignal, liveAudioPackets, send } = useArena()
  const [muted, setMuted] = useState(true)
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'blocked' | 'unsupported' | 'failed'>('idle')
  const [connectedPeers, setConnectedPeers] = useState<string[]>([])
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const [connectionSlow, setConnectionSlow] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const localStreamRef = useRef<MediaStream | null>(null)
  const startPromiseRef = useRef<Promise<MediaStream | null> | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const audioRef = useRef(new Map<string, HTMLAudioElement>())
  const offeredRef = useRef(new Set<string>())
  const handledSignalsRef = useRef(new Set<string>())
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const relayContextRef = useRef<AudioContext | null>(null)
  const relayProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const relayPlaybackRef = useRef<AudioContext | null>(null)
  // Each remote speaker needs an independent playback clock.
  const relayPlaybackTimesRef = useRef(new Map<string, number>())
  // React may batch incoming WebSocket packets into a single render.
  const handledAudioIdsRef = useRef(new Set<string>())

  function startRelayCapture(stream: MediaStream) {
    if (relayProcessorRef.current) return
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(2048, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0
    processor.onaudioprocess = event => {
      if (mutedRef.current) return
      const input = event.inputBuffer.getChannelData(0)
      const ratio = context.sampleRate / 16000
      const samples = new Int16Array(Math.floor(input.length / ratio))
      for (let index = 0; index < samples.length; index += 1) {
        const value = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)]))
        samples[index] = value < 0 ? value * 0x8000 : value * 0x7fff
      }
      const bytes = new Uint8Array(samples.buffer)
      let binary = ''
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
      send('rtc_audio', { audio: btoa(binary) })
    }
    source.connect(processor)
    processor.connect(silent)
    silent.connect(context.destination)
    relayContextRef.current = context
    relayProcessorRef.current = processor
  }

  async function startMicrophone() {
    if (localStreamRef.current) return localStreamRef.current
    if (startPromiseRef.current) return startPromiseRef.current
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setStatus('unsupported')
      return null
    }
    startPromiseRef.current = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then(stream => {
      localStreamRef.current = stream
      stream.getAudioTracks().forEach(track => { track.enabled = true })
      for (const [remoteId, peer] of peersRef.current) {
        const senderTracks = peer.getSenders().map(sender => sender.track).filter(Boolean)
        stream.getAudioTracks().forEach(track => { if (!senderTracks.includes(track)) peer.addTrack(track, stream) })
        void peer.createOffer().then(offer => peer.setLocalDescription(offer)).then(() => {
          if (peer.localDescription) sendRtcSignal(remoteId, { type: 'offer', sdp: { type: peer.localDescription.type, sdp: peer.localDescription.sdp } })
        }).catch(() => undefined)
      }
      setMuted(false)
      setStatus('live')
      startRelayCapture(stream)
      return stream
    }).catch(() => {
      setStatus('blocked')
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
      const audio = audioRef.current.get(remoteId) || new Audio()
      audio.autoplay = true
      audio.srcObject = event.streams[0]
      audioRef.current.set(remoteId, audio)
      void audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setConnectedPeers(previous => previous.includes(remoteId) ? previous : [...previous, remoteId])
        setConnectionSlow(false)
        playGameSound('join')
      } else if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        setConnectedPeers(previous => previous.filter(id => id !== remoteId))
      }
    }
    peersRef.current.set(remoteId, peer)
    return peer
  }

  useEffect(() => {
    if (enabled) send('rtc_ready')
    return () => {
      localStreamRef.current?.getTracks().forEach(track => track.stop())
      peersRef.current.forEach(peer => peer.close())
      audioRef.current.forEach(audio => { audio.pause(); audio.srcObject = null })
      relayProcessorRef.current?.disconnect()
      relayProcessorRef.current = null
      void relayContextRef.current?.close()
      relayContextRef.current = null
      void relayPlaybackRef.current?.close()
      relayPlaybackRef.current = null
      relayPlaybackTimesRef.current.clear()
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
        setConnectedPeers(previous => previous.filter(id => id !== remoteId))
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

  useEffect(() => {
    const pending = liveAudioPackets.filter(packet => {
      if (handledAudioIdsRef.current.has(packet.id)) return false
      handledAudioIdsRef.current.add(packet.id)
      return packet.from !== playerId && !connectedPeers.includes(packet.from)
    })
    // Keep deduplication bounded across long sessions.
    if (handledAudioIdsRef.current.size > 500) {
      const recent = [...handledAudioIdsRef.current].slice(-250)
      handledAudioIdsRef.current = new Set(recent)
    }
    if (!pending.length) return

    const context = relayPlaybackRef.current || new AudioContext()
    relayPlaybackRef.current = context
    if (context.state !== 'running') {
      setPlaybackBlocked(true)
      return
    }

    for (const packet of pending) {
      try {
        const bytes = Uint8Array.from(atob(packet.audio), character => character.charCodeAt(0))
        if (bytes.byteLength < 2 || bytes.byteLength % 2 !== 0) continue
        const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
        const buffer = context.createBuffer(1, samples.length, 16000)
        const channel = buffer.getChannelData(0)
        for (let index = 0; index < samples.length; index += 1) {
          channel[index] = samples[index] / 0x8000
        }

        const previousTime = relayPlaybackTimesRef.current.get(packet.from) || 0
        // A small initial buffer smooths packet arrival; drop accumulated latency.
        const now = context.currentTime
        const startAt = previousTime < now || previousTime > now + 0.35
          ? now + 0.08
          : previousTime
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        source.start(startAt)
        relayPlaybackTimesRef.current.set(packet.from, startAt + buffer.duration)
      } catch {
        // A damaged packet should not stop playback of subsequent packets.
      }
    }
  }, [liveAudioPackets, playerId, connectedPeers])

  useEffect(() => {
    const waitingFor = players.some(player => player.id !== playerId && player.connected && player.voice_ready)
    if (!waitingFor || connectedPeers.length) { setConnectionSlow(false); return }
    const timer = window.setTimeout(() => setConnectionSlow(true), 12000)
    return () => window.clearTimeout(timer)
  }, [players, playerId, connectedPeers.length])

  function toggleMute() {
    if (!localStreamRef.current) {
      setStatus('starting')
      startPromiseRef.current = null
      void startMicrophone()
      return
    }
    const next = !muted
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next })
    audioRef.current.forEach(audio => { void audio.play().catch(() => undefined) })
    setMuted(next)
  }

  function enablePlayback() {
    const relayPlayback = relayPlaybackRef.current
    void Promise.all([...audioRef.current.values()].map(audio => audio.play()).concat(relayPlayback ? [relayPlayback.resume()] : [])).then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
  }

  const voiceCount = connectedPeers.length + 1
  const statusText = `${voiceCount} ${voiceCount === 1 ? 'player' : 'players'} connected`
  return <aside className={`voice-panel live-voice-panel content-panel ${drawerOpen ? 'voice-drawer-open' : ''}`} aria-label="Live table voice"><button type="button" className="voice-drawer-toggle" onClick={() => setDrawerOpen(open => !open)} aria-expanded={drawerOpen} aria-label={drawerOpen ? 'Close live voice controls' : 'Open live voice controls'}>{muted ? <Mic size={20} /> : <MicOff size={20} />}<ChevronDown size={14} /></button><div className="voice-heading"><span className={`voice-icon ${status === 'live' ? 'voice-live' : ''}`}><Volume2 size={17} /></span><div><strong>Live table voice</strong><small>{statusText}</small></div><span className="status-dot online" /></div><div className="live-voice-room"><button type="button" className={`live-mic-orbit ${status === 'live' && !muted ? 'mic-active' : ''}`} onClick={toggleMute} disabled={!enabled || status === 'starting' || status === 'unsupported' || status === 'failed'} aria-label={!localStreamRef.current ? 'Start live microphone' : muted ? 'Unmute live microphone' : 'Mute live microphone'}><span>{muted ? <MicOff size={27} /> : <Mic size={27} />}</span></button><strong>{status === 'starting' ? 'Opening microphone…' : muted ? 'Tap the mic to speak live' : 'You are speaking live'}</strong><small>{voiceError || (connectionSlow ? 'Direct voice connection failed. This network may require a TURN server.' : 'Nothing is recorded. Everyone at the table hears you live.')}</small></div><div className="voice-compose">{status === 'blocked' ? <button type="button" className="button button-green full-button" onClick={() => { startPromiseRef.current = null; setStatus('starting'); void startMicrophone() }}><Mic size={16} /> Allow microphone</button> : playbackBlocked ? <button type="button" className="button button-green full-button" onClick={enablePlayback}><Volume2 size={16} /> Enable speaker</button> : <button type="button" className={`button ${muted ? 'button-green' : 'button-outline'} full-button`} disabled={!enabled || status === 'starting'} onClick={toggleMute}>{muted ? <><Mic size={16} /> Tap to speak</> : <><MicOff size={16} /> Stop speaking</>}</button>}<span className="voice-hint">Live only · no recording is saved</span></div></aside>
}

function VoicePanel({ messages, chatMessages, playerId, enabled }: { messages: VoiceMessage[]; chatMessages: ChatMessage[]; playerId: string; enabled: boolean }) {
  const { voiceUrls, requestVoice, send } = useArena()
  const [notification, setNotification] = useState('')
  const [open, setOpen] = useState(false)
  const [textMessage, setTextMessage] = useState('')
  const [unread, setUnread] = useState(0)
  const previousMessageCountRef = useRef(messages.length)
  const previousChatCountRef = useRef(chatMessages.length)

  useEffect(() => {
    if (messages.length > previousMessageCountRef.current) {
      const latest = messages[messages.length - 1]
      setNotification(`New voice note from ${latest.name}`)
      if (!open && latest.player_id !== playerId) setUnread(previous => previous + 1)
      playGameSound('join')
      const timer = window.setTimeout(() => setNotification(''), 3500)
      previousMessageCountRef.current = messages.length
      return () => window.clearTimeout(timer)
    }
    previousMessageCountRef.current = messages.length
  }, [messages, open, playerId])

  useEffect(() => {
    if (chatMessages.length > previousChatCountRef.current) {
      const latest = chatMessages[chatMessages.length - 1]
      if (!open && latest.player_id !== playerId) {
        setUnread(previous => previous + 1)
        playGameSound('join')
      }
    }
    previousChatCountRef.current = chatMessages.length
  }, [chatMessages, open, playerId])

  function sendTextMessage(event: React.FormEvent) {
    event.preventDefault()
    const text = textMessage.trim()
    if (!text) return
    send('chat', { text })
    setTextMessage('')
  }

  function toggleChat() {
    setOpen(previous => !previous)
    setUnread(0)
  }

  const feed = [
    ...chatMessages.map(message => ({ kind: 'text' as const, sent_at: message.sent_at, message })),
    ...messages.map(message => ({ kind: 'voice' as const, sent_at: message.sent_at, message })),
  ].sort((a, b) => a.sent_at - b.sent_at)
  const phoneTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return createPortal(<div className="table-chat-shell">
    <button type="button" className={`chat-fab ${open ? 'chat-fab-open' : ''}`} onClick={toggleChat} aria-label={open ? 'Close table chat' : 'Open table chat'}>{open ? <X size={21} /> : <><MessageCircle size={21} />{unread > 0 && <span>{Math.min(unread, 9)}</span>}</>}</button>
    {open && <aside className="table-chat-phone" aria-label="Table chat">
      <div className="iphone-screen">
      <div className="iphone-statusbar" aria-hidden="true"><strong>{phoneTime}</strong><span className="iphone-island" /><span className="iphone-signals"><Signal size={12} fill="currentColor" /><Wifi size={13} /><BatteryFull size={16} /></span></div>
      <div className="iphone-chat-header"><button type="button" className="icon-button iphone-back" onClick={toggleChat} aria-label="Close chat"><ArrowLeft size={19} /></button><span className="iphone-contact"><Users size={17} /></span><div><strong>WHOT Table</strong><small><span /> {notification || 'Players online'}</small></div><button type="button" className="icon-button" onClick={toggleChat} aria-label="Close chat"><X size={17} /></button></div>
      <div className="iphone-chat-date">Today</div>
      <div className="voice-feed chat-feed" aria-live="polite">
        {feed.length ? feed.map(item => item.kind === 'text' ? <div className={`chat-bubble ${item.message.player_id === playerId ? 'chat-bubble-mine' : ''}`} key={`text-${item.message.id}`}><div className="voice-message-meta"><strong>{item.message.name}</strong><time>{new Date(item.message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{item.message.text}</p></div> : <div className={`voice-message ${item.message.player_id === playerId ? 'chat-bubble-mine' : ''}`} key={`voice-${item.message.id}`}><div className="voice-message-meta"><strong>{item.message.name}</strong><time>{new Date(item.message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>{voiceUrls[item.message.id] ? <audio controls preload="none" src={voiceUrls[item.message.id]} aria-label={`Voice message from ${item.message.name}`} /> : <button className="voice-play" onClick={() => requestVoice(item.message.id)}><Volume2 size={14} /> Listen <span>{Math.max(1, Math.round(item.message.size / 16_000))} KB</span></button>}</div>) : <div className="voice-empty"><Mic size={19} /><span>No messages yet.</span><small>Say hello to the table.</small></div>}
      </div>
      <div className="voice-compose chat-compose">
        <form onSubmit={sendTextMessage}><input value={textMessage} maxLength={500} onChange={event => setTextMessage(event.target.value)} placeholder="Message" aria-label="Message the table" disabled={!enabled} /><button type="submit" className="icon-button iphone-send" disabled={!enabled || !textMessage.trim()} aria-label="Send message"><ArrowRight size={17} /></button></form>
        <span className="voice-hint">Use Live table voice to speak · voice is not recorded</span>
      </div>
      <span className="iphone-homebar" aria-hidden="true" />
      </div>
    </aside>}
  </div>, document.body)
}

function Profile() {
  const { user } = useArena()
  const [profile, setProfile] = useState<User | null>(user)
  const [status, setStatus] = useState('')
  useEffect(() => {
    const token = sessionStorage.getItem('whot.token')
    if (!token) return
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } }).then(async response => {
      if (!response.ok) throw new Error('Sign in to view your account profile.')
      const result = await response.json() as User; setProfile(result); localStorage.setItem('whot.user', JSON.stringify(result))
    }).catch(error => setStatus(error instanceof Error ? error.message : 'Profile unavailable'))
  }, [])
  async function saveCosmetics(field: 'theme' | 'card_back' | 'avatar', value: string) {
    if (!profile) return
    setStatus('Saving your Arena style…')
    const payload = { theme: profile.selected_theme, card_back: profile.selected_card_back, avatar: profile.selected_avatar, [field]: value }
    try {
      const response = await fetch(`${API_URL}/api/profile/cosmetics`, { method: 'PUT', headers: { Authorization: `Bearer ${sessionStorage.getItem('whot.token')}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not save cosmetics')
      const result = await response.json() as User
      setProfile(result); localStorage.setItem('whot.user', JSON.stringify(result)); setStatus('Arena style saved.')
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : 'Could not save cosmetics') }
  }
  const xpInLevel = (profile?.xp || 0) % 500
  const achievementNames: Record<string, string> = { first_win: 'First Victory', hot_streak: 'Hot Streak', arena_regular: 'Arena Regular', level_five: 'Level Five' }
  return <><PageTitle eyebrow="PLAYER PROGRESSION" title={profile?.username || 'Your player card'} detail="Play matches, earn XP, build streaks, and unlock your Arena style." />
    <section className="profile-panel content-panel"><div className={`profile-avatar avatar-cosmetic-${profile?.selected_avatar || 'initial'}`}>{profile ? avatarGlyph(profile.username, profile.selected_avatar) : <UserRound size={34} />}</div><div className="profile-main"><span className="small-label">LEVEL {profile?.level || 1} ARENA PLAYER</span><h2>{profile?.username || 'Guest player'}</h2><p>{profile?.email || 'Sign in to save progression and unlock cosmetics.'}</p><div className="xp-track"><span style={{ width: `${xpInLevel / 5}%` }} /><small>{xpInLevel} / 500 XP to next level</small></div><div className="profile-stats"><div><strong>{profile?.wins ?? '—'}</strong><span>Wins</span></div><div><strong>{profile?.win_streak ?? '—'}</strong><span>Current streak</span></div><div><strong>{profile?.best_win_streak ?? '—'}</strong><span>Best streak</span></div><div><strong>{profile?.xp ?? '—'}</strong><span>Total XP</span></div></div></div>{!profile && <Link className="button button-green" to="/login">Sign in <ArrowRight size={15} /></Link>}</section>
    {profile && <div className="progression-grid"><section className="content-panel achievement-panel"><span className="small-label">ACHIEVEMENTS</span><h2>Your trophy shelf</h2><div className="achievement-list">{Object.entries(achievementNames).map(([id, label]) => <span className={profile.achievements.includes(id) ? 'achievement-earned' : ''} key={id}><Trophy size={16} /><strong>{label}</strong><small>{profile.achievements.includes(id) ? 'Earned' : 'Locked'}</small></span>)}</div></section><section className="content-panel cosmetic-panel"><span className="small-label">UNLOCKABLE STYLE</span><h2>Equip your rewards</h2><label>Table theme<select value={profile.selected_theme} onChange={event => void saveCosmetics('theme', event.target.value)}>{profile.unlocked_themes.map(item => <option key={item}>{item}</option>)}</select></label><label>Card back<select value={profile.selected_card_back} onChange={event => void saveCosmetics('card_back', event.target.value)}>{profile.unlocked_card_backs.map(item => <option key={item}>{item}</option>)}</select></label><label>Avatar<select value={profile.selected_avatar} onChange={event => void saveCosmetics('avatar', event.target.value)}>{profile.unlocked_avatars.map(item => <option key={item}>{item}</option>)}</select></label><p>New rewards unlock at levels 2, 3, 4, and 5.</p></section></div>}
    {status && <div className="info-banner"><Shield size={16} />{status}</div>}</>
}

function HistoryPage() {
  const { user } = useArena()
  const [matches, setMatches] = useState<MatchHistory[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  const [error, setError] = useState('')
  useEffect(() => {
    const token = sessionStorage.getItem('whot.token')
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

function SettingsPage() {
  const { user } = useArena()
  const [nickname, setNickname] = useState(localStorage.getItem('whot.nickname') || user?.username || 'Guest')
  const [sound, setSound] = useState(gameSoundsEnabled)
  const [theme, setTheme] = useState<ColorTheme>(preferredTheme)
  const [saved, setSaved] = useState(false)
  function save() { localStorage.setItem('whot.nickname', nickname.slice(0, 20)); setSaved(true); window.setTimeout(() => setSaved(false), 2200) }
  function toggleSound(enabled: boolean) { setSound(enabled); setGameSoundsEnabled(enabled); if (enabled) playGameSound('preview') }
  function changeTheme(next: ColorTheme) { setTheme(next); applyColorTheme(next) }
  return <><PageTitle eyebrow="PREFERENCES" title="Make it yours." detail="Local settings for this browser. Your account data stays on the server." /><div className="settings-layout"><section className="content-panel settings-panel"><span className="small-label">PLAYER IDENTITY</span><h2>Table name</h2><p>This name appears to other players when you join as a guest.</p><label className="field-label">Display name<input value={nickname} maxLength={20} onChange={event => setNickname(event.target.value)} /></label><button className="button button-green" onClick={save}><Check size={16} /> {saved ? 'Saved' : 'Save preference'}</button></section><section className="content-panel settings-panel"><span className="small-label">APPEARANCE</span><h2>Color mode</h2><p>Choose the Arena appearance that is most comfortable for you.</p><div className="theme-options"><button type="button" className={`theme-option ${theme === 'light' ? 'theme-option-active' : ''}`} onClick={() => changeTheme('light')}><Sun size={18} /><span><strong>Light</strong><small>Bright and clean</small></span></button><button type="button" className={`theme-option ${theme === 'dark' ? 'theme-option-active' : ''}`} onClick={() => changeTheme('dark')}><Moon size={18} /><span><strong>Dark</strong><small>Easy on the eyes</small></span></button></div></section><section className="content-panel settings-panel"><span className="small-label">GAME EXPERIENCE</span><h2>Audio cues</h2><p>Hear subtle cues when players join, cards move, your turn begins, and a round ends.</p><label className="toggle-row"><span><strong>Enable game sounds</strong><small>Saved automatically on this device</small></span><input type="checkbox" checked={sound} onChange={event => toggleSound(event.target.checked)} /></label><button type="button" className="button button-outline" disabled={!sound} onClick={() => playGameSound('preview')}><Volume2 size={16} /> Test sound</button></section><div className="info-banner"><Shield size={16} /> Account email and password are managed by your player account, not stored in these local settings.</div></div></>
}

const rules = [
  ['1', 'Hold On', 'Keep the turn and play again.'],
  ['2', 'Pick Two', 'Adds two to the penalty. It can only be blocked with another Pick Two.'],
  ['5', 'Pick Three', 'Adds three to the penalty. It can only be blocked with another Pick Three.'],
  ['8', 'Suspension', 'Skip the next player.'],
  ['14', 'General Market', 'Every opponent draws one card, then you play again.'],
  ['20', 'WHOT', 'Choose the next shape. WHOT can be played at any time.'],
]
function HelpPage() {
  return <><PageTitle eyebrow="HOW TO PLAY" title="Know the table." detail="These are WHOT Arena's chosen house rules, enforced by the game server." /><section className="rules-intro"><div><span className="small-label">THE OBJECT</span><h2>Be the first to play every card in your hand.</h2><p>Match the top card by shape or number, or draw one card and pass.</p></div><div className="rule-visual"><span className="rule-number">20</span><span>✦</span><small>WILD</small></div></section><div className="rules-grid">{rules.map(([number, title, description]) => <article className="rule-row" key={number}><span className={`rule-token tone-${shapeTone[number === '20' ? 'whot' : 'star']}`}>{number}</span><div><strong>{title}</strong><p>{description}</p></div><ChevronDown size={16} /></article>)}</div><div className="rules-note"><BookOpen size={17} /><div><strong>Penalty blocking and Last Card</strong><p>Pick Two only stacks on Pick Two, while Pick Three only stacks on Pick Three. A player without the matching penalty card picks the accumulated total and loses their turn. When you reach one card, press LAST CARD before the next game action or pick two cards. The CPU must declare too. Special cards 1, 2, 5, 8, 14, and 20 cannot finish a round.</p></div></div><div className="help-actions"><Link className="button button-green" to="/create"><Gamepad2 size={16} /> Start a game</Link><Link className="text-link" to="/settings">Game settings <ArrowRight size={15} /></Link></div></>
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
