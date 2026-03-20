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
        <div className="flex items-start justify-between">
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-1">Author Profile</h4>
            <p className="text-xs text-text-muted">
              Your professional lens — injected into every post generation to make drafts sound like you.
            </p>
          </div>
          <button
            onClick={() => setShowInterview(true)}
            className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors flex items-center gap-2"
          >
            <span className="text-base">&#127908;</span>
            {interviewCount > 0 ? "Re-interview" : "Start Interview"}
          </button>
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
              <span className="text-xs text-text-muted">
                ~{Math.ceil(profileText.length / 4)} tokens &middot; always in prompt
              </span>
              {interviewCount > 0 && (
                <span className="text-xs text-text-muted">
                  &middot; {interviewCount} interview{interviewCount !== 1 ? "s" : ""} completed
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="bg-surface-2 rounded-lg p-6 text-center">
            <p className="text-sm text-text-muted mb-2">No profile yet</p>
            <p className="text-xs text-text-muted mb-4">
              Start a 5-minute voice interview and the AI will extract what makes your perspective distinctive.
              Or type your profile directly below.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowInterview(true)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
              >
                Start Interview
              </button>
            </div>
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
