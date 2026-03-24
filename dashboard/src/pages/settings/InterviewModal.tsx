import { useState } from "react";
import { api } from "../../api/client";
import { useRealtimeInterview, type InterviewStatus } from "../../hooks/useRealtimeInterview";

interface InterviewModalProps {
  onClose: () => void;
  onComplete: (profileText: string) => void;
}

export default function InterviewModal({ onClose, onComplete }: InterviewModalProps) {
  const { status, elapsed, transcript, error, start, stop } = useRealtimeInterview();
  const [phase, setPhase] = useState<"pre" | "active" | "extracting" | "review">("pre");
  const [extractedText, setExtractedText] = useState("");
  const [extractedJson, setExtractedJson] = useState<Record<string, any>>({});
  const [extractError, setExtractError] = useState<string | null>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStart = async () => {
    setExtractError(null);
    try {
      await start();
      setPhase("active");
    } catch (err: any) {
      setExtractError(err.message ?? "Failed to start interview");
    }
  };

  const handleStop = async () => {
    stop();
    setPhase("extracting");

    // Build transcript text
    const transcriptText = transcript
      .map((t) => `${t.role === "user" ? "User" : "Interviewer"}: ${t.text}`)
      .join("\n\n");

    if (!transcriptText.trim()) {
      setExtractError("No conversation was captured. Please try again.");
      setPhase("pre");
      return;
    }

    try {
      const result = await api.extractProfile(transcriptText, elapsed);
      setExtractedText(result.profile_text);
      setExtractedJson(result.profile_json);
      setPhase("review");
    } catch (err: any) {
      setExtractError(err.message ?? "Profile extraction failed");
      setPhase("pre");
    }
  };

  const handleSave = () => {
    onComplete(extractedText);
  };

  const layerLabels: Record<string, { label: string; color: string }> = {
    mental_models: { label: "Mental Models", color: "text-purple-400" },
    contrarian_convictions: { label: "Contrarian Convictions", color: "text-red-400" },
    scar_tissue: { label: "Scar Tissue", color: "text-yellow-400" },
    disproportionate_caring: { label: "Disproportionate Caring", color: "text-green-400" },
    vantage_point: { label: "Vantage Point", color: "text-blue-400" },
    persuasion_style: { label: "Persuasion Style", color: "text-indigo-400" },
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-0 border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Profile Interview</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">&times;</button>
        </div>

        <div className="p-5">
          {/* Pre-interview */}
          {phase === "pre" && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                A 5-minute voice conversation to capture what makes your professional perspective distinctive.
                The AI will start by asking your name and role, then dig into your mental models, contrarian beliefs, and hard-won lessons.
              </p>

              {(error || extractError) && (
                <div className="bg-negative/10 text-negative text-sm rounded-lg p-3">
                  {error || extractError}
                </div>
              )}

              <div className="bg-surface-2 rounded-lg p-4 text-xs text-text-muted space-y-1">
                <p className="font-medium text-text-secondary">Topics we'll cover:</p>
                <p>&bull; What you actually do (beyond your title)</p>
                <p>&bull; What your industry gets wrong</p>
                <p>&bull; Hard-won lessons and recurring patterns</p>
                <p>&bull; Mental models you apply everywhere</p>
              </div>

              <button
                onClick={handleStart}
                disabled={status === "connecting"}
                className="w-full py-3 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {status === "connecting" ? "Connecting..." : "Start Interview"}
              </button>
            </div>
          )}

          {/* Active interview */}
          {phase === "active" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Pulsing indicator */}
                  <div className="relative">
                    <div className="w-4 h-4 bg-negative rounded-full animate-pulse" />
                    <div className="absolute inset-0 w-4 h-4 bg-negative rounded-full animate-ping opacity-30" />
                  </div>
                  <span className="text-sm font-medium text-text-primary">Interview in progress</span>
                </div>
                <span className="text-2xl font-mono text-text-primary tabular-nums">
                  {formatTime(elapsed)}
                </span>
              </div>

              {/* Live transcript */}
              <div className="bg-surface-2 rounded-lg p-4 max-h-64 overflow-y-auto space-y-3">
                {transcript.length === 0 ? (
                  <p className="text-sm text-text-muted italic">Waiting for conversation to begin...</p>
                ) : (
                  transcript.map((t, i) => (
                    <div key={i} className={`text-sm ${t.role === "user" ? "text-text-primary" : "text-accent"}`}>
                      <span className="text-xs text-text-muted font-medium">
                        {t.role === "user" ? "You" : "AI"}:
                      </span>{" "}
                      {t.text}
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={handleStop}
                className="w-full py-3 rounded-lg text-sm font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors border border-border"
              >
                End Interview
              </button>
            </div>
          )}

          {/* Extracting */}
          {phase === "extracting" && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <svg className="animate-spin h-6 w-6 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              <p className="text-sm">Extracting your profile...</p>
              <p className="text-xs mt-1">Analyzing {transcript.length} conversation exchanges</p>
            </div>
          )}

          {/* Review extracted profile */}
          {phase === "review" && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Here's what we extracted. Edit anything that doesn't sound right.
              </p>

              <div>
                <label className="text-xs text-text-muted block mb-1">Profile (injected into every draft)</label>
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  rows={6}
                  className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
                />
                <span className="text-xs text-text-muted">~{Math.ceil(extractedText.length / 4)} tokens</span>
              </div>

              {/* Structured layers */}
              <div className="space-y-3">
                {Object.entries(layerLabels).map(([key, { label, color }]) => {
                  const value = extractedJson[key];
                  if (!value) return null;
                  return (
                    <div key={key} className="bg-surface-2 rounded-lg p-3">
                      <span className={`text-xs font-semibold uppercase ${color}`}>{label}</span>
                      <div className="mt-1 text-sm text-text-secondary">
                        {Array.isArray(value)
                          ? value.map((v: string, i: number) => <p key={i} className="mt-0.5">&bull; {v}</p>)
                          : <p>{value}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
                >
                  Save Profile
                </button>
                <button
                  onClick={() => { setPhase("pre"); }}
                  className="px-4 py-3 rounded-lg text-sm font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors border border-border"
                >
                  Redo Interview
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
