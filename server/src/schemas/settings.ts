import { z } from "zod";

export const timezoneBody = z.object({
  timezone: z.string().optional(),
});

export const writingPromptBody = z.object({
  text: z.string().optional(),
  source: z.string().optional(),
  evidence: z.string().optional(),
});

export const autoRefreshBody = z.object({
  schedule: z.enum(["off", "daily", "weekly"]).optional(),
  post_threshold: z.number().int().min(1).max(50).optional(),
});

export const settingBody = z.object({
  key: z.string().min(1),
  value: z.string().max(1000),
});

export const configKeysBody = z.object({
  keys: z.record(z.string()),
});
