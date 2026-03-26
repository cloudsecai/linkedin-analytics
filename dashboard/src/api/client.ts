import { getActivePersonaId } from "../context/PersonaContext";
import type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  ProgressData,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
  Story as GenStory,
  Draft as GenDraft,
  RetroChange,
  RetroRuleSuggestion,
  RetroPromptEdit,
  RetroAnalysis,
} from "@reachlab/shared";

export type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  ProgressData,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
  GenStory,
  GenDraft,
  RetroChange,
  RetroRuleSuggestion,
  RetroPromptEdit,
  RetroAnalysis,
};

function getBaseUrl(): string {
  const personaId = getActivePersonaId();
  return `/api/personas/${personaId}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Append personaId query param to any URL for routes not under the persona URL prefix */
function withPersonaId(url: string): string {
  const personaId = getActivePersonaId();
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}personaId=${personaId}`;
}

// For routes not under the persona URL prefix (insights, generate, settings, sources, author-profile)
// Passes personaId as a query param so the server knows which persona to scope to.
async function getUnscoped<T>(path: string): Promise<T> {
  const res = await fetch(withPersonaId(`/api${path}`));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface OverviewData {
  total_impressions: number;
  avg_engagement_rate: number | null;
  total_followers: number | null;
  profile_views: number | null;
  posts_count: number;
}

export interface Post {
  id: string;
  content_preview: string | null;
  hook_text: string | null;
  full_text: string | null;
  image_local_paths: string | null;
  content_type: string;
  published_at: string;
  url: string | null;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  sends: number | null;
  engagement_rate: number | null;
  weighted_engagement: number | null;
  post_category: string | null;
  topics: string | null;
}

export interface PostsResponse {
  posts: Post[];
  total: number;
  offset: number;
  limit: number;
}

export interface MetricSnapshot {
  id: number;
  post_id: string;
  scraped_at: string;
  impressions: number | null;
  members_reached: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  sends: number | null;
  video_views: number | null;
  watch_time_seconds: number | null;
  avg_watch_time_seconds: number | null;
}

export interface TimingSlot {
  day: number;
  hour: number;
  avg_engagement_rate: number | null;
  post_count: number;
}

export interface FollowerSnapshot {
  date: string;
  total_followers: number;
  new_followers: number | null;
}

export interface ProfileSnapshot {
  date: string;
  profile_views: number | null;
  search_appearances: number | null;
  all_appearances: number | null;
}

export interface AiOverview {
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string; // JSON array string
}

export interface Recommendation {
  id: number;
  type: string;
  priority: string;
  confidence: string;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string | null;
  feedback: string | null;
  acted_on: number;
  created_at: string;
  resolved_at: string | null;
  resolved_type: string | null;
  stable_key: string | null;
}

export interface Insight {
  id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string;
  direction: string;
  consecutive_appearances: number;
  status: string;
}

export interface Changelog {
  confirmed: Insight[];
  new_signal: Insight[];
  reversed: Insight[];
  retired: Insight[];
}

export interface AnalysisGap {
  id: number;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
  times_flagged: number;
  first_seen_at: string;
  last_seen_at: string;
}

// PromptSuggestion, PromptSuggestions — imported from @reachlab/shared

export interface WritingPromptHistory {
  id: number;
  prompt_text: string;
  source: string;
  suggestion_evidence: string | null;
  created_at: string;
}

export interface AiRun {
  id: number;
  triggered_by: string;
  post_count: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_cents: number | null;
}

export interface TaxonomyItem {
  id: number;
  name: string;
  description: string;
}

// MetricsSummary, ProgressData, CategoryPerformance, SparklinePoint, EngagementQuality — imported from @reachlab/shared

export interface RecommendationsWithCooldown {
  active: Recommendation[];
  resolved: Recommendation[];
}

// TopicPerformance, HookPerformance, ImageSubtypePerformance — imported from @reachlab/shared

export interface AnalysisStatus {
  running: { id: number; started_at: string } | null;
  last_run: { id: number; completed_at: string; triggered_by: string } | null;
  schedule: string;
  post_threshold: number;
  next_auto_regen: string | null;
}

export interface ScrapeError {
  error_type: string;
  page_type: string;
  selector: string | null;
  message: string;
  consecutive_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface HealthData {
  last_sync_at: string | null;
  sources: {
    posts: { status: "ok" | "error"; last_success: string | null; error?: string };
    followers: { status: "ok" | "error"; last_success: string | null; error?: string };
    profile: { status: "ok" | "error"; last_success: string | null; error?: string };
  };
}

// ── Generate Pipeline Types ─────────────────────────────────

// GenStory, GenDraft — imported from @reachlab/shared (as Story, Draft)


export interface GenResearchResponse {
  research_id: number;
  stories: GenStory[];
  article_count: number;
  source_count: number;
}

export interface GenDraftsResponse {
  generation_id: number;
  drafts: GenDraft[];
}

export interface DiscoveryTopic {
  label: string;
  source_headline: string;
  source_url: string;
}

export interface DiscoveryCategory {
  name: string;
  topics: DiscoveryTopic[];
}

export interface DiscoveryResponse {
  categories: DiscoveryCategory[];
}

// New quality shape from coach-check
export interface GenExpertiseItem {
  area: string;
  question: string;
}

export interface GenAlignmentItem {
  dimension: string;
  summary: string;
}

export interface GenCoachCheckQuality {
  expertise_needed: GenExpertiseItem[];
  alignment: GenAlignmentItem[];
}

export interface GenChatResponse {
  draft: string;
  quality: GenCoachCheckQuality;
  explanation: string;
}

export interface GenChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  display_content: string;
  draft_snapshot?: string;
  quality_json?: string;
}

export interface GenCombineResponse {
  final_draft: string;
  quality: GenCoachCheckQuality;
}


export interface GenRule {
  id?: number;
  rule_text: string;
  example_text?: string | null;
  sort_order: number;
}

export interface GenRulesResponse {
  categories: {
    voice_tone: GenRule[];
    structure_formatting: GenRule[];
    anti_ai_tropes: { enabled: boolean; rules: GenRule[] };
  };
}

export interface GenHistoryItem {
  id: number;
  hook_excerpt: string;
  story_headline: string;
  drafts_used: number;
  post_type: string;
  status: string;
  created_at: string;
}

export interface GenHistoryResponse {
  generations: GenHistoryItem[];
  total: number;
}

export interface GenCoachingChange {
  id: number;
  type: "new" | "updated" | "retire";
  title: string;
  evidence: string;
  old_text?: string;
  new_text?: string;
  insight_id?: number;
}

export interface GenCoachingSyncResponse {
  sync_id: number;
  changes: GenCoachingChange[];
}

export interface GenCoachingInsight {
  id: number;
  title: string;
  prompt_text: string;
  evidence: string | null;
  status: string;
}

export interface AuthorProfileResponse {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
    persuasion_style: string;
  };
  interview_count: number;
}

export interface InterviewSessionResponse {
  client_secret: string;
  model: string;
}

export interface ExtractedProfileResponse {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
    persuasion_style: string;
  };
}

export const api = {
  overview: (params?: { since?: string; until?: string }) => {
    const q = new URLSearchParams();
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return get<OverviewData>(`/overview${qs ? `?${qs}` : ""}`);
  },
  posts: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) q.set(k, String(v));
      }
    }
    const qs = q.toString();
    return get<PostsResponse>(`/posts${qs ? `?${qs}` : ""}`);
  },
  metrics: (postId: string) =>
    get<{ post_id: string; metrics: MetricSnapshot[] }>(`/metrics/${postId}`),
  timing: () => get<{ slots: TimingSlot[] }>("/timing"),
  followers: () => get<{ snapshots: FollowerSnapshot[] }>("/followers"),
  profile: () => get<{ snapshots: ProfileSnapshot[] }>("/profile"),
  health: () => get<HealthData>("/health"),
  insightsOverview: () => getUnscoped<{ overview: AiOverview | null }>("/insights/overview"),
  insights: () => getUnscoped<{ recommendations: Recommendation[]; insights: Insight[] }>("/insights"),
  insightsChangelog: () => getUnscoped<Changelog>("/insights/changelog"),
  insightsTags: (postIds: string[]) =>
    getUnscoped<{ tags: Record<string, { hook_type: string; tone: string; format_style: string }> }>(
      `/insights/tags?post_ids=${postIds.join(",")}`
    ),
  insightsTaxonomy: () => getUnscoped<{ taxonomy: TaxonomyItem[] }>("/insights/taxonomy"),
  insightsRefresh: (force = false) =>
    fetch(withPersonaId(`/api/insights/refresh`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).then((r) => r.json()),
  insightsStatus: () =>
    getUnscoped<AnalysisStatus>("/insights/status"),
  recommendationFeedback: (id: number, rating: string, reason?: string) =>
    fetch(withPersonaId(`/api/insights/recommendations/${id}/feedback`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: { rating, reason: reason || null } }),
    }).then((r) => r.json()),
  authorPhoto: () =>
    fetch(withPersonaId(`/api/settings/author-photo`)).then((r) =>
      r.ok ? r.blob().then((b) => URL.createObjectURL(b)) : null
    ),
  uploadAuthorPhoto: (file: File) =>
    fetch(withPersonaId(`/api/settings/author-photo`), {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type },
    }).then((r) => r.json()),
  deleteAuthorPhoto: () =>
    fetch(withPersonaId(`/api/settings/author-photo`), { method: "DELETE" }).then((r) => r.json()),

  // Timezone
  setTimezone: (timezone: string) =>
    fetch(withPersonaId(`/api/settings/timezone`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // Writing prompt
  getWritingPrompt: () =>
    getUnscoped<{ text: string | null }>("/settings/writing-prompt"),

  saveWritingPrompt: (text: string, source: "manual_edit" | "ai_suggestion", evidence?: string) =>
    fetch(withPersonaId(`/api/settings/writing-prompt`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, evidence }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  getWritingPromptHistory: () =>
    getUnscoped<{ history: WritingPromptHistory[] }>("/settings/writing-prompt/history"),

  // Recommendations with cooldown
  recommendationsWithCooldown: () =>
    getUnscoped<RecommendationsWithCooldown>("/insights/recommendations"),

  // Resolve a recommendation
  resolveRecommendation: (id: number, type: "accepted" | "dismissed") =>
    fetch(withPersonaId(`/api/insights/recommendations/${id}/resolve`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }).then((r) => r.json()),

  // Deep Dive endpoints
  deepDiveProgress: (days = 30) =>
    getUnscoped<ProgressData>(`/insights/deep-dive/progress?days=${days}`),

  deepDiveCategories: () =>
    getUnscoped<{ categories: CategoryPerformance[] }>("/insights/deep-dive/categories"),

  deepDiveEngagement: () =>
    getUnscoped<{ engagement: EngagementQuality }>("/insights/deep-dive/engagement"),

  deepDiveSparkline: (days = 90) =>
    getUnscoped<{ points: SparklinePoint[] }>(`/insights/deep-dive/sparkline?days=${days}`),

  deepDiveTopics: (days?: number) =>
    getUnscoped<{ topics: TopicPerformance[] }>(`/insights/deep-dive/topics${days ? `?days=${days}` : ""}`),

  deepDiveHooks: (days?: number) =>
    getUnscoped<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>(
      `/insights/deep-dive/hooks${days ? `?days=${days}` : ""}`
    ),

  deepDiveImageSubtypes: (days?: number) =>
    getUnscoped<{ subtypes: ImageSubtypePerformance[] }>(
      `/insights/deep-dive/image-subtypes${days ? `?days=${days}` : ""}`
    ),

  // Analysis gaps
  insightsGaps: () =>
    getUnscoped<{ gaps: AnalysisGap[] }>("/insights/gaps"),

  // Prompt suggestions
  insightsPromptSuggestions: () =>
    getUnscoped<{ prompt_suggestions: PromptSuggestions | null }>("/insights/prompt-suggestions"),

  // Auto-refresh settings
  getAutoRefreshSettings: () =>
    getUnscoped<{ schedule: string; post_threshold: number }>("/settings/auto-refresh"),

  saveAutoRefreshSettings: (settings: { schedule?: string; post_threshold?: number }) =>
    fetch(withPersonaId(`/api/settings/auto-refresh`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // Run history
  getAiRuns: () =>
    getUnscoped<{ runs: AiRun[]; total_cost_cents: number }>("/insights/runs"),

  // Sync health
  getSyncHealth: () =>
    getUnscoped<{ warnings: Array<{ message: string; detected_at: string }> }>("/settings/sync-health"),

  // ── Author Profile ──────────────────────────────────────────

  getAuthorProfile: () =>
    getUnscoped<AuthorProfileResponse>("/author-profile"),

  saveAuthorProfile: (profile_text: string, profile_json?: Record<string, any>) =>
    fetch(withPersonaId(`/api/author-profile`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_text, profile_json }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  createInterviewSession: () =>
    fetch(withPersonaId(`/api/author-profile/interview/session`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `API error: ${r.status}`);
      }
      return r.json() as Promise<InterviewSessionResponse>;
    }),

  extractProfile: (transcript: string, duration_seconds?: number) =>
    fetch(withPersonaId(`/api/author-profile/extract`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, duration_seconds }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<ExtractedProfileResponse>;
    }),

  // ── Generate Pipeline ─────────────────────────────────────

  generateDiscover: () =>
    fetch(withPersonaId(`/api/generate/discover`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<DiscoveryResponse>;
    }),

  generateResearch: (topic: string, avoid?: string[]) =>
    fetch(withPersonaId(`/api/generate/research`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        ...(avoid && avoid.length > 0 && { avoid }),
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenResearchResponse>;
    }),

  generateDrafts: (researchId: number, storyIndex: number, personalConnection?: string, length?: "short" | "medium" | "long") =>
    fetch(withPersonaId(`/api/generate/drafts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        research_id: researchId,
        story_index: storyIndex,
        personal_connection: personalConnection,
        length,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenDraftsResponse>;
    }),

  generateChat: (generationId: number, message: string, editedDraft?: string) =>
    fetch(withPersonaId(`/api/generate/chat`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, message, edited_draft: editedDraft }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenChatResponse>;
    }),

  generateChatHistory: (generationId: number) =>
    fetch(withPersonaId(`/api/generate/${generationId}/messages`)).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenChatMessage[]>;
    }),

  generateCombine: (generationId: number, selectedDrafts: number[], combiningGuidance?: string) =>
    fetch(withPersonaId(`/api/generate/combine`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, selected_drafts: selectedDrafts, combining_guidance: combiningGuidance }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCombineResponse>;
    }),

  // ── Generate Rules ────────────────────────────────────────

  generateGetRules: () =>
    getUnscoped<GenRulesResponse>("/generate/rules"),

  generateSaveRules: (categories: GenRulesResponse["categories"]) =>
    fetch(withPersonaId(`/api/generate/rules`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateResetRules: () =>
    fetch(withPersonaId(`/api/generate/rules/reset`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenRulesResponse>;
    }),

  // ── Generate History ──────────────────────────────────────

  getActiveGeneration: () =>
    getUnscoped<{ generation: any | null }>("/generate/active"),

  generateHistory: (status = "all", offset = 0, limit = 20) =>
    getUnscoped<GenHistoryResponse>(`/generate/history?status=${status}&offset=${offset}&limit=${limit}`),

  generateHistoryDetail: (id: number) =>
    getUnscoped<any>(`/generate/history/${id}`),

  generateDiscard: (id: number) =>
    fetch(withPersonaId(`/api/generate/history/${id}/discard`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateRetro: (id: number, publishedText: string) =>
    fetch(withPersonaId(`/api/generate/history/${id}/retro`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published_text: publishedText }),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `API error: ${r.status}`);
      }
      return r.json() as Promise<{ analysis: RetroAnalysis; input_tokens: number; output_tokens: number }>;
    }),

  generateGetRetro: (id: number) =>
    getUnscoped<RetroResponse>(`/generate/history/${id}/retro`),

  generateAddRule: (category: string, ruleText: string) =>
    fetch(withPersonaId(`/api/generate/rules/add`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, rule_text: ruleText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── Pending Retros (for Coach) ──────────────────────────

  getPendingRetros: () =>
    getUnscoped<{ retros: PendingRetro[] }>("/generate/retros/pending"),

  markRetroApplied: (generationId: number) =>
    fetch(withPersonaId(`/api/generate/retros/${generationId}/apply`), { method: "PATCH" })
      .then((r) => r.json()),

  // ── Coaching Sync ─────────────────────────────────────────

  generateCoachingAnalyze: () =>
    fetch(withPersonaId(`/api/generate/coaching/analyze`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCoachingSyncResponse>;
    }),

  generateCoachingDecide: (changeId: number, action: string, editedText?: string) =>
    fetch(withPersonaId(`/api/generate/coaching/changes/${changeId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, edited_text: editedText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateCoachingHistory: () =>
    getUnscoped<{ syncs: any[] }>("/generate/coaching/history"),

  generateCoachingInsights: () =>
    getUnscoped<{ insights: GenCoachingInsight[] }>("/generate/coaching/insights"),

  // Sources
  getSources: () =>
    getUnscoped<{ sources: GenSource[] }>("/sources"),

  addSource: (url: string) =>
    fetch(withPersonaId(`/api/sources`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `API error: ${r.status}`);
      return data as { source: GenSource };
    }),

  updateSource: (id: number, updates: { enabled?: boolean; name?: string }) =>
    fetch(withPersonaId(`/api/sources/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  deleteSource: (id: number) =>
    fetch(withPersonaId(`/api/sources/${id}`), { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  // ── Generic Settings (for onboarding gate, etc.) ────────

  getSetting: async (key: string): Promise<string | null> => {
    const res = await fetch(withPersonaId(`/api/settings/kv/${encodeURIComponent(key)}`));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    return data.value;
  },

  setSetting: (key: string, value: string) =>
    fetch(withPersonaId(`/api/settings/kv`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── Source Discovery ────────────────────────────────────

  // ── API Key Config ─────────────────────────────────────

  getConfigKeys: () =>
    fetch("/api/config/keys").then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ keys: Array<{ key: string; label: string; required: boolean; configured: boolean; prefix: string; url: string }> }>;
    }),

  saveConfigKeys: (keys: Record<string, string>) =>
    fetch(`/api/config/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── Source Discovery ────────────────────────────────────

  discoverSources: (topics?: string[]) =>
    fetch(withPersonaId(`/api/sources/discover`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      const data = await r.json();
      return data.sources as Array<{ name: string; url: string; feed_url: string | null; description: string }>;
    }),

  // Persona management (not scoped)
  listPersonas: () =>
    fetch("/api/personas").then(r => r.json() as Promise<{ personas: import("../context/PersonaContext").Persona[] }>),
  createPersona: (data: { name: string; linkedin_url: string }) =>
    fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  updatePersona: (id: number, data: { name?: string; linkedin_url?: string }) =>
    fetch(`/api/personas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  getApiToken: (): Promise<{ token: string | null }> =>
    fetch("/api/auth/token").then(r => r.json()),
  getScrapeHealth: () => get<{ errors: ScrapeError[] }>("/scrape-health"),
};

// RetroChange, RetroRuleSuggestion, RetroPromptEdit, RetroAnalysis — imported from @reachlab/shared

export interface RetroResponse {
  retro: {
    published_text: string;
    analysis: RetroAnalysis;
    retro_at: string;
  } | null;
}

export interface PendingRetro {
  generation_id: number;
  draft_excerpt: string;
  retro_at: string;
  matched_post_id: string | null;
  analysis: RetroAnalysis;
}

export interface GenSource {
  id: number;
  name: string;
  feed_url: string;
  enabled: number;
  created_at?: string;
}
