import type { GenDraft } from "../../../api/client";

interface DraftSidebarProps {
  drafts: GenDraft[];
  activeDraft: number;
  selectedIndices: number[];
  onActivate: (index: number) => void;
  onToggleInclude: (index: number) => void;
}

const draftLabels: Record<string, string> = {
  contrarian: "Contrarian",
  operator: "Operator",
  future: "Future",
};

export default function DraftSidebar({
  drafts,
  activeDraft,
  selectedIndices,
  onActivate,
  onToggleInclude,
}: DraftSidebarProps) {
  return (
    <div className="w-[280px] flex-shrink-0 border-r border-gen-border-1 pr-5">
      <p className="text-[10px] uppercase tracking-[1.4px] text-gen-text-2 font-medium mb-4">
        Variations
      </p>
      <div className="space-y-1">
        {drafts.map((draft, i) => {
          const isActive = activeDraft === i;
          const isIncluded = selectedIndices.includes(i);
          return (
            <div key={i} className="relative">
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-gen-accent rounded-full" />
              )}
              <button
                onClick={() => onActivate(i)}
                className={`w-full text-left pl-4 pr-3 py-3 rounded-lg transition-colors ${
                  isActive ? "bg-gen-bg-2" : "hover:bg-gen-bg-2/50"
                }`}
              >
                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-gen-bg-3 text-gen-text-2 mb-1.5">
                  {draftLabels[draft.type] || draft.type}
                </span>
                <p className="text-[13px] text-gen-text-1 leading-snug line-clamp-2">
                  {draft.hook}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-gen-text-3">{draft.word_count} words</span>
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="text-[11px] text-gen-text-3">Include</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleInclude(i);
                      }}
                      className={`w-9 h-5 rounded-full transition-colors relative overflow-hidden ${
                        isIncluded ? "bg-gen-accent" : "bg-gen-bg-3"
                      }`}
                    >
                      <span
                        className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                          isIncluded ? "translate-x-[19px]" : "translate-x-[3px]"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
