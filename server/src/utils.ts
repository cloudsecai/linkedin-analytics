import type { FastifyRequest } from "fastify";

/**
 * Extract personaId from route params or query string, defaulting to 1.
 * Shared across all route files to avoid duplication.
 */
export function getPersonaId(request: FastifyRequest): number {
  const params = request.params as any;
  if (params.personaId) {
    const n = parseInt(params.personaId, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const query = request.query as any;
  if (query.personaId) {
    const n = parseInt(query.personaId, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}
