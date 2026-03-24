import { useState, useEffect, useRef } from "react";

interface ScannerLoaderProps {
  messages: string[];
  /** Milliseconds between message rotations (default 2500) */
  interval?: number;
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

    const size = 120;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];
    let frame = 0;
    let animId: number;

    const spawn = () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 12;
      particles.push({
        x: size / 2 + Math.cos(angle) * dist,
        y: size / 2 + Math.sin(angle) * dist,
        vx: Math.cos(angle) * (0.15 + Math.random() * 0.3),
        vy: Math.sin(angle) * (0.15 + Math.random() * 0.3),
        life: 0,
        maxLife: 60 + Math.random() * 80,
        size: 1 + Math.random() * 1.5,
      });
    };

    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;

      // Morphing blob — 3 layered radial gradients orbiting
      const t = frame * 0.008;
      for (let layer = 0; layer < 3; layer++) {
        const offset = (layer * Math.PI * 2) / 3;
        const bx = cx + Math.cos(t * (1 + layer * 0.3) + offset) * (10 + layer * 4);
        const by = cy + Math.sin(t * (1.2 + layer * 0.2) + offset) * (10 + layer * 4);
        const radius = 20 + layer * 8 + Math.sin(t * 2 + layer) * 4;

        const colors = [
          [107, 161, 245],
          [139, 92, 246],
          [59, 130, 246],
        ];
        const [r, g, b] = colors[layer];
        const alpha = 0.25 - layer * 0.05;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.4})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // Particles
      if (frame % 3 === 0) spawn();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        const progress = p.life / p.maxLife;
        const alpha = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - progress * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160,190,255,${alpha * 0.6})`;
        ctx.fill();
      }

      // Center bright core
      const coreAlpha = 0.5 + Math.sin(frame * 0.04) * 0.3;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
      coreGrad.addColorStop(0, `rgba(220,230,255,${coreAlpha})`);
      coreGrad.addColorStop(0.5, `rgba(107,161,245,${coreAlpha * 0.4})`);
      coreGrad.addColorStop(1, "rgba(107,161,245,0)");
      ctx.fillStyle = coreGrad;
      ctx.fillRect(cx - 8, cy - 8, 16, 16);

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-24 select-none">
      <canvas
        ref={canvasRef}
        className="mb-8"
        style={{ width: 120, height: 120 }}
      />
      <p
        key={msgIndex}
        className="text-[13px] text-gen-text-3 tracking-wide"
        style={{ animation: "scanner-msg 0.3s ease both" }}
      >
        {messages[msgIndex]}
      </p>
    </div>
  );
}
