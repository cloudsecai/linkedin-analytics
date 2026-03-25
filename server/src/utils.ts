import type { FastifyRequest } from "fastify";

/**
 * Extract personaId from route params or query string, defaulting to 1.
 * Shared across all route files to avoid duplication.
 */
export function getPersonaId(request: FastifyRequest): number {
  const params = request.params as any;
  if (params.personaId) return Number(params.personaId);
  const query = request.query as any;
  if (query.personaId) return Number(query.personaId);
  return 1;
}
