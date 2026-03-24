import { useState, useEffect } from "react";
import { api } from "../../api/client";
import InterviewModal from "./InterviewModal";

export default function ProfileSection() {
  const [profileText, setProfileText] = useState("");
  const [interviewCount, setInterviewCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInterview, setShowInterview] = useState(false);

  useEffect(() => {
    api.getAuthorProfile().then((r) => {
      setProfileText(r.profile_text);
      setInterviewCount(r.interview_count);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveAuthorProfile(profileText);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleInterviewComplete = (newProfileText: string) => {
    setProfileText(newProfileText);
    setInterviewCount((c) => c + 1);
    setShowInterview(false);
  };

  return (
    <>
      <div className="bg-surface-1 border border-border rounded-lg p-5 space-y-4 mt-3">
        <div>
          <h4 className="text-sm font-medium text-text-primary mb-1">Author Profile</h4>
          <p className="text-xs text-text-muted">
            Your professional lens — injected into every post generation to make drafts sound like you.
          </p>
        </div>

        {profileText ? (
          <>
            <textarea
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
              rows={6}
              className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : saved ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => setShowInterview(true)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-surface-2 text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                {interviewCount > 0 ? "Re-interview" : "Voice interview"}
              </button>
              <span className="text-xs text-text-muted">
                ~{Math.ceil(profileText.length / 4)} tokens
                {interviewCount > 0 && ` · ${interviewCount} interview${interviewCount !== 1 ? "s" : ""}`}
              </span>
            </div>
          </>
        ) : (
          <div className="bg-surface-2 rounded-lg p-6 text-center">
            <p className="text-sm text-text-muted mb-2">No profile yet</p>
            <p className="text-xs text-text-muted mb-4">
              A 5-minute voice interview will extract what makes your perspective distinctive.
              Or type your profile directly below.
            </p>
            <button
              onClick={() => setShowInterview(true)}
              className="px-5 py-2.5 rounded-md text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity inline-flex items-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
              Start Interview
            </button>
          </div>
        )}
      </div>

      {showInterview && (
        <InterviewModal
          onClose={() => setShowInterview(false)}
          onComplete={handleInterviewComplete}
        />
      )}
    </>
  );
}
