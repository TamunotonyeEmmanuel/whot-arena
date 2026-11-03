import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, Avatar, CardFace, RematchAction, microphoneFailureMessage, normalizeTurnUrl, relayPlaybackStartAt, shouldUseRelayFallback } from './main'

class NotificationTestSocket {
  static OPEN = 1
  readyState = NotificationTestSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor() {
    window.setTimeout(() => this.onopen?.(new Event('open')), 0)
  }

  send() {}

  close() {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('WebSocket', NotificationTestSocket)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('WHOT Arena web client', () => {
  it('navigates from the landing screen to the rules page', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: /how to play/i }))

    expect(screen.getByRole('heading', { name: 'Know the table.' })).toBeInTheDocument()
    expect(screen.getByText('Pick Two')).toBeInTheDocument()
  })

  it('exposes an accessible WHOT card control', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<CardFace card={{ id: 'wild', shape: 'whot', number: 20 }} playable onClick={onClick} />)

    const card = screen.getByRole('button', { name: 'Play 20 whot' })
    expect(card.querySelector('.card-glyph')).toHaveTextContent('WHOT')
    expect(card.querySelector('.whot-number-top')).toHaveTextContent('20')
    expect(card.querySelector('.whot-number-bottom')).toHaveTextContent('20')
    expect(card.querySelector('.whot-number-top small')).toHaveTextContent('W')
    expect(card.querySelector('.whot-number-bottom small')).toHaveTextContent('W')
    expect(card.querySelector('.card-whot-label')).not.toBeInTheDocument()

    await user.click(card)

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('explains why microphone capture failed and how to retry', () => {
    expect(microphoneFailureMessage(new DOMException('', 'NotAllowedError')))
      .toContain('Allow microphone access')
    expect(microphoneFailureMessage(new DOMException('', 'NotFoundError')))
      .toContain('No microphone was found')
  })

  it('keeps new-match action in the room for any connected player', async () => {
    const onRematch = vi.fn()
    const user = userEvent.setup()
    render(<RematchAction players={[
      { id: 'host', name: 'Host', count: 0, connected: true },
      { id: 'guest', name: 'Guest', count: 0, connected: true },
    ]} isNewMatch onRematch={onRematch} />)

    await user.click(screen.getByRole('button', { name: /new match/i }))

    expect(onRematch).toHaveBeenCalledOnce()
  })

  it('waits in the room until every player reconnects before rematch', () => {
    render(<RematchAction players={[
      { id: 'host', name: 'Host', count: 0, connected: true },
      { id: 'guest', name: 'Guest', count: 0, connected: false },
    ]} isNewMatch onRematch={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Waiting for players to reconnect' })).toBeDisabled()
  })

  it('disables a card when it is not marked playable', () => {
    render(<CardFace card={{ id: 'card', shape: 'square', number: 4 }} />)

    expect(screen.getByRole('button', { name: 'Play 4 square' })).toBeDisabled()
  })

  it('renders the selected avatar portrait asset', () => {
    render(<Avatar name="Player One" avatar="crown" />)

    expect(screen.getByRole('img', { name: 'Player One avatar' }).querySelector('img')).toHaveAttribute('src', '/avatars/crown.svg')
  })

  it('uses the relay when a direct voice connection is still connecting', () => {
    expect(shouldUseRelayFallback('connecting')).toBe(true)
    expect(shouldUseRelayFallback('connected')).toBe(false)
    expect(shouldUseRelayFallback('closed')).toBe(false)
  })

  it('keeps relay audio moving with a short jitter buffer', () => {
    expect(relayPlaybackStartAt(undefined, 10)).toBeCloseTo(10.18)
    expect(relayPlaybackStartAt(9.9, 10)).toBeCloseTo(10.025)
    expect(relayPlaybackStartAt(10.2, 10)).toBeCloseTo(10.2)
    expect(relayPlaybackStartAt(12, 10)).toBeCloseTo(10.18)
  })

  it('normalizes TURN URLs to WebRTC ICE server syntax', () => {
    expect(normalizeTurnUrl('turns://global.relay.metered.ca:443?transport=tcp'))
      .toBe('turns:global.relay.metered.ca:443?transport=tcp')
    expect(normalizeTurnUrl('turn:relay.example:3478?transport=udp'))
      .toBe('turn:relay.example:3478?transport=udp')
  })

  it('lists authenticated tables with player, turn, stake, and participation details', async () => {
    localStorage.setItem('whot.token', 'account-token')
    localStorage.setItem('whot.user', JSON.stringify({
      id: 1, username: 'Ada', email: 'ada@example.com', wins: 0, arena_coins: 500,
      matches_played: 0, xp: 0, level: 1, win_streak: 0, best_win_streak: 0,
      achievements: [], unlocked_themes: ['classic'], unlocked_card_backs: ['classic'],
      unlocked_avatars: ['initial'], selected_theme: 'classic',
      selected_card_back: 'classic', selected_avatar: 'initial', is_admin: false,
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tables: [{
          code: 'A1B2C3', status: 'playing', player_count: 2, total_seats: 2,
          wager: 50, wager_pot: 100, current_turn_name: 'Ada', is_your_turn: true,
          your_connected: false, participation_status: 'away',
          players: [
            { id: 'ada', name: 'Ada', count: 5, connected: false, is_bot: false, is_you: true },
            { id: 'ben', name: 'Ben', count: 4, connected: true, is_bot: false, is_you: false },
          ],
        }],
      }),
    }))
    window.history.pushState({}, '', '/tables')
    render(<App />)

    expect(await screen.findByText('A1B2C3')).toBeInTheDocument()
    expect(screen.getByText('2/2 players')).toBeInTheDocument()
    expect(screen.getByText("Ada's turn")).toBeInTheDocument()
    expect(screen.getByText('You are away')).toBeInTheDocument()
    expect(screen.getByText('₦50 stake · ₦100 pot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resume table/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave table/i })).toBeInTheDocument()
  })

  it('shows the HTTP status when the saved table request fails', async () => {
    localStorage.setItem('whot.token', 'account-token')
    localStorage.setItem('whot.user', JSON.stringify({
      id: 1, username: 'Ada', email: 'ada@example.com', wins: 0, arena_coins: 500,
      matches_played: 0, xp: 0, level: 1, win_streak: 0, best_win_streak: 0,
      achievements: [], unlocked_themes: ['classic'], unlocked_card_backs: ['classic'],
      unlocked_avatars: ['initial'], selected_theme: 'classic',
      selected_card_back: 'classic', selected_avatar: 'initial', is_admin: false,
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    window.history.pushState({}, '', '/tables')
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your tables (HTTP 500)')
  })
})