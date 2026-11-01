import { useEffect, useRef, useState } from 'react'
import './snooker.css'

type Ball = {
  id: string
  color: string
  value: number
  x: number
  y: number
  vx: number
  vy: number
  potted: boolean
}

type Phase = 'red' | 'color' | 'clear' | 'over'

const TABLE = { width: 720, height: 360, left: 34, right: 686, top: 34, bottom: 326 }
const BALL_RADIUS = 9
const COLOR_NAMES: Record<number, string> = { 2: 'Yellow', 3: 'Green', 4: 'Brown', 5: 'Blue', 6: 'Pink', 7: 'Black' }
const COLOR_SPOTS = [
  { value: 2, x: 118, y: 242, color: '#f4d328' },
  { value: 3, x: 118, y: 118, color: '#168b48' },
  { value: 4, x: 118, y: 180, color: '#9a582b' },
  { value: 5, x: 360, y: 180, color: '#2476e8' },
  { value: 6, x: 448, y: 180, color: '#e65e9c' },
  { value: 7, x: 568, y: 180, color: '#191a1d' },
]
const POCKETS = [
  { x: 34, y: 34 }, { x: 360, y: 34 }, { x: 686, y: 34 },
  { x: 34, y: 326 }, { x: 360, y: 326 }, { x: 686, y: 326 },
]

function createFrame(): Ball[] {
  const balls: Ball[] = [
    { id: 'cue', color: '#fffdf1', value: 0, x: 78, y: 150, vx: 0, vy: 0, potted: false },
    ...COLOR_SPOTS.map(spot => ({
      id: `color-${spot.value}`, color: spot.color, value: spot.value,
      x: spot.x, y: spot.y, vx: 0, vy: 0, potted: false,
    })),
  ]
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      balls.push({
        id: `red-${row}-${column}`, color: '#c92832', value: 1,
        x: 476 + row * 17, y: 180 + (column - row / 2) * 18,
        vx: 0, vy: 0, potted: false,
      })
    }
  }
  return balls
}

function replaceColorOnSpot(balls: Ball[], ball: Ball) {
  const spot = COLOR_SPOTS.find(item => item.value === ball.value)
  if (!spot) return
  const position = findOpenSpot(balls, spot.x, spot.y)
  balls.push({ ...ball, ...position, vx: 0, vy: 0, potted: false })
}

function findOpenSpot(balls: Ball[], x: number, y: number) {
  if (balls.every(ball => ball.potted || Math.hypot(ball.x - x, ball.y - y) >= BALL_RADIUS * 2)) return { x, y }
  for (let offset = 1; offset <= 12; offset += 1) {
    const candidateY = y + offset * BALL_RADIUS * 2
    if (candidateY < TABLE.bottom - BALL_RADIUS && balls.every(ball => ball.potted || Math.hypot(ball.x - x, ball.y - candidateY) >= BALL_RADIUS * 2)) {
      return { x, y: candidateY }
    }
  }
  return { x, y: Math.max(TABLE.top + BALL_RADIUS, y - BALL_RADIUS * 3) }
}

function advanceBalls(balls: Ball[], pottedThisShot: Set<string>) {
  const next = balls.map(ball => ({ ...ball }))
  const substeps = 2
  for (let step = 0; step < substeps; step += 1) {
    for (const ball of next) {
      if (ball.potted) continue
      ball.x += ball.vx / substeps
      ball.y += ball.vy / substeps
      ball.vx *= 0.989
      ball.vy *= 0.989
      if (Math.hypot(ball.vx, ball.vy) < 0.025) { ball.vx = 0; ball.vy = 0 }

      const pocket = POCKETS.some(item => Math.hypot(ball.x - item.x, ball.y - item.y) < 17)
      if (pocket) {
        ball.potted = true
        ball.vx = 0
        ball.vy = 0
        pottedThisShot.add(ball.id)
        continue
      }

      if (ball.x < TABLE.left + BALL_RADIUS || ball.x > TABLE.right - BALL_RADIUS) {
        ball.x = Math.min(TABLE.right - BALL_RADIUS, Math.max(TABLE.left + BALL_RADIUS, ball.x))
        ball.vx *= -0.82
      }
      if (ball.y < TABLE.top + BALL_RADIUS || ball.y > TABLE.bottom - BALL_RADIUS) {
        ball.y = Math.min(TABLE.bottom - BALL_RADIUS, Math.max(TABLE.top + BALL_RADIUS, ball.y))
        ball.vy *= -0.82
      }
    }

    for (let i = 0; i < next.length; i += 1) {
      const first = next[i]
      if (first.potted) continue
      for (let j = i + 1; j < next.length; j += 1) {
        const second = next[j]
        if (second.potted) continue
        const dx = second.x - first.x
        const dy = second.y - first.y
        const distance = Math.hypot(dx, dy)
        if (distance === 0 || distance >= BALL_RADIUS * 2) continue
        const nx = dx / distance
        const ny = dy / distance
        const overlap = BALL_RADIUS * 2 - distance
        first.x -= nx * overlap / 2
        first.y -= ny * overlap / 2
        second.x += nx * overlap / 2
        second.y += ny * overlap / 2
        const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny
        if (relative >= 0) continue
        first.vx += relative * nx
        first.vy += relative * ny
        second.vx -= relative * nx
        second.vy -= relative * ny
      }
    }
  }
  return next
}

export function SnookerGame() {
  const [balls, setBalls] = useState(createFrame)
  const [scores, setScores] = useState([0, 0])
  const [player, setPlayer] = useState(0)
  const [phase, setPhase] = useState<Phase>('red')
  const [angle, setAngle] = useState(0)
  const [power, setPower] = useState(6)
  const [moving, setMoving] = useState(false)
  const [message, setMessage] = useState('Break off: pot a red to start scoring.')
  const ballsRef = useRef(balls)
  const movingRef = useRef(false)
  const pottedRef = useRef(new Set<string>())
  const phaseRef = useRef<Phase>('red')
  const playerRef = useRef(0)
  const scoresRef = useRef([0, 0])

  useEffect(() => { ballsRef.current = balls }, [balls])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { playerRef.current = player }, [player])
  useEffect(() => { scoresRef.current = scores }, [scores])

  useEffect(() => {
    if (!moving) return
    let frame = 0
    let settledFrames = 0
    const animate = () => {
      const next = advanceBalls(ballsRef.current, pottedRef.current)
      ballsRef.current = next
      setBalls(next)
      const fastest = next.reduce((speed, ball) => Math.max(speed, Math.hypot(ball.vx, ball.vy)), 0)
      settledFrames = fastest < 0.08 ? settledFrames + 1 : 0
      if (settledFrames > 8) {
        setMoving(false)
        movingRef.current = false
        finishShot(next, pottedRef.current)
        return
      }
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [moving])

  function finishShot(settled: Ball[], potted: Set<string>) {
    const newlyPotted = settled.filter(ball => potted.has(ball.id))
    const cuePotted = newlyPotted.some(ball => ball.id === 'cue')
    const redsOnTable = settled.filter(ball => ball.value === 1 && !ball.potted).length
    const shotPhase = phaseRef.current
    const expectedValue = shotPhase === 'red' ? 1 : shotPhase === 'clear' ? Math.min(...settled.filter(ball => ball.value > 1 && !ball.potted).map(ball => ball.value), 99) : 0
    const colorValues = newlyPotted.filter(ball => ball.value > 1).map(ball => ball.value)
    const multipleColors = shotPhase === 'color' && new Set(colorValues).size > 1
    const wrongPot = multipleColors || newlyPotted.some(ball => ball.value > 0 && (shotPhase === 'red' ? ball.value !== 1 : shotPhase === 'clear' ? ball.value !== expectedValue : ball.value === 1))
    const legalPots = newlyPotted.filter(ball => ball.value > 0 && !wrongPot && (shotPhase !== 'clear' || ball.value === expectedValue))
    const foul = cuePotted || wrongPot || legalPots.length === 0
    let next = settled.map(ball => ({ ...ball }))
    let nextPhase = shotPhase
    let nextPlayer = playerRef.current
    const nextScores = [...scoresRef.current]

    if (foul) {
      const penalty = Math.max(4, ...newlyPotted.filter(ball => ball.value > 0).map(ball => ball.value))
      nextScores[1 - nextPlayer] += penalty
      nextPlayer = 1 - nextPlayer
      for (const ball of newlyPotted) {
        const index = next.findIndex(item => item.id === ball.id)
        if (ball.value > 1 && index >= 0) {
          next.splice(index, 1)
          replaceColorOnSpot(next, ball)
        }
      }
      setMessage(`Foul: ${penalty} point${penalty === 1 ? '' : 's'} to Player ${nextPlayer + 1}.`)
    } else {
      const points = legalPots.reduce((sum, ball) => sum + ball.value, 0)
      nextScores[nextPlayer] += points
      if (shotPhase === 'red') nextPhase = 'color'
      else if (shotPhase === 'color') nextPhase = redsOnTable > 0 ? 'red' : 'clear'
      else if (shotPhase === 'clear' && !next.some(ball => ball.value > 1 && !ball.potted)) nextPhase = 'over'
      setMessage(points ? `Player ${nextPlayer + 1} scores ${points}. ${nextPhase === 'over' ? 'Frame complete!' : 'Stay at the table.'}` : 'No pot. Turn passes.')
      if (!points) nextPlayer = 1 - nextPlayer
      if (shotPhase === 'color') {
        for (const ball of newlyPotted.filter(item => item.value > 1)) {
          const index = next.findIndex(item => item.id === ball.id)
          if (index >= 0) {
            next.splice(index, 1)
            replaceColorOnSpot(next, ball)
          }
        }
      }
    }

    if (cuePotted) {
      const cue = next.find(ball => ball.id === 'cue')
      if (cue) Object.assign(cue, { x: 78, y: 150, vx: 0, vy: 0, potted: false })
    }
    pottedRef.current = new Set()
    ballsRef.current = next
    phaseRef.current = nextPhase
    playerRef.current = nextPlayer
    scoresRef.current = nextScores
    setBalls(next)
    setScores(nextScores)
    setPlayer(nextPlayer)
    setPhase(nextPhase)
  }

  function shoot() {
    if (movingRef.current || phase === 'over') return
    const cue = ballsRef.current.find(ball => ball.id === 'cue')
    if (!cue || cue.potted) return
    const radians = angle * Math.PI / 180
    const next = ballsRef.current.map(ball => ball.id === 'cue'
      ? { ...ball, vx: Math.cos(radians) * power, vy: Math.sin(radians) * power }
      : { ...ball })
    pottedRef.current = new Set()
    ballsRef.current = next
    setBalls(next)
    setMoving(true)
    movingRef.current = true
    setMessage('Balls in motion…')
  }

  function resetFrame() {
    if (movingRef.current) return
    const next = createFrame()
    pottedRef.current = new Set()
    ballsRef.current = next
    scoresRef.current = [0, 0]
    playerRef.current = 0
    phaseRef.current = 'red'
    setBalls(next)
    setScores([0, 0])
    setPlayer(0)
    setPhase('red')
    setAngle(0)
    setPower(6)
    setMessage('Break off: pot a red to start scoring.')
  }

  const cue = balls.find(ball => ball.id === 'cue')
  const redsLeft = balls.filter(ball => ball.value === 1 && !ball.potted).length
  const targetValue = Math.min(...balls.filter(ball => ball.value > 1 && !ball.potted).map(ball => ball.value), 99)
  const targetText = phase === 'red' ? 'Red' : phase === 'color' ? 'Any colour' : phase === 'clear' ? COLOR_NAMES[targetValue] : 'Frame complete'
  const aimEnd = cue ? {
    x: cue.x + Math.cos(angle * Math.PI / 180) * 100,
    y: cue.y + Math.sin(angle * Math.PI / 180) * 100,
  } : { x: 0, y: 0 }

  return <section className="snooker-app" aria-label="Snooker game">
    <div className="snooker-scoreboard">
      {[0, 1].map(index => <div className={player === index && phase !== 'over' ? 'snooker-active-player' : ''} key={index}>
        <span>PLAYER {index + 1}</span><strong>{scores[index]}</strong>
      </div>)}
      <button type="button" className="snooker-reset" onClick={resetFrame} disabled={moving}>New frame</button>
    </div>
    <div className="snooker-target"><span>{phase === 'over' ? 'FRAME COMPLETE' : `PLAYER ${player + 1} TO PLAY`}</span><strong>{phase === 'over' ? 'Well played' : `Target: ${targetText}`}</strong><small>{redsLeft} reds remaining</small></div>
    <svg className="snooker-table" viewBox={`0 0 ${TABLE.width} ${TABLE.height}`} role="img" aria-label="Snooker table with cue ball, reds, colours and six pockets">
      <rect x="0" y="0" width={TABLE.width} height={TABLE.height} rx="28" fill="#6a3e21" />
      <rect x="20" y="20" width="680" height="320" rx="22" fill="#d2a35d" />
      <rect x={TABLE.left} y={TABLE.top} width={TABLE.right - TABLE.left} height={TABLE.bottom - TABLE.top} rx="12" fill="#087747" />
      <path d="M118 35v290M118 107a73 73 0 0 1 0 146" fill="none" stroke="#f8f2d6" strokeOpacity=".8" strokeWidth="1.5" />
      <circle cx="360" cy="180" r="2" fill="#f8f2d6" />
      {POCKETS.map((pocket, index) => <circle key={index} cx={pocket.x} cy={pocket.y} r="17" fill="#14130f" />)}
      {cue && !cue.potted && phase !== 'over' && <line x1={cue.x} y1={cue.y} x2={aimEnd.x} y2={aimEnd.y} stroke="#fff9db" strokeOpacity=".68" strokeDasharray="5 5" strokeWidth="1.5" />}
      {balls.filter(ball => !ball.potted).map(ball => <g key={ball.id} aria-label={`${ball.id.startsWith('red') ? 'Red' : ball.id === 'cue' ? 'Cue ball' : `${ball.value}-point ball`}`}>
        <circle cx={ball.x} cy={ball.y} r={BALL_RADIUS} fill={ball.color} stroke={ball.id === 'cue' ? '#d9d4c3' : '#ffffff66'} strokeWidth="1" />
        <circle cx={ball.x - 2.8} cy={ball.y - 3} r="2.1" fill="#ffffff85" />
      </g>)}
    </svg>
    <p className="snooker-message" role="status">{message}</p>
    <label className="snooker-control"><span>Aim <b>{angle}°</b></span><input aria-label="Cue angle" type="range" min="-60" max="60" step="1" value={angle} onChange={event => setAngle(Number(event.target.value))} disabled={moving || phase === 'over'} /></label>
    <label className="snooker-control"><span>Power <b>{power}</b></span><input aria-label="Shot power" type="range" min="2" max="10" step=".5" value={power} onChange={event => setPower(Number(event.target.value))} disabled={moving || phase === 'over'} /></label>
    <button className="snooker-shoot" type="button" onClick={shoot} disabled={moving || phase === 'over'}>{moving ? 'Shot in progress…' : phase === 'over' ? 'Frame complete' : 'Take shot'}</button>
    <small className="snooker-help">Two-player local frame · pot reds, then a colour · misses pass the turn.</small>
  </section>
}
