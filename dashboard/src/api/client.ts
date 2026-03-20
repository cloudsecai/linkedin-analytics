const BASE_URL = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
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
  engagement_rate: number | null;
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

export interface PromptSuggestion {
  current: string;
  suggested: string;
  evidence: string;
}

export interface PromptSuggestions {
  assessment: "working_well" | "suggest_changes";
  reasoning: string;
  suggestions: PromptSuggestion[];
}

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

export interface MetricsSummary {
  median_er: number | null;
  median_impressions: number | null;
  total_posts: number;
  avg_comments: number | null;
}

export interface ProgressData {
  current: MetricsSummary;
  previous: MetricsSummary;
}

export interface CategoryPerformance {
  category: string;
  post_count: number;
  median_er: number | null;
  median_impressions: number | null;
  median_interactions: number | null;
  status: "underexplored_high" | "reliable" | "declining" | "normal";
}

export interface SparklinePoint {
  date: string;
  er: number;
  impressions: number;
  comments: number;
  comment_ratio: number;
  save_rate: number;
}

export interface EngagementQuality {
  comment_ratio: number | null;
  save_rate: number | null;
  repost_rate: number | null;
  weighted_er: number | null;
  standard_er: number | null;
  total_posts: number;
}

export interface RecommendationsWithCooldown {
  active: Recommendation[];
  resolved: Recommendation[];
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

export interface GenStory {
  headline: string;
  summary: string;
  source: string;
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}

export interface GenDraft {
  type: "contrarian" | "operator" | "future";
  hook: string;
  body: string;
  closing: string;
  word_count: number;
  structure_label: string;
}

export interface GenQualityCheck {
  name: string;
  status: "pass" | "warn";
  detail: string;
}

export interface GenQualityGate {
  passed: boolean;
  checks: GenQualityCheck[];
}

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

export interface GenCombineResponse {
  final_draft: string;
  quality_gate: GenQualityGate;
}

export interface GenReviseResponse {
  final_draft: string;
  quality_gate: GenQualityGate;
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
  insightsOverview: () => get<{ overview: AiOverview | null }>("/insights/overview"),
  insights: () => get<{ recommendations: Recommendation[]; insights: Insight[] }>("/insights"),
  insightsChangelog: () => get<Changelog>("/insights/changelog"),
  insightsTags: (postIds: string[]) =>
    get<{ tags: Record<string, { hook_type: string; tone: string; format_style: string }> }>(
      `/insights/tags?post_ids=${postIds.join(",")}`
    ),
  insightsTaxonomy: () => get<{ taxonomy: TaxonomyItem[] }>("/insights/taxonomy"),
  insightsRefresh: () =>
    fetch(`${BASE_URL}/insights/refresh`, { method: "POST" }).then((r) => r.json()),
  recommendationFeedback: (id: number, rating: string, reason?: string) =>
    fetch(`${BASE_URL}/insights/recommendations/${id}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: { rating, reason: reason || null } }),
    }).then((r) => r.json()),
  authorPhoto: () =>
    fetch(`${BASE_URL}/settings/author-photo`).then((r) =>
      r.ok ? r.blob().then((b) => URL.createObjectURL(b)) : null
    ),
  uploadAuthorPhoto: (file: File) =>
    fetch(`${BASE_URL}/settings/author-photo`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type },
    }).then((r) => r.json()),
  deleteAuthorPhoto: () =>
    fetch(`${BASE_URL}/settings/author-photo`, { method: "DELETE" }).then((r) => r.json()),

  // Timezone
  setTimezone: (timezone: string) =>
    fetch(`${BASE_URL}/settings/timezone`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // Writing prompt
  getWritingPrompt: () =>
    get<{ text: string | null }>("/settings/writing-prompt"),

  saveWritingPrompt: (text: string, source: "manual_edit" | "ai_suggestion", evidence?: string) =>
    fetch(`${BASE_URL}/settings/writing-prompt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, evidence }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  getWritingPromptHistory: () =>
    get<{ history: WritingPromptHistory[] }>("/settings/writing-prompt/history"),

  // Recommendations with cooldown
  recommendationsWithCooldown: () =>
    get<RecommendationsWithCooldown>("/insights/recommendations"),

  // Resolve a recommendation
  resolveRecommendation: (id: number, type: "accepted" | "dismissed") =>
    fetch(`${BASE_URL}/insights/recommendations/${id}/resolve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }).then((r) => r.json()),

  // Deep Dive endpoints
  deepDiveProgress: (days = 30) =>
    get<ProgressData>(`/insights/deep-dive/progress?days=${days}`),

  deepDiveCategories: () =>
    get<{ categories: CategoryPerformance[] }>("/insights/deep-dive/categories"),

  deepDiveEngagement: () =>
    get<{ engagement: EngagementQuality }>("/insights/deep-dive/engagement"),

  deepDiveSparkline: (days = 90) =>
    get<{ points: SparklinePoint[] }>(`/insights/deep-dive/sparkline?days=${days}`),

  // Analysis gaps
  insightsGaps: () =>
    get<{ gaps: AnalysisGap[] }>("/insights/gaps"),

  // Prompt suggestions
  insightsPromptSuggestions: () =>
    get<{ prompt_suggestions: PromptSuggestions | null }>("/insights/prompt-suggestions"),

  // Auto-refresh settings
  getAutoRefreshSettings: () =>
    get<{ schedule: string; post_threshold: number }>("/settings/auto-refresh"),

  saveAutoRefreshSettings: (settings: { schedule?: string; post_threshold?: number }) =>
    fetch(`${BASE_URL}/settings/auto-refresh`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // Run history
  getAiRuns: () =>
    get<{ runs: AiRun[]; total_cost_cents: number }>("/insights/runs"),

  // Sync health
  getSyncHealth: () =>
    get<{ warnings: Array<{ message: string; detected_at: string }> }>("/settings/sync-health"),

  // ── Author Profile ──────────────────────────────────────────

  getAuthorProfile: () =>
    get<AuthorProfileResponse>("/author-profile"),

  saveAuthorProfile: (profile_text: string, profile_json?: Record<string, any>) =>
    fetch(`${BASE_URL}/author-profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_text, profile_json }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  createInterviewSession: (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) =>
    fetch(`${BASE_URL}/author-profile/interview/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preInfo ?? {}),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<InterviewSessionResponse>;
    }),

  extractProfile: (transcript: string, duration_seconds?: number) =>
    fetch(`${BASE_URL}/author-profile/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, duration_seconds }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<ExtractedProfileResponse>;
    }),

  // ── Generate Pipeline ─────────────────────────────────────

  generateResearch: (postType: string) =>
    fetch(`${BASE_URL}/generate/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_type: postType }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenResearchResponse>;
    }),

  generateDrafts: (researchId: number, storyIndex: number, postType: string, personalConnection?: string) =>
    fetch(`${BASE_URL}/generate/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        research_id: researchId,
        story_index: storyIndex,
        post_type: postType,
        personal_connection: personalConnection,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenDraftsResponse>;
    }),

  generateCombine: (generationId: number, selectedDrafts: number[], combiningGuidance?: string) =>
    fetch(`${BASE_URL}/generate/combine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, selected_drafts: selectedDrafts, combining_guidance: combiningGuidance }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCombineResponse>;
    }),

  generateRevise: (generationId: number, action: string, instruction?: string, editedDraft?: string) =>
    fetch(`${BASE_URL}/generate/revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, action, instruction, edited_draft: editedDraft }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenReviseResponse>;
    }),

  // ── Generate Rules ────────────────────────────────────────

  generateGetRules: () =>
    get<GenRulesResponse>("/generate/rules"),

  generateSaveRules: (categories: GenRulesResponse["categories"]) =>
    fetch(`${BASE_URL}/generate/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateResetRules: () =>
    fetch(`${BASE_URL}/generate/rules/reset`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenRulesResponse>;
    }),

  // ── Generate History ──────────────────────────────────────

  generateHistory: (status = "all", offset = 0, limit = 20) =>
    get<GenHistoryResponse>(`/generate/history?status=${status}&offset=${offset}&limit=${limit}`),

  generateHistoryDetail: (id: number) =>
    get<any>(`/generate/history/${id}`),

  generateDiscard: (id: number) =>
    fetch(`${BASE_URL}/generate/history/${id}/discard`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  // ── Coaching Sync ─────────────────────────────────────────

  generateCoachingAnalyze: () =>
    fetch(`${BASE_URL}/generate/coaching/analyze`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCoachingSyncResponse>;
    }),

  generateCoachingDecide: (changeId: number, action: string, editedText?: string) =>
    fetch(`${BASE_URL}/generate/coaching/changes/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, edited_text: editedText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateCoachingHistory: () =>
    get<{ syncs: any[] }>("/generate/coaching/history"),

  generateCoachingInsights: () =>
    get<{ insights: GenCoachingInsight[] }>("/generate/coaching/insights"),
};
