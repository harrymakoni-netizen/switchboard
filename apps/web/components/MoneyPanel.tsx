import type { Payment, State } from "@switchboard/shared";
export function MoneyPanel({
  payments,
  state,
  email,
  onReveal,
  busy,
}: {
  payments: Payment[];
  state: State;
  email: string | null;
  onReveal: () => void;
  busy: boolean;
}) {
  const amount = (kind: Payment["kind"]) => {
    const p = payments.find((p) => p.kind === kind);
    return p ? "$" + ((p.amountCents ?? 0) / 100).toFixed(2) : "—";
  };
  const voided = payments.some((p) => p.kind === "void");
  const captured = payments.some(
    (p) => p.kind === "capture" && p.status === "COMPLETED",
  );
  const capturePayment = payments.find((p) => p.kind === "capture");
  const payoutPayment = payments.find((p) => p.kind === "payout");
  const invoice = payments.find((p) => p.kind === "invoice");
  return (
    <>
      <h2>Payment overview</h2>
      <div>
        <ol className="approval-trail" aria-label="Your payment approvals">
          <li
            className={
              payments.some((p) => p.kind === "authorization") ? "approved" : ""
            }
          >
            <span>1</span>
            <div>
              <strong>Approve the booking</strong>
              <small>
                {payments.some((p) => p.kind === "authorization")
                  ? "You approved a funds hold"
                  : "A hold first. No capture yet."}
              </small>
            </div>
          </li>
          <li className={captured ? "approved" : ""}>
            <span>2</span>
            <div>
              <strong>Confirm the work</strong>
              <small>
                {captured
                  ? "You approved payment release"
                  : "Payment waits for your approval"}
              </small>
            </div>
          </li>
        </ol>
        <div className="money-row">
          <span>Funds held</span>
          <strong>
            {voided
              ? "Released"
              : captured
                ? "Released to payment"
                : amount("authorization")}
          </strong>
        </div>
        <div className="money-row">
          <span>
            {capturePayment?.status === "PENDING"
              ? "Capture pending"
              : capturePayment?.status === "DECLINED"
                ? "Capture declined"
                : "Captured"}
          </span>
          <strong>{amount("capture")}</strong>
        </div>
        <div className="money-row">
          <span>
            {payoutPayment?.status === "PENDING"
              ? "Payout pending"
              : payoutPayment?.status === "UNCLAIMED"
                ? "Awaiting claim"
                : payoutPayment?.status === "FAILED"
                  ? "Payout failed"
                  : "Paid out"}
          </span>
          <strong>{amount("payout")}</strong>
        </div>
        {invoice && (
          <div className="receipt-status">
            {invoice.status === "PAID" ? (
              <a
                href={"/api/jobs/" + invoice.jobId + "/receipt"}
                target="_blank"
                rel="noreferrer"
                className="receipt-link"
              >
                View receipt
              </a>
            ) : (
              <span role="status">
                {invoice.status === "NEEDS_REVIEW"
                  ? "Receipt needs review"
                  : "Preparing receipt…"}
              </span>
            )}{" "}
            {invoice.status === "PAID" && (
              <span className="small">
                Payment recorded · opens in a new tab
              </span>
            )}
          </div>
        )}
        {payments.length > 0 && (
          <details className="payment-activity">
            <summary>Payment activity · {payments.length} records</summary>
            <p className="small">
              Provider references for this job’s sandbox transactions.
            </p>
            {payments.map((p) => (
              <div key={p.id} className="activity-record">
                <span>
                  {p.kind} · {p.status}
                </span>
                <span className="ledger-id">{p.paypalId}</span>
              </div>
            ))}
          </details>
        )}
      </div>
      <div>
        {email ? (
          <p className="recipient">
            {payoutPayment ? "Payout recipient" : "Payout will go to"}{" "}
            <strong>{email}</strong>
          </p>
        ) : ["CONFIRMED", "AWAITING_COMPLETION"].includes(state) ? (
          <button className="secondary" disabled={busy} onClick={onReveal}>
            Show payout recipient
          </button>
        ) : null}
        <p className="payment-foot">
          PayPal sandbox
          <br />A hold isn’t a charge. We capture only after you confirm the
          work is done.
        </p>
      </div>
    </>
  );
}
