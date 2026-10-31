import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url) });
if (process.env.PAYPAL_ENV !== "sandbox")
  throw new Error("Switchboard requires PAYPAL_ENV=sandbox");
export default {
  transpilePackages: [
    "@switchboard/shared",
    "@switchboard/db",
    "@switchboard/engine",
    "@switchboard/agents",
    "@switchboard/paypal",
  ],
  experimental: { cpus: 2 },
};
