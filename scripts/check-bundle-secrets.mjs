// Verifies the built frontend contains no Retell credentials.
// Run after `npm run build`:  npm run check:secrets
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const dist = path.resolve("client/dist");
if (!fs.existsSync(dist)) {
  console.error("client/dist not found — run `npm run build` first.");
  process.exit(1);
}

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);

const key = (process.env.RETELL_API_KEY ?? "").trim();
const needles = ["RETELL_API_KEY", "process.env"];
if (key && key !== "your_retell_secret_api_key_here") needles.push(key);

let leaks = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const needle of needles) {
    if (text.includes(needle)) {
      leaks++;
      console.error(`✗ ${path.relative(process.cwd(), file)} contains ${needle === key ? "the Retell API key" : `"${needle}"`}`);
    }
  }
}
if (leaks) process.exit(1);
console.log(`✓ Scanned ${files.length} built files: no Retell secret or server env references found${key ? " (checked against your real key)" : ""}.`);
