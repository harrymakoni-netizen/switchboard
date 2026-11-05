import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url) });

const assertSandboxMode = (source = process.env) => {
  const paypalEnv = source.PAYPAL_ENV ?? "sandbox";
  if (paypalEnv !== "sandbox")
    throw new Error("Switchboard requires PAYPAL_ENV=sandbox");
  return paypalEnv;
};

assertSandboxMode();

export default {
  transpilePackages: [
    "@switchboard/shared",
    "@switchboard/db",
    "@switchboard/engine",
    "@switchboard/agents",
    "@switchboard/paypal",
    "@switchboard/partners",
  ],
  experimental: { cpus: 2 },
};
