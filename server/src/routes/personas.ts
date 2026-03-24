import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { listPersonas, getPersona, createPersona, updatePersona } from "../db/persona-queries.js";

export function registerPersonaRoutes(app: FastifyInstance, db: Database.Database) {
  app.get("/api/personas", async () => {
    return { personas: listPersonas(db) };
  });

  // IMPORTANT: Use :personaId (not :id) to avoid Fastify param name conflicts
  // with the scoped route prefix /api/personas/:personaId/...
  app.get("/api/personas/:personaId", async (request, reply) => {
    const { personaId } = request.params as { personaId: string };
    const persona = getPersona(db, Number(personaId));
    if (!persona) return reply.status(404).send({ error: "Persona not found" });
    return persona;
  });

  app.post("/api/personas", async (request) => {
    const body = request.body as { name: string; linkedin_url: string; type?: string };
    const type = body.linkedin_url.includes("/company/") ? "company_page" : (body.type as any ?? "personal");
    const persona = createPersona(db, { name: body.name, linkedin_url: body.linkedin_url, type });
    return persona;
  });

  app.put("/api/personas/:personaId", async (request, reply) => {
    const { personaId } = request.params as { personaId: string };
    const persona = getPersona(db, Number(personaId));
    if (!persona) return reply.status(404).send({ error: "Persona not found" });
    const body = request.body as { name?: string; linkedin_url?: string };
    updatePersona(db, Number(personaId), body);
    return { ok: true };
  });
}
