import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface SetupCompleteProps {
  onFinish: () => void;
}

export default function SetupComplete({ onFinish }: SetupCompleteProps) {
  const [stats, setStats] = useState({ topics: 0, sources: 0, hasProfile: false });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [taxonomyRes, sourcesRes, profile] = await Promise.all([
        api.insightsTaxonomy().catch(() => ({ taxonomy: [] })),
        api.getSources().catch(() => ({ sources: [] })),
        api.getAuthorProfile().catch(() => null),
      ]);
      setStats({
        topics: taxonomyRes.taxonomy.length,
        sources: sourcesRes.sources.filter((s) => s.enabled).length,
        hasProfile: !!profile?.profile_text,
      });
    } catch {}
  };

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>

      <h2 className="text-[24px] font-semibold text-text-primary mb-2">You're all set!</h2>
      <p className="text-[13px] text-text-secondary mb-8">
        ReachLab is configured and ready to help you write.
      </p>

      <div className="flex justify-center gap-8 mb-8">
        {stats.topics > 0 && (
          <div className="text-center">
            <div className="text-[20px] font-semibold text-accent">{stats.topics}</div>
            <div className="text-[11px] text-text-muted">topics</div>
          </div>
        )}
        {stats.sources > 0 && (
          <div className="text-center">
            <div className="text-[20px] font-semibold text-accent">{stats.sources}</div>
            <div className="text-[11px] text-text-muted">sources</div>
          </div>
        )}
        {stats.hasProfile && (
          <div className="text-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent mx-auto">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <div className="text-[11px] text-text-muted">voice profile</div>
          </div>
        )}
      </div>

      <button
        onClick={onFinish}
        className="px-8 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 transition-opacity"
      >
        Start writing
      </button>
    </div>
  );
}
