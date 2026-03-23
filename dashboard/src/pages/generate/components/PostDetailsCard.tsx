interface PostDetailsCardProps {
  storyHeadline: string;
  draftsUsed: string[];
  structureLabel: string;
  wordCount: number;
}

export default function PostDetailsCard({ storyHeadline, draftsUsed, structureLabel, wordCount }: PostDetailsCardProps) {
  const readTime = Math.max(1, Math.round(wordCount / 200));

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Post details</h4>
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between gap-4">
          <span className="text-gen-text-3 flex-shrink-0">Story</span>
          <span className="text-gen-text-1 text-right max-w-[180px] truncate">{storyHeadline}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gen-text-3 flex-shrink-0">Drafts used</span>
          <span className="text-gen-text-1 text-right">{draftsUsed.join(", ")}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gen-text-3 flex-shrink-0">Structure</span>
          <span className="text-gen-text-1 text-right">{structureLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gen-text-3">Est. read time</span>
          <span className="text-gen-text-1">{readTime} min</span>
        </div>
      </div>
    </div>
  );
}
