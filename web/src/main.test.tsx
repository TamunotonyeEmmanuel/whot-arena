import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App, Avatar, CardFace, RematchAction, normalizeTurnUrl, relayPlaybackStartAt, shouldUseRelayFallback } from './main'

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
    expect(card.querySelector('.card-glyph')).toHaveTextContent('✦')
    expect(card.querySelector('.card-whot-label')).toHaveTextContent('WHOT')
    expect(card.querySelector('.top-corner')).toHaveTextContent('20')

    await user.click(card)

    expect(onClick).toHaveBeenCalledOnce()
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
})