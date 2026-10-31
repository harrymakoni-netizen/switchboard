import { Suspense } from "react";
import { JobView } from "../../../components/JobView";
export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<p className="loading">Opening your job…</p>}>
      <JobView id={params.id} demo={process.env.DEMO_MODE === "1"} />
    </Suspense>
  );
}
