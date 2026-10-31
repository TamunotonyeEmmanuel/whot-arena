import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Crown, DoorOpen, Gamepad2, History, Home, LogIn, LogOut, Menu, Mic, Plus, Radio, Settings, Shield, Sparkles, Square, Trophy, UserRound, Users, Volume2, X } from 'lucide-react'
import './styles.css'
import { gameSoundsEnabled, playGameSound, primeGameAudio, setGameSoundsEnabled } from './audio'

type Card = { id: string; shape: string; number: number }
type Player = { id: string; name: string; count: number; connected: boolean }
type VoiceMessage = { id: string; player_id: string; name: string; content_type: string; size: number; sent_at: number }
type RoomView = {
  code: string; status: 'lobby' | 'playing' | 'finished'; host: string; you: string
  turn: string | null; players: Player[]; hand: Card[]; top: Card | null
  requested_shape: string | null; winner: string | null; last_action: string
  voice_messages: VoiceMessage[]
  is_public: boolean; rules: { cards_per_player: number; pick_two: number; pick_three: number; general_market: number; penalty_stacking: boolean }
}
type Session = { player_id: string; code: string; reconnect_token: string }
type User = { id: number; username: string; email: string; wins: number; matches_played: number }
type MatchHistory = { room_code: string; result: 'win' | 'loss'; player_count: number; completed_at: string }
type ArenaContextValue = {
  view: RoomView | null; session: Session | null; user: User | null; error: string
  connected: boolean; busy: boolean; clearError: () => void
  voiceUrls: Record<string, string>; requestVoice: (messageId: string) => void
  connectRoom: (action: string, values?: Record<string, unknown>) => Promise<Session>
  send: (action: string, values?: Record<string, unknown>) => void
  authenticate: (registering: boolean, values: Record<string, string>) => Promise<void>
  signOut: () => void
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const WS_URL = import.meta.env.VITE_WS_URL || `${API_URL.replace(/^http/, 'ws')}/ws`
const Context = createContext<ArenaContextValue | null>(null)
const readStored = <T,>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null } catch { return null }
}

function ArenaProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<RoomView | null>(null)
  const [session, setSession] = useState<Session | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('whot.session') || 'null') as Session | null }
    catch { return null }
  })
  const [user, setUser] = useState<User | null>(() => readStored<User>('whot.user'))
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({})
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
    sessionStorage.setItem('whot.session', JSON.stringify(next))
  }

  function openSocket(payload: Record<string, unknown>): Promise<Session> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket
      let settled = false
      socket.onopen = () => {
        setConnected(true)
        socket.send(JSON.stringify(payload))
      }
      socket.onmessage = event => {
        let message: { type?: string; data?: RoomView; message?: string; player_id?: string; code?: string; reconnect_token?: string; id?: string; content_type?: string; audio?: string }
        try { message = JSON.parse(String(event.data)) } catch { setError('Received an unreadable server message.'); return }
        if (message.type === 'session' && message.player_id && message.code && message.reconnect_token) {
          const next = { player_id: message.player_id, code: message.code, reconnect_token: message.reconnect_token }
          saveSession(next)
          if (!settled) { settled = true; resolve(next) }
        } else if (message.type === 'state' && message.data) {
          setView(message.data)
        } else if (message.type === 'voice_audio' && message.id && message.content_type && message.audio) {
          const bytes = Uint8Array.from(atob(message.audio), character => character.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: message.content_type }))
          voiceUrlsRef.current.add(url)
          setVoiceUrls(previous => {
            const oldUrl = previous[message.id!]
            if (oldUrl) { URL.revokeObjectURL(oldUrl); voiceUrlsRef.current.delete(oldUrl) }
            return { ...previous, [message.id!]: url }
          })
        } else if (message.type === 'error') {
          setError(message.message || 'The server rejected that action.')
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

  function requestVoice(messageId: string) {
    send('voice_get', { message_id: messageId })
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
    sessionStorage.removeItem('whot.session'); sessionRef.current = null
    setUser(null); setSession(null); setView(null)
    if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close() }
  }

  return <Context.Provider value={{ view, session, user, error, connected, busy, voiceUrls, requestVoice, clearError: () => setError(''), connectRoom, send, authenticate, signOut }}>{children}</Context.Provider>
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

function AppFrame() {
  const { user, session, connected, error, clearError, signOut } = useArena()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const isTable = location.pathname.startsWith('/game/')
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
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><div className="crumb">{location.pathname === '/' ? 'Welcome to the arena' : location.pathname.split('/')[1]?.replace('-', ' ')}</div><div className="top-actions"><span className="server-pill"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'LIVE' : 'READY'}</span><Link className="top-avatar" to={user ? '/profile' : '/login'} aria-label="Open profile">{user ? user.username.slice(0, 1).toUpperCase() : <UserRound size={17} />}</Link></div></header>
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
      {session && <div className="room-chip"><Radio size={14} /> Room {session.code}<span className={`status-dot ${connected ? 'online' : ''}`} /></div>}
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
  const { user, session } = useArena()
  const [profile, setProfile] = useState(user)
  useEffect(() => {
    const token = sessionStorage.getItem('whot.token')
    if (!token) return
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (response.ok) setProfile(await response.json() as User) })
      .catch(() => undefined)
  }, [user?.id])
  return <><PageTitle eyebrow="PLAYER DASHBOARD" title={`Good to see you${user ? `, ${user.username}` : ''}.`} detail="Pick up a game or see how you stack up." action={<Link className="button button-lime" to="/create"><Plus size={17} /> New game</Link>} />
    <div className="stats-row"><Stat icon={<Trophy />} label="Wins" value={profile?.wins ?? '—'} tone="gold" /><Stat icon={<Gamepad2 />} label="Games played" value={profile?.matches_played ?? '—'} tone="green" /><Stat icon={<Radio />} label="Room status" value={session ? 'In room' : 'Ready'} tone="coral" /></div>
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
  async function create(action: 'create' | 'quick_match') {
    setRoomError('')
    try { const next = await connectRoom(action, { name: name.trim() || 'Guest' }); navigate(`/lobby/${next.code}`) }
    catch (error) { setRoomError(error instanceof Error ? error.message : 'Could not create room') }
  }
  return <><PageTitle eyebrow="FIND YOUR TABLE" title="Let's play." detail="Set up a private game or find a player for a quick match." /><div className="setup-layout"><section className="content-panel setup-panel"><span className="setup-number">01</span><span className="small-label">PRIVATE ROOM</span><h2>Bring your own crew.</h2><p>Create a room and share its six-character code. Your friends can join from the web or mobile app.</p><label className="field-label">Your table name<input value={name} maxLength={20} onChange={event => setName(event.target.value)} onBlur={() => localStorage.setItem('whot.nickname', name)} placeholder="Choose a nickname" /></label><button disabled={busy} onClick={() => void create('create')} className="button button-green full-button"><Plus size={17} /> {busy ? 'Opening table…' : 'Create private room'}</button></section><section className="content-panel setup-panel quick-match-panel"><span className="setup-number">02</span><span className="small-label">QUICK MATCH</span><h2>Meet at the table.</h2><p>Open a public lobby and pair up with the next player who joins quick match.</p><div className="quick-match-meta"><span><Users size={15} /> 2–4 players</span><span><Clock3 size={15} /> Usually under a minute</span></div><button disabled={busy} onClick={() => void create('quick_match')} className="button button-lime full-button"><Sparkles size={17} /> {busy ? 'Finding players…' : 'Find a quick match'}</button></section></div>{roomError && <div role="alert" className="form-error form-error-block">{roomError}</div>}<div className="house-rule-callout"><Shield size={17} /><span><strong>Fair play is server-side.</strong> The game server deals cards, checks moves, and decides the winner.</span><Link to="/help">Rules <ArrowRight size={14} /></Link></div></>
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
  return <><PageTitle eyebrow="JOIN A TABLE" title="Got a room code?" detail="Ask your host for the code and pull up a chair." /><form className="join-panel content-panel" onSubmit={submit}><div className="join-card-icon"><DoorOpen size={24} /></div><label className="field-label">Room code<input className="code-input" value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6))} placeholder="ABC123" maxLength={6} required autoCapitalize="characters" /></label><label className="field-label">Your table name<input value={name} maxLength={20} onChange={event => setName(event.target.value)} placeholder="Choose a nickname" /></label>{formError && <div role="alert" className="form-error">{formError}</div>}<button disabled={busy || code.length !== 6} className="button button-green full-button"><DoorOpen size={17} /> {busy ? 'Joining table…' : 'Join this room'}</button><p className="fine-print"><Shield size={14} /> You only see your own cards once play begins.</p></form></>
}

function Lobby() {
  const { code = '' } = useParams()
  const { view, session, connected, send } = useArena()
  const navigate = useNavigate()
  useEffect(() => { if (view?.status === 'playing') navigate(`/game/${view.code}`, { replace: true }) }, [view?.status])
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Finding your table…</h2><p>Reconnecting to room {code.toUpperCase()}</p></div>
  const isHost = view.host === session?.player_id
  return <><PageTitle eyebrow={view.is_public ? 'QUICK MATCH LOBBY' : 'PRIVATE ROOM'} title="The table is set." detail="Share your code and wait for everyone to join." action={<Link to="/dashboard" className="button button-outline"><ArrowLeft size={16} /> Leave view</Link>} /><section className="lobby-room content-panel"><div className="lobby-code"><div><span className="small-label">ROOM CODE</span><strong>{view.code}</strong></div><button className="button button-outline" onClick={() => void navigator.clipboard?.writeText(view.code)}><Check size={15} /> Copy code</button></div><div className="lobby-divider" /><div className="lobby-player-heading"><span className="small-label">PLAYERS</span><span>{view.players.length} / 4 seats</span></div><div className="player-list">{Array.from({ length: 4 }, (_, index) => {
    const player = view.players[index]
    return player ? <div className="lobby-player" key={player.id}><div className={`avatar ${player.id === view.host ? 'host-avatar' : ''}`}>{player.name.slice(0, 1).toUpperCase()}</div><div className="player-copy"><strong>{player.name}{player.id === session?.player_id ? ' (You)' : ''}</strong><span>{player.id === view.host ? 'Host' : 'Ready to play'} · {player.connected ? 'Connected' : 'Reconnecting'}</span></div>{player.id === view.host && <Crown size={17} className="host-crown" />}{player.id === session?.player_id && <span className="you-tag">YOU</span>}</div> : <div className="lobby-player empty-seat" key={`empty-${index}`}><div className="avatar empty-avatar"><Plus size={16} /></div><div className="player-copy"><strong>Waiting for a player</strong><span>Share the room code to fill this seat</span></div></div>
  })}</div><div className="lobby-footer"><div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Room is live' : 'Connecting…'}</div>{isHost ? <button className="button button-lime" disabled={view.players.length < 2 || view.players.some(player => !player.connected)} onClick={() => send('start')}><Gamepad2 size={17} /> Start game <ArrowRight size={16} /></button> : <span className="waiting-label"><span className="pulse-dot" /> Waiting for host to start</span>}</div></section><div className="lobby-footnote"><Shield size={15} /> The server will privately deal five cards to each player when the host starts.</div></>
}

const shapes = ['circle', 'triangle', 'cross', 'square', 'star']
const shapeGlyph: Record<string, string> = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★', whot: 'W' }
const shapeTone: Record<string, string> = { circle: 'blue', triangle: 'red', cross: 'green', square: 'gold', star: 'coral', whot: 'dark' }
function CardFace({ card, large = false, back = false, selected = false, playable = false, onClick, index = 0 }: { card?: Card | null; large?: boolean; back?: boolean; selected?: boolean; playable?: boolean; onClick?: () => void; index?: number }) {
  if (back) return <div className={`whot-card card-back-face ${large ? 'card-large' : ''}`}><span className="back-mark mark-one"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-two"><strong>WHOT</strong><small>ARENA</small></span><span className="back-mark mark-three"><strong>WHOT</strong><small>ARENA</small></span><span className="back-seal">W</span></div>
  if (!card) return <div className={`empty-card ${large ? 'card-large' : ''}`}><span>?</span></div>
  return <button type="button" className={`whot-card ${large ? 'card-large' : ''} tone-${shapeTone[card.shape]} ${selected ? 'card-selected' : ''} ${playable ? 'card-playable' : ''}`} onClick={onClick} disabled={!playable} style={{ '--card-index': index } as React.CSSProperties} aria-label={`Play ${card.number} ${card.shape}`}><span className="card-corner top-corner"><span>{card.number}</span><small>{shapeGlyph[card.shape]}</small></span><span className="card-glyph">{shapeGlyph[card.shape]}</span><span className="card-number">{card.number}</span><span className="card-corner bottom-corner"><span>{card.number}</span><small>{shapeGlyph[card.shape]}</small></span></button>
}

function GameTable() {
  const { code = '' } = useParams()
  const { view, session, send } = useArena()
  const [selectedWhot, setSelectedWhot] = useState<Card | null>(null)
  const [shape, setShape] = useState('circle')
  const [toast, setToast] = useState('')
  const navigate = useNavigate()
  useEffect(() => { if (view?.status === 'finished') setToast(view.winner === session?.player_id ? 'You emptied your hand. What a finish!' : `${view.players.find(player => player.id === view.winner)?.name || 'A player'} takes the round.`) }, [view?.status, view?.winner])
  if (!view || view.code !== code.toUpperCase()) return <div className="center-state"><div className="loader-mark">W</div><h2>Restoring your game…</h2><p>Your hand stays private while the table reconnects.</p></div>
  const me = view.players.find(player => player.id === session?.player_id)
  const opponents = view.players.filter(player => player.id !== session?.player_id)
  const myTurn = view.turn === session?.player_id && view.status === 'playing'
  const isLegal = (card: Card) => card.number === 20 || card.number === view.top?.number || card.shape === (view.requested_shape || view.top?.shape)
  function play(card: Card) {
    if (!myTurn) return
    if (card.number === 20) { setSelectedWhot(card); return }
    send('play', { card_id: card.id })
  }
  function confirmWhot() { if (selectedWhot) { send('play', { card_id: selectedWhot.id, shape }); setSelectedWhot(null) } }
  return (
    <div className="game-page">
      <div className="game-topline">
        <div>
          <Eyebrow>ROOM {view.code}</Eyebrow>
          <span className={`game-status ${myTurn ? 'turn-live' : ''}`}>
            <span className="status-dot online" />
            {view.status === 'finished' ? 'ROUND COMPLETE' : myTurn ? 'YOUR TURN' : `TURN: ${view.players.find(player => player.id === view.turn)?.name || 'OPPONENT'}`}
          </span>
        </div>
        <button className="icon-button game-exit" title="Return to dashboard" onClick={() => navigate('/dashboard')}><ArrowLeft size={18} /></button>
      </div>
      <div className="game-layout">
      <div className="table-column">
      <section className="table-felt">
        <div className="table-stitch" />
        <div className="opponents-row">
          {opponents.map((player, index) => (
            <div className={`opponent ${!player.connected ? 'player-away' : ''} ${view.turn === player.id ? 'opponent-turn' : ''}`} key={player.id}>
              <div className="opponent-avatar-wrap"><div className={`avatar opponent-avatar avatar-${index}`}>{player.name.slice(0, 1).toUpperCase()}</div><span className={`status-dot ${player.connected ? 'online' : ''}`} /></div>
              <strong>{player.name}</strong><span>{player.count} cards</span>{view.turn === player.id && <span className="opponent-turn-label">THEIR TURN</span>}
              <div className="opponent-card-fan">{Array.from({ length: Math.min(player.count, 3) }, (_, cardIndex) => <CardFace key={cardIndex} back />)}</div>
            </div>
          ))}
        </div>
        <div className="center-piles">
          <div className="pile-block"><span className="pile-label">DRAW PILE</span><div className="pile-stack" onClick={() => myTurn && send('draw')} role="button" tabIndex={0} onKeyDown={event => event.key === 'Enter' && myTurn && send('draw')} aria-label="Draw one card and pass"><CardFace back large /><span className="pile-count">{myTurn ? 'TAP TO DRAW' : 'DRAW'}</span></div></div>
          <div className="table-arrow">{myTurn ? <Sparkles size={19} /> : <ArrowRight size={19} />}</div>
          <div className="pile-block"><span className="pile-label">ON THE TABLE</span><div className="top-card-slot"><CardFace card={view.top} large selected /><div className="top-glow" /></div></div>
        </div>
        {view.requested_shape && <div className="requested-shape"><span>SHAPE REQUESTED</span><strong>{shapeGlyph[view.requested_shape]} {view.requested_shape}</strong></div>}
        <div className="table-message" aria-live="polite">{toast || view.last_action}</div>
        <div className="you-at-table"><div className="avatar you-avatar">{(me?.name || 'Y').slice(0, 1).toUpperCase()}</div><div><strong>{me?.name || 'You'} <span>(you)</span></strong><small>{myTurn ? 'Your move' : view.status === 'finished' ? 'Round over' : 'Waiting for your turn'}</small></div>{myTurn && <span className="turn-clock"><Clock3 size={15} /> PLAY NOW</span>}</div>
      </section>
      {view.status === 'finished' ? (
        <section className="round-result">
          <div className="result-icon">{view.winner === session?.player_id ? <Crown size={26} /> : <Trophy size={26} />}</div>
          <div><span className="small-label">ROUND COMPLETE</span><h2>{view.winner === session?.player_id ? 'You won the round!' : `${view.players.find(player => player.id === view.winner)?.name || 'A player'} won.`}</h2><p>The server records the result for registered players. The host can start a rematch when everyone is connected.</p></div>
          {view.host === session?.player_id && view.players.every(player => player.connected)
            ? <button className="button button-green" onClick={() => send('rematch')}>Rematch <ArrowRight size={16} /></button>
            : <Link to="/create" className="button button-green">New table <ArrowRight size={16} /></Link>}
        </section>
      ) : (
        <section className="hand-panel">
          <div className="hand-heading"><div><span className="small-label">YOUR HAND</span><strong>{view.hand.length} cards</strong></div><span className="hand-hint">{myTurn ? 'Choose a matching card or draw to pass' : 'Cards only you can see'}</span></div>
          <div className="hand-cards">{view.hand.map((card, index) => <CardFace key={card.id} card={card} playable={myTurn && isLegal(card)} selected={selectedWhot?.id === card.id} index={index} onClick={() => play(card)} />)}</div>
          {selectedWhot && <div className="shape-picker"><div><span className="small-label">WHOT 20</span><strong>Choose the next shape</strong></div><div className="shape-controls">{shapes.map(item => <button key={item} className={`shape-choice ${shape === item ? 'shape-choice-active' : ''}`} onClick={() => setShape(item)} aria-label={item}>{shapeGlyph[item]}<span>{item}</span></button>)}<button className="button button-lime" onClick={confirmWhot}><Check size={15} /> Play WHOT</button></div></div>}
        </section>
      )}
      </div>
      <VoicePanel messages={view.voice_messages || []} enabled={view.status === 'playing'} />
      </div>
    </div>
  )
}

function VoicePanel({ messages, enabled }: { messages: VoiceMessage[]; enabled: boolean }) {
  const { voiceUrls, requestVoice, send } = useArena()
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  async function recordVoice() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        if (timerRef.current) window.clearTimeout(timerRef.current)
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        if (!blob.size) { setError('No audio was recorded. Check microphone permissions and try again.'); return }
        if (blob.size > 512_000) { setError('That recording is over 512 KB. Try a shorter clip.'); return }
        const contentType = blob.type.split(';')[0]
        if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'].includes(contentType)) {
          setError('This browser produced an unsupported audio format.')
          return
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 16_384) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
        }
        send('voice', { content_type: contentType, audio: btoa(binary) })
      }
      recorder.start()
      setRecording(true)
      timerRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 15_000)
    } catch (reason) {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setRecording(false)
      setError(reason instanceof Error && reason.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to send a voice message.'
        : 'Could not start microphone recording.')
    }
  }

  function stopRecording() {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  return (
    <aside className="voice-panel content-panel" aria-label="Game voice messages">
      <div className="voice-heading"><span className="voice-icon"><Volume2 size={17} /></span><div><strong>Voice notes</strong><small>Only players at this table</small></div><span className="voice-count">{messages.length}/20</span></div>
      <div className="voice-feed" aria-live="polite">
        {messages.length ? messages.map(message => (
          <div className="voice-message" key={message.id}>
            <div className="voice-message-meta"><strong>{message.name}</strong><time>{new Date(message.sent_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
            {voiceUrls[message.id]
              ? <audio controls preload="none" src={voiceUrls[message.id]} aria-label={`Voice message from ${message.name}`} />
              : <button className="voice-play" onClick={() => requestVoice(message.id)}><Volume2 size={14} /> Listen <span>{Math.max(1, Math.round(message.size / 16_000))} KB</span></button>}
          </div>
        )) : <div className="voice-empty"><Mic size={19} /><span>No voice notes yet.</span><small>Send a quick hello to the table.</small></div>}
      </div>
      <div className="voice-compose">
        <button className={`button ${recording ? 'button-recording' : 'button-green'} full-button`} disabled={!enabled && !recording} onClick={recording ? stopRecording : () => void recordVoice()}>
          {recording ? <><Square size={14} fill="currentColor" /> Stop recording</> : <><Mic size={16} /> Record voice note</>}
        </button>
        <span className="voice-hint">{recording ? 'Recording… stops automatically at 15 seconds' : enabled ? 'Up to 15 seconds · microphone permission required' : 'Recording is available during a game'}</span>
        {error && <span className="voice-error" role="alert">{error}</span>}
      </div>
    </aside>
  )
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
  return <><PageTitle eyebrow="PLAYER PROFILE" title={profile?.username || 'Your player card'} detail="Your account stats follow you from match to match." /><section className="profile-panel content-panel"><div className="profile-avatar">{profile?.username?.slice(0, 1).toUpperCase() || <UserRound size={34} />}</div><div className="profile-main"><span className="small-label">ARENA PLAYER</span><h2>{profile?.username || 'Guest player'}</h2><p>{profile?.email || 'Sign in to save your player profile and match statistics.'}</p><div className="profile-stats"><div><strong>{profile?.wins ?? '—'}</strong><span>Wins</span></div><div><strong>{profile?.matches_played ?? '—'}</strong><span>Matches played</span></div><div><strong>{profile && profile.matches_played ? `${Math.round(profile.wins / profile.matches_played * 100)}%` : '—'}</strong><span>Win rate</span></div></div></div>{!profile && <Link className="button button-green" to="/login">Sign in <ArrowRight size={15} /></Link>}</section>{status && <div className="info-banner"><Shield size={16} />{status}</div>}</>
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
  const [saved, setSaved] = useState(false)
  function save() { localStorage.setItem('whot.nickname', nickname.slice(0, 20)); setSaved(true); window.setTimeout(() => setSaved(false), 2200) }
  function toggleSound(enabled: boolean) { setSound(enabled); setGameSoundsEnabled(enabled); if (enabled) playGameSound('preview') }
  return <><PageTitle eyebrow="PREFERENCES" title="Make it yours." detail="Local settings for this browser. Your account data stays on the server." /><div className="settings-layout"><section className="content-panel settings-panel"><span className="small-label">PLAYER IDENTITY</span><h2>Table name</h2><p>This name appears to other players when you join as a guest.</p><label className="field-label">Display name<input value={nickname} maxLength={20} onChange={event => setNickname(event.target.value)} /></label><button className="button button-green" onClick={save}><Check size={16} /> {saved ? 'Saved' : 'Save preference'}</button></section><section className="content-panel settings-panel"><span className="small-label">GAME EXPERIENCE</span><h2>Audio cues</h2><p>Hear subtle cues when players join, cards move, your turn begins, and a round ends.</p><label className="toggle-row"><span><strong>Enable game sounds</strong><small>Saved automatically on this device</small></span><input type="checkbox" checked={sound} onChange={event => toggleSound(event.target.checked)} /></label><button type="button" className="button button-outline" disabled={!sound} onClick={() => playGameSound('preview')}><Volume2 size={16} /> Test sound</button></section><div className="info-banner"><Shield size={16} /> Account email and password are managed by your player account, not stored in these local settings.</div></div></>
}

const rules = [
  ['1', 'Hold On', 'Keep the turn and play again.'],
  ['2', 'Pick Two', 'The next player draws two and loses their turn.'],
  ['5', 'Pick Three', 'The next player draws three and loses their turn.'],
  ['8', 'Suspension', 'Skip the next player.'],
  ['14', 'General Market', 'Every opponent draws one card.'],
  ['20', 'WHOT', 'Choose the next shape. WHOT can be played at any time.'],
]
function HelpPage() {
  return <><PageTitle eyebrow="HOW TO PLAY" title="Know the table." detail="These are WHOT Arena's chosen house rules, enforced by the game server." /><section className="rules-intro"><div><span className="small-label">THE OBJECT</span><h2>Be the first to play every card in your hand.</h2><p>Match the top card by shape or number, or draw one card and pass.</p></div><div className="rule-visual"><span className="rule-number">20</span><span>✦</span><small>WILD</small></div></section><div className="rules-grid">{rules.map(([number, title, description]) => <article className="rule-row" key={number}><span className={`rule-token tone-${shapeTone[number === '20' ? 'whot' : 'star']}`}>{number}</span><div><strong>{title}</strong><p>{description}</p></div><ChevronDown size={16} /></article>)}</div><div className="rules-note"><BookOpen size={17} /><div><strong>A note on variants</strong><p>Nigerian WHOT has regional and household variations. Arena uses its displayed rules: five cards each, no penalty stacking, and the next player draws then loses their turn after Pick Two or Pick Three. You may draw and pass even when you have a playable card.</p></div></div><div className="help-actions"><Link className="button button-green" to="/create"><Gamepad2 size={16} /> Start a game</Link><Link className="text-link" to="/settings">Game settings <ArrowRight size={15} /></Link></div></>
}

function LaunchScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 1450)
    return () => window.clearTimeout(timer)
  }, [onDone])
  return <div className="launch-screen" role="status" aria-label="Loading WHOT Arena"><div className="launch-glow" /><div className="launch-card" aria-hidden="true"><span>W</span></div><div className="launch-wordmark"><strong>WHOT</strong><span>ARENA</span></div><div className="launch-progress" aria-hidden="true"><span /></div><small>SETTING THE TABLE</small></div>
}

function App() {
  const [launching, setLaunching] = useState(true)
  const finishLaunch = React.useCallback(() => setLaunching(false), [])
  return <BrowserRouter><ArenaProvider><AppFrame />{launching && <LaunchScreen onDone={finishLaunch} />}</ArenaProvider></BrowserRouter>
}

export { App, CardFace }

const rootElement = document.getElementById('root')
if (rootElement) createRoot(rootElement).render(<React.StrictMode><App /></React.StrictMode>)
