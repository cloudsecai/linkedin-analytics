import { useState, useEffect } from "react";
import { api, type GenStory, type DiscoveryCategory } from "../../api/client";
import StoryCard from "./components/StoryCard";
import ScannerLoader from "./components/ScannerLoader";

interface DiscoveryViewProps {
  gen: {
    discoveryTopics: DiscoveryCategory[] | null;
    selectedTopic: string | null;
    stories: GenStory[];
    articleCount: number;
    sourceCount: number;
    researchId: number | null;
    selectedStoryIndex: number | null;
    personalConnection: string;
    draftLength: "short" | "medium" | "long";
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const DISCOVERY_MESSAGES = [
  "Scanning feeds...",
  "Reading headlines...",
  "Clustering topics...",
  "Finding angles...",
];

const RESEARCH_MESSAGES = [
  "Deep diving...",
  "Finding perspectives...",
  "Building story cards...",
];

const CACHE_KEY = "reachlab_discovery_cache";

function getCachedTopics(): DiscoveryCategory[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    // Valid for the calendar day
    if (cached.date === new Date().toISOString().slice(0, 10) && Array.isArray(cached.categories) && cached.categories.length > 0) {
      return cached.categories;
    }
  } catch {}
  return null;
}

function setCachedTopics(categories: DiscoveryCategory[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      categories,
    }));
  } catch {}
}

function clearCachedTopics() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}

// ── Scanner animation ──────────────────────────────────────
// (moved to components/ScannerLoader.tsx)

// ── Main component ─────────────────────────────────────────

export default function DiscoveryView({ gen, setGen, loading, setLoading, onNext }: DiscoveryViewProps) {
  const [topicInput, setTopicInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [activeMessages, setActiveMessages] = useState<string[]>(DISCOVERY_MESSAGES);

  // Auto-discover on mount: use daily cache if available
  useEffect(() => {
    if (!gen.discoveryTopics && !gen.stories.length && !loading) {
      const cached = getCachedTopics();
      if (cached) {
        setGen((prev: any) => ({
          ...prev,
          discoveryTopics: cached,
          stories: [],
          researchId: null,
          selectedStoryIndex: null,
          selectedTopic: null,
        }));
      } else {
        handleDiscover();
      }
    }
  }, []);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setLoading(true);
    setError(null);
    setActiveMessages(DISCOVERY_MESSAGES);

    try {
      const res = await api.generateDiscover();
      setCachedTopics(res.categories);
      setGen((prev: any) => ({
        ...prev,
        discoveryTopics: res.categories,
        stories: [],
        researchId: null,
        selectedStoryIndex: null,
        selectedTopic: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Couldn't load topics. Try again.");
    } finally {
      setLoading(false);
      setIsDiscovering(false);
    }
  };

  const handleRefresh = () => {
    clearCachedTopics();
    setGen((prev: any) => ({ ...prev, discoveryTopics: null }));
    handleDiscover();
  };

  const handleTopicClick = async (label: string) => {
    setLoading(true);
    setError(null);
    setActiveMessages(RESEARCH_MESSAGES);
    setGen((prev: any) => ({ ...prev, selectedTopic: label }));

    const avoid = gen.stories.map((s) => s.headline).filter(Boolean);

    try {
      const res = await api.generateResearch(label, avoid.length > 0 ? avoid : undefined);
      setGen((prev: any) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Research failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoTopic = () => {
    const trimmed = topicInput.trim();
    if (!trimmed) return;
    handleTopicClick(trimmed);
  };

  const handleBackToTopics = () => {
    setGen((prev: any) => ({
      ...prev,
      stories: [],
      researchId: null,
      selectedStoryIndex: null,
      selectedTopic: null,
    }));
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.personalConnection || undefined, gen.draftLength);
      setGen((prev: any) => ({
        ...prev,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err: any) {
      setError(err.message ?? "Draft generation failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const hasStories = gen.stories.length > 0;
  const hasBubbles = gen.discoveryTopics && gen.discoveryTopics.length > 0;

  return (
    <div>
      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Loading state — scanner animation */}
      {loading && !hasStories && (
        <ScannerLoader messages={activeMessages} />
      )}

      {/* Discovery bubbles view */}
      {!loading && !hasStories && (
        <div>
          {/* Topic input */}
          <div className="flex gap-2 mb-8">
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGoTopic(); }}
              placeholder="I want to write about..."
              className="flex-1 bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-3 text-[14px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent"
            />
            <button
              onClick={handleGoTopic}
              disabled={!topicInput.trim()}
              className="px-6 py-3 bg-gen-accent text-white text-[14px] font-medium rounded-[10px] hover:bg-gen-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Go
            </button>
          </div>

          {hasBubbles && (
            <>
              {/* Divider with refresh */}
              <div className="flex items-center gap-4 mb-8">
                <div className="flex-1 h-px bg-gen-border-1" />
                <span className="text-[11px] uppercase tracking-[1.6px] text-gen-text-4">or explore trending topics</span>
                <div className="flex-1 h-px bg-gen-border-1" />
              </div>

              {/* Categories with bubbles */}
              {gen.discoveryTopics!.map((category, catIdx) => (
                <div
                  key={category.name}
                  className="mb-8"
                  style={{ animation: `fadeInUp 0.5s ease both`, animationDelay: `${catIdx * 0.08}s` }}
                >
                  <div className="flex items-center gap-3 my-3.5 pl-1">
                    <span className="text-[22px] font-extralight text-gen-text-2 whitespace-nowrap">
                      {category.name}
                    </span>
                    <div className="flex-1 h-px bg-gen-border-1" />
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {category.topics.map((topic) => (
                      <button
                        key={topic.label}
                        onClick={() => handleTopicClick(topic.label)}
                        className="bg-gen-bg-1 border border-gen-border-1 rounded-full px-4 py-2 text-[13.5px] text-gen-text-2 hover:bg-gen-bg-2 hover:border-gen-accent hover:text-gen-text-0 hover:-translate-y-px transition-all cursor-pointer"
                      >
                        {topic.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Footer with refresh */}
              <div className="flex items-center justify-center gap-3 mt-6">
                <span className="text-[12px] text-gen-text-4">
                  ~{gen.discoveryTopics!.reduce((sum, c) => sum + c.topics.length, 0)} topics from your feeds
                </span>
                <span className="text-gen-text-4">·</span>
                <button
                  onClick={handleRefresh}
                  className="text-[12px] text-gen-text-3 hover:text-gen-accent transition-colors cursor-pointer"
                >
                  Find new topics
                </button>
              </div>
            </>
          )}

          {/* If no bubbles and not loading, show retry */}
          {!hasBubbles && !loading && (
            <div className="text-center py-10">
              <button
                onClick={handleDiscover}
                className="px-5 py-2.5 border border-gen-border-1 rounded-[10px] text-[13px] text-gen-text-2 hover:text-gen-text-0 hover:border-gen-border-2 transition-colors"
              >
                Load trending topics
              </button>
            </div>
          )}
        </div>
      )}

      {/* Story cards — shown after clicking a bubble or entering a topic */}
      {!loading && hasStories && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-medium text-gen-text-0">
              Pick a story to write about
            </h2>
            <button
              onClick={handleBackToTopics}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
            >
              Back to topics
            </button>
          </div>

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

          {/* Personal connection */}
          {gen.selectedStoryIndex !== null && (
            <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-2">
              <h3 className="text-[14px] font-medium text-gen-text-0">
                What's your personal connection to this?
              </h3>
              <p className="text-[12px] text-gen-text-3">
                Optional — helps the AI ground the draft in your real experience.
              </p>
              <textarea
                value={gen.personalConnection}
                onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (gen.selectedStoryIndex !== null && !loading) handleGenerateDrafts();
                  }
                }}
                rows={3}
                placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated..."'
                className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent resize-none"
              />
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
            <span className="text-[12px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-gen-bg-2 rounded-lg p-0.5">
                {(["short", "medium", "long"] as const).map((len) => (
                  <button
                    key={len}
                    onClick={() => setGen((prev: any) => ({ ...prev, draftLength: len }))}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors capitalize ${
                      gen.draftLength === len
                        ? "bg-gen-bg-0 text-gen-text-0 shadow-sm"
                        : "text-gen-text-3 hover:text-gen-text-1"
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateDrafts}
                disabled={gen.selectedStoryIndex === null || loading}
                className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Generate drafts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
