import { useState, useEffect } from "react";
import { api, type RetroAnalysis } from "../../api/client";

interface PostRetroProps {
  generationId: number;
  draftText: string;
  onBack: () => void;
}

export default function PostRetro({ generationId, draftText, onBack }: PostRetroProps) {
  const [publishedText, setPublishedText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<RetroAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load existing retro if available
  useEffect(() => {
    api.generateGetRetro(generationId).then((res) => {
      if (res.retro) {
        setPublishedText(res.retro.published_text);
        setAnalysis(res.retro.analysis);
      }
    }).catch(() => {});
  }, [generationId]);

  const handleAnalyze = async () => {
    if (!publishedText.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await api.generateRetro(generationId, publishedText);
      setAnalysis(res.analysis);
    } catch (err: any) {
      setError(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const significanceDot = (s: string) =>
    s === "high" ? "bg-accent" : "bg-text-muted";

  const categoryLabel = (c: string) => {
    const labels: Record<string, string> = {
      structural: "Structure",
      voice: "Voice",
      content: "Content",
      hook: "Hook",
      closing: "Closing",
      cut: "Cut",
      added: "Added",
    };
    return labels[c] ?? c;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[13px] text-text-secondary hover:text-text-primary">
          Back
        </button>
        <h2 className="text-[15px] font-semibold text-text-primary">Post Retro</h2>
      </div>

      {/* Side-by-side: draft and published */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2">
            AI Draft
          </label>
          <div className="bg-surface-2 rounded-lg p-4 text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
            {draftText}
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2">
            What You Published
          </label>
          <textarea
            value={publishedText}
            onChange={(e) => setPublishedText(e.target.value)}
            placeholder="Paste the final version you published on LinkedIn..."
            className="w-full bg-surface-2 border border-border rounded-lg p-4 text-[13px] text-text-primary leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            rows={16}
            disabled={analyzing}
          />
        </div>
      </div>

      {/* Analyze button */}
      {!analysis && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !publishedText.trim()}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {analyzing ? "Analyzing..." : "Analyze Differences"}
          </button>
          {error && <span className="text-[12px] text-negative">{error}</span>}
        </div>
      )}

      {/* Results */}
      {analysis && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="bg-surface-2 rounded-lg p-4 border border-border">
            <p className="text-[13px] text-text-primary leading-relaxed">{analysis.summary}</p>
            {analysis.surface_changes_summary && analysis.surface_changes_summary !== "None significant" && (
              <p className="text-[11px] text-text-muted mt-2">
                Surface changes: {analysis.surface_changes_summary}
              </p>
            )}
          </div>

          {/* Editorial principles found */}
          {analysis.changes.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Editorial Principles
              </h3>
              <div className="space-y-3">
                {analysis.changes.map((change, i) => (
                  <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${significanceDot(change.significance)}`} />
                      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                        {categoryLabel(change.category)}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-primary leading-relaxed">{change.principle}</p>
                    {(change.draft_excerpt || change.published_excerpt) && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {change.draft_excerpt && (
                          <div className="text-[12px]">
                            <span className="text-text-muted">Draft: </span>
                            <span className="text-negative/80 line-through">{change.draft_excerpt}</span>
                          </div>
                        )}
                        {change.published_excerpt && (
                          <div className="text-[12px]">
                            <span className="text-text-muted">Published: </span>
                            <span className="text-positive/80">{change.published_excerpt}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patterns */}
          {analysis.patterns.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Patterns
              </h3>
              <ul className="space-y-2">
                {analysis.patterns.map((p, i) => (
                  <li key={i} className="text-[13px] text-text-secondary leading-relaxed pl-4 border-l-2 border-accent/30">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rule suggestions */}
          {analysis.rule_suggestions.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Suggested Rule Updates
              </h3>
              <div className="space-y-3">
                {analysis.rule_suggestions.map((rule, i) => (
                  <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium text-accent uppercase">
                        {rule.action} · {rule.category.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-primary">{rule.rule_text}</p>
                    <p className="text-[11px] text-text-muted mt-1">Evidence: {rule.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt suggestions */}
          {analysis.prompt_suggestions.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Prompt Improvements
              </h3>
              <ul className="space-y-2">
                {analysis.prompt_suggestions.map((s, i) => (
                  <li key={i} className="text-[13px] text-text-secondary leading-relaxed pl-4 border-l-2 border-warning/30">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Re-analyze */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !publishedText.trim()}
            className="text-[12px] text-text-muted hover:text-accent transition-colors"
          >
            {analyzing ? "Analyzing..." : "Re-analyze"}
          </button>
        </div>
      )}
    </div>
  );
}
