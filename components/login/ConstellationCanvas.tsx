'use client'

import { useEffect, useRef } from 'react'

export function ConstellationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    let raf: number

    const COUNT = 55
    const CONNECT_DIST = 130

    interface Node { x: number; y: number; vx: number; vy: number; r: number; o: number }
    let nodes: Node[] = []
    let W = 0, H = 0

    function resize() {
      W = canvas.width = canvas.offsetWidth
      H = canvas.height = canvas.offsetHeight
      nodes = Array.from({ length: COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.8 + 0.8,
        o: Math.random() * 0.45 + 0.15,
      }))
    }

    function tick() {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < CONNECT_DIST) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(139,92,246,${(1 - d / CONNECT_DIST) * 0.15})`
            ctx.lineWidth = 0.7
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }
      for (const n of nodes) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(139,92,246,${n.o})`
        ctx.fill()
        n.x += n.vx; n.y += n.vy
        if (n.x < -10) n.x = W + 10
        if (n.x > W + 10) n.x = -10
        if (n.y < -10) n.y = H + 10
        if (n.y > H + 10) n.y = -10
      }
      raf = requestAnimationFrame(tick)
    }

    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); resize(); tick() })
    ro.observe(canvas)
    resize()
    tick()

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}
