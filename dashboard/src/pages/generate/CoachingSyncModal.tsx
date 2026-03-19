import { useState, useEffect } from "react";
import { api, type GenCoachingChange } from "../../api/client";
import CoachingChangeCard from "./components/CoachingChangeCard";

interface CoachingSyncModalProps {
  onClose: () => void;
  onViewHistory?: () => void;
}

export default function CoachingSyncModal({ onClose, onViewHistory }: CoachingSyncModalProps) {
  const [loading, setLoading] = useState(true);
  const [syncId, setSyncId] = useState<number | null>(null);
  const [changes, setChanges] = useState<GenCoachingChange[]>([]);
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);

  const cardsPerPage = 2;
  const totalPages = Math.max(1, Math.ceil(changes.length / cardsPerPage));
  const currentCards = changes.slice(page * cardsPerPage, (page + 1) * cardsPerPage);
  const acceptedCount = Object.values(decisions).filter((d) => d === "accept" || d === "retire").length;
  const isLastPage = page === totalPages - 1;

  useEffect(() => {
    api
      .generateCoachingAnalyze()
      .then((res) => {
        setSyncId(res.sync_id);
        setChanges(res.changes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDecide = async (changeId: number, action: string, editedText?: string) => {
    try {
      await api.generateCoachingDecide(changeId, action, editedText);
      setDecisions((prev) => ({ ...prev, [changeId]: action }));
    } catch (err) {
      console.error("Decision failed:", err);
    }
  };

  const weekDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-gen-bg-1 border border-gen-border-2 rounded-[20px] w-[640px] max-h-[85vh] flex flex-col overflow-hidden"
        style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)" }}
      >
        {/* Header */}
        <div className="px-7 pt-6 mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="font-serif-gen text-[22px] font-normal tracking-[-0.3px] text-gen-text-0">
              Weekly coaching sync
            </h2>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-gen-bg-3 text-gen-text-3 hover:text-gen-text-0 hover:bg-gen-bg-4 flex items-center justify-center text-[14px] transition-all cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="text-[13px] text-gen-text-2 leading-[1.5]">
            Based on this week's post performance and coaching analysis, here are proposed updates to your writing guidance.
          </p>
          <p className="text-[12px] text-gen-text-4 mt-1">
            Week of {weekDate}
            {onViewHistory && (
              <>
                {" · "}
                <button
                  onClick={onViewHistory}
                  className="text-gen-text-4 hover:text-gen-text-2 underline-offset-2 transition-colors cursor-pointer"
                >
                  View revision history
                </button>
              </>
            )}
          </p>
        </div>

        {/* Cards */}
        <div className="px-7 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gen-text-3 text-[14px]">
              Analyzing your coaching insights...
            </div>
          ) : changes.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gen-text-3 text-[14px]">
              No changes proposed this week. Your coaching insights are looking good.
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-6">
              {currentCards.map((change) => (
                <CoachingChangeCard
                  key={change.id}
                  change={change}
                  decided={!!decisions[change.id]}
                  onDecide={(action, editedText) => handleDecide(change.id, action, editedText)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {changes.length > 0 && (
          <div className="px-7 pt-4 pb-5 border-t border-gen-border-1">
            {/* Nav row — centered */}
            <div className="flex items-center justify-center gap-4 mb-2">
              {page > 0 && (
                <button
                  onClick={() => setPage((p) => p - 1)}
                  className="text-[13px] font-medium text-gen-text-2 hover:text-gen-text-0 transition-colors cursor-pointer bg-transparent border-none p-2"
                >
                  ← Previous
                </button>
              )}
              {!isLastPage && (
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-[22px] py-2.5 bg-gen-text-0 text-gen-bg-0 rounded-[10px] text-[13px] font-medium hover:opacity-90 hover:-translate-y-px transition-all cursor-pointer border-none"
                  style={{ boxShadow: "0 4px 16px rgba(255,255,255,0.06)" }}
                >
                  Next →
                </button>
              )}
              {isLastPage && (
                <button
                  onClick={onClose}
                  className="px-[22px] py-2.5 bg-gen-text-0 text-gen-bg-0 rounded-[10px] text-[13px] font-medium hover:opacity-90 hover:-translate-y-px transition-all cursor-pointer border-none"
                  style={{ boxShadow: "0 4px 16px rgba(255,255,255,0.06)" }}
                >
                  Done
                </button>
              )}
            </div>
            {/* Meta row — page centered, accepted right-aligned */}
            <div className="relative flex justify-center">
              <span className="text-[12px] text-gen-text-3">
                {page + 1} of {totalPages}
              </span>
              <span className="absolute right-0 text-[12px] text-gen-text-3">
                {acceptedCount} of {changes.length} accepted
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
