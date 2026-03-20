import type { GenExpertiseItem } from "../../../api/client";

interface ExpertiseCardProps {
  items: GenExpertiseItem[];
  onClickItem: (question: string) => void;
}

export default function ExpertiseCard({ items, onClickItem }: ExpertiseCardProps) {
  if (items.length === 0) return null;

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">
        Needs your expertise
      </h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => onClickItem(item.question)}
            className="w-full text-left p-3 bg-gen-bg-3 border border-gen-border-1 rounded-lg hover:border-gen-accent-border transition-colors group"
          >
            <p className="text-[12px] font-medium text-gen-accent mb-1">{item.area}</p>
            <p className="text-[12px] text-gen-text-2 leading-snug group-hover:text-gen-text-1 transition-colors">
              {item.question}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
