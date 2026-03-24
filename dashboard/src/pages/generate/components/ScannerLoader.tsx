import { useState, useEffect, useRef } from "react";

interface ScannerLoaderProps {
  messages: string[];
  /** Milliseconds between message rotations (default 2500) */
  interval?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  orbit: number;
  dist: number;
  angle: number;
  trail: { x: number; y: number }[];
}

export default function ScannerLoader({ messages, interval = 2500 }: ScannerLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msgIndex, setMsgIndex] = useState(0);

  // Rotate messages
  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % messages.length);
    }, interval);
    return () => clearInterval(timer);
  }, [messages, interval]);

  // Canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 160;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const particles: Particle[] = [];
    let frame = 0;
    let animId: number;

    // Spawn a swirling particle
    const spawn = () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 4 + Math.random() * 8;
      const hues = [210, 240, 270, 190, 300]; // blue, indigo, purple, cyan, magenta
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      particles.push({
        x: px,
        y: py,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 80 + Math.random() * 120,
        size: 0.8 + Math.random() * 2,
        hue: hues[Math.floor(Math.random() * hues.length)],
        orbit: (0.01 + Math.random() * 0.025) * (Math.random() > 0.5 ? 1 : -1),
        dist,
        angle,
        trail: [],
      });
    };

    const draw = () => {
      frame++;
      const t = frame * 0.006;

      // Clear with slight opacity for motion trails on particles
      ctx.clearRect(0, 0, size, size);

      // ── Layer 1: Deep ambient nebula (slow, large) ──
      for (let i = 0; i < 4; i++) {
        const offset = (i * Math.PI * 2) / 4;
        const bx = cx + Math.cos(t * 0.4 + offset) * (18 + i * 6);
        const by = cy + Math.sin(t * 0.5 + offset) * (18 + i * 6);
        const radius = 35 + Math.sin(t + i * 1.5) * 8;
        const hue = 220 + i * 25 + Math.sin(t * 0.3 + i) * 15;
        const alpha = 0.08 + Math.sin(t * 0.7 + i * 2) * 0.03;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},70%,60%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue},60%,50%,${alpha * 0.3})`);
        grad.addColorStop(1, `hsla(${hue},50%,40%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 2: Morphing plasma blobs (medium speed) ──
      for (let i = 0; i < 5; i++) {
        const offset = (i * Math.PI * 2) / 5;
        const bx = cx + Math.cos(t * (0.8 + i * 0.15) + offset) * (12 + i * 3);
        const by = cy + Math.sin(t * (1.0 + i * 0.12) + offset) * (12 + i * 3);
        const radius = 14 + i * 4 + Math.sin(t * 1.5 + i) * 3;

        const hues = [210, 250, 280, 200, 310];
        const hue = hues[i] + Math.sin(t * 0.5 + i) * 20;
        const alpha = 0.18 - i * 0.02;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},75%,65%,${alpha})`);
        grad.addColorStop(0.4, `hsla(${hue},65%,55%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${hue},55%,45%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 3: Energy tendrils (fast, thin arcs) ──
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 3; i++) {
        const startAngle = t * (1.5 + i * 0.4) + (i * Math.PI * 2) / 3;
        const arcLen = Math.PI * (0.4 + Math.sin(t * 2 + i) * 0.2);
        const r = 22 + i * 6 + Math.sin(t * 3 + i * 2) * 4;
        const hue = 220 + i * 40;
        const alpha = 0.3 + Math.sin(t * 2 + i) * 0.15;

        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, startAngle + arcLen);
        ctx.strokeStyle = `hsla(${hue},80%,70%,${alpha})`;
        ctx.lineWidth = 1.5 + Math.sin(t * 4 + i) * 0.5;
        ctx.shadowColor = `hsla(${hue},80%,60%,0.4)`;
        ctx.shadowBlur = 6;
        ctx.stroke();
      }
      ctx.restore();

      // ── Layer 4: Swirling particles ──
      if (frame % 2 === 0) spawn();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        // Store trail position
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();

        // Swirl outward
        p.angle += p.orbit;
        p.dist += 0.15 + (p.life / p.maxLife) * 0.3;
        p.x = cx + Math.cos(p.angle) * p.dist;
        p.y = cy + Math.sin(p.angle) * p.dist;

        const progress = p.life / p.maxLife;
        const alpha = progress < 0.1
          ? progress / 0.1
          : 1 - Math.pow((progress - 0.1) / 0.9, 0.5);
        const currentSize = p.size * (1 - progress * 0.3);

        // Draw trail
        if (p.trail.length > 1) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let j = 1; j < p.trail.length; j++) {
            ctx.lineTo(p.trail[j].x, p.trail[j].y);
          }
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = `hsla(${p.hue},70%,65%,${alpha * 0.2})`;
          ctx.lineWidth = currentSize * 0.6;
          ctx.stroke();
          ctx.restore();
        }

        // Draw particle with glow
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},75%,75%,${alpha * 0.7})`;
        ctx.shadowColor = `hsla(${p.hue},80%,60%,${alpha * 0.4})`;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.restore();
      }

      // ── Center core: bright pulsing nucleus ──
      const corePhase = frame * 0.03;
      const coreAlpha = 0.6 + Math.sin(corePhase) * 0.3;
      const coreSize = 6 + Math.sin(corePhase * 1.3) * 2;

      // Outer glow
      const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 3);
      outerGlow.addColorStop(0, `hsla(220,80%,80%,${coreAlpha * 0.3})`);
      outerGlow.addColorStop(0.5, `hsla(250,70%,65%,${coreAlpha * 0.1})`);
      outerGlow.addColorStop(1, "hsla(250,60%,50%,0)");
      ctx.fillStyle = outerGlow;
      ctx.fillRect(cx - coreSize * 3, cy - coreSize * 3, coreSize * 6, coreSize * 6);

      // Inner core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
      coreGrad.addColorStop(0, `hsla(220,60%,95%,${coreAlpha})`);
      coreGrad.addColorStop(0.4, `hsla(230,70%,75%,${coreAlpha * 0.6})`);
      coreGrad.addColorStop(1, "hsla(240,60%,60%,0)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 select-none">
      <canvas
        ref={canvasRef}
        className="mb-6"
        style={{ width: 160, height: 160 }}
      />
      <p
        key={msgIndex}
        className="text-[13px] text-gen-text-3 tracking-wide"
        style={{ animation: "scanner-msg 0.4s ease both" }}
      >
        {messages[msgIndex]}
      </p>
    </div>
  );
}
