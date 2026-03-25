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
  type PendingRetro,
  type RetroPromptEdit,
} from "../api/client";
import { formatTimeAgo, formatTimeUntil } from "./coach/components";
import { ActionsTab } from "./coach/ActionsTab";
import { InsightsTab } from "./coach/InsightsTab";
import { DeepDiveTab } from "./coach/DeepDiveTab";

type CoachTab = "actions" | "insights" | "deep-dive";

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

  // Post Retro
  const [pendingRetros, setPendingRetros] = useState<PendingRetro[]>([]);
  const [appliedRetroEdits, setAppliedRetroEdits] = useState<Set<string>>(new Set());

  const handleApplyRetroEdit = async (retroId: number, editIndex: number, edit: RetroPromptEdit) => {
    const key = `${retroId}-${editIndex}`;
    try {
      const res = await api.getWritingPrompt();
      const current = res.text ?? "";
      let updated: string;
      if (edit.type === "add") {
        if (current.includes(edit.add_text)) return;
        updated = current.trimEnd() + "\n\n" + edit.add_text;
      } else if (edit.type === "remove" && edit.remove_text) {
        if (!current.includes(edit.remove_text)) return;
        updated = current.replace(edit.remove_text, "").replace(/\n{3,}/g, "\n\n").trim();
      } else if (edit.type === "replace" && edit.remove_text) {
        if (!current.includes(edit.remove_text)) {
          updated = current.trimEnd() + "\n\n" + edit.add_text;
        } else {
          updated = current.replace(edit.remove_text, edit.add_text);
        }
      } else {
        return;
      }
      await api.saveWritingPrompt(updated, "ai_suggestion", edit.reason);
      await api.markRetroApplied(retroId);
      setAppliedRetroEdits((prev) => new Set(prev).add(key));
      setPendingRetros((prev) => prev.filter((r) => r.generation_id !== retroId));
    } catch { /* ignore */ }
  };

  const loadAll = () => {
    // Status
    api.insightsStatus().then(setStatus).catch(() => {});

    // Actions + Retros
    api.getPendingRetros().then((r) => setPendingRetros(r.retros)).catch(() => {});
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
        <>
          {/* Post Retro — auto-detected prompt improvements */}
          {pendingRetros.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wider mb-2">
                Post Retro
              </h2>
              <p className="text-[12px] text-text-muted mb-4">
                Based on changes you made between AI drafts and what you published
              </p>
              {pendingRetros.map((retro) => (
                <div key={retro.generation_id} className="bg-surface-1 rounded-xl border border-border p-5 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] text-text-muted">{formatTimeAgo(retro.retro_at)}</span>
                    <span className="text-[11px] text-text-muted">Draft #{retro.generation_id}</span>
                  </div>
                  <p className="text-[13px] text-text-primary mb-4 leading-relaxed">{retro.analysis.summary}</p>

                  {retro.analysis.prompt_edits && retro.analysis.prompt_edits.length > 0 && (
                    <div className="space-y-3">
                      <span className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                        Suggested prompt updates
                      </span>
                      {retro.analysis.prompt_edits.map((edit, i) => {
                        const key = `${retro.generation_id}-${i}`;
                        const applied = appliedRetroEdits.has(key);
                        return (
                          <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <p className="text-[12px] text-text-muted mb-2">{edit.reason}</p>
                                {edit.remove_text && (
                                  <div className="text-[12px] bg-negative/5 text-negative/80 rounded px-2 py-1 mb-1 font-mono">
                                    − {edit.remove_text}
                                  </div>
                                )}
                                <div className="text-[12px] bg-positive/5 text-positive/80 rounded px-2 py-1 font-mono">
                                  + {edit.add_text}
                                </div>
                              </div>
                              <button
                                onClick={() => handleApplyRetroEdit(retro.generation_id, i, edit)}
                                disabled={applied}
                                className={`shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                                  applied
                                    ? "bg-positive/10 text-positive border border-positive/20"
                                    : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                                }`}
                              >
                                {applied ? "Applied" : "Apply"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
        </>
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
