import { useState, useEffect, useRef } from "react";
import { api } from "../../api/client";

interface ExtensionSetupProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function ExtensionSetup({ onNext, onSkip }: ExtensionSetupProps) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [synced, setSynced] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    setError(null);
    try {
      const health = await api.health();
      if (health) {
        setConnected(true);
        if (health.last_sync_at) {
          setSynced(true);
          // Get post count from the posts endpoint
          try {
            const postsRes = await api.posts({ limit: 1 });
            setPostCount(postsRes.total);
          } catch {
            setPostCount(0);
          }
        }
      }
    } catch {
      setError("Can't reach the server. Make sure ReachLab is running.");
    } finally {
      setChecking(false);
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const health = await api.health();
        if (health?.last_sync_at) {
          setSynced(true);
          try {
            const postsRes = await api.posts({ limit: 1 });
            setPostCount(postsRes.total);
          } catch {}
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 3000);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText("chrome://extensions");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Connect LinkedIn</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        Install the ReachLab Chrome extension to import your LinkedIn posts.
      </p>

      <div className="space-y-4 mb-6">
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
          <div>
            <p className="text-[13px] text-text-primary">Open Chrome extensions page</p>
            <button onClick={copyUrl} className="text-[12px] text-accent hover:underline mt-0.5">
              {copied ? "Copied!" : "Copy chrome://extensions"}
            </button>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
          <p className="text-[13px] text-text-primary">Enable &ldquo;Developer mode&rdquo; (toggle in top-right)</p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
          <div>
            <p className="text-[13px] text-text-primary">
              Click &ldquo;Load unpacked&rdquo; and select the{" "}
              <code className="text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">extension/dist</code> folder inside your ReachLab directory
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              {navigator.platform.startsWith("Win")
                ? "e.g. C:\\Users\\YourName\\reachlab\\extension\\dist"
                : "e.g. ~/reachlab/extension/dist"}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error}
        </div>
      )}

      {!connected ? (
        <button
          onClick={checkConnection}
          disabled={checking}
          className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "Checking..." : "Check connection"}
        </button>
      ) : !synced ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-green-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.3 5.3l-4 4a.75.75 0 01-1.1 0l-2-2a.75.75 0 111.1-1.1L6.8 8.7l3.4-3.4a.75.75 0 111.1 1.1z" />
            </svg>
            Extension connected!
          </div>
          <p className="text-[13px] text-text-secondary">
            Now visit LinkedIn to import your posts:
          </p>
          <a
            href="https://www.linkedin.com/analytics/creator/content/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => startPolling()}
            className="block w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium text-center hover:opacity-90"
          >
            Open LinkedIn Analytics
          </a>
          <p className="text-[12px] text-text-muted text-center">Waiting for posts to sync...</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-green-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.3 5.3l-4 4a.75.75 0 01-1.1 0l-2-2a.75.75 0 111.1-1.1L6.8 8.7l3.4-3.4a.75.75 0 111.1 1.1z" />
            </svg>
            Found {postCount} posts!
          </div>
          <button
            onClick={onNext}
            className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
          >
            Continue
          </button>
        </div>
      )}

      <button
        onClick={onSkip}
        className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
      >
        I'll do this later
      </button>
    </div>
  );
}
