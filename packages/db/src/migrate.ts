import { readFile, readdir } from "node:fs/promises";
import { sql } from "./index";
const directory = new URL("../migrations/", import.meta.url);
for (const name of (await readdir(directory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort())
  await sql.unsafe(await readFile(new URL(name, directory), "utf8"));
await sql.end();
console.log("Migration applied");
