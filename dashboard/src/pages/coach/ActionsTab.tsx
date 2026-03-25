import { useState } from "react";
import type { Recommendation, PromptSuggestions, PromptSuggestion, ProgressData, SparklinePoint, Insight } from "../../api/client";
import { getPriorityLabel, getConfidenceLabel, formatCategory, fmtNum, deltaClass, deltaLabel, Sparkline } from "./components";

export function ActionsTab({
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
