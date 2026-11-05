"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const example = "Fix Mum’s geyser in Avondale tomorrow, under $120";
export function RequestForm({
  bookingAvailable = true,
  demo = false,
}: {
  bookingAvailable?: boolean;
  demo?: boolean;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const input = useRef<HTMLTextAreaElement>(null);
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
      <form
        className="request-form"
        id="request-form"
        onSubmit={submit}
        aria-busy={busy}
      >
        {!bookingAvailable && (
          <p className="empty-note" role="status">
            Preview deployment · Online booking is not available here yet. No
            requests or payments will be submitted.
          </p>
        )}
        <label htmlFor="request">What needs taking care of?</label>
        <textarea
          ref={input}
          id="request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Tell us the repair, where, when, and your budget."
          minLength={5}
          maxLength={2000}
          required
          disabled={busy}
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
      <button
        className="example"
        disabled={busy}
        onClick={() => {
          setRequest(example);
          input.current?.focus();
        }}
      >
        Try: “{example}”
      </button>
      {demo && (
        <p className="demo-help">
          New here? Use the sample repair above.{" "}
          <a href="/demo">See the walkthrough</a> before trying the two payment
          approvals.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
