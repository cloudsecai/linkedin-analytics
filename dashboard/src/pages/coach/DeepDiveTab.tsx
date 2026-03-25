import { useState } from "react";
import type { CategoryPerformance, EngagementQuality, SparklinePoint, TopicPerformance, HookPerformance, ImageSubtypePerformance, TimingSlot } from "../../api/client";
import { formatCategory, fmtNum, Sparkline, TimingGrid, PerformanceTable } from "./components";

export function DeepDiveTab({
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
