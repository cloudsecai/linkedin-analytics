// Barrel re-export — all AI query modules
// Keep explicit named exports so missing exports cause compile errors.

// runs (extracted first — other modules depend on getLatestCompletedRun)
export { createRun, completeRun, failRun, getRunningRun, getRunCost, getLatestCompletedRun, getRunLogs, insertAiLog, getAiLogsForRun, listCompletedRuns, getTotalCostForPersona, getLastFullRun, getRunsNeedingCostBackfill, backfillRunCost, pruneOldAiLogs } from "./ai/runs.js";
export type { AiLogInput } from "./ai/runs.js";

// tags
export { upsertAiTag, getAiTags, getUntaggedPostIds, upsertImageTag, getImageTags, getUnclassifiedImagePosts, upsertTaxonomy, getTaxonomy, setPostTopics, getPostTopics, clearTagsForPersona, getPostsForTaxonomy } from "./ai/tags.js";
export type { AiTag, ImageTagInput, ImageTag } from "./ai/tags.js";

// insights (imports getLatestCompletedRun from ./runs.js)
export { insertInsight, getActiveInsights, retireInsight, insertInsightLineage, upsertOverview, getLatestOverview, getChangelog, getLatestAnalysisGaps, upsertAnalysisGap, getLatestPromptSuggestions, clearPromptSuggestions } from "./ai/insights.js";
export type { InsightInput, OverviewInput, AnalysisGapInput, AnalysisGapRow } from "./ai/insights.js";

// recommendations (imports getLatestCompletedRun from ./runs.js)
export { insertRecommendation, getUnresolvedRecommendationHeadlines, getRecommendations, getRecommendationsWithCooldown, updateRecommendationFeedback, resolveRecommendation, getRecommendationById, markRecommendationActedOn, getRecentFeedbackWithReasons } from "./ai/recommendations.js";
export type { RecommendationInput } from "./ai/recommendations.js";

// deep-dive
export { getProgressMetrics, getCategoryPerformance, getEngagementQuality, getSparklineData, getTopicPerformance, getHookPerformance, getImageSubtypePerformance, getPostCountWithMetrics, getPostCountSinceRun } from "./ai/deep-dive.js";

// settings
export { getSetting, upsertSetting, deleteSetting, saveWritingPromptHistory, getWritingPromptHistory, getPersonaSetting, upsertPersonaSetting } from "./ai/settings.js";
export type { WritingPromptHistoryRow } from "./ai/settings.js";

// Re-export shared types that consumers import through this barrel
export type { PromptSuggestion, PromptSuggestions, MetricsSummary, CategoryPerformance, SparklinePoint, EngagementQuality, TopicPerformance, HookPerformance, ImageSubtypePerformance } from "@reachlab/shared";
