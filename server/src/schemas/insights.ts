import { z } from "zod";

export const refreshBody = z.object({
  force: z.boolean().optional(),
}).optional();

export const feedbackBody = z.object({
  feedback: z.union([
    z.string(),
    z.object({ rating: z.string(), reason: z.string().optional() }),
  ]).optional(),
  acted_on: z.boolean().optional(),
});

export const resolveBody = z.object({
  type: z.enum(["accepted", "dismissed"]),
});
