import { demoConfiguration } from "../../lib/demo";

export const metadata = { title: "Try the demo — Switchboard" };
export default function DemoPage() {
  const mode = demoConfiguration();
  return (
    <main className="shell guide" id="main">
      <a href="/" className="back-link">
        Back to Switchboard
      </a>
      <div className="guide-heading">
        <h1>
          A repair request.
          <br />
          Two clear approvals.
        </h1>
        <p>
          Try the complete journey, from a repair brief to a payment receipt.
          This is a working sandbox demonstration. No real repairs are booked
          and no real money moves.
        </p>
        <a className="primary" href="/#request-form">
          Start a demo request
        </a>
      </div>
      <div className="guide-layout">
        <section aria-labelledby="walkthrough-title">
          <h2 id="walkthrough-title">Your walkthrough</h2>
          <ol className="walkthrough">
            <li>
              <h3>Describe the repair</h3>
              <p>
                Use “Fix Mum’s geyser in Avondale tomorrow, under $120.” The
                assistant turns your words into a task, location, budget, and
                time window. If information is missing, it asks a follow-up.
              </p>
            </li>
            <li>
              <h3>Compare the evidence</h3>
              <p>
                {mode.simulatedCalls
                  ? "Three simulated provider conversations produce two quotes and a decline."
                  : "Configured test providers are called for quotes."}{" "}
                Review what’s included, the available time, and the transcript.
                Demo prices and ratings are illustrative, not market data.
              </p>
            </li>
            <li>
              <h3>Approval one: book and hold</h3>
              <p>
                Choose a quote within your budget and select{" "}
                <strong>Book</strong>.{" "}
                {mode.simulatedPayments
                  ? "In offline mode, the payment adapter simulates approval."
                  : "PayPal opens its sandbox checkout. Sign in with a sandbox Personal buyer account, not your real PayPal login."}{" "}
                The booking authorizes funds; it does not capture them.
              </p>
            </li>
            <li>
              <h3>Review the confirmed recipient</h3>
              <p>
                After confirmation, select{" "}
                <strong>Show payout recipient</strong>. Check the business’s
                sandbox email. For this demo, select{" "}
                <strong>Fast-forward to completion</strong> to skip waiting for
                the appointment.
              </p>
            </li>
            <li>
              <h3>Approval two: confirm the work</h3>
              <p>
                Select <strong>Mark done · release payment</strong>. Payment is
                captured and the payout is sent to the reviewed recipient. The
                agent cannot approve either payment step for you.
              </p>
            </li>
            <li>
              <h3>Follow the payment to its receipt</h3>
              <p>
                Watch the payment status and open <strong>View receipt</strong>{" "}
                once ready. An unclaimed payout is labeled separately from a
                completed payout. A receipt may take a moment to prepare.
              </p>
            </li>
          </ol>
          <div className="alternative-path">
            <h3>Try the other outcome, too.</h3>
            <p>
              <strong>Cancel booking</strong> requests release of the hold
              before capture. <strong>Not done · keep funds held</strong>{" "}
              records an issue without releasing payment. You remain in control
              when the repair doesn’t go to plan.
            </p>
          </div>
        </section>
        <aside className="guide-aside">
          <h2>What’s running here</h2>
          <dl className="capabilities">
            <div>
              <dt>Planning & quote extraction</dt>
              <dd>{mode.simulatedAI ? "Deterministic demo AI" : "Gemini"}</dd>
            </div>
            <div>
              <dt>Payment integration</dt>
              <dd>
                {mode.simulatedPayments
                  ? "Simulated sandbox payments"
                  : "PayPal sandbox APIs"}
              </dd>
            </div>
            <div>
              <dt>Business discovery</dt>
              <dd>
                {mode.simulatedDiscovery
                  ? "Configured demo providers"
                  : "Configured discovery integration"}
              </dd>
            </div>
            <div>
              <dt>Phone conversations</dt>
              <dd>
                {mode.simulatedCalls
                  ? "Simulated transcripts; no phone calls"
                  : "Configured test phone calls"}
              </dd>
            </div>
          </dl>
          <p>
            Live business discovery and autonomous phone conversations are
            unfinished. The demo does not claim to contact real repair
            businesses.
          </p>
          {!mode.simulatedPayments && (
            <details>
              <summary>Need a sandbox buyer account?</summary>
              <p>
                Create a Personal sandbox test account in the{" "}
                <a
                  href="https://developer.paypal.com/dashboard/accounts"
                  target="_blank"
                  rel="noreferrer"
                >
                  PayPal Developer Dashboard
                </a>
                . Use that account’s generated email and password at checkout.
                The developer account and sandbox buyer are separate logins.
                Keep your real account credentials out of the demo.
              </p>
            </details>
          )}
          <a
            href="https://github.com/harrymakoni-netizen/switchboard"
            target="_blank"
            rel="noreferrer"
          >
            Explore the source and local setup
          </a>
        </aside>
      </div>
    </main>
  );
}
