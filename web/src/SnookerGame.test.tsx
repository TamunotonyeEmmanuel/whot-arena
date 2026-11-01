import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SnookerGame } from './SnookerGame'

afterEach(cleanup)

describe('Snooker phone game', () => {
  it('starts a two-player frame with a red as the target', () => {
    render(<SnookerGame />)

    expect(screen.getByText('PLAYER 1 TO PLAY')).toBeInTheDocument()
    expect(screen.getByText('Target: Red')).toBeInTheDocument()
    expect(screen.getByText('15 reds remaining')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take shot' })).toBeEnabled()
  })

  it('lets players adjust their shot and start a fresh frame', () => {
    render(<SnookerGame />)
    const angle = screen.getByRole('slider', { name: 'Cue angle' })
    const power = screen.getByRole('slider', { name: 'Shot power' })

    fireEvent.change(angle, { target: { value: '24' } })
    fireEvent.change(power, { target: { value: '8' } })

    expect(angle).toHaveValue('24')
    expect(power).toHaveValue('8')

    fireEvent.click(screen.getByRole('button', { name: 'New frame' }))

    expect(angle).toHaveValue('0')
    expect(power).toHaveValue('6')
    expect(screen.getByText('15 reds remaining')).toBeInTheDocument()
  })
})
