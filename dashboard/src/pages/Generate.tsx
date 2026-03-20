import { useState } from "react";
import SubTabBar, { type GenerateSubTab } from "./generate/SubTabBar";
import DiscoveryView from "./generate/DiscoveryView";
import DraftVariations from "./generate/DraftVariations";
import ReviewEdit from "./generate/ReviewEdit";
import Rules from "./generate/Rules";
import Sources from "./generate/Sources";
import GenerationHistory from "./generate/GenerationHistory";
import CoachingSyncModal from "./generate/CoachingSyncModal";
import {
  api,
  type GenStory,
  type GenDraft,
  type GenCoachingInsight,
  type DiscoveryCategory,
  type GenCoachCheckQuality,
} from "../api/client";

interface GenerationState {
  // Discovery
  discoveryTopics: DiscoveryCategory[] | null;
  selectedTopic: string | null;
  // Research
  researchId: number | null;
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  // Generation
  generationId: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  personalConnection: string;
  // Review
  finalDraft: string;
  qualityGate: GenCoachCheckQuality | null;
  appliedInsights: GenCoachingInsight[];
  // Chat
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

const initialState: GenerationState = {
  discoveryTopics: null,
  selectedTopic: null,
  researchId: null,
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  generationId: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  personalConnection: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
  chatMessages: [],
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
        <SubTabBar active={subTab} onChange={(tab) => {
          setSubTab(tab);
          if (tab !== "Generate") {
            setGen((prev) => ({ ...prev, discoveryTopics: null }));
          }
        }} />
        <button
          onClick={() => setShowCoachingSync(true)}
          className="text-[12px] text-gen-text-3 hover:text-gen-accent transition-colors cursor-pointer"
        >
          Coaching sync
        </button>
      </div>

      <div className="mt-6">
        {subTab === "Generate" && step === 1 && (
          <DiscoveryView
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
        {subTab === "Sources" && <Sources />}
        {subTab === "Generation History" && <GenerationHistory onOpen={async (id) => {
          try {
            const data = await api.generateHistoryDetail(id);
            const drafts: GenDraft[] = data.drafts_json ? JSON.parse(data.drafts_json) : [];
            const selectedIndices: number[] = data.selected_draft_indices ? JSON.parse(data.selected_draft_indices) : [];
            const qualityGate: GenCoachCheckQuality | null = data.quality_gate_json ? JSON.parse(data.quality_gate_json) : null;

            // Load chat messages for this generation
            let chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
            if (data.id && data.final_draft) {
              try {
                const msgs = await api.generateChatHistory(data.id);
                chatMessages = msgs.map((m: any) => ({ role: m.role, content: m.display_content ?? m.content }));
              } catch {
                // Chat history is non-critical — proceed without it
              }
            }

            setGen({
              ...initialState,
              researchId: data.research_id,
              stories: data.stories ?? [],
              articleCount: data.article_count ?? 0,
              sourceCount: data.source_count ?? 0,
              selectedStoryIndex: data.selected_story_index,
              generationId: data.id,
              drafts,
              selectedDraftIndices: selectedIndices,
              combiningGuidance: data.combining_guidance ?? "",
              finalDraft: data.final_draft ?? "",
              qualityGate,
              personalConnection: data.personal_connection ?? "",
              chatMessages,
            });
            // Jump to the right step based on what data exists
            if (data.final_draft) {
              setStep(3);
            } else if (drafts.length > 0) {
              setStep(2);
            } else {
              setStep(1);
            }
            setSubTab("Generate");
          } catch (err) {
            console.error("Failed to restore generation:", err);
          }
        }} />}
      </div>

      {showCoachingSync && (
        <CoachingSyncModal onClose={() => setShowCoachingSync(false)} />
      )}
    </div>
  );
}
