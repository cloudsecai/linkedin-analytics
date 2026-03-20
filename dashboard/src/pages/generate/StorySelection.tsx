import { useState, useEffect, useRef } from "react";
import { api, type GenStory } from "../../api/client";
import StoryCard from "./components/StoryCard";

type PostType = "news" | "topic" | "insight";

interface StorySelectionProps {
  gen: {
    postType: PostType;
    stories: GenStory[];
    articleCount: number;
    sourceCount: number;
    researchId: number | null;
    selectedStoryIndex: number | null;
    personalConnection: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const postTypes: { value: PostType; label: string }[] = [
  { value: "news", label: "News" },
  { value: "topic", label: "Topic" },
  { value: "insight", label: "Insight" },
];

export default function StorySelection({ gen, setGen, loading, setLoading, onNext }: StorySelectionProps) {
  const [showConnectionInput, setShowConnectionInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-research once per day when visiting the Generate tab
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    if (gen.stories.length > 0 || loading) return;
    const today = new Date().toDateString();
    const lastResearch = localStorage.getItem("reachlab_last_research_date");
    if (lastResearch === today) return;
    doResearch(gen.postType);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doResearch = async (postType: PostType) => {
    setLoading(true);
    setError(null);
    setShowConnectionInput(false);
    // Clear stories immediately so the loading spinner shows
    setGen((prev: any) => ({
      ...prev,
      stories: [],
      selectedStoryIndex: null,
      postType,
    }));
    try {
      const res = await api.generateResearch(postType);
      localStorage.setItem("reachlab_last_research_date", new Date().toDateString());
      setGen((prev: any) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
        postType,
      }));
    } catch (err: any) {
      console.error("Research failed:", err);
      setError(err.message ?? "Research failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.postType, gen.personalConnection || undefined);
      setGen((prev: any) => ({
        ...prev,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoPickAndGenerate = async () => {
    if (gen.researchId === null || gen.stories.length === 0) return;
    // Auto-pick: select the first non-stretch story, or first story
    const bestIndex = gen.stories.findIndex((s) => !s.is_stretch);
    const pickIndex = bestIndex >= 0 ? bestIndex : 0;
    setGen((prev: any) => ({ ...prev, selectedStoryIndex: pickIndex }));
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, pickIndex, gen.postType);
      setGen((prev: any) => ({
        ...prev,
        selectedStoryIndex: pickIndex,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[15px] font-medium text-gen-text-0">
          Pick a story to write about
        </h2>
        <div className="flex gap-1">
          {postTypes.map((pt) => (
            <button
              key={pt.value}
              onClick={() => doResearch(pt.value)}
              disabled={loading}
              className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors ${
                gen.postType === pt.value
                  ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                  : "text-gen-text-3 hover:text-gen-text-1 border border-transparent"
              }`}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && gen.stories.length === 0 && (
        <div className="flex items-center justify-center py-20 text-gen-text-3 text-[14px]">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          Researching stories...
        </div>
      )}

      {/* Empty state */}
      {!loading && gen.stories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gen-text-3 text-[14px]">
          <p className="mb-4">Already researched today. Click below to research again.</p>
          <button
            onClick={() => doResearch(gen.postType)}
            className="px-4 py-2 rounded-lg bg-gen-accent text-gen-bg-0 text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            Research stories
          </button>
        </div>
      )}

      {/* Story cards */}
      {gen.stories.length > 0 && (
        <div className="space-y-3">
          {gen.stories.map((story, i) => (
            <StoryCard
              key={i}
              story={story}
              index={i}
              selected={gen.selectedStoryIndex === i}
              onSelect={() =>
                setGen((prev: any) => ({ ...prev, selectedStoryIndex: i }))
              }
            />
          ))}
        </div>
      )}

      {/* Bottom bar */}
      {gen.stories.length > 0 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => doResearch(gen.postType)}
              disabled={loading}
              className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors disabled:opacity-50"
            >
              New research
            </button>
            <span className="text-[12px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleAutoPickAndGenerate}
              disabled={loading}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors disabled:opacity-50"
            >
              Auto-pick best match
            </button>
            <button
              onClick={() => setShowConnectionInput(true)}
              disabled={gen.selectedStoryIndex === null || loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate drafts"}
            </button>
          </div>
        </div>
      )}

      {/* Personal connection input */}
      {showConnectionInput && gen.selectedStoryIndex !== null && (
        <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-3">
          <div>
            <h3 className="text-[14px] font-medium text-gen-text-0">
              What's your personal connection to this?
            </h3>
            <p className="text-[12px] text-gen-text-3 mt-1">
              Optional — helps the AI ground the draft in your real experience.
            </p>
          </div>
          <textarea
            value={gen.personalConnection}
            onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
            rows={3}
            placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated. The real cost wasn&#39;t the migration — it was the feature freeze."'
            className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent resize-none"
          />
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
            >
              Skip — generate without
            </button>
            <button
              onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
              disabled={loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40"
            >
              {loading ? "Generating..." : "Generate with connection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
