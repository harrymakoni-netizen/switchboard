"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Snapshot } from "@switchboard/shared";
import dynamic from "next/dynamic";
import type { BoardRow } from "./QuoteBoard";
const QuoteBoard = dynamic(
  () => import("./QuoteBoard").then((m) => m.QuoteBoard),
  {
    ssr: false,
    loading: () => <p className="empty-note">Opening the quote board…</p>,
  },
);
import { JobStepper } from "./JobStepper";
import { MoneyPanel } from "./MoneyPanel";
import { TranscriptDrawer } from "./TranscriptDrawer";
export function JobView({ id, demo }: { id: string; demo: boolean }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<BoardRow | null>(null);
  const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState<string | null>(null);
  const search = useSearchParams();
  const [question, setQuestion] = useState(search.get("question") ?? "");
  const [answer, setAnswer] = useState("");
  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs/" + id);
    const value = await res.json();
    if (!res.ok) throw new Error(value.error);
    setData(value);
    setRevision((v) => v + 1);
  }, [id]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const stream = new EventSource("/api/jobs/" + id + "/events");
    for (const name of [
      "connected",
      "state.changed",
      "business.found",
      "call.status",
      "quote.created",
      "payment.updated",
      "transcript.line",
    ])
      stream.addEventListener(name, () => {
        void refresh().catch((e) => setError(e.message));
      });
    stream.addEventListener("notice", (event) => {
      try {
        setNotice(JSON.parse((event as MessageEvent).data).message);
      } catch {}
    });
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => {
      stream.close();
      clearInterval(timer);
    };
  }, [id, refresh]);
  const post = useCallback(
    async (action: string, body: unknown = {}) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(
          action.startsWith("/api/") ? action : `/api/jobs/${id}/${action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Please retry.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [id, refresh],
  );
  const book = useCallback(
    (quoteId: string) => {
      void post("book", { quoteId }).then((r) => {
        if (r?.approveUrl) window.location.assign(r.approveUrl);
      });
    },
    [post],
  );
  const listen = useCallback((row: BoardRow) => setTranscript(row), []);
  if (!data)
    return (
      <main className="loading" role="status">
        {error || "Opening your switchboard…"}
      </main>
    );
  const { job, businesses, calls, quotes, payments } = data;
  const rows: BoardRow[] = businesses.map((b) => {
    const quote = quotes.find((q) => q.businessId === b.id);
    return {
      ...b,
      quote,
      call: calls.find((c) => c.businessId === b.id && c.purpose === "quote"),
      priceCents: quote?.priceCents ?? null,
      earliestSlot: quote?.earliestSlot ?? null,
    };
  });
  const payment = payments.some((p) => p.kind === "void")
    ? "Released"
    : payments.some((p) => p.kind === "payout")
      ? "Paid"
      : payments.some((p) => p.kind === "capture")
        ? "Captured"
        : payments.some((p) => p.kind === "authorization")
          ? "Held"
          : "—";
  const statusText: Record<string, string> = {
    FINDING: "Looking for businesses that can help with your repair.",
    CALLING: "The calls are underway. Quotes appear as each conversation ends.",
    QUOTED:
      "The calls are complete. Compare the quotes and choose who gets the job.",
    BOOK_APPROVED: "Preparing PayPal approval. No funds have been captured.",
    FUNDS_HELD: "Funds are held. We’re calling back to confirm your booking.",
    CONFIRMED:
      "Your booking is confirmed. Payment waits until you confirm completion.",
    AWAITING_COMPLETION:
      "Has the repair been completed and is everything working?",
    COMPLETED: "Completion confirmed. Processing the sandbox payment.",
    PAID_OUT: "Payment captured. Waiting for payout confirmation.",
    CLOSED: "Job complete. The business has been paid.",
    CANCELLED: "Booking cancelled. Any authorization will be voided.",
    ISSUE: "This job needs attention. Any existing hold stays in place.",
  };
  return (
    <main className="shell">
      <div className="job-top">
        <div>
          <h1>{job.brief?.task ?? "Let’s finish your brief"}</h1>
          <div className="brief-meta">
            <span>{job.brief?.location}</span>
            {job.brief && (
              <>
                <span>Budget ${(job.brief.budgetCents / 100).toFixed(2)}</span>
                <span>
                  {new Date(job.brief.windowStart).toLocaleDateString("en-GB", {
                    timeZone: "Africa/Harare",
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · Harare time
                </span>
              </>
            )}
          </div>
        </div>
        <span className="job-id">
          Job {id.slice(0, 8)} · {demo ? "Demo" : "Sandbox"}
        </span>
      </div>
      <JobStepper state={job.state} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p className="empty-note" role="status">
          {notice}
        </p>
      )}
      {search.get("notice") && (
        <p className="empty-note">
          {search.get("notice") === "approval_failed"
            ? "Approval could not be completed. Please retry."
            : "PayPal approval was cancelled. No funds were captured."}
        </p>
      )}
      {job.state === "DRAFT" ? (
        <form
          className="request-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post("answer", { answer }).then((r) => {
              if (r) {
                setQuestion(r.followUpQuestion ?? "");
                setAnswer("");
              }
            });
          }}
        >
          <label htmlFor="answer">
            {question ||
              "Add the repair, location, time window, or budget that is missing."}
          </label>
          <input
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            Continue
          </button>
        </form>
      ) : (
        <>
          <p className="progress-note" role="status">
            {statusText[job.state]}
          </p>
          {job.state === "CLOSED" && (
            <div className="closed-banner">
              All taken care of. Thanks for using Switchboard.
            </div>
          )}
          <div className="workspace">
            <section>
              <div className="board-header">
                <h2>Your quote board</h2>
                <span
                  className={"badge " + (job.state === "CALLING" ? "live" : "")}
                >
                  {quotes.filter((q) => !q.declined).length} quotes ·{" "}
                  {businesses.length} businesses
                </span>
              </div>
              <QuoteBoard
                rows={rows}
                budget={job.brief?.budgetCents ?? 0}
                state={job.state}
                chosen={job.chosenQuoteId}
                busy={busy}
                payment={payment}
                onListen={listen}
                onBook={book}
              />
              <p className="small" style={{ marginTop: 12 }}>
                Prices are quoted by the business. Lowest price first; uncertain
                quotes are shown last. Scroll across for details and booking.
              </p>
            </section>
            <aside className="payment-panel">
              <MoneyPanel
                payments={payments}
                state={job.state}
                email={email}
                busy={busy}
                onReveal={() =>
                  void post("show-payout-email").then((r) => {
                    if (r) setEmail(r.email);
                  })
                }
              />
              <div className="job-actions">
                {job.state === "BOOK_APPROVED" &&
                  payments.find((p) => p.kind === "order") && (
                    <a
                      className="primary"
                      href={
                        (
                          payments.find((p) => p.kind === "order")?.raw as {
                            approveUrl: string;
                          }
                        )?.approveUrl
                      }
                    >
                      Continue to approval
                    </a>
                  )}
                {demo && job.state === "CONFIRMED" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void post("/api/demo/fast-forward", { jobId: id })
                    }
                  >
                    Fast-forward to completion
                  </button>
                )}
                {job.state === "AWAITING_COMPLETION" && (
                  <>
                    <button
                      className="primary"
                      disabled={busy || !email}
                      onClick={() => void post("done", { done: true })}
                    >
                      Mark done · release payment
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void post("done", {
                          done: false,
                          note: "The job is not complete.",
                        })
                      }
                    >
                      Not done · keep funds held
                    </button>
                    {!email && (
                      <p className="small">
                        Review the payout recipient before releasing payment.
                      </p>
                    )}
                  </>
                )}
                {["BOOK_APPROVED", "FUNDS_HELD", "CONFIRMED", "ISSUE"].includes(
                  job.state,
                ) && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => void post("cancel")}
                  >
                    Cancel booking
                  </button>
                )}
                <a className="small" href="/">
                  Start another request
                </a>
              </div>
            </aside>
          </div>
        </>
      )}
      {transcript?.call && (
        <TranscriptDrawer
          jobId={id}
          callId={transcript.call.id}
          name={transcript.name}
          revision={revision}
          onClose={() => setTranscript(null)}
        />
      )}
    </main>
  );
}
