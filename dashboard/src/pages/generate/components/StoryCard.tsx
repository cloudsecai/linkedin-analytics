import type { GenStory } from "../../../api/client";

interface StoryCardProps {
  story: GenStory;
  index: number;
  selected: boolean;
  onSelect: () => void;
}

export default function StoryCard({ story, index, selected, onSelect }: StoryCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl p-5 transition-all border ${
        selected
          ? "border-gen-accent-border bg-gen-bg-2 shadow-[inset_3px_0_0_0_var(--color-gen-accent)]"
          : "border-gen-border-1 bg-gen-bg-1 hover:border-gen-border-2"
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Radio indicator */}
        <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          selected ? "border-gen-accent bg-gen-accent" : "border-gen-text-4"
        }`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Headline */}
          <h3 className="font-serif-gen text-[19px] leading-snug text-gen-text-0 mb-2">
            {story.headline}
          </h3>

          {/* Summary */}
          <p className="text-[14px] text-gen-text-2 leading-relaxed mb-3">
            {story.summary}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2 text-[12px]">
            <span className={`px-2 py-0.5 rounded-md font-medium ${
              selected
                ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                : "bg-gen-bg-3 text-gen-text-3"
            }`}>
              {story.tag}
            </span>
            {story.is_stretch && (
              <span className="px-2 py-0.5 rounded-md font-medium bg-warning/10 text-warning border border-warning/20">
                STRETCH
              </span>
            )}
            {story.source_url ? (
              <a
                href={story.source_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-gen-text-3 hover:text-gen-accent underline underline-offset-2 transition-colors"
              >
                {story.source}
              </a>
            ) : (
              <span className="text-gen-text-3">{story.source}</span>
            )}
            <span className="text-gen-text-4">{story.age}</span>
          </div>

          {/* Angles — only when selected */}
          {selected && story.angles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gen-border-1">
              <p className="text-[12px] text-gen-text-3 font-medium mb-1">Possible angles</p>
              <ul className="text-[13px] text-gen-text-2 space-y-0.5">
                {story.angles.map((angle, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gen-text-4 select-none">-</span>
                    <span>{angle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
