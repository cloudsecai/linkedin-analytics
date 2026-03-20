import type { GenAlignmentItem } from "../../../api/client";

interface AlignmentCardProps {
  items: GenAlignmentItem[];
}

export default function AlignmentCard({ items }: AlignmentCardProps) {
  if (items.length === 0) return null;

  const dimensionLabels: Record<string, string> = {
    voice_match: "Voice match",
    ai_tropes: "AI tropes",
    hook_strength: "Hook strength",
    engagement_close: "Engagement close",
    concrete_specifics: "Concrete specifics",
    ending_quality: "Ending quality",
  };

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">
        Alignment
      </h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <svg className="mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#34d399" strokeWidth="1.5" />
              <path d="M4.5 7l1.5 1.5 3-3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="text-[12px] text-gen-text-1 font-medium">
                {dimensionLabels[item.dimension] ?? item.dimension}
              </p>
              <p className="text-[11px] text-gen-text-3 leading-snug">{item.summary}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
