import { useState, useEffect, useRef } from "react";

interface ScannerLoaderProps {
  messages: string[];
  /** Milliseconds between message rotations (default 2500) */
  interval?: number;
}

interface Particle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  orbit: number;
  dist: number;
  angle: number;
  trail: { x: number; y: number; alpha: number }[];
  type: "swirl" | "spark" | "floater";
  pulsePhase: number;
  blur: number;
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

    const size = 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const particles: Particle[] = [];
    let frame = 0;
    let animId: number;

    const hues = [210, 240, 270, 190, 300, 175];

    // Spawn particles of different types
    const spawn = (type: Particle["type"]) => {
      const angle = Math.random() * Math.PI * 2;
      const hue = hues[Math.floor(Math.random() * hues.length)];

      if (type === "swirl") {
        const dist = 3 + Math.random() * 10;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 100 + Math.random() * 160,
          size: 1.0 + Math.random() * 2.5,
          hue,
          orbit: (0.008 + Math.random() * 0.02) * (Math.random() > 0.5 ? 1 : -1),
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 0,
        });
      } else if (type === "spark") {
        // Fast-moving sparks that shoot outward and fade
        const dist = 8 + Math.random() * 15;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 30 + Math.random() * 40,
          size: 0.5 + Math.random() * 1.2,
          hue: hue + Math.random() * 30,
          orbit: (0.02 + Math.random() * 0.04) * (Math.random() > 0.5 ? 1 : -1),
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 0,
        });
      } else {
        // Floaters — large, blurry, slow-drifting orbs
        const dist = 20 + Math.random() * 40;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 180 + Math.random() * 200,
          size: 8 + Math.random() * 16,
          hue,
          orbit: (0.002 + Math.random() * 0.005) * (Math.random() > 0.5 ? 1 : -1),
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 4 + Math.random() * 8,
        });
      }
    };

    const draw = () => {
      frame++;
      const t = frame * 0.005;

      ctx.clearRect(0, 0, size, size);

      // ── Layer 1: Deep ambient nebula (slow, large, soft) ──
      for (let i = 0; i < 5; i++) {
        const offset = (i * Math.PI * 2) / 5;
        const bx = cx + Math.cos(t * 0.3 + offset) * (25 + i * 10);
        const by = cy + Math.sin(t * 0.4 + offset) * (25 + i * 10);
        const radius = 55 + Math.sin(t * 0.8 + i * 1.5) * 15;
        const hue = 215 + i * 22 + Math.sin(t * 0.25 + i) * 15;
        const alpha = 0.07 + Math.sin(t * 0.5 + i * 2) * 0.025;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},70%,60%,${alpha})`);
        grad.addColorStop(0.4, `hsla(${hue},60%,50%,${alpha * 0.4})`);
        grad.addColorStop(1, `hsla(${hue},50%,40%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 2: Morphing plasma blobs ──
      for (let i = 0; i < 6; i++) {
        const offset = (i * Math.PI * 2) / 6;
        const bx = cx + Math.cos(t * (0.6 + i * 0.12) + offset) * (18 + i * 5);
        const by = cy + Math.sin(t * (0.8 + i * 0.1) + offset) * (18 + i * 5);
        const radius = 20 + i * 6 + Math.sin(t * 1.2 + i) * 5;

        const blobHues = [210, 245, 275, 195, 305, 230];
        const hue = blobHues[i] + Math.sin(t * 0.4 + i) * 20;
        const alpha = 0.14 - i * 0.015;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},75%,65%,${alpha})`);
        grad.addColorStop(0.35, `hsla(${hue},65%,55%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${hue},55%,45%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 3: Floater particles (big blurry drifting orbs) ──
      if (frame % 20 === 0) spawn("floater");
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "floater") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        p.angle += p.orbit;
        p.dist += Math.sin(t + p.pulsePhase) * 0.2;
        p.x = cx + Math.cos(p.angle) * p.dist;
        p.y = cy + Math.sin(p.angle) * p.dist;

        const progress = p.life / p.maxLife;
        // Fade in, hold, fade out
        const fadeIn = Math.min(1, progress / 0.15);
        const fadeOut = Math.max(0, 1 - Math.pow(Math.max(0, (progress - 0.6)) / 0.4, 2));
        const alpha = fadeIn * fadeOut * 0.12;
        const pulseSize = p.size * (1 + Math.sin(t * 2 + p.pulsePhase) * 0.3);

        ctx.save();
        ctx.filter = `blur(${p.blur}px)`;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pulseSize);
        grad.addColorStop(0, `hsla(${p.hue},70%,70%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${p.hue},60%,55%,${alpha * 0.4})`);
        grad.addColorStop(1, `hsla(${p.hue},50%,50%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - pulseSize, p.y - pulseSize, pulseSize * 2, pulseSize * 2);
        ctx.restore();
      }

      // ── Layer 4: Swirling particles with trails ──
      if (frame % 3 === 0) spawn("swirl");
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "swirl") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        // Store trail position
        const progress = p.life / p.maxLife;
        const trailAlpha = progress < 0.1
          ? progress / 0.1
          : 1 - Math.pow((progress - 0.1) / 0.9, 0.5);
        p.trail.push({ x: p.x, y: p.y, alpha: trailAlpha });
        if (p.trail.length > 12) p.trail.shift();

        // Swirl outward with slight wobble
        p.angle += p.orbit;
        p.dist += 0.12 + (p.life / p.maxLife) * 0.35;
        const wobble = Math.sin(t * 3 + p.pulsePhase) * 2;
        p.x = cx + Math.cos(p.angle) * (p.dist + wobble);
        p.y = cy + Math.sin(p.angle) * (p.dist + wobble);

        const currentSize = p.size * (1 - progress * 0.2) * (1 + Math.sin(t * 4 + p.pulsePhase) * 0.2);

        // Draw trail with gradient opacity
        if (p.trail.length > 2) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          for (let j = 1; j < p.trail.length; j++) {
            const segAlpha = (j / p.trail.length) * trailAlpha * 0.25;
            ctx.beginPath();
            ctx.moveTo(p.trail[j - 1].x, p.trail[j - 1].y);
            ctx.lineTo(p.trail[j].x, p.trail[j].y);
            ctx.strokeStyle = `hsla(${p.hue},70%,65%,${segAlpha})`;
            ctx.lineWidth = currentSize * 0.5 * (j / p.trail.length);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Draw particle with pulsing glow
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        // Outer glow
        const glowSize = currentSize * 3;
        const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
        glowGrad.addColorStop(0, `hsla(${p.hue},80%,75%,${trailAlpha * 0.15})`);
        glowGrad.addColorStop(1, `hsla(${p.hue},80%,60%,0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(p.x - glowSize, p.y - glowSize, glowSize * 2, glowSize * 2);
        // Core dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},75%,80%,${trailAlpha * 0.8})`;
        ctx.fill();
        ctx.restore();
      }

      // ── Layer 5: Fast sparks ──
      if (frame % 8 === 0) spawn("spark");
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "spark") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        p.angle += p.orbit;
        p.dist += 0.8 + Math.random() * 0.5;
        p.x = cx + Math.cos(p.angle) * p.dist;
        p.y = cy + Math.sin(p.angle) * p.dist;

        const progress = p.life / p.maxLife;
        const alpha = (1 - progress) * 0.9;
        const sparkSize = p.size * (1 - progress * 0.5);

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath();
        ctx.arc(p.x, p.y, sparkSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},85%,85%,${alpha})`;
        ctx.shadowColor = `hsla(${p.hue},90%,70%,${alpha * 0.6})`;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.restore();
      }

      // ── Center core: bright breathing nucleus ──
      const corePhase = frame * 0.025;
      const breathe = Math.sin(corePhase) * 0.5 + 0.5; // 0..1 smooth
      const coreAlpha = 0.5 + breathe * 0.4;
      const coreSize = 8 + breathe * 4;

      // Outer diffuse glow
      const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 5);
      outerGlow.addColorStop(0, `hsla(220,80%,85%,${coreAlpha * 0.2})`);
      outerGlow.addColorStop(0.3, `hsla(245,70%,65%,${coreAlpha * 0.08})`);
      outerGlow.addColorStop(1, "hsla(250,60%,50%,0)");
      ctx.fillStyle = outerGlow;
      ctx.fillRect(cx - coreSize * 5, cy - coreSize * 5, coreSize * 10, coreSize * 10);

      // Mid glow ring
      const midGlow = ctx.createRadialGradient(cx, cy, coreSize * 0.8, cx, cy, coreSize * 2.5);
      midGlow.addColorStop(0, `hsla(230,75%,80%,${coreAlpha * 0.3})`);
      midGlow.addColorStop(1, "hsla(240,60%,60%,0)");
      ctx.fillStyle = midGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
      coreGrad.addColorStop(0, `hsla(215,60%,97%,${coreAlpha})`);
      coreGrad.addColorStop(0.35, `hsla(225,70%,80%,${coreAlpha * 0.7})`);
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
    <div className="flex flex-col items-center justify-center py-16 select-none">
      <canvas
        ref={canvasRef}
        className="mb-6"
        style={{ width: 280, height: 280 }}
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
