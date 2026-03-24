import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useRealtimeInterview } from "../../hooks/useRealtimeInterview";

interface VoiceInterviewProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function VoiceInterview({ onNext, onSkip }: VoiceInterviewProps) {
  const { status, elapsed, transcript, getTranscript, error, start, stop } = useRealtimeInterview();
  const [phase, setPhase] = useState<"pre" | "active" | "extracting" | "review">("pre");
  const [extractedText, setExtractedText] = useState("");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [noApiKey, setNoApiKey] = useState(false);

  // Stop interview and mic if component unmounts (e.g. user skips mid-interview)
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

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
      if (err.message?.includes("OPENAI_API_KEY") || err.message?.includes("500")) {
        setNoApiKey(true);
      } else {
        setExtractError(err.message ?? "Failed to start interview");
      }
    }
  };

  const handleStop = async () => {
    const currentTranscript = getTranscript();
    stop();
    setPhase("extracting");
    const transcriptText = currentTranscript
      .map((t) => `${t.role === "user" ? "User" : "Interviewer"}: ${t.text}`)
      .join("\n\n");

    if (!transcriptText.trim()) {
      setExtractError("No conversation captured. Try again.");
      setPhase("pre");
      return;
    }

    try {
      const result = await api.extractProfile(transcriptText, elapsed);
      setExtractedText(result.profile_text);
      setPhase("review");
    } catch (err: any) {
      setExtractError(err.message ?? "Extraction failed");
      setPhase("pre");
    }
  };

  const handleSave = async () => {
    try {
      await api.saveAuthorProfile(extractedText);
      onNext();
    } catch (err: any) {
      setExtractError(err.message ?? "Failed to save profile");
    }
  };

  if (noApiKey) {
    return (
      <div className="max-w-lg mx-auto text-center">
        <h2 className="text-[20px] font-semibold text-text-primary mb-2">Voice interview unavailable</h2>
        <p className="text-[13px] text-text-secondary mb-6">
          This feature requires an OpenAI API key. Add <code className="text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">OPENAI_API_KEY=sk-...</code> to your <code className="text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">server/.env</code> file and restart the server.
        </p>
        <p className="text-[13px] text-text-secondary mb-6">
          You can do the interview later from Settings.
        </p>
        <button
          onClick={onSkip}
          className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
        >
          Continue without interview
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Voice interview</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        A 5-minute voice conversation to capture what makes your perspective distinctive. The AI will ask about your name, role, and what you do — then dig into how you think.
      </p>

      {(error || extractError) && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error || extractError}
        </div>
      )}

      {phase === "pre" && (
        <div className="space-y-4">
          <div className="bg-surface-2 border border-border rounded-lg p-4 text-[13px] text-text-secondary space-y-2">
            <p>The interview will:</p>
            <ul className="list-disc list-inside text-[12px] space-y-1 text-text-muted">
              <li>Ask your name, role, and what you do</li>
              <li>Explore what makes your perspective unique</li>
              <li>Dig into your mental models and contrarian views</li>
              <li>Take about 5 minutes</li>
            </ul>
          </div>
          <button
            onClick={handleStart}
            disabled={status === "connecting"}
            className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {status === "connecting" ? "Connecting..." : "Start Interview"}
          </button>
        </div>
      )}

      {phase === "active" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-4 h-4 bg-negative rounded-full animate-pulse" />
              </div>
              <span className="text-[13px] font-medium text-text-primary">Interview in progress</span>
            </div>
            <span className="text-2xl font-mono text-text-primary tabular-nums">{formatTime(elapsed)}</span>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
            {transcript.length === 0 ? (
              <p className="text-[13px] text-text-muted italic">Waiting for conversation...</p>
            ) : (
              transcript.map((t, i) => (
                <div key={i} className={`text-[13px] ${t.role === "user" ? "text-text-primary" : "text-accent"}`}>
                  <span className="text-[11px] text-text-muted font-medium">
                    {t.role === "user" ? "You" : "AI"}:
                  </span>{" "}
                  {t.text}
                </div>
              ))
            )}
          </div>
          <button
            onClick={handleStop}
            className="w-full py-3 bg-surface-2 text-text-primary rounded-xl text-[14px] font-medium border border-border hover:bg-surface-3"
          >
            End Interview
          </button>
        </div>
      )}

      {phase === "extracting" && (
        <div className="text-center py-16 text-text-muted">
          <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-[13px]">Extracting your profile...</p>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-4">
          <p className="text-[13px] text-text-secondary">
            Here's what we extracted. Edit anything that doesn't sound right.
          </p>
          <div>
            <label className="text-[11px] text-text-muted block mb-1">Extracted profile</label>
            <textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              rows={6}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <button
            onClick={handleSave}
            className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
          >
            Save &amp; Continue
          </button>
        </div>
      )}

      <button
        onClick={onSkip}
        className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}
