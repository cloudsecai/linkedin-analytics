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
  const doResearch = async (postType: PostType) => {
    setLoading(true);
    try {
      const res = await api.generateResearch(postType);
      setGen((prev: any) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
        postType,
      }));
    } catch (err) {
      console.error("Research failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.postType);
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
          <p className="mb-4">Choose a post type above to research stories</p>
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
              onClick={handleGenerateDrafts}
              disabled={gen.selectedStoryIndex === null || loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate drafts"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
