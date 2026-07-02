'use client'

/**
 * Auth-page "merch pile": five oversized flat merch cutouts fall under gravity,
 * pile up along the bottom of the screen, and can be shoved with the cursor or
 * grabbed and flung with the mouse. A Matter.js physics canvas, loaded lazily
 * (client + desktop-with-mouse only). Layered behind the form and purely
 * decorative (aria-hidden).
 *
 * Pointer handling follows the Pleasant Company Game-of-Life field: a fixed
 * full-screen canvas that OWNS the pointer (pointer-events + touch-action:none)
 * with the form layered above it, so the mouse pushes merch in the exposed
 * areas while the form and its links stay fully usable. Matter's own wheel/touch
 * handlers are removed so page scroll is never hijacked.
 *
 * Touch devices, prefers-reduced-motion, and SSR fall back to a static SVG pile
 * with no motion or interaction.
 */

import { useEffect, useRef } from 'react'
import { MERCH_SHAPES, merchTextureUrl, MerchSvg } from './merch-shapes'

// Per-shape size multiplier and resting tilt (deg) for the static fallback.
const SIZE_MULT = [1.05, 1.2, 0.85, 0.9, 1.0]
const FALLBACK_TILT = [-8, 6, -4, 8, -6]
const TEXTURE_PX = 512

export default function MerchPile() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const fallback = fallbackRef.current
    if (!canvas || !container) return

    const media = (q: string) =>
      typeof window.matchMedia === 'function' ? window.matchMedia(q) : null
    const reduced = media('(prefers-reduced-motion: reduce)')?.matches
    const finePointer = media('(pointer: fine)')?.matches
    // Keep the static fallback for reduced motion, touch, or non-DOM (test) envs.
    if (reduced || !finePointer) return

    let disposed = false
    let teardown: (() => void) | null = null

    import('matter-js')
      .then((mod) => {
        if (disposed) return
        const Matter = ((mod as { default?: typeof import('matter-js') }).default ??
          mod) as typeof import('matter-js')
        teardown = startPile(Matter, canvas, container)
        fallback?.classList.add('hidden')
      })
      .catch(() => {
        /* leave the static fallback in place */
      })

    return () => {
      disposed = true
      teardown?.()
      fallback?.classList.remove('hidden')
    }
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Live physics canvas. It only claims the pointer (and touch-action) once
          physics actually starts — see startPile — so on touch / reduced-motion
          fallbacks it never blocks page scrolling. */}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none h-full w-full" />

      {/* Static fallback (reduced motion / touch / SSR). Hidden once physics runs. */}
      <div
        ref={fallbackRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center -space-x-6"
      >
        {MERCH_SHAPES.map((shape, i) => (
          <MerchSvg
            key={shape.name}
            shape={shape}
            className="h-auto w-[22vw] max-w-[14rem] origin-bottom drop-shadow-[0_12px_20px_rgba(0,0,0,0.12)]"
            style={{ transform: `rotate(${FALLBACK_TILT[i]}deg)` }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Boot the Matter.js world on `canvas` sized to `container`. Returns a teardown
 * that stops the loop, drops listeners, and clears the world.
 */
function startPile(
  Matter: typeof import('matter-js'),
  canvas: HTMLCanvasElement,
  container: HTMLElement,
): () => void {
  const { Engine, Render, Runner, Bodies, Composite, Body, Mouse, MouseConstraint, Events } = Matter

  const engine = Engine.create()
  engine.gravity.y = 1

  let W = container.clientWidth
  let H = container.clientHeight

  const render = Render.create({
    canvas,
    engine,
    options: {
      width: W,
      height: H,
      background: 'transparent',
      wireframes: false,
      pixelRatio: window.devicePixelRatio || 1,
    },
  })

  // ---- Boundaries: floor + side walls. Walls are pulled INWARD (a central
  // corridor) so five big bodies heap up on top of each other instead of
  // spreading into a thin row across the whole width. ---------------------------
  const wallOpts = { isStatic: true, render: { visible: false } }
  const ground = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const leftWall = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const rightWall = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const positionBounds = () => {
    const margin = Math.max(40, W * 0.04) // keep bodies just inside the viewport
    Body.setPosition(ground, { x: W / 2, y: H + 50 })
    Body.setVertices(ground, Bodies.rectangle(W / 2, H + 50, W + 400, 120).vertices)
    Body.setPosition(leftWall, { x: margin - 60, y: H / 2 })
    Body.setVertices(leftWall, Bodies.rectangle(margin - 60, H / 2, 120, H * 3).vertices)
    Body.setPosition(rightWall, { x: W - margin + 60, y: H / 2 })
    Body.setVertices(rightWall, Bodies.rectangle(W - margin + 60, H / 2, 120, H * 3).vertices)
  }
  positionBounds()
  Composite.add(engine.world, [ground, leftWall, rightWall])

  // ---- Merch bodies: drop from just above the top, spread across a wide band
  // with overlap so they land side-by-side and heap into a low pile along the
  // floor (cropped by the bottom edge) rather than a tall central tower ---------
  const base = Math.max(150, Math.min(W * 0.17, 240))
  const bodies = MERCH_SHAPES.map((shape, idx) => {
    const size = base * SIZE_MULT[idx]
    const spread = (idx - (MERCH_SHAPES.length - 1) / 2) * base * 0.7
    const jitter = ((idx * 71) % 60) - 30 // small nudge so they don't land in a perfect line
    const b = Bodies.rectangle(W / 2 + spread + jitter, -size * 0.6 - (idx % 2) * 160, size, size, {
      restitution: 0,
      friction: 0.95,
      frictionAir: 0.005,
      chamfer: { radius: size * 0.08 },
      render: {
        sprite: {
          texture: merchTextureUrl(shape, TEXTURE_PX),
          xScale: size / TEXTURE_PX,
          yScale: size / TEXTURE_PX,
        },
      },
    })
    Body.setAngularVelocity(b, (idx % 2 ? 1 : -1) * 0.06)
    return b
  })
  Composite.add(engine.world, bodies)

  // ---- Mouse: drag/fling (MouseConstraint) + shove on fast move ---------------
  const mouse = Mouse.create(canvas)
  // Matter binds these on the canvas; grab the refs so we can detach them.
  const handlers = mouse as unknown as {
    mousewheel: EventListener
    mousemove: EventListener
    mousedown: EventListener
    mouseup: EventListener
  }
  // Don't let the physics canvas eat wheel / touch — the page must still scroll.
  canvas.removeEventListener('wheel', handlers.mousewheel)
  canvas.removeEventListener('touchmove', handlers.mousemove)
  canvas.removeEventListener('touchstart', handlers.mousedown)
  canvas.removeEventListener('touchend', handlers.mouseup)

  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  })
  Composite.add(engine.world, mouseConstraint)
  render.mouse = mouse

  // Cursor shove: a fast-moving pointer pushes nearby (un-grabbed) bodies away.
  let last = { x: 0, y: 0 }
  let hasLast = false
  const onBeforeUpdate = () => {
    const m = mouse.position
    if (!hasLast) {
      last = { x: m.x, y: m.y }
      hasLast = true
      return
    }
    const dx = m.x - last.x
    const dy = m.y - last.y
    last = { x: m.x, y: m.y }
    const speed = Math.hypot(dx, dy)
    if (speed < 1) return
    const radius = base * 0.85
    for (const b of bodies) {
      if (b === mouseConstraint.body) continue // let the grabbed body follow the cursor
      const ox = b.position.x - m.x
      const oy = b.position.y - m.y
      const dist = Math.hypot(ox, oy)
      if (dist > radius || dist < 0.001) continue
      const falloff = 1 - dist / radius
      const strength = 0.0009 * Math.min(speed, 80) * falloff * b.mass
      Body.applyForce(b, b.position, { x: (ox / dist) * strength, y: (oy / dist) * strength })
    }
  }
  Events.on(engine, 'beforeUpdate', onBeforeUpdate)

  // ---- Run --------------------------------------------------------------------
  // Claim the pointer now that physics is live (kept off until here so touch /
  // reduced-motion fallbacks never block page scrolling).
  canvas.style.pointerEvents = 'auto'
  canvas.style.touchAction = 'none'
  Render.run(render)
  const runner = Runner.create()
  Runner.run(runner, engine)

  // ---- Resize: refit canvas + reposition bounds -------------------------------
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      W = container.clientWidth
      H = container.clientHeight
      const dpr = window.devicePixelRatio || 1
      render.options.width = W
      render.options.height = H
      render.canvas.width = W * dpr
      render.canvas.height = H * dpr
      render.canvas.style.width = `${W}px`
      render.canvas.style.height = `${H}px`
      render.bounds.max.x = W
      render.bounds.max.y = H
      positionBounds()
    }, 200)
  }
  window.addEventListener('resize', onResize)

  return () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    window.removeEventListener('resize', onResize)
    Events.off(engine, 'beforeUpdate', onBeforeUpdate)
    Render.stop(render)
    Runner.stop(runner)
    canvas.removeEventListener('mousemove', handlers.mousemove)
    canvas.removeEventListener('mousedown', handlers.mousedown)
    canvas.removeEventListener('mouseup', handlers.mouseup)
    Composite.clear(engine.world, false)
    Engine.clear(engine)
    canvas.style.pointerEvents = ''
    canvas.style.touchAction = ''
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }
}
