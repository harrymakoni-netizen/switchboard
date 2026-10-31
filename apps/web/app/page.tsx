import { RequestForm } from "../components/RequestForm";
export default function Page() {
  return (
    <div className="shell">
      <main className="home">
        <section>
          <h1>
            One request.
            <br />
            Consider it called.
          </h1>
          <p className="intro">
            Tell us what needs fixing. We’ll call local businesses, bring back
            their quotes, and leave the choice to you.
          </p>
          <RequestForm />
        </section>
        <aside className="how">
          <h2 className="how-title">From to-do to taken care of.</h2>
          {[
            [
              "Tell us the job",
              "The repair, your location, a time window, and a budget. One brief is all it takes.",
            ],
            [
              "We make the calls",
              "Three demo businesses, called in parallel. Compare the price, availability, and the actual conversation.",
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
              A booking places a hold, not a charge. Cancel before completion to
              release it. This build uses PayPal sandbox funds only.
            </p>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>Switchboard · Home repairs, without the phone tag.</span>
        <span>Built for the PayPal AI Hackathon · Demo</span>
      </footer>
    </div>
  );
}
