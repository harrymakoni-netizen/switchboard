import { demoConfiguration } from "../lib/demo";

export function DemoNotice() {
  const mode = demoConfiguration();
  if (!mode.enabled) return null;
  return (
    <div className="demo-banner">
      <span>
        <strong>Interactive demo</strong> ·{" "}
        {mode.simulatedCalls ? "Simulated calls" : "Test calls"} ·{" "}
        {mode.simulatedPayments ? "Simulated payments" : "PayPal sandbox"} · No
        real money
      </span>
      <a href="/demo">Demo guide</a>
    </div>
  );
}
