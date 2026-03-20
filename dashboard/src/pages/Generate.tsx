import { useState } from "react";
import SubTabBar, { type GenerateSubTab } from "./generate/SubTabBar";
import StorySelection from "./generate/StorySelection";
import DraftVariations from "./generate/DraftVariations";
import ReviewEdit from "./generate/ReviewEdit";
import Rules from "./generate/Rules";
import GenerationHistory from "./generate/GenerationHistory";
import CoachingSyncModal from "./generate/CoachingSyncModal";
import type {
  GenStory,
  GenDraft,
  GenQualityGate,
  GenCoachingInsight,
} from "../api/client";

export type PostType = "news" | "topic" | "insight";

export interface TypeCache {
  stories: GenStory[];
  researchId: number | null;
  articleCount: number;
  sourceCount: number;
}

interface GenerationState {
  postType: PostType;
  cache: Record<PostType, TypeCache | null>;
  // Top-level convenience fields — synced from active cache entry
  researchId: number | null;
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  generationId: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  finalDraft: string;
  qualityGate: GenQualityGate | null;
  appliedInsights: GenCoachingInsight[];
  personalConnection: string;
}

const initialState: GenerationState = {
  postType: "news",
  cache: { news: null, topic: null, insight: null },
  researchId: null,
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  generationId: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
  personalConnection: "",
};

export default function Generate() {
  const [subTab, setSubTab] = useState<GenerateSubTab>("Generate");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [gen, setGen] = useState<GenerationState>(initialState);
  const [loading, setLoading] = useState(false);
  const [showCoachingSync, setShowCoachingSync] = useState(false);

  const resetPipeline = () => {
    setGen(initialState);
    setStep(1);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <SubTabBar active={subTab} onChange={setSubTab} />
        <button
          onClick={() => setShowCoachingSync(true)}
          className="text-[12px] text-gen-text-3 hover:text-gen-accent transition-colors cursor-pointer"
        >
          Coaching sync
        </button>
      </div>

      <div className="mt-6">
        {subTab === "Generate" && step === 1 && (
          <StorySelection
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onNext={() => setStep(2)}
          />
        )}
        {subTab === "Generate" && step === 2 && (
          <DraftVariations
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {subTab === "Generate" && step === 3 && (
          <ReviewEdit
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(2)}
            onReset={resetPipeline}
          />
        )}
        {subTab === "Rules" && <Rules />}
        {subTab === "Generation History" && <GenerationHistory onOpen={(id) => {
          // TODO: restore generation from history
          setSubTab("Generate");
        }} />}
      </div>

      {showCoachingSync && (
        <CoachingSyncModal onClose={() => setShowCoachingSync(false)} />
      )}
    </div>
  );
}
