import { config } from "dotenv";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { assertSandboxMode } from "../packages/shared/src/env";
import { HttpPayPal } from "../packages/paypal/src/index";
import {
  newSmokeState,
  preparePayPalSmoke,
  resumePayPalSmoke,
  smokeSchema,
  type SmokeState,
} from "../packages/engine/src/paypal-smoke";
config({ path: new URL("../.env", import.meta.url) });
const args = process.argv.slice(2);
async function main() {
  if (args.includes("--help")) {
    console.log(
      "PayPal sandbox only. Each leg is $1.00 USD.\npnpm paypal:smoke --state .paypal-smoke/run.json\nApprove BOTH sandbox orders in your browser. Then authorize and void:\npnpm paypal:smoke --state .paypal-smoke/run.json --resume\nOnly when ready to confirm completion and capture $1.00:\npnpm paypal:smoke --state .paypal-smoke/run.json --resume --confirm-done\nOptional payout recipient: PAYPAL_SMOKE_PAYOUT_EMAIL (a sandbox personal account).",
    );
    return;
  }
  assertSandboxMode(process.env);
  for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"])
    if (!process.env[key]?.trim())
      throw new Error(
        "Missing " +
          key +
          "; configure sandbox credentials in environment secrets, not source code.",
      );
  const p = args.indexOf("--state");
  if (p < 0 || !args[p + 1] || args[p + 1].startsWith("--"))
    throw new Error(
      "Provide --state .paypal-smoke/run.json so retries use the same IDs.",
    );
  const path = resolve(args[p + 1]);
  const resume = args.includes("--resume");
  const paypal = new HttpPayPal(
    process.env.PAYPAL_CLIENT_ID!,
    process.env.PAYPAL_CLIENT_SECRET!,
    process.env.PAYPAL_WEBHOOK_ID ?? "",
  );
  const persist = async (state: SmokeState) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path + ".tmp", JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(path + ".tmp", path);
  };
  let state: SmokeState;
  if (resume) {
    state = smokeSchema.parse(JSON.parse(await readFile(path, "utf8")));
    await resumePayPalSmoke(
      paypal,
      state,
      {
        confirmDone: args.includes("--confirm-done"),
        payoutEmail: process.env.PAYPAL_SMOKE_PAYOUT_EMAIL || undefined,
      },
      persist,
    );
    console.log(
      JSON.stringify(
        {
          captureAuthorizationId: state.capture.authorizationId,
          captureId: state.capture.captureId,
          voidAuthorizationId: state.cancel.authorizationId,
          voided: state.cancel.voided,
          payout: state.payout?.status ?? "NOT_TESTED",
        },
        null,
        2,
      ),
    );
    if (!args.includes("--confirm-done"))
      console.log(
        "Hold and void checked. Capture awaits explicit --confirm-done approval.",
      );
    if (!state.payout)
      console.log(
        "Payout is NOT verified; configure PAYPAL_SMOKE_PAYOUT_EMAIL to test it.",
      );
  } else {
    try {
      await readFile(path);
      throw new Error("State file already exists; use --resume or a new path.");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    state = newSmokeState();
    await preparePayPalSmoke(
      paypal,
      state,
      process.env.APP_URL ?? "http://localhost:3000",
      persist,
    );
    console.log(
      "Awaiting sandbox buyer approval. Open BOTH URLs using a sandbox personal buyer account:",
    );
    console.log("Capture leg:", state.capture.approveUrl);
    console.log("Void leg:", state.cancel.approveUrl);
    console.log("State file:", path);
    console.log(
      "After approving both, rerun with --resume. No capture occurs without --confirm-done.",
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Sandbox smoke failed",
  );
  process.exitCode = 1;
});
