"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const example = "Fix Mum’s geyser in Avondale tomorrow, under $120";
export function RequestForm({
  bookingAvailable = true,
}: {
  bookingAvailable?: boolean;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(
        "/jobs/" +
          data.jobId +
          (data.followUpQuestion
            ? "?question=" + encodeURIComponent(data.followUpQuestion)
            : ""),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start. Please retry.",
      );
      setBusy(false);
    }
  }
  return (
    <>
      <form className="request-form" onSubmit={submit}>
        {!bookingAvailable && (
          <p className="empty-note" role="status">
            Preview deployment · Online booking is not available here yet. No
            requests or payments will be submitted.
          </p>
        )}
        <label htmlFor="request">What needs taking care of?</label>
        <textarea
          id="request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Tell us the repair, where, when, and your budget."
          minLength={5}
          maxLength={2000}
          required
        />
        <div className="form-bottom">
          <span className="small">
            You choose the business.
            <br />
            You approve every payment.
          </span>
          <button className="primary" disabled={busy || !bookingAvailable}>
            {busy ? "Preparing your brief…" : "Find my quotes"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
      <button className="example" onClick={() => setRequest(example)}>
        Try: “{example}”
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
