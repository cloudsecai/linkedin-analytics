import { useState, useEffect } from "react";
import { api, type GenSource } from "../../api/client";

export default function Sources() {
  const [sources, setSources] = useState<GenSource[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api.getSources().then((res) => setSources(res.sources)).catch(() => {});
  }, []);

  const handleAdd = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.addSource(trimmed);
      setSources((prev) => [...prev, res.source].sort((a, b) => a.name.localeCompare(b.name)));
      setUrlInput("");
      setSuccess(`Added ${res.source.name}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message ?? "Failed to add source");
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (source: GenSource) => {
    const newEnabled = !source.enabled;
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? { ...s, enabled: newEnabled ? 1 : 0 } : s))
    );
    try {
      await api.updateSource(source.id, { enabled: newEnabled });
    } catch {
      // Rollback
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, enabled: source.enabled } : s))
      );
    }
  };

  const handleDelete = async (source: GenSource) => {
    setSources((prev) => prev.filter((s) => s.id !== source.id));
    try {
      await api.deleteSource(source.id);
    } catch {
      // Rollback — re-fetch
      api.getSources().then((res) => setSources(res.sources)).catch(() => {});
    }
  };

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="max-w-2xl">
      {/* Add source */}
      <div className="mb-6">
        <h3 className="text-[14px] font-medium text-gen-text-0 mb-1">Add a source</h3>
        <p className="text-[12px] text-gen-text-3 mb-3">
          Paste a website URL — we'll find the feed automatically.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !adding) handleAdd(); }}
            placeholder="e.g. krebsonsecurity.com"
            className="flex-1 bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-2.5 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent"
          />
          <button
            onClick={handleAdd}
            disabled={!urlInput.trim() || adding}
            className="px-5 py-2.5 bg-gen-accent text-white text-[13px] font-medium rounded-[10px] hover:bg-gen-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {adding ? "Finding..." : "Add"}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[12px] text-red-400">{error}</p>
        )}
        {success && (
          <p className="mt-2 text-[12px] text-positive">{success}</p>
        )}
      </div>

      {/* Source list */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-medium text-gen-text-0">
            Your sources
          </h3>
          <span className="text-[12px] text-gen-text-3">
            {enabledCount} active
          </span>
        </div>

        {sources.length === 0 && (
          <p className="text-[13px] text-gen-text-3 py-8 text-center">
            No sources configured yet. Add a website above.
          </p>
        )}

        {sources.map((source) => (
          <div
            key={source.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              source.enabled
                ? "bg-gen-bg-1 border-gen-border-1"
                : "bg-gen-bg-0 border-gen-border-1 opacity-50"
            }`}
          >
            {/* Toggle */}
            <button
              onClick={() => handleToggle(source)}
              className={`w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 cursor-pointer ${
                source.enabled ? "bg-gen-accent" : "bg-gen-bg-4"
              }`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                  source.enabled ? "left-[16px]" : "left-[2px]"
                }`}
              />
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-gen-text-0 truncate">{source.name}</p>
              <p className="text-[11px] text-gen-text-4 truncate">{source.feed_url}</p>
            </div>

            {/* Delete */}
            <button
              onClick={() => handleDelete(source)}
              className="text-gen-text-4 hover:text-red-400 transition-colors flex-shrink-0 cursor-pointer"
              title="Remove source"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
