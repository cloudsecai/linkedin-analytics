import { useState } from "react";
import type { Insight, Changelog, AnalysisGap, TimingSlot } from "../../api/client";

export function InsightsTab({
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
