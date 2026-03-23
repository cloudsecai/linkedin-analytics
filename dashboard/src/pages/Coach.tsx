import { useState, useEffect } from "react";
import {
  api,
  type Recommendation,
  type Insight,
  type Changelog,
  type PromptSuggestions,
  type PromptSuggestion,
  type AnalysisGap,
  type ProgressData,
  type CategoryPerformance,
  type EngagementQuality,
  type TimingSlot,
  type SparklinePoint,
  type TopicPerformance,
  type HookPerformance,
  type ImageSubtypePerformance,
  type AnalysisStatus,
} from "../api/client";

type CoachTab = "actions" | "insights" | "deep-dive";

function getPriorityLabel(p: number | string): { label: string; classes: string } {
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

function getConfidenceLabel(c: number | string): { label: string; dotClass: string } {
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

function formatCategory(s: string): string {
  return s.replace(/_/g, " ");
}

function formatTimeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate + (isoDate.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimeUntil(isoDate: string): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return "soon";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString();
}

function deltaClass(current: number | null, previous: number | null): string {
  if (current == null || previous == null || previous === 0) return "text-text-muted";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (pct > 5) return "text-positive";
  if (pct < -5) return "text-negative";
  return "text-text-muted";
}

function deltaLabel(current: number | null, previous: number | null): string | null {
  if (current == null || previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// ── Sparkline Component ─────────────────────────────────────

function Sparkline({ data, color = "var(--color-accent)", width = 120, height = 32 }: {
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

// ── Actions Tab ─────────────────────────────────────────────

function ActionsTab({
  active,
  resolved,
  promptSuggestions,
  onResolve,
  onFeedback,
  onAcceptSuggestion,
  progress,
  sparklinePoints,
  insights,
}: {
  active: Recommendation[];
  resolved: Recommendation[];
  promptSuggestions: PromptSuggestions | null;
  onResolve: (id: number, type: "accepted" | "dismissed") => void;
  onFeedback: (id: number, rating: string) => void;
  onAcceptSuggestion: (index: number, suggestion: PromptSuggestion) => void;
  progress: ProgressData | null;
  sparklinePoints: SparklinePoint[];
  insights: Insight[];
}) {
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<number>>(new Set());
  const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<number>>(new Set());

  // Extract prompt suggestions linked to specific recommendations via evidence
  const getLinkedSuggestion = (rec: Recommendation): PromptSuggestion | null => {
    if (!promptSuggestions?.suggestions?.length) return null;
    if (promptSuggestions.assessment === "working_well") return null;
    // Match suggestion to recommendation by checking if the evidence overlaps
    for (const s of promptSuggestions.suggestions) {
      if (rec.detail?.includes(s.evidence?.slice(0, 30) ?? "___nomatch")) return s;
      if (rec.headline?.toLowerCase().includes(s.current?.slice(0, 20)?.toLowerCase() ?? "___nomatch")) return s;
    }
    return null;
  };

  // Standalone suggestions (not linked to any recommendation)
  const linkedSuggestionIndices = new Set<number>();
  if (promptSuggestions?.suggestions) {
    for (const rec of active) {
      const s = getLinkedSuggestion(rec);
      if (s) {
        const idx = promptSuggestions.suggestions.indexOf(s);
        if (idx >= 0) linkedSuggestionIndices.add(idx);
      }
    }
  }

  // Surfaced insights: first 3 confirmed or new-signal insights
  const surfacedInsights = insights
    .filter((i) => i.status === "confirmed" || i.status === "new_signal")
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {progress && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-up">
          {[
            { label: "Median ER", current: progress.current.median_er, prev: progress.previous.median_er, fmt: (v: number | null) => v != null ? v.toFixed(1) + "%" : "--", sparkData: sparklinePoints.map((p) => p.er) },
            { label: "Median Impressions", current: progress.current.median_impressions, prev: progress.previous.median_impressions, fmt: (v: number | null) => fmtNum(v), sparkData: sparklinePoints.map((p) => p.impressions) },
            { label: "Posts", current: progress.current.total_posts, prev: progress.previous.total_posts, fmt: (v: number | null) => fmtNum(v), sparkData: [] as number[] },
            { label: "Avg Comments", current: progress.current.avg_comments, prev: progress.previous.avg_comments, fmt: (v: number | null) => v != null ? v.toFixed(1) : "--", sparkData: sparklinePoints.map((p) => p.comments) },
          ].map((m) => (
            <div key={m.label} className="bg-surface-1 border border-border rounded-lg p-4">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">{m.label}</div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-xl font-semibold font-mono tracking-tight">{m.fmt(m.current)}</div>
                  {deltaLabel(m.current, m.prev) && (
                    <div className={`text-sm font-mono mt-0.5 ${deltaClass(m.current, m.prev)}`}>
                      {deltaLabel(m.current, m.prev)} vs prev 30d
                    </div>
                  )}
                </div>
                {m.sparkData.length >= 2 && (
                  <Sparkline
                    data={m.sparkData}
                    color={
                      m.current != null && m.prev != null && m.prev > 0
                        ? ((m.current - m.prev) / Math.abs(m.prev)) * 100 > 5
                          ? "var(--color-positive)"
                          : ((m.current - m.prev) / Math.abs(m.prev)) * 100 < -5
                          ? "var(--color-negative)"
                          : "var(--color-accent)"
                        : "var(--color-accent)"
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Surfaced Insights */}
      {surfacedInsights.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "40ms" }}>
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-2">Key Findings</h3>
          <div className="space-y-2">
            {surfacedInsights.map((insight) => (
              <div key={insight.id} className="bg-surface-1 border border-border rounded-lg px-4 py-3 flex items-start gap-3">
                <span className={`mt-0.5 text-xs ${insight.status === "confirmed" ? "text-positive" : "text-accent"}`}>
                  {insight.status === "confirmed" ? "\u2713" : "\u2022"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">{insight.claim}</p>
                  <p className="text-xs text-text-muted mt-0.5">{insight.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {active.length === 0 && !promptSuggestions && (
        <div className="bg-surface-1 border border-border rounded-lg p-6 text-center animate-fade-up">
          <p className="text-sm text-text-muted">
            {progress
              ? "Check back after your next AI refresh for personalized recommendations."
              : <>No recommendations yet. Click <strong>Refresh AI</strong> to generate insights from your posts.</>}
          </p>
        </div>
      )}
      {active.map((rec, i) => {
        const p = getPriorityLabel(rec.priority);
        const c = getConfidenceLabel(rec.confidence);
        const linkedSuggestion = getLinkedSuggestion(rec);
        const suggIdx = linkedSuggestion ? promptSuggestions!.suggestions.indexOf(linkedSuggestion) : -1;

        return (
          <div
            key={rec.id}
            className="bg-surface-1 border border-border rounded-lg p-5 space-y-3 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Header: priority + category + confidence */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${p.classes}`}>
                {p.label}
              </span>
              <span className="text-[10px] text-text-muted uppercase tracking-widest">
                {formatCategory(rec.type)}
              </span>
              <span className="flex items-center gap-1 text-xs text-text-muted ml-auto">
                <span className={`w-1.5 h-1.5 rounded-full ${c.dotClass}`} />
                {c.label}
              </span>
            </div>

            {/* Headline + detail */}
            <p className="text-base font-semibold text-text-primary leading-snug">{rec.headline}</p>
            <p className="text-[13px] text-text-secondary leading-relaxed">{rec.detail}</p>

            {/* Action box */}
            {rec.action && (
              <div className="bg-accent/5 border border-accent/12 rounded-md px-4 py-3">
                <span className="text-[10px] font-semibold text-accent uppercase tracking-widest">Try next</span>
                <p className="text-[13px] text-text-primary mt-1 leading-relaxed">{rec.action}</p>
              </div>
            )}

            {/* Inline prompt suggestion */}
            {linkedSuggestion && suggIdx >= 0 && !acceptedSuggestions.has(suggIdx) && !rejectedSuggestions.has(suggIdx) && (
              <div className="bg-surface-2 border border-border rounded-lg p-4 space-y-3">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Suggested prompt update</span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Current</span>
                    <div className="flex-1 flex items-center">
                      <p className="w-full text-sm bg-surface-0 rounded-md px-3 py-2.5 text-text-secondary leading-relaxed">
                        {linkedSuggestion.current}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-accent uppercase tracking-wider mb-1 font-medium">Suggested</span>
                    <div className="flex-1 flex items-center">
                      <p className="w-full text-sm bg-accent/5 border border-accent/15 rounded-md px-3 py-2.5 text-text-primary leading-relaxed">
                        {linkedSuggestion.suggested}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onAcceptSuggestion(suggIdx, linkedSuggestion);
                      setAcceptedSuggestions((prev) => new Set([...prev, suggIdx]));
                    }}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/18 transition-colors"
                  >
                    Apply to prompt
                  </button>
                  <button
                    onClick={() => setRejectedSuggestions((prev) => new Set([...prev, suggIdx]))}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-3 text-text-muted hover:text-text-secondary transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {linkedSuggestion && suggIdx >= 0 && acceptedSuggestions.has(suggIdx) && (
              <div className="bg-positive/5 border border-positive/20 rounded-md px-4 py-2.5">
                <span className="text-xs text-positive font-medium">Prompt updated</span>
              </div>
            )}

            {/* Footer: Got it / Dismiss / Feedback */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => onResolve(rec.id, "accepted")}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent border border-accent/15 hover:bg-accent/18 transition-colors"
              >
                Got it
              </button>
              <button
                onClick={() => onResolve(rec.id, "dismissed")}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 text-text-muted border border-border hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
                <button
                  onClick={() => onFeedback(rec.id, "useful")}
                  className="opacity-40 hover:opacity-80 transition-opacity text-sm leading-none"
                  title="Useful"
                >
                  &#x1F44D;
                </button>
                <button
                  onClick={() => onFeedback(rec.id, "not_useful")}
                  className="opacity-40 hover:opacity-80 transition-opacity text-sm leading-none"
                  title="Not useful"
                >
                  &#x1F44E;
                </button>
              </span>
            </div>
          </div>
        );
      })}

      {/* Standalone prompt suggestions (not linked to any recommendation) */}
      {promptSuggestions && promptSuggestions.assessment === "suggest_changes" && promptSuggestions.suggestions.map((s, i) => {
        if (linkedSuggestionIndices.has(i)) return null;
        if (acceptedSuggestions.has(i) || rejectedSuggestions.has(i)) return null;
        return (
          <div key={`ps-${i}`} className="bg-surface-1 border border-border rounded-lg p-5 space-y-3 animate-fade-up">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Prompt suggestion</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <span className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Current</span>
                <div className="flex-1 flex items-center">
                  <p className="w-full text-sm bg-surface-2 rounded-md px-3 py-2.5 text-text-secondary leading-relaxed">{s.current}</p>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-accent uppercase tracking-wider mb-1 font-medium">Suggested</span>
                <div className="flex-1 flex items-center">
                  <p className="w-full text-sm bg-accent/5 border border-accent/15 rounded-md px-3 py-2.5 text-text-primary leading-relaxed">{s.suggested}</p>
                </div>
              </div>
            </div>
            <p className="text-sm text-text-muted">{s.evidence}</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onAcceptSuggestion(i, s);
                  setAcceptedSuggestions((prev) => new Set([...prev, i]));
                }}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/18 transition-colors"
              >
                Apply to prompt
              </button>
              <button
                onClick={() => setRejectedSuggestions((prev) => new Set([...prev, i]))}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-3 text-text-muted hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}

      {/* Resolved recommendations */}
      {resolved.length > 0 && (
        <>
          <div className="flex items-center gap-2.5 mt-6 mb-3">
            <span className="text-[10px] text-text-muted uppercase tracking-widest font-medium">Resolved</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          {resolved.map((rec) => (
            <div key={rec.id} className="bg-surface-1/50 border border-border rounded-lg px-5 py-3.5 opacity-50 hover:opacity-70 transition-opacity">
              <div className="flex items-center gap-2.5">
                {rec.resolved_type === "accepted" ? (
                  <span className="text-positive text-xs">&#10003;</span>
                ) : (
                  <span className="text-text-muted text-xs">&times;</span>
                )}
                <span className={`text-[13px] text-text-secondary flex-1 ${rec.resolved_type === "accepted" ? "line-through" : ""}`}>
                  {rec.headline}
                </span>
                {rec.resolved_at && (
                  <span className="text-[10px] font-mono text-text-muted shrink-0">
                    {new Date(rec.resolved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {!rec.resolved_at && rec.resolved_type === "dismissed" && (
                  <span className="text-[10px] font-mono text-text-muted shrink-0">Dismissed</span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Insights Tab ────────────────────────────────────────────

function InsightsTab({
  insights,
  changelog,
  gaps,
  timingSlots,
}: {
  insights: Insight[];
  changelog: Changelog | null;
  gaps: AnalysisGap[];
  timingSlots: TimingSlot[];
}) {
  const [changelogOpen, setChangelogOpen] = useState(true);
  const [gapsOpen, setGapsOpen] = useState(false);

  const changelogSections: { key: keyof Changelog; label: string; color: string }[] = [
    { key: "confirmed", label: "CONFIRMED", color: "text-positive" },
    { key: "new_signal", label: "NEW SIGNAL", color: "text-accent" },
    { key: "reversed", label: "REVERSED", color: "text-warning" },
    { key: "retired", label: "RETIRED", color: "text-text-muted" },
  ];

  const hasChangelog = changelog && (
    changelog.confirmed.length > 0 || changelog.new_signal.length > 0 ||
    changelog.reversed.length > 0 || changelog.retired.length > 0
  );

  // Compute best timing from slots
  const computeTiming = () => {
    if (timingSlots.length === 0) return null;

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayAgg: Record<number, { totalEr: number; count: number }> = {};
    const hourAgg: Record<number, { totalEr: number; count: number }> = {};
    let postsPerWeek = 0;

    for (const s of timingSlots) {
      if (s.avg_engagement_rate == null) continue;
      if (!dayAgg[s.day]) dayAgg[s.day] = { totalEr: 0, count: 0 };
      dayAgg[s.day].totalEr += s.avg_engagement_rate * s.post_count;
      dayAgg[s.day].count += s.post_count;

      if (!hourAgg[s.hour]) hourAgg[s.hour] = { totalEr: 0, count: 0 };
      hourAgg[s.hour].totalEr += s.avg_engagement_rate * s.post_count;
      hourAgg[s.hour].count += s.post_count;

      postsPerWeek += s.post_count;
    }

    // Best 2 days
    const sortedDays = Object.entries(dayAgg)
      .map(([d, v]) => ({ day: Number(d), er: v.totalEr / v.count }))
      .sort((a, b) => b.er - a.er);
    const bestDays = sortedDays.slice(0, 2).map((d) => dayNames[d.day]);
    const bestDayEr = sortedDays[0]?.er ?? 0;

    // Best hour range — find best contiguous 3-hour window
    const hourEntries = Object.entries(hourAgg)
      .map(([h, v]) => ({ hour: Number(h), er: v.totalEr / v.count, count: v.count }))
      .sort((a, b) => a.hour - b.hour);

    let bestWindowStart = 9;
    let bestWindowEr = 0;
    // Slide a 3-hour window across hours with data
    for (const entry of hourEntries) {
      const windowHours = hourEntries.filter((h) => h.hour >= entry.hour && h.hour < entry.hour + 3);
      if (windowHours.length > 0) {
        const totalCount = windowHours.reduce((s, h) => s + h.count, 0);
        const weightedEr = windowHours.reduce((s, h) => s + h.er * h.count, 0) / totalCount;
        if (weightedEr > bestWindowEr) {
          bestWindowEr = weightedEr;
          bestWindowStart = entry.hour;
        }
      }
    }

    const fmtHour = (h: number) => {
      const hr = h % 24;
      if (hr === 0) return "12 AM";
      if (hr < 12) return `${hr} AM`;
      if (hr === 12) return "12 PM";
      return `${hr - 12} PM`;
    };

    // Estimate posts per week from total posts over data span
    const totalPosts = timingSlots.reduce((s, t) => s + t.post_count, 0);
    // 51 posts over ~52 weeks is ~1x/wk; use a better heuristic
    const weeksEstimate = Math.max(totalPosts / 2.5, 4); // assume ~2.5 posts/wk as upper bound
    const weeklyRate = Math.round((totalPosts / weeksEstimate) * 10) / 10;

    return {
      bestDays: bestDays.join(" & "),
      bestDayEr: (bestDayEr * 100).toFixed(1) + "%",
      bestTime: `${fmtHour(bestWindowStart)} – ${fmtHour(bestWindowStart + 3)}`,
      bestTimeEr: (bestWindowEr * 100).toFixed(1) + "%",
      frequency: weeklyRate >= 2 ? "2–3x/wk" : "1–2x/wk",
      currentFreq: `${weeklyRate.toFixed(1)}x/wk`,
    };
  };

  const timing = computeTiming();

  return (
    <div className="space-y-7">
      {/* Quick Insights */}
      <div className="animate-fade-up">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[13px] font-semibold text-text-primary">Quick Insights</h3>
          {insights.length > 0 && (
            <span className="text-[11px] font-medium text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">
              {insights.length}
            </span>
          )}
        </div>
        {insights.length === 0 ? (
          <p className="text-base text-text-muted">No insights available yet.</p>
        ) : (
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div
                key={ins.id}
                className="bg-surface-1 border border-border rounded-lg px-4 py-3.5 animate-fade-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <p className="text-[13px] font-medium text-text-primary leading-snug mb-1">{ins.claim}</p>
                <p className="text-sm text-text-secondary leading-relaxed">{ins.evidence}</p>
                <div className="flex items-center gap-2 mt-2">
                  {ins.consecutive_appearances > 1 ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-positive/8 text-positive">
                      Confirmed
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-accent/8 text-accent">
                      New signal
                    </span>
                  )}
                  {ins.consecutive_appearances > 1 && (
                    <span className="text-[10px] font-mono text-text-muted">
                      {ins.consecutive_appearances} consecutive runs
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What Changed */}
      {hasChangelog && (
        <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
          <button
            onClick={() => setChangelogOpen((v) => !v)}
            className="flex items-center gap-2 mb-3 group"
          >
            <span className={`text-[10px] text-text-muted transition-transform ${changelogOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
              What Changed
            </h3>
          </button>
          {changelogOpen && (
            <div className="space-y-4">
              {changelogSections.map(({ key, label, color }) =>
                changelog![key].length > 0 ? (
                  <div key={key} className="space-y-2">
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${color}`}>{label}</span>
                    {changelog![key].map((item) => (
                      <div key={item.id} className="bg-surface-1 border border-border rounded-md px-4 py-2.5">
                        <p className="text-sm font-medium text-text-primary">{item.claim}</p>
                        <p className="text-[11px] text-text-muted mt-0.5">{item.evidence}</p>
                      </div>
                    ))}
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <button
            onClick={() => setGapsOpen((v) => !v)}
            className="flex items-center gap-2 mb-3 group"
          >
            <span className={`text-[10px] text-text-muted transition-transform ${gapsOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
              What's Limiting Analysis
            </h3>
            <span className="text-[11px] font-medium text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">{gaps.length}</span>
          </button>
          {gapsOpen && (
            <div className="space-y-2">
              {gaps.map((gap) => (
                <div
                  key={gap.id}
                  className={`bg-surface-1 border rounded-md px-4 py-2.5 ${gap.times_flagged >= 3 ? "border-warning/40" : "border-border"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                      {gap.gap_type.replace("_", " ")}
                    </span>
                    {gap.times_flagged >= 3 && (
                      <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded-full font-medium">
                        {gap.times_flagged}x flagged
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-primary mt-1">{gap.description}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{gap.impact}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Best Timing */}
      {timing && (
        <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
          <h3 className="text-[13px] font-semibold text-text-primary mb-3">Best Timing</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-1 border border-border rounded-lg p-4 text-center hover:border-surface-3 transition-colors">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1.5">Best Days</div>
              <div className="text-lg font-semibold font-mono tracking-tight">{timing.bestDays}</div>
              <div className="text-[10px] font-mono text-positive mt-1">{timing.bestDayEr} median ER</div>
            </div>
            <div className="bg-surface-1 border border-border rounded-lg p-4 text-center hover:border-surface-3 transition-colors">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1.5">Best Time</div>
              <div className="text-lg font-semibold font-mono tracking-tight">{timing.bestTime}</div>
              <div className="text-[10px] font-mono text-positive mt-1">{timing.bestTimeEr} median ER</div>
            </div>
            <div className="bg-surface-1 border border-border rounded-lg p-4 text-center hover:border-surface-3 transition-colors">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1.5">Frequency</div>
              <div className="text-lg font-semibold font-mono tracking-tight">{timing.frequency}</div>
              <div className="text-[10px] font-mono text-text-muted mt-1">current: {timing.currentFreq}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deep Dive Tab ───────────────────────────────────────────

function DeepDiveTab({
  categories,
  engagement,
  sparklinePoints,
  topics,
  hooks,
  imageSubtypes,
  timingSlots,
}: {
  categories: CategoryPerformance[];
  engagement: EngagementQuality | null;
  sparklinePoints: SparklinePoint[];
  topics: TopicPerformance[];
  hooks: { by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] };
  imageSubtypes: ImageSubtypePerformance[];
  timingSlots: TimingSlot[];
}) {
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [engagementOpen, setEngagementOpen] = useState(true);
  const [topicsOpen, setTopicsOpen] = useState(true);
  const [hooksOpen, setHooksOpen] = useState(true);
  const [imageSubtypesOpen, setImageSubtypesOpen] = useState(true);

  const categoryStatusBadge = (status: CategoryPerformance["status"]) => {
    switch (status) {
      case "underexplored_high":
        return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-accent/10 text-accent">Opportunity</span>;
      case "reliable":
        return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-positive/10 text-positive">Reliable</span>;
      case "declining":
        return <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-negative/10 text-negative">Declining</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-7">
      {/* Content Opportunities */}
      <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        <button onClick={() => setCategoriesOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
          <span className={`text-[10px] text-text-muted transition-transform ${categoriesOpen ? "rotate-90" : ""}`}>&#9654;</span>
          <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
            Content Opportunities
          </h3>
          <span className="text-[11px] text-text-muted">What should I write next?</span>
        </button>
        {categoriesOpen && categories.length > 0 && (
          <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted uppercase tracking-widest">
                  <th className="text-left px-4 py-2.5 font-medium text-[10px]">Category</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[10px]">Posts</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median ER</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median<br />Impressions</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[10px]">Median<br />Interactions</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[10px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.category} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-2.5 text-text-primary font-medium">{formatCategory(cat.category)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{cat.post_count}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{cat.median_er?.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{fmtNum(cat.median_impressions)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{fmtNum(cat.median_interactions)}</td>
                    <td className="px-4 py-2.5 text-right">{categoryStatusBadge(cat.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {categoriesOpen && categories.length === 0 && (
          <p className="text-base text-text-muted">No category data available. Run AI analysis to classify your posts.</p>
        )}
      </div>

      {/* Engagement Quality */}
      <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <button onClick={() => setEngagementOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
          <span className={`text-[10px] text-text-muted transition-transform ${engagementOpen ? "rotate-90" : ""}`}>&#9654;</span>
          <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
            Engagement Quality
          </h3>
          <span className="text-[11px] text-text-muted">What kind of engagement am I getting?</span>
        </button>
        {engagementOpen && engagement && engagement.total_posts > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Comment Ratio</div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-xl font-semibold font-mono tracking-tight">{engagement.comment_ratio?.toFixed(2) ?? "--"}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">comments per reaction</div>
                  </div>
                  {sparklinePoints.length >= 2 && (
                    <Sparkline data={sparklinePoints.map((p) => p.comment_ratio)} color="var(--color-accent)" />
                  )}
                </div>
              </div>
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Save Rate</div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-xl font-semibold font-mono tracking-tight">{engagement.save_rate?.toFixed(2) ?? "--"}%</div>
                    <div className="text-[10px] text-text-muted mt-0.5">saves / impressions</div>
                  </div>
                  {sparklinePoints.length >= 2 && (
                    <Sparkline data={sparklinePoints.map((p) => p.save_rate)} color="var(--color-positive)" />
                  )}
                </div>
              </div>
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Repost Rate</div>
                <div className="text-xl font-semibold font-mono tracking-tight">{engagement.repost_rate?.toFixed(2) ?? "--"}%</div>
                <div className="text-[10px] text-text-muted mt-0.5">reposts / impressions</div>
              </div>
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Total Posts</div>
                <div className="text-xl font-semibold font-mono tracking-tight">{engagement.total_posts}</div>
                <div className="text-[10px] text-text-muted mt-0.5">with metrics</div>
              </div>
            </div>

            {/* ER comparison */}
            <div className="bg-surface-1 border border-border rounded-lg p-4">
              <div className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Engagement Rate Comparison</div>
              <div className="flex items-end gap-6">
                <div>
                  <div className="text-sm text-text-muted mb-1">Standard ER</div>
                  <div className="text-2xl font-semibold font-mono tracking-tight">{engagement.standard_er?.toFixed(2) ?? "--"}%</div>
                  <div className="text-[10px] text-text-muted">(reactions + comments + reposts) / impressions</div>
                </div>
                <div className="text-text-muted text-lg mb-1">vs</div>
                <div>
                  <div className="text-sm text-accent mb-1 font-medium">Weighted ER</div>
                  <div className="text-2xl font-semibold font-mono tracking-tight text-accent">{engagement.weighted_er?.toFixed(2) ?? "--"}%</div>
                  <div className="text-[10px] text-text-muted">comments x5 + reposts x3 + saves x3 + sends x3 + reactions x1</div>
                </div>
              </div>
              {engagement.weighted_er != null && engagement.standard_er != null && engagement.weighted_er > engagement.standard_er && (
                <p className="text-sm text-positive mt-3">
                  Your weighted ER is {((engagement.weighted_er / engagement.standard_er - 1) * 100).toFixed(0)}% higher than standard — your engagement is quality-heavy.
                </p>
              )}
            </div>
          </div>
        )}
        {engagementOpen && (!engagement || engagement.total_posts === 0) && (
          <p className="text-base text-text-muted">Not enough engagement data yet.</p>
        )}
      </div>

      {/* Topic Performance */}
      {topics.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "180ms" }}>
          <button onClick={() => setTopicsOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
            <span className={`text-[10px] text-text-muted transition-transform ${topicsOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
              Topic Performance
            </h3>
            <span className="text-[11px] text-text-muted">Which topics resonate most?</span>
          </button>
          {topicsOpen && (
            <PerformanceTable
              rows={topics.map((t) => ({ name: t.topic, post_count: t.post_count, median_wer: t.median_wer, median_impressions: t.median_impressions, median_comments: t.median_comments }))}
              nameLabel="Topic"
            />
          )}
        </div>
      )}

      {/* Hook Type Performance */}
      {(hooks.by_hook_type.length > 0 || hooks.by_format_style.length > 0) && (
        <div className="animate-fade-up" style={{ animationDelay: "240ms" }}>
          <button onClick={() => setHooksOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
            <span className={`text-[10px] text-text-muted transition-transform ${hooksOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
              Hook &amp; Format Performance
            </h3>
            <span className="text-[11px] text-text-muted">What openings and formats work best?</span>
          </button>
          {hooksOpen && (
            <div className="space-y-4">
              {hooks.by_hook_type.length > 0 && (
                <div>
                  <div className="text-[11px] text-text-muted font-medium mb-2">By Hook Type</div>
                  <PerformanceTable
                    rows={hooks.by_hook_type.map((h) => ({ name: h.name, post_count: h.post_count, median_wer: h.median_wer, median_impressions: h.median_impressions, median_comments: h.median_comments }))}
                    nameLabel="Hook Type"
                  />
                </div>
              )}
              {hooks.by_format_style.length > 0 && (
                <div>
                  <div className="text-[11px] text-text-muted font-medium mb-2">By Format Style</div>
                  <PerformanceTable
                    rows={hooks.by_format_style.map((h) => ({ name: h.name, post_count: h.post_count, median_wer: h.median_wer, median_impressions: h.median_impressions, median_comments: h.median_comments }))}
                    nameLabel="Format"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Image Subtype Performance (conditional) */}
      {imageSubtypes.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "300ms" }}>
          <button onClick={() => setImageSubtypesOpen((v) => !v)} className="flex items-center gap-2 mb-3 group">
            <span className={`text-[10px] text-text-muted transition-transform ${imageSubtypesOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <h3 className="text-[13px] font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
              Image Subtype Performance
            </h3>
          </button>
          {imageSubtypesOpen && (
            <PerformanceTable
              rows={imageSubtypes.map((s) => ({ name: s.format, post_count: s.post_count, median_wer: s.median_wer, median_impressions: s.median_impressions, median_comments: s.median_comments }))}
              nameLabel="Format"
            />
          )}
        </div>
      )}

      {/* Timing Grid */}
      {timingSlots.length > 0 && <TimingGrid slots={timingSlots} />}
    </div>
  );
}

// ── Timing Grid ──────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_WINDOWS = [
  { label: "Early\n6-9a", start: 6, end: 9 },
  { label: "Morning\n9-12p", start: 9, end: 12 },
  { label: "Lunch\n12-2p", start: 12, end: 14 },
  { label: "Afternoon\n2-5p", start: 14, end: 17 },
  { label: "Evening\n5-8p", start: 17, end: 20 },
  { label: "Night\n8-11p", start: 20, end: 23 },
];

function TimingGrid({ slots }: { slots: TimingSlot[] }) {
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

function PerformanceTable({
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

// ── Main Coach Component ────────────────────────────────────

export default function Coach() {
  const [tab, setTab] = useState<CoachTab>("actions");
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);

  // Actions data
  const [activeRecs, setActiveRecs] = useState<Recommendation[]>([]);
  const [resolvedRecs, setResolvedRecs] = useState<Recommendation[]>([]);
  const [promptSuggestions, setPromptSuggestions] = useState<PromptSuggestions | null>(null);

  // Insights data
  const [insights, setInsights] = useState<Insight[]>([]);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [gaps, setGaps] = useState<AnalysisGap[]>([]);
  const [timingSlots, setTimingSlots] = useState<TimingSlot[]>([]);

  // Deep Dive / Breakdowns data
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [categories, setCategories] = useState<CategoryPerformance[]>([]);
  const [engagement, setEngagement] = useState<EngagementQuality | null>(null);
  const [sparklinePoints, setSparklinePoints] = useState<SparklinePoint[]>([]);
  const [topics, setTopics] = useState<TopicPerformance[]>([]);
  const [hooks, setHooks] = useState<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>({ by_hook_type: [], by_format_style: [] });
  const [imageSubtypes, setImageSubtypes] = useState<ImageSubtypePerformance[]>([]);

  const loadAll = () => {
    // Status
    api.insightsStatus().then(setStatus).catch(() => {});

    // Actions
    api.recommendationsWithCooldown().then((r) => {
      setActiveRecs(r.active);
      setResolvedRecs(r.resolved);
    }).catch(() => {});
    api.insightsPromptSuggestions().then((r) => setPromptSuggestions(r.prompt_suggestions)).catch(() => {});

    // Insights
    api.insights().then((r) => setInsights(r.insights)).catch(() => {});
    api.insightsChangelog().then(setChangelog).catch(() => {});
    api.insightsGaps().then((r) => setGaps(r.gaps)).catch(() => {});
    api.timing().then((r) => setTimingSlots(r.slots)).catch(() => {});

    // Deep Dive / Breakdowns
    api.deepDiveProgress().then(setProgress).catch(() => {});
    api.deepDiveCategories().then((r) => setCategories(r.categories)).catch(() => {});
    api.deepDiveEngagement().then((r) => setEngagement(r.engagement)).catch(() => {});
    api.deepDiveSparkline(90).then((r) => setSparklinePoints(r.points)).catch(() => {});
    api.deepDiveTopics().then((r) => setTopics(r.topics)).catch(() => {});
    api.deepDiveHooks().then(setHooks).catch(() => {});
    api.deepDiveImageSubtypes().then((r) => setImageSubtypes(r.subtypes)).catch(() => {});
  };

  useEffect(() => {
    loadAll();
    // If pipeline is running on load, poll until done
    api.insightsStatus().then((s) => {
      if (s.running) {
        setRefreshing(true);
        const poll = setInterval(() => {
          api.insightsStatus().then((s2) => {
            setStatus(s2);
            if (!s2.running) {
              clearInterval(poll);
              setRefreshing(false);
              loadAll();
            }
          }).catch(() => {});
        }, 3000);
      }
    }).catch(() => {});
  }, []);

  const handleRefresh = (force = false) => {
    setRefreshing(true);
    api.insightsRefresh(force)
      .then(() => {
        // Poll for completion
        const poll = setInterval(() => {
          api.insightsStatus().then((s) => {
            setStatus(s);
            if (!s.running) {
              clearInterval(poll);
              setRefreshing(false);
              loadAll();
            }
          }).catch(() => {});
        }, 3000);
      })
      .catch(() => setRefreshing(false));
  };

  const handleResolve = (id: number, type: "accepted" | "dismissed") => {
    api.resolveRecommendation(id, type).then(() => {
      // Move from active to resolved locally
      setActiveRecs((prev) => prev.filter((r) => r.id !== id));
      setResolvedRecs((prev) => {
        const rec = activeRecs.find((r) => r.id === id);
        if (rec) return [{ ...rec, resolved_type: type, resolved_at: new Date().toISOString() }, ...prev];
        return prev;
      });
    }).catch(() => {});
  };

  const handleFeedback = (id: number, rating: string) => {
    api.recommendationFeedback(id, rating).catch(() => {});
  };

  const handleAcceptSuggestion = async (_index: number, suggestion: PromptSuggestion) => {
    const currentPromptRes = await api.getWritingPrompt().catch(() => ({ text: null }));
    const currentText = currentPromptRes.text ?? "";
    let newText: string;
    if (currentText.includes(suggestion.current)) {
      newText = currentText.replace(suggestion.current, suggestion.suggested);
    } else if (currentText.includes(suggestion.suggested)) {
      // Already applied — don't duplicate
      return;
    } else {
      newText = currentText + "\n" + suggestion.suggested;
    }
    await api.saveWritingPrompt(newText, "ai_suggestion", suggestion.evidence).catch(() => {});
    setPromptSuggestions(null); // Clear the UI immediately
  };

  const tabs: { key: CoachTab; label: string; count?: number }[] = [
    { key: "actions", label: "Overview", count: activeRecs.length || undefined },
    { key: "insights", label: "Insights" },
    { key: "deep-dive", label: "Breakdowns" },
  ];

  return (
    <div className="space-y-5">
      {/* Header with tabs */}
      <div className="flex items-center border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key
                ? "text-text-primary font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold bg-accent/12 text-accent">
                {t.count}
              </span>
            )}
            {tab === t.key && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-accent rounded-t" />
            )}
          </button>
        ))}
        <div className="ml-auto py-2.5 flex items-center gap-3">
          {status && (
            <span className="text-[11px] text-text-muted">
              {status.running
                ? "Analyzing..."
                : status.last_run
                  ? `Last run ${formatTimeAgo(status.last_run.completed_at)}`
                  : "Never run"}
              {!status.running && status.next_auto_regen && (
                <> · Next auto-regen {formatTimeUntil(status.next_auto_regen)}</>
              )}
              {!status.running && status.schedule === "off" && (
                <> · Auto-regen off</>
              )}
            </span>
          )}
          <button
            onClick={() => handleRefresh(true)}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-accent hover:bg-accent/8 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === "actions" && (
        <ActionsTab
          active={activeRecs}
          resolved={resolvedRecs}
          promptSuggestions={promptSuggestions}
          onResolve={handleResolve}
          onFeedback={handleFeedback}
          onAcceptSuggestion={handleAcceptSuggestion}
          progress={progress}
          sparklinePoints={sparklinePoints}
          insights={insights}
        />
      )}
      {tab === "insights" && (
        <InsightsTab
          insights={insights}
          changelog={changelog}
          gaps={gaps}
          timingSlots={timingSlots}
        />
      )}
      {tab === "deep-dive" && (
        <DeepDiveTab
          categories={categories}
          engagement={engagement}
          sparklinePoints={sparklinePoints}
          topics={topics}
          hooks={hooks}
          imageSubtypes={imageSubtypes}
          timingSlots={timingSlots}
        />
      )}
    </div>
  );
}
