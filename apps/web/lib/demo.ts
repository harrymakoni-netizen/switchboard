export function demoConfiguration() {
  return {
    enabled: process.env.DEMO_MODE === "1",
    simulatedCalls: process.env.MOCK_TELEPHONY !== "0",
    simulatedDiscovery: process.env.MOCK_PARTNERS !== "0",
    simulatedAI: process.env.MOCK_LLM !== "0",
    simulatedPayments: process.env.MOCK_PAYPAL !== "0",
  };
}
