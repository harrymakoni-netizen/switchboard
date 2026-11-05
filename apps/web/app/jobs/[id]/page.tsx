import { Suspense } from "react";
import { JobView } from "../../../components/JobView";
import { demoConfiguration } from "../../../lib/demo";
export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<p className="loading">Opening your job…</p>}>
      <JobView
        id={params.id}
        demo={process.env.DEMO_MODE === "1"}
        simulatedCalls={demoConfiguration().simulatedCalls}
        researchEnabled={["mock", "live"].includes(
          process.env.PARTNER_RESEARCH_MODE ?? "off",
        )}
      />
    </Suspense>
  );
}
