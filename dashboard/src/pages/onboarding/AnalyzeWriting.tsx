import { useState, useEffect, useRef } from "react";
import { api } from "../../api/client";

interface AnalyzeWritingProps {
  onNext: () => void;
  onSkip: () => void;
}

const MESSAGES = [
  "Reading your posts...",
  "Finding your topics...",
  "Building your writing profile...",
];

export default function AnalyzeWriting({ onNext, onSkip }: AnalyzeWritingProps) {
  const [phase, setPhase] = useState<"checking" | "no-posts" | "analyzing" | "done">("checking");
  const [topics, setTopics] = useState<string[]>([]);
  const [writingPrompt, setWritingPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(MESSAGES[0]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAndAnalyze();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (msgRef.current) clearInterval(msgRef.current);
    };
  }, []);

  const checkAndAnalyze = async () => {
    try {
      const postsRes = await api.posts({ limit: 1 });
      if (postsRes.total === 0) {
        setPhase("no-posts");
        return;
      }

      setPhase("analyzing");

      // Trigger analysis
      await api.insightsRefresh();

      // Rotate status messages
      let msgIdx = 0;
      msgRef.current = setInterval(() => {
        msgIdx = Math.min(msgIdx + 1, MESSAGES.length - 1);
        setMessage(MESSAGES[msgIdx]);
      }, 4000);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const { runs } = await api.getAiRuns();
          const latest = runs[0];
          if (latest && (latest.status === "completed" || latest.status === "error")) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (msgRef.current) clearInterval(msgRef.current);
            if (latest.status === "error") {
              setError("Analysis encountered an error, but you can continue.");
            }
            await loadResults();
            setPhase("done");
          }
        } catch {}
      }, 2000);
    } catch (err: any) {
      setError(err.message ?? "Analysis failed");
      setPhase("done");
    }
  };

  const loadResults = async () => {
    try {
      const { taxonomy } = await api.insightsTaxonomy();
      setTopics(taxonomy.map((t) => t.name));
    } catch {}
    try {
      const { text } = await api.getWritingPrompt();
      setWritingPrompt(text ?? "");
    } catch {}
  };

  const savePrompt = async () => {
    try {
      await api.saveWritingPrompt(writingPrompt, "manual_edit");
      setEditing(false);
    } catch {}
  };

  if (phase === "checking") {
    return (
      <div className="text-center py-20 text-text-muted text-[13px]">
        Checking your posts...
      </div>
    );
  }

  if (phase === "no-posts") {
    return (
      <div className="max-w-lg mx-auto text-center">
        <h2 className="text-[20px] font-semibold text-text-primary mb-2">No posts to analyze yet</h2>
        <p className="text-[13px] text-text-secondary mb-6">
          After your first LinkedIn sync, come back to Settings to run the analysis.
        </p>
        <button
          onClick={onSkip}
          className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
        >
          Continue
        </button>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-2 border-accent/40 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-accent" />
          </div>
        </div>
        <p className="text-[13px] text-text-muted">{message}</p>
      </div>
    );
  }

  // Phase: done
  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Here's what we found</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        We analyzed your posts and identified your topics and writing style.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error}
        </div>
      )}

      {topics.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[13px] font-medium text-text-primary mb-2">Your topics</h3>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <span
                key={t}
                className="px-3 py-1.5 bg-surface-2 border border-border rounded-full text-[12px] text-text-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {writingPrompt && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-medium text-text-primary">Writing prompt</h3>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[12px] text-accent hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <div>
              <textarea
                value={writingPrompt}
                onChange={(e) => setWritingPrompt(e.target.value)}
                rows={6}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent resize-none"
              />
              <button
                onClick={savePrompt}
                className="mt-2 px-4 py-2 bg-accent text-white rounded-lg text-[12px] font-medium hover:opacity-90"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="bg-surface-2 border border-border rounded-lg p-3 text-[12px] text-text-secondary max-h-32 overflow-y-auto whitespace-pre-wrap">
              {writingPrompt}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
      >
        Looks good, continue
      </button>
    </div>
  );
}
