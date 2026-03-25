import { useState } from "react";
import { api, type GenDraft } from "../../api/client";
import DraftSidebar from "./components/DraftSidebar";
import DraftReader from "./components/DraftReader";
import ScannerLoader from "./components/ScannerLoader";

const COMBINING_MESSAGES = [
  "Analyzing draft structures...",
  "Identifying strongest hooks...",
  "Developing core themes...",
  "Removing AI tropes...",
  "Tightening the argument...",
  "Sharpening contrarian angles...",
  "Grounding in practitioner voice...",
  "Cutting filler and clichés...",
  "Strengthening the close...",
  "Crafting engagement hooks...",
  "Weaving personal connection...",
  "Polishing transitions...",
  "Checking word count...",
  "Optimizing for readability...",
  "Building the final draft...",
  "Eliminating passive voice...",
  "Adding specificity...",
  "Testing the opening line...",
  "Refining the takeaway...",
  "Final quality check...",
];

interface DraftVariationsProps {
  gen: {
    generationId: number | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    combiningGuidance: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function DraftVariations({ gen, setGen, loading, setLoading, onBack, onNext }: DraftVariationsProps) {
  const [activeDraft, setActiveDraft] = useState(0);

  const selectedCount = gen.selectedDraftIndices.length;
  const showGuidance = selectedCount >= 2;

  const handleToggleInclude = (index: number) => {
    setGen((prev: any) => {
      const current = prev.selectedDraftIndices as number[];
      const next = current.includes(index)
        ? current.filter((i: number) => i !== index)
        : [...current, index];
      return { ...prev, selectedDraftIndices: next };
    });
  };

  const handleCombineAndReview = async () => {
    if (gen.generationId === null || selectedCount === 0) return;
    setLoading(true);
    try {
      const res = await api.generateCombine(
        gen.generationId,
        gen.selectedDraftIndices,
        showGuidance ? gen.combiningGuidance : undefined
      );
      setGen((prev: any) => ({
        ...prev,
        originalDraft: res.final_draft,
        finalDraft: res.final_draft,
        qualityGate: res.quality,
      }));
      onNext();
    } catch (err) {
      console.error("Combine failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = selectedCount <= 1 ? "Review" : "Combine & review";

  if (loading) {
    return <ScannerLoader messages={COMBINING_MESSAGES} interval={2000} />;
  }

  return (
    <div>
      <div className="flex min-h-[60vh]">
        {/* Sidebar */}
        <DraftSidebar
          drafts={gen.drafts}
          activeDraft={activeDraft}
          selectedIndices={gen.selectedDraftIndices}
          onActivate={setActiveDraft}
          onToggleInclude={handleToggleInclude}
        />

        {/* Reading area */}
        {gen.drafts[activeDraft] && (
          <DraftReader draft={gen.drafts[activeDraft]} />
        )}
      </div>

      {/* Combining guidance */}
      {showGuidance && (
        <div className="mt-4 px-1">
          <label className="text-gen-text-0 text-[13px] font-semibold block mb-2">
            Direction for combining
          </label>
          <textarea
            value={gen.combiningGuidance}
            onChange={(e) =>
              setGen((prev: any) => ({ ...prev, combiningGuidance: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCombineAndReview();
              }
            }}
            placeholder="e.g. Lead with the contrarian hook, use the operator's examples, close with the future angle..."
            className="w-full bg-gen-bg-2 border border-gen-border-2 rounded-lg px-4 py-3 text-[14px] text-gen-text-1 placeholder:text-gen-text-3 resize-none h-20 focus:outline-none focus:border-gen-accent-border"
          />
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <button
          onClick={onBack}
          className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors"
        >
          Back to stories
        </button>
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-md text-[12px] font-bold bg-gen-accent-soft text-gen-accent border border-gen-accent-border">
              {selectedCount}
            </span>
          )}
          <button
            onClick={handleCombineAndReview}
            disabled={selectedCount === 0}
            className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
