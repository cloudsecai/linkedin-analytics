import { useState, useRef, useEffect } from "react";
import SubTabBar, { type GenerateSubTab } from "./generate/SubTabBar";
import DiscoveryView from "./generate/DiscoveryView";
import DraftVariations from "./generate/DraftVariations";
import ReviewEdit from "./generate/ReviewEdit";
import Rules from "./generate/Rules";
import Sources from "./generate/Sources";
import GenerationHistory from "./generate/GenerationHistory";
import PostRetro from "./generate/PostRetro";
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
  draftLength: "short" | "medium" | "long";
  // Review
  originalDraft: string;
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
  draftLength: "medium",
  originalDraft: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
  chatMessages: [],
};

interface RestoreResult {
  state: GenerationState;
  step: 1 | 2 | 3;
}

async function restoreGeneration(data: any): Promise<RestoreResult | null> {
  let drafts: GenDraft[];
  let selectedIndices: number[];
  let qualityGate: GenCoachCheckQuality | null;
  try {
    drafts = data.drafts_json ? JSON.parse(data.drafts_json) : [];
    selectedIndices = data.selected_draft_indices ? JSON.parse(data.selected_draft_indices) : [];
    qualityGate = data.quality_gate_json ? JSON.parse(data.quality_gate_json) : null;
  } catch (err) {
    console.error("[Generate] Failed to parse generation JSON:", err);
    return null;
  }

  // Load chat messages only when final_draft exists (matches onOpen behavior)
  let chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (data.id && data.final_draft) {
    try {
      const msgs = await api.generateChatHistory(data.id);
      chatMessages = msgs.map((m: any) => ({ role: m.role, content: m.display_content ?? m.content }));
    } catch {
      // Chat history is non-critical — proceed without it
    }
  }

  const state: GenerationState = {
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
    originalDraft: data.final_draft ?? "",
    finalDraft: data.final_draft ?? "",
    qualityGate,
    personalConnection: data.personal_connection ?? "",
    draftLength: data.draft_length ?? "medium",
    chatMessages,
  };

  // Step mapping: final_draft exists -> step 3 (ReviewEdit), drafts exist -> step 2 (DraftVariations), else step 1
  // Step 4 (PostRetro) is never opened from history/restore.
  let step: 1 | 2 | 3;
  if (data.final_draft) {
    step = 3;
  } else if (drafts.length > 0) {
    step = 2;
  } else {
    step = 1;
  }

  return { state, step };
}

export default function Generate() {
  const [subTab, setSubTab] = useState<GenerateSubTab>("Generate");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [gen, setGen] = useState<GenerationState>(initialState);
  const [loading, setLoading] = useState(false);
  const userActedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getActiveGeneration();
        const data = res.generation;
        if (cancelled || userActedRef.current || !data) return;

        const result = await restoreGeneration(data);
        // Check userActedRef again — user may have acted during restoreGeneration's
        // async work (e.g., the chat history fetch)
        if (cancelled || userActedRef.current || !result) return;

        setGen(result.state);
        setStep(result.step);
      } catch (err) {
        console.error("Auto-restore failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resetPipeline = () => {
    // Mark current generation as discarded so it won't auto-restore
    if (gen.generationId) {
      api.generateDiscard(gen.generationId).catch(err => console.error("[Generate] Failed to discard:", err));
    }
    userActedRef.current = true;
    setGen(initialState);
    setStep(1);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <SubTabBar active={subTab} onChange={(tab) => {
          userActedRef.current = true;
          setSubTab(tab);
          if (tab !== "Generate") {
            setGen((prev) => ({ ...prev, discoveryTopics: null }));
          }
        }} />
        {step > 1 && subTab === "Generate" && (
          <button
            onClick={resetPipeline}
            className="text-[12px] text-gen-text-3 hover:text-gen-accent transition-colors cursor-pointer"
          >
            Start new
          </button>
        )}
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
            onRetro={() => setStep(4)}
          />
        )}
        {subTab === "Generate" && step === 4 && gen.generationId && (
          <PostRetro
            generationId={gen.generationId}
            draftText={gen.originalDraft || gen.finalDraft}
            finalDraftText={gen.finalDraft}
            onBack={() => setStep(3)}
          />
        )}
        {subTab === "Rules" && <Rules />}
        {subTab === "Sources" && <Sources />}
        {subTab === "Generation History" && <GenerationHistory onOpen={async (id) => {
          try {
            const data = await api.generateHistoryDetail(id);
            const result = await restoreGeneration(data);
            if (!result) return;
            setGen(result.state);
            setStep(result.step);
            setSubTab("Generate");
          } catch (err) {
            console.error("Failed to restore generation:", err);
          }
        }} />}
      </div>
    </div>
  );
}
