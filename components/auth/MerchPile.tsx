'use client'

/**
 * Auth-page "merch pile": oversized flat merch cutouts rain down from above
 * the top edge of the screen, pile up along the bottom, and can be shoved with
 * the cursor or grabbed and flung with the mouse or a finger. A Matter.js
 * physics canvas, loaded lazily on the client for any device with a pointer —
 * mouse or touch. Layered behind the form and purely decorative (aria-hidden).
 *
 * Pointer handling follows the Pleasant Company Game-of-Life field: a full auth
 * scene canvas that OWNS pointer-events with the form layered above it, so the
 * mouse pushes merch in the exposed areas while the form and its links stay
 * fully usable. Matter's own wheel/touch handlers are removed so page scroll is
 * never hijacked — touch is routed by hand instead, and only claims a gesture
 * that starts on a merch piece.
 *
 * prefers-reduced-motion, pointerless devices, and SSR fall back to a static
 * SVG pile with no motion or interaction.
 */

import { useEffect, useRef } from 'react'
import { MERCH_SHAPES, merchTextureUrl, MerchSvg } from './merch-shapes'

// Per-shape body-size multiplier (canvas pile). Kept close to 1 so the merch
// lands as a compressed cluster without one product dominating the heap.
const SIZE_MULT = [1.14, 1.18, 1.04, 1.08, 1.18, 1.12]
// Per-shape resting tilt (deg) for the static fallback pile.
const FALLBACK_TILT = [-8, 5, -4, 7, -6, 5]
// Landing lane per shape for the sky drop, alternating centre-out. Consecutive
// spawns land on OPPOSITE sides of centre, and the outer lanes belong to the
// highest (last-arriving) pieces — so every piece rains onto empty floor
// beside the settled ones. A monotonic left-to-right column instead stacked
// each piece onto the previous one's shoulder and cascaded the heap sideways
// into a tower.
const DROP_LANE = [-0.5, 0.5, -1.5, 1.5, -2.5, 2.5]
const TEXTURE_PX = 512
// Air drag. The mouse spring has no damping of its own, so a held piece never
// stops swaying/bobbing around a stationary cursor at the pile's low drag —
// against a wall that residual motion becomes a visible rattle. Raise the drag
// while a piece is held (it settles under the cursor within ~half a second)
// and restore the low value on release so free tumbling stays smooth.
const FRICTION_AIR = 0.02
const HELD_FRICTION_AIR = 0.1

export default function MerchPile({ floorOffset = 400 }: { floorOffset?: number }) {
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
    const hasPointer =
      media('(pointer: fine)')?.matches || media('(pointer: coarse)')?.matches
    // Keep the static fallback for reduced motion and pointerless / non-DOM
    // (test) envs — jsdom's matchMedia matches neither pointer query.
    if (reduced || !hasPointer) return

    let disposed = false
    let teardown: (() => void) | null = null

    // Hide the fallback up front: the pieces rain in from above the top edge,
    // and that sky drop should be the intro — not a swap out of an already-
    // settled static pile.
    fallback?.classList.add('hidden')
    import('matter-js')
      .then((mod) => {
        if (disposed) return
        const Matter = ((mod as { default?: typeof import('matter-js') }).default ??
          mod) as typeof import('matter-js')
        teardown = startPile(Matter, canvas, container, floorOffset)
      })
      .catch(() => {
        fallback?.classList.remove('hidden')
      })

    return () => {
      disposed = true
      teardown?.()
      fallback?.classList.remove('hidden')
    }
  }, [floorOffset])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* Live physics canvas. It only claims pointer-events once physics
          actually starts — see startPile — and touch is hit-tested by hand
          there, so page scrolling keeps working everywhere. */}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none h-full w-full" />

      {/* Static fallback (reduced motion / no pointer / SSR / physics failed to
          load). Hidden the moment physics is eligible, so the sky drop is the
          only intro. */}
      <div
        ref={fallbackRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center -space-x-16"
      >
        {MERCH_SHAPES.map((shape, i) => (
          <MerchSvg
            key={shape.name}
            shape={shape}
            className="h-auto w-[32vw] max-w-[19rem] origin-bottom drop-shadow-[0_12px_20px_rgba(0,0,0,0.12)]"
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
  floorOffset: number,
): () => void {
  const { Engine, Render, Runner, Bodies, Composite, Body, Mouse, MouseConstraint, Query, Events, Sleeping } =
    Matter

  const engine = Engine.create()
  engine.enableSleeping = true
  engine.gravity.y = 1.15

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
      // Matter fades sleeping (settled) bodies to half opacity by default,
      // which reads as products greying out on hover. Keep them fully opaque.
      showSleeping: false,
    },
  })

  // Body scale. The outlined shapes fill their viewBox, so a measured base
  // keeps the heap heavy and legible without pushing into the form. Below
  // ~570px (phones) the 170px floor would swamp the screen — six ~170px slabs
  // on a ~390px viewport — so the floor gives way to 30vw there. Desktop
  // widths resolve exactly as before.
  const base = Math.max(Math.min(170, W * 0.3), Math.min(W * 0.17, 245))

  // ---- Boundaries: floor + ceiling + side walls, all flush with the actual
  // viewport edges. The walls used to frame a narrower centred corridor (to
  // compress the pile), but an invisible barrier in the middle of open screen
  // made pieces thrown to the outer sides stop dead and vibrate against
  // "nothing" — the whole viewport is fair play area now. The floor sits ON
  // the bottom edge so the heap rests fully in view (never sinking under the
  // screen), and a ceiling above the top edge stops a flung item leaving the
  // top once the initial sky drop has finished. --------------------------------
  const wallOpts = { isStatic: true, render: { visible: false } }
  const ground = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const ceiling = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const leftWall = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const rightWall = Bodies.rectangle(0, 0, 10, 10, wallOpts)
  const positionBounds = () => {
    const groundHeight = Math.max(240, floorOffset * 0.85)
    // Top face on the bottom edge (y = H) so the heap rests fully in view.
    const groundY = H + groundHeight / 2
    Body.setPosition(ground, { x: W / 2, y: groundY })
    Body.setVertices(ground, Bodies.rectangle(W / 2, groundY, W + 400, groundHeight).vertices)
    // Ceiling: full-width slab whose bottom face sits on the top edge (y = 0).
    // Walls and ceiling are deliberately THICK (480px): the mouse constraint
    // moves the held body positionally, so a big enough single-tick jump can
    // pass a thin slab entirely (tunnelling) and leave the piece trapped
    // outside, rattling against the wall's outer face. The per-tick pull is
    // also bounded (see beforeUpdate), so a jump that clears 480px can't occur.
    Body.setPosition(ceiling, { x: W / 2, y: -240 })
    Body.setVertices(ceiling, Bodies.rectangle(W / 2, -240, W + 1200, 480).vertices)
    // Side walls: inner faces exactly on x = 0 and x = W.
    Body.setPosition(leftWall, { x: -240, y: H / 2 })
    Body.setVertices(leftWall, Bodies.rectangle(-240, H / 2, 480, H * 3).vertices)
    Body.setPosition(rightWall, { x: W + 240, y: H / 2 })
    Body.setVertices(rightWall, Bodies.rectangle(W + 240, H / 2, 480, H * 3).vertices)
  }
  positionBounds()
  // The ceiling stays OUT of the world until every piece has rained fully into
  // view (armed in onBeforeUpdate) — pieces spawn above the top edge, and a
  // pre-armed ceiling would catch them on its outer face, invisible forever.
  let ceilingArmed = false
  Composite.add(engine.world, [ground, leftWall, rightWall])

  // ---- Merch bodies: staggered sky drop. Every piece spawns ABOVE the top
  // edge in one loose column, each 1.25 body-scales higher than the last so no
  // two spawn boxes overlap (overlapping spawns pop apart violently and read
  // as a glitch), then rains in under gravity — lowest first — and settles
  // into a compact, touching bottom cluster. ----------------------------------
  const bodies = MERCH_SHAPES.map((shape, idx) => {
    const size = base * SIZE_MULT[idx]
    // Hitbox = the artwork's tight bounding box (texture is cropped to the same
    // box), so pieces collide and rest exactly where the drawing ends — they
    // visibly touch, with no invisible padding around slim shapes.
    const bw = (size * shape.box.w) / 100
    const bh = (size * shape.box.h) / 100
    const spread = DROP_LANE[idx] * base * 0.55
    const jitter = ((idx * 71) % 34) - 17 // small nudge so they don't land in a perfect line
    const y = -bh * 0.6 - idx * base * 1.25
    const b = Bodies.rectangle(W / 2 + spread + jitter, y, bw, bh, {
      angle: (idx - 2) * 0.035,
      density: 0.0026,
      restitution: 0,
      friction: 0.82,
      frictionStatic: 1.05,
      // Low air drag: pieces glide and tumble smoothly instead of stopping
      // abruptly mid-motion (the reference feel — heavy but graceful).
      frictionAir: FRICTION_AIR,
      chamfer: { radius: size * 0.035 },
      render: {
        sprite: {
          texture: merchTextureUrl(shape, TEXTURE_PX),
          xScale: size / TEXTURE_PX,
          yScale: size / TEXTURE_PX,
        },
      },
    })
    // Gentle alternating tumble for the fall — air drag bleeds most of it off
    // by touchdown, so the heap still settles flat.
    Body.setAngularVelocity(b, (idx % 2 ? 1 : -1) * (0.006 + (idx % 3) * 0.004))
    return b
  })
  Composite.add(engine.world, bodies)

  // ---- Mouse: drag/fling (MouseConstraint) + shove on fast move ---------------
  const mouse = Mouse.create(canvas)
  // Matter reads the canvas pixel ratio via parseInt, truncating fractional
  // ratios (Windows 125%/150% display scaling → 1.25/1.5 becomes 1). That skews
  // every cursor coordinate — grabs land beside the piece you're pointing at,
  // and get worse away from the top-left corner. Feed it the real ratio.
  ;(mouse as unknown as { pixelRatio: number }).pixelRatio = window.devicePixelRatio || 1
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
    // Soft spring grab — the classic Matter mouse feel. Stiffer/damped setups
    // vibrate whenever the held item is pressed into the floor or the pile
    // (constraint and collision solver fight each other every tick).
    constraint: { stiffness: 0.2, render: { visible: false } },
  })
  Composite.add(engine.world, mouseConstraint)
  render.mouse = mouse

  // Cursor affordance: grab over the pile, grabbing while a body is held.
  // Drag also swaps the held piece onto high air drag (see HELD_FRICTION_AIR).
  canvas.style.cursor = 'grab'
  const onStartDrag = () => {
    canvas.style.cursor = 'grabbing'
    if (mouseConstraint.body) mouseConstraint.body.frictionAir = HELD_FRICTION_AIR
  }
  const onEndDrag = () => {
    canvas.style.cursor = 'grab'
    // Restore every body (not just the released one) — covers forced releases.
    for (const b of bodies) b.frictionAir = FRICTION_AIR
  }
  Events.on(mouseConstraint, 'startdrag', onStartDrag)
  Events.on(mouseConstraint, 'enddrag', onEndDrag)

  // A drag must end the moment the button is released — anywhere. Matter only
  // listens for mouseup on the canvas itself, so releasing over a form
  // control, the captcha iframe, or outside the window left the piece glued to
  // the cursor ("sticks to the mouse"). Force-release on window-level mouseup,
  // on tab blur, and the first time the cursor moves with no button held.
  let touchDragging = false
  const releaseDrag = () => {
    ;(mouse as unknown as { button: number }).button = -1
  }
  const onMoveReleaseGuard = (e: MouseEvent) => {
    if (touchDragging) return // synthetic mouse events fired during a touch drag
    if (mouseConstraint.body && (e.buttons & 1) === 0) releaseDrag()
  }
  window.addEventListener('mouseup', releaseDrag)
  window.addEventListener('blur', releaseDrag)
  canvas.addEventListener('mousemove', onMoveReleaseGuard)

  // ---- Touch: grab & fling with a finger. Matter's own canvas touch handlers
  // stay detached (they preventDefault EVERY touch, which would hijack page
  // scrolling), so touches are routed by hand instead: a touch that STARTS on
  // a merch piece becomes a drag, fed through Matter's touch-aware mouse
  // handlers (which preventDefault just that gesture), while a touch on empty
  // canvas is ignored entirely and scrolls the page as normal. Render coords
  // equal CSS px relative to the canvas (the render is W×H styled at W×H px),
  // so the client rect offset is the whole coordinate mapping.
  const onTouchEnd = (e: TouchEvent) => {
    touchDragging = false
    handlers.mouseup(e)
    canvas.removeEventListener('touchmove', handlers.mousemove)
    canvas.removeEventListener('touchend', onTouchEnd)
    canvas.removeEventListener('touchcancel', onTouchEnd)
  }
  const onTouchStart = (e: TouchEvent) => {
    if (touchDragging) return
    const rect = canvas.getBoundingClientRect()
    const t = e.changedTouches[0]
    const hit = Query.point(bodies, { x: t.clientX - rect.left, y: t.clientY - rect.top })
    if (hit.length === 0) return
    touchDragging = true
    handlers.mousedown(e) // sets mouse.position + button; the grab starts next tick
    canvas.addEventListener('touchmove', handlers.mousemove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    canvas.addEventListener('touchcancel', onTouchEnd)
  }
  canvas.addEventListener('touchstart', onTouchStart, { passive: false })

  // Cursor shove: a fast-moving pointer nudges nearby (un-grabbed) bodies away.
  // The force is intentionally capped so products feel weighted, not floaty.
  let last = { x: 0, y: 0 }
  let hasLast = false
  // Also the rain's terminal fall speed — 24px/tick reads heavy without
  // dragging out the tail of the sky drop, and still can't tunnel a 480px slab.
  const maxSpeed = 24
  const maxAngularVelocity = 0.14
  // Containment slack: how far past an edge a body must sit before the escape
  // clamp teleports it back. Wall contact must be resolved by the solver ALONE
  // — a piece meeting a wall can legitimately overlap it for a few ticks
  // (fast impacts, being squeezed by a dragged piece), and snap-teleporting +
  // velocity-zeroing it mid-contact reads as a glitch right at the edge. The
  // walls are 480px slabs that capped-velocity bodies can't tunnel, so this
  // clamp is only for pathological escapes, never routine contact.
  const slack = 60
  const onBeforeUpdate = () => {
    // Arm the ceiling once the last raining piece is fully inside the
    // viewport. `bounds` inflate by velocity, but only in the direction of
    // travel — a falling piece's min.y is its true top edge.
    if (!ceilingArmed && bodies.every((b) => b.bounds.min.y > 0)) {
      ceilingArmed = true
      Composite.add(engine.world, ceiling)
    }

    // While dragging, tame the spring's target (constraint.pointA) two ways:
    //  1. Clamp it so it never asks the held piece to leave the viewport — the
    //     cursor can sit right on a screen edge; without this the spring and
    //     the wall solver fight every tick and the piece buzzes at the edge.
    //  2. Bound how far from the grip the target may sit. The constraint moves
    //     the body POSITIONALLY (velocity caps don't apply), so a distant
    //     cursor yanks the piece hundreds of px per tick — far enough to pass
    //     clean through a wall slab and end up trapped outside the viewport.
    const held = mouseConstraint.body
    if (held) {
      const c = mouseConstraint.constraint
      const pA = c.pointA
      const pB = c.pointB ?? { x: 0, y: 0 }
      // pointB is ALREADY the world-space offset of the grip from the body
      // centre — Constraint.solve rotates it in place as the body turns
      // (tracking angleB). Rotating it again here would double-rotate it and
      // put the clamp bounds up to a grip-offset past the wall, letting the
      // spring press the piece through the edge.
      const offX = pB.x
      const offY = pB.y
      // True extents from the vertices — NOT body.bounds, which Matter inflates
      // by the current velocity (broadphase expansion). A velocity-dependent
      // clamp target oscillates as the dangling piece sways, feeding the swing
      // back into itself — a self-sustaining buzz against the wall.
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const v of held.vertices) {
        if (v.x < minX) minX = v.x
        if (v.x > maxX) maxX = v.x
        if (v.y < minY) minY = v.y
        if (v.y > maxY) maxY = v.y
      }
      const heldHalfW = (maxX - minX) / 2
      const heldHalfH = (maxY - minY) / 2
      // 1: keep the requested position inside the viewport.
      let tx = Math.min(Math.max(pA.x, offX + heldHalfW), offX + W - heldHalfW)
      let ty = Math.min(Math.max(pA.y, offY + heldHalfH), offY + H - heldHalfH)
      // 2: cap the pull distance from the grip's current world position, so
      // the solver can never translate the piece through a 480px slab.
      const gripX = held.position.x + offX
      const gripY = held.position.y + offY
      const pullX = tx - gripX
      const pullY = ty - gripY
      const pull = Math.hypot(pullX, pullY)
      const maxPull = 240
      if (pull > maxPull) {
        tx = gripX + (pullX / pull) * maxPull
        ty = gripY + (pullY / pull) * maxPull
      }
      // MouseConstraint re-assigns pointA to the live mouse.position object
      // every tick — write a clamped copy, never mutate the original.
      c.pointA = { x: tx, y: ty }
      // Rescue: if the piece still ends up fully outside the viewport, put it
      // back in bounds rather than leaving it welded to a wall's outer face.
      if (minX > W || maxX < 0 || minY > H || maxY < 0) {
        Body.setPosition(held, {
          x: Math.min(Math.max(held.position.x, heldHalfW), W - heldHalfW),
          y: Math.min(Math.max(held.position.y, heldHalfH), H - heldHalfH),
        })
        Body.setVelocity(held, { x: 0, y: 0 })
      }
    }

    for (const b of bodies) {
      // Never fight the grabbed body: capping/clamping it against the mouse
      // constraint is what made dragging stutter. The mouse can't leave the
      // canvas while holding, so the walls still contain it.
      if (b === mouseConstraint.body) continue

      const speed = Math.hypot(b.velocity.x, b.velocity.y)
      if (speed > maxSpeed) {
        Body.setVelocity(b, {
          x: (b.velocity.x / speed) * maxSpeed,
          y: (b.velocity.y / speed) * maxSpeed,
        })
      }
      if (Math.abs(b.angularVelocity) > maxAngularVelocity) {
        Body.setAngularVelocity(b, Math.sign(b.angularVelocity) * maxAngularVelocity)
      }

      // Escape insurance only — the walls do the real containment (with the
      // velocity cap above, bodies can't move fast enough to tunnel them). If
      // one still ends up past an edge, tuck it back and kill outward velocity.
      const halfW = (b.bounds.max.x - b.bounds.min.x) / 2
      const halfH = (b.bounds.max.y - b.bounds.min.y) / 2
      let cx = b.position.x
      let cy = b.position.y
      if (b.bounds.min.x < -slack) cx = halfW
      else if (b.bounds.max.x > W + slack) cx = W - halfW
      // Above the top edge is a legitimate place to be until the ceiling arms
      // (pieces rain in from up there); only after that is it an escape.
      if (b.bounds.min.y < -slack) {
        if (ceilingArmed) cy = halfH
      } else if (b.bounds.max.y > H + slack) cy = H - halfH
      if (cx !== b.position.x || cy !== b.position.y) {
        Body.setVelocity(b, {
          x: cx !== b.position.x ? 0 : b.velocity.x,
          y: cy !== b.position.y ? 0 : b.velocity.y,
        })
        Body.setPosition(b, { x: cx, y: cy })
      }
    }

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
    // No cursor shove while holding an item — the grabbed piece should plow
    // through the pile by collision alone; an invisible force field on top of
    // that made dragging feel chaotic.
    if (mouseConstraint.body) return
    // A huge delta means the pointer re-entered after hovering the form — a
    // teleport, not a swipe. Shoving on it reads as a random pop.
    if (speed > 160) return
    const radius = base * 0.72
    for (const b of bodies) {
      if (b === mouseConstraint.body) continue // let the grabbed body follow the cursor
      const ox = b.position.x - m.x
      const oy = b.position.y - m.y
      const dist = Math.hypot(ox, oy)
      if (dist > radius || dist < 0.001) continue
      // applyForce is silently ignored by sleeping bodies — wake them first, or
      // the shove feels dead until a collision happens to rouse the pile.
      if (b.isSleeping) Sleeping.set(b, false)
      const falloff = 1 - dist / radius
      const strength = 0.00034 * Math.min(speed, 60) * falloff * b.mass
      // Damp the upward component so a swipe sweeps the heap aside rather than
      // fountaining it up into the form.
      let fy = (oy / dist) * strength
      if (fy < 0) fy *= 0.35
      Body.applyForce(b, b.position, { x: (ox / dist) * strength, y: fy })
    }
  }
  Events.on(engine, 'beforeUpdate', onBeforeUpdate)

  // ---- Run --------------------------------------------------------------------
  // Claim pointer events now that physics is live (kept off until here so the
  // fallback modes never block the page). touch-action is deliberately left
  // alone: page scroll on touch survives because the hit-tested touch handlers
  // above only claim gestures that start on a merch piece.
  canvas.style.pointerEvents = 'auto'
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
      // Re-tuck anything the new bounds stranded outside the viewport — a
      // one-off teleport here beats the per-frame clamp fighting the walls.
      for (const b of bodies) {
        // A piece still raining in from above the top edge belongs out there.
        if (!ceilingArmed && b.bounds.min.y < 0) continue
        const halfW = (b.bounds.max.x - b.bounds.min.x) / 2
        const halfH = (b.bounds.max.y - b.bounds.min.y) / 2
        const cx = Math.min(Math.max(b.position.x, halfW), W - halfW)
        const cy = Math.min(Math.max(b.position.y, halfH), H - halfH)
        if (cx !== b.position.x || cy !== b.position.y) {
          Body.setPosition(b, { x: cx, y: cy })
          Body.setVelocity(b, { x: 0, y: 0 })
          Sleeping.set(b, false)
        }
      }
    }, 200)
  }
  window.addEventListener('resize', onResize)

  return () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    window.removeEventListener('resize', onResize)
    Events.off(engine, 'beforeUpdate', onBeforeUpdate)
    Events.off(mouseConstraint, 'startdrag', onStartDrag)
    Events.off(mouseConstraint, 'enddrag', onEndDrag)
    window.removeEventListener('mouseup', releaseDrag)
    window.removeEventListener('blur', releaseDrag)
    canvas.removeEventListener('mousemove', onMoveReleaseGuard)
    Render.stop(render)
    Runner.stop(runner)
    canvas.removeEventListener('mousemove', handlers.mousemove)
    canvas.removeEventListener('mousedown', handlers.mousedown)
    canvas.removeEventListener('mouseup', handlers.mouseup)
    canvas.removeEventListener('touchstart', onTouchStart)
    canvas.removeEventListener('touchmove', handlers.mousemove)
    canvas.removeEventListener('touchend', onTouchEnd)
    canvas.removeEventListener('touchcancel', onTouchEnd)
    Composite.clear(engine.world, false)
    Engine.clear(engine)
    canvas.style.pointerEvents = ''
    canvas.style.cursor = ''
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }
}
