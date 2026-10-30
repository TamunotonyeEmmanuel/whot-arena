import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App, CardFace } from './main'

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

    await user.click(screen.getByRole('button', { name: 'Play 20 whot' }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables a card when it is not marked playable', () => {
    render(<CardFace card={{ id: 'card', shape: 'square', number: 4 }} />)

    expect(screen.getByRole('button', { name: 'Play 4 square' })).toBeDisabled()
  })
})