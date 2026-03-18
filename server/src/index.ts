import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file if it exists
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
const DB_PATH = path.join(__dirname, "../../data/linkedin.db");
const PORT = 3210;

const app = buildApp(DB_PATH);

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Linkling server running at ${address}`);
});
