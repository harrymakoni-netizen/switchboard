import { RequestForm } from "../components/RequestForm";
import { demoConfiguration } from "../lib/demo";
export default function Page() {
  const mode = demoConfiguration();
  return (
    <div className="shell">
      <main className="home" id="main">
        <section>
          <h1>
            One request.
            <br />
            Your repair, sorted.
          </h1>
          <p className="intro">
            Tell us what needs fixing. Compare the quotes, choose who gets the
            job, and release payment only when you confirm the work is done.
          </p>
          <RequestForm
            bookingAvailable={process.env.HOSTED_UI_ONLY !== "1"}
            demo={mode.enabled}
          />
        </section>
        <aside className="how">
          <h2 className="how-title">From to-do to taken care of.</h2>
          {[
            [
              "Tell us the job",
              "The repair, your location, a time window, and a budget. One brief is all it takes.",
            ],
            [
              mode.simulatedCalls
                ? "Compare the conversations"
                : "We make the calls",
              mode.simulatedCalls
                ? "Three simulated providers. Two quotes and one decline. See the price, availability, and the transcript behind each answer."
                : "Compare the price, availability, and conversation from configured test providers.",
            ],
            [
              "Choose. Then confirm.",
              "Book a business to hold funds. Release payment only when you confirm the job is done.",
            ],
          ].map(([title, description], i) => (
            <div className="how-step" key={title}>
              <span className="step-num">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </div>
          ))}
          <div className="promise">
            <h3>Your money waits for your say-so.</h3>
            <p>
              First, approve a booking to hold funds. Then, confirm the
              completed work to release payment. You review the recipient before
              anything is paid out. Sandbox funds only.
            </p>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>Switchboard · Home repairs, without the phone tag.</span>
        <a href="/demo">How to try the demo</a>
      </footer>
    </div>
  );
}
