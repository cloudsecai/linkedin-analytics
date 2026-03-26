// Shared API response types — single source of truth for server + dashboard

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

export interface TopicPerformance {
  topic: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export interface HookPerformance {
  name: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export interface ImageSubtypePerformance {
  format: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export interface Story {
  headline: string;
  summary: string;
  source: string;
  source_url?: string;
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}

export interface Draft {
  type: "contrarian" | "operator" | "future";
  hook: string;
  body: string;
  closing: string;
  word_count: number;
  structure_label: string;
}

export interface RetroChange {
  category: "structural" | "voice" | "content" | "hook" | "closing" | "cut" | "added";
  significance: "high" | "medium";
  principle: string;
  draft_excerpt?: string;
  published_excerpt?: string;
}

export interface RetroRuleSuggestion {
  action: "add" | "update";
  category: "voice_tone" | "structure_formatting" | "anti_ai_tropes";
  rule_text: string;
  evidence: string;
}

export interface RetroPromptEdit {
  type: "add" | "remove" | "replace";
  remove_text?: string;
  add_text: string;
  reason: string;
}

export interface RetroAnalysis {
  core_message_same: boolean;
  surface_changes_summary: string;
  changes: RetroChange[];
  patterns: string[];
  rule_suggestions: RetroRuleSuggestion[];
  prompt_edits: RetroPromptEdit[];
  summary: string;
}
