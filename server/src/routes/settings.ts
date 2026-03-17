import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

export function registerSettingsRoutes(
  app: FastifyInstance,
  dataDir: string
): void {
  const photoPath = path.join(dataDir, "author-reference.jpg");

  app.get("/api/settings/author-photo", async (_request, reply) => {
    if (!fs.existsSync(photoPath)) {
      return reply.status(404).send({ error: "No author photo uploaded" });
    }
    return reply.type("image/jpeg").send(fs.readFileSync(photoPath));
  });

  app.post("/api/settings/author-photo", async (request, reply) => {
    const contentType = request.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file provided" });
      }
      if (!ALLOWED_TYPES.has(data.mimetype)) {
        return reply
          .status(400)
          .send({ error: "Only JPEG and PNG files are allowed" });
      }
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length > MAX_FILE_SIZE) {
        return reply.status(400).send({ error: "File too large. Max 5MB." });
      }
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(photoPath, buffer);
      return { ok: true };
    }

    // Handle raw binary upload — validate MIME type
    if (!ALLOWED_TYPES.has(contentType.split(";")[0].trim())) {
      return reply
        .status(400)
        .send({ error: "Only JPEG and PNG files are allowed" });
    }
    const body = request.body as Buffer;
    if (!body || body.length === 0) {
      return reply.status(400).send({ error: "No file provided" });
    }
    if (body.length > MAX_FILE_SIZE) {
      return reply.status(400).send({ error: "File too large. Max 5MB." });
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(photoPath, body);
    return { ok: true };
  });

  app.delete("/api/settings/author-photo", async () => {
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }
    return { ok: true };
  });
}
