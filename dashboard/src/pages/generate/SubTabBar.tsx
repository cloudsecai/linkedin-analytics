const subTabs = ["Generate", "Rules", "Sources", "Generation History"] as const;
export type GenerateSubTab = (typeof subTabs)[number];

interface SubTabBarProps {
  active: GenerateSubTab;
  onChange: (tab: GenerateSubTab) => void;
}

export default function SubTabBar({ active, onChange }: SubTabBarProps) {
  return (
    <div className="border-b border-gen-border-2 -mx-6 px-8">
      <div className="flex gap-6">
        {subTabs.map((t) => (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`pb-2.5 pt-1 text-[13px] font-medium transition-colors relative ${
              active === t
                ? "text-gen-text-0"
                : "text-gen-text-3 hover:text-gen-text-1"
            }`}
          >
            {t}
            {active === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gen-accent rounded-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
