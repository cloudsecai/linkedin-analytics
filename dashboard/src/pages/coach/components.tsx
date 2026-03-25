import { useState } from "react";
import type { TimingSlot } from "../../api/client";

export function getPriorityLabel(p: number | string): { label: string; classes: string } {
  if (typeof p === "string") {
    const upper = p.toUpperCase();
    if (upper === "HIGH") return { label: "HIGH", classes: "bg-negative/15 text-negative" };
    if (upper === "MED" || upper === "MEDIUM") return { label: "MED", classes: "bg-warning/15 text-warning" };
    return { label: "LOW", classes: "bg-surface-2 text-text-muted" };
  }
  if (p <= 1) return { label: "HIGH", classes: "bg-negative/15 text-negative" };
  if (p <= 2) return { label: "MED", classes: "bg-warning/15 text-warning" };
  return { label: "LOW", classes: "bg-surface-2 text-text-muted" };
}

export function getConfidenceLabel(c: number | string): { label: string; dotClass: string } {
  if (typeof c === "string") {
    const upper = c.toUpperCase();
    if (upper === "STRONG") return { label: "Strong", dotClass: "bg-positive" };
    if (upper === "MODERATE") return { label: "Moderate", dotClass: "bg-warning" };
    return { label: "Weak", dotClass: "bg-negative" };
  }
  if (c >= 0.8) return { label: "Strong", dotClass: "bg-positive" };
  if (c >= 0.6) return { label: "Moderate", dotClass: "bg-warning" };
  return { label: "Weak", dotClass: "bg-negative" };
}

export function formatCategory(s: string): string {
  return s.replace(/_/g, " ");
}

export function formatTimeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate + (isoDate.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTimeUntil(isoDate: string): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return "soon";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString();
}

export function deltaClass(current: number | null, previous: number | null): string {
  if (current == null || previous == null || previous === 0) return "text-text-muted";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (pct > 5) return "text-positive";
  if (pct < -5) return "text-negative";
  return "text-text-muted";
}

export function deltaLabel(current: number | null, previous: number | null): string | null {
  if (current == null || previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// ── Sparkline Component ─────────────────────────────────────

export function Sparkline({ data, color = "var(--color-accent)", width = 120, height = 32 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on latest value */}
      {data.length > 0 && (() => {
        const lastX = pad + ((data.length - 1) / (data.length - 1)) * (width - pad * 2);
        const lastY = pad + (1 - (data[data.length - 1] - min) / range) * (height - pad * 2);
        return <circle cx={lastX} cy={lastY} r="2" fill={color} />;
      })()}
    </svg>
  );
}

// ── Constants ────────────────────────────────────────────────

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TIME_WINDOWS = [
  { label: "Early\n6-9a", start: 6, end: 9 },
  { label: "Morning\n9-12p", start: 9, end: 12 },
  { label: "Lunch\n12-2p", start: 12, end: 14 },
  { label: "Afternoon\n2-5p", start: 14, end: 17 },
  { label: "Evening\n5-8p", start: 17, end: 20 },
  { label: "Night\n8-11p", start: 20, end: 23 },
];

// ── Timing Grid ─────────────────────────────────────────────

export function TimingGrid({ slots }: { slots: TimingSlot[] }) {
  const [timingOpen, setTimingOpen] = useState(true);

  // Aggregate slots into day x time-window buckets
  const grid: Record<string, { totalER: number; totalPosts: number }> = {};
  for (const s of slots) {
    for (const w of TIME_WINDOWS) {
      if (s.hour >= w.start && s.hour < w.end && s.avg_engagement_rate != null) {
        const key = `${s.day}-${w.start}`;
        if (!grid[key]) grid[key] = { totalER: 0, totalPosts: 0 };
        grid[key].totalER += s.avg_engagement_rate * s.post_count;
        grid[key].totalPosts += s.post_count;
      }
    }
  }

  // Compute weighted average ER for each cell
  const cells: Record<string, { er: number; posts: number }> = {};
  let maxER = 0;
  for (const [key, val] of Object.entries(grid)) {
    const er = val.totalPosts > 0 ? val.totalER / val.totalPosts : 0;
    cells[key] = { er, posts: val.totalPosts };
    if (er > maxER) maxER = er;
  }

  return (
    <div className="animate-fade-up" style={{ animationDelay: "360ms" }}>
      <button onClick={() => setTimingOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
        <span className={`text-[10px] text-text-muted transition-transform ${timingOpen ? "rotate-90" : ""}`}>&#9654;</span>
        <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
          Best Times to Post
        </h3>
        <span className="text-[11px] text-text-muted">When does your audience engage most?</span>
      </button>
      {timingOpen && (
        <div className="bg-surface-1 border border-border rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 font-medium text-[10px] text-text-muted"></th>
                {TIME_WINDOWS.map((w) => (
                  <th key={w.start} className="text-center px-2 py-1.5 font-medium text-[10px] text-text-muted whitespace-pre-line">{w.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((day, dayIdx) => (
                <tr key={day}>
                  <td className="px-2 py-1.5 font-medium text-text-secondary text-[11px]">{day}</td>
                  {TIME_WINDOWS.map((w) => {
                    const cell = cells[`${dayIdx}-${w.start}`];
                    const intensity = cell && maxER > 0 ? cell.er / maxER : 0;
                    return (
                      <td key={w.start} className="px-1 py-1">
                        <div
                          className="rounded px-2 py-2 text-center font-mono"
                          style={{
                            backgroundColor: intensity > 0
                              ? `rgba(var(--color-accent-rgb, 99, 102, 241), ${(intensity * 0.4 + 0.05).toFixed(2)})`
                              : "transparent",
                            color: intensity > 0.5 ? "white" : "var(--color-text-secondary)",
                          }}
                          title={cell ? `${(cell.er * 100).toFixed(1)}% ER (${cell.posts} posts)` : "No data"}
                        >
                          {cell ? `${(cell.er * 100).toFixed(1)}%` : "--"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-2 text-[10px] text-text-muted">
            <span>Low</span>
            <div className="flex gap-0.5">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
                <div
                  key={v}
                  className="w-4 h-3 rounded-sm"
                  style={{ backgroundColor: `rgba(var(--color-accent-rgb, 99, 102, 241), ${(v * 0.4 + 0.05).toFixed(2)})` }}
                />
              ))}
            </div>
            <span>High</span>
            <span className="ml-2">engagement rate</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared Performance Table ─────────────────────────────────

export function PerformanceTable({
  rows,
  nameLabel,
}: {
  rows: { name: string; post_count: number; median_wer: number; median_impressions: number; median_comments: number }[];
  nameLabel: string;
}) {
  const sorted = [...rows].sort((a, b) => b.median_wer - a.median_wer);
  const bestWer = sorted[0]?.median_wer ?? 0;

  return (
    <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted uppercase tracking-widest">
            <th className="text-left px-4 py-2.5 font-medium text-[10px]">{nameLabel}</th>
            <th className="text-right px-4 py-2.5 font-medium text-[10px]">Posts</th>
            <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median WER</th>
            <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median<br />Impressions</th>
            <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median<br />Comments</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.name}
              className={`border-b border-border/50 hover:bg-surface-2/50 transition-colors ${row.median_wer === bestWer ? "bg-positive/5" : ""}`}
            >
              <td className="px-4 py-2.5 text-text-primary font-medium">{formatCategory(row.name)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{row.post_count}</td>
              <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{row.median_wer.toFixed(1)}%</td>
              <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{fmtNum(row.median_impressions)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{row.median_comments.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
