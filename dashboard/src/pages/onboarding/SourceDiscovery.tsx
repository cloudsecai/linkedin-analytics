import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface DiscoveredSource {
  name: string;
  url: string;
  feed_url: string | null;
  description: string;
  selected: boolean;
  persisted: boolean;
}

interface SourceDiscoveryProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function SourceDiscovery({ onNext, onSkip }: SourceDiscoveryProps) {
  const [phase, setPhase] = useState<"discovering" | "selecting" | "saving">("discovering");
  const [sources, setSources] = useState<DiscoveredSource[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    discover();
  }, []);

  const discover = async () => {
    try {
      const result = await api.discoverSources();
      setSources(result.map((s) => ({ ...s, selected: true, persisted: false })));
      setPhase("selecting");
    } catch (err: any) {
      // Discovery failed — let user add manually or use defaults
      setError("Couldn't auto-discover sources. You can add them manually or use the defaults.");
      setPhase("selecting");
    }
  };

  const toggleSource = (idx: number) => {
    setSources((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, selected: !s.selected } : s))
    );
  };

  const addManual = async () => {
    const url = manualUrl.trim();
    if (!url) return;
    setAddingManual(true);
    setError(null);
    try {
      const { source } = await api.addSource(url);
      setSources((prev) => [
        ...prev,
        {
          name: source.name || url,
          url,
          feed_url: source.feed_url,
          description: "",
          selected: true,
          persisted: true,
        },
      ]);
      setManualUrl("");
    } catch (err: any) {
      setError(err.message ?? "Failed to add source");
    } finally {
      setAddingManual(false);
    }
  };

  const saveAndContinue = async () => {
    setPhase("saving");
    const toSave = sources.filter((s) => s.selected && s.feed_url && !s.persisted);
    await Promise.allSettled(
      toSave.map((source) => api.addSource(source.url))
    );
    onNext();
  };

  if (phase === "discovering") {
    return (
      <div className="text-center py-24">
        <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-[13px] text-text-muted">Finding sources for your topics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Your news sources</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        {sources.length > 0
          ? "We found sources relevant to your topics. Uncheck any you don't want."
          : "Add websites you follow to help discover timely topics."}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error}
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {sources.map((s, i) => (
            <label
              key={i}
              className="flex items-start gap-3 p-3 bg-surface-2 border border-border rounded-lg cursor-pointer hover:bg-surface-3 transition-colors"
            >
              <input
                type="checkbox"
                checked={s.selected}
                onChange={() => toggleSource(i)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-primary truncate">{s.name}</div>
                {s.description && (
                  <div className="text-[11px] text-text-muted mt-0.5">{s.description}</div>
                )}
                <div className="text-[11px] text-text-muted truncate">{s.url}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
          placeholder="Add a website URL..."
          className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={addManual}
          disabled={!manualUrl.trim() || addingManual}
          className="px-4 py-2 bg-accent text-white rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
        >
          {addingManual ? "..." : "Add"}
        </button>
      </div>

      <button
        onClick={saveAndContinue}
        disabled={phase === "saving"}
        className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
      >
        {phase === "saving" ? "Saving..." : "Save sources & continue"}
      </button>

      <button
        onClick={onSkip}
        className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
      >
        Use default sources
      </button>
    </div>
  );
}
