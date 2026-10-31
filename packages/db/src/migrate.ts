import { readFile } from "node:fs/promises";
import { sql } from "./index";
await sql.unsafe(
  await readFile(
    new URL("../migrations/0000_initial.sql", import.meta.url),
    "utf8",
  ),
);
await sql.end();
console.log("Migration applied");
