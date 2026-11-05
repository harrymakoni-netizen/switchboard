"use client";
import type { PartnerResearch as Research } from "@switchboard/shared";
import { publicUrl } from "@switchboard/shared";
function source(value: string) {
  return publicUrl.safeParse(value).success ? value : undefined;
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function PartnerResearch({
  data,
  busy,
  onStart,
}: {
  data?: Research | null;
  busy: boolean;
  onStart: () => void;
}) {
  const pending =
    data?.kernel.status === "pending" || data?.channel3.status === "pending";
  const retry =
    data &&
    [data.kernel, data.channel3].some((item) =>
      ["failed", "unavailable"].includes(item.status),
    );
  return (
    <section className="partner-research" aria-labelledby="research-heading">
      <div className="research-heading">
        <div>
          <h2 id="research-heading">Research behind your request</h2>
          <p>
            Directory leads and parts prices to help you assess the options.
          </p>
        </div>
        {(!data || retry) && (
          <button
            className="secondary"
            disabled={busy || pending}
            onClick={onStart}
          >
            {busy || pending
              ? "Researching…"
              : data
                ? "Retry research"
                : "Research this repair"}
          </button>
        )}
      </div>
      {!data ? (
        <p className="small">
          Research is optional. Your booking and payment approvals stay under
          your control.
        </p>
      ) : (
        <div className="research-columns">
          <div>
            <h3>
              Business directory{" "}
              <span className="research-provider">
                Kernel ·{" "}
                {data.kernel.mode === "mock" ? "simulated" : "live research"}
              </span>
            </h3>
            {data.kernel.status === "pending" ? (
              <p role="status">Checking the directory…</p>
            ) : data.kernel.data ? (
              <>
                <p className="small">
                  {data.kernel.mode === "mock"
                    ? "Illustrative directory results. "
                    : "Public directory leads. "}
                  These are separate from the demo quote providers. No calls,
                  availability, or prices are confirmed.
                </p>
                <ul className="research-list">
                  {data.kernel.data.businesses.map((b) => (
                    <li key={b.phone}>
                      <strong>{b.name}</strong>
                      <span>{b.phone}</span>
                      {data.kernel.mode === "live" && source(b.sourceUrl) && (
                        <a
                          href={b.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Directory source
                          <span className="sr-only"> for {b.name}</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                {!data.kernel.data.businesses.length && (
                  <p>
                    No businesses could be supported by the directory evidence.
                    No leads were invented.
                  </p>
                )}
                <details className="research-evidence">
                  <summary>Discovery evidence</summary>
                  <p>
                    Checked{" "}
                    {new Date(data.kernel.data.checkedAt).toLocaleString(
                      "en-GB",
                    )}
                  </p>
                  <p>
                    Session <span>{data.kernel.data.sessionId}</span>
                  </p>
                  {data.kernel.mode === "live" &&
                    source(data.kernel.data.directoryUrl) && (
                      <a
                        href={data.kernel.data.directoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open searched directory
                      </a>
                    )}
                </details>
              </>
            ) : (
              <p role="status">
                {data.kernel.message ?? "Directory research is unavailable."}
              </p>
            )}
          </div>
          <div>
            <h3>
              Replacement-part prices{" "}
              <span className="research-provider">
                Channel3 ·{" "}
                {data.channel3.mode === "mock" ? "simulated" : "live research"}
              </span>
            </h3>
            {data.channel3.status === "pending" ? (
              <p role="status">Checking parts prices…</p>
            ) : data.channel3.data ? (
              <>
                <p className="research-price">
                  {data.channel3.data.medianCents === null
                    ? "No comparable USD prices found"
                    : `${money(data.channel3.data.medianCents)} USD median`}
                </p>
                <p className="small">
                  Search: {data.channel3.data.query}.{" "}
                  {data.channel3.mode === "mock"
                    ? "Illustrative prices."
                    : "US-market retail search."}{" "}
                  Parts only; excludes labour, delivery and taxes. Compatibility
                  and local availability are unverified. This is not a service
                  quote.
                </p>
                <ul className="research-list">
                  {data.channel3.data.offers.map((o) => (
                    <li key={o.productId}>
                      <strong>{o.title}</strong>
                      <span>
                        {o.merchant} · {money(o.priceCents)} USD
                      </span>
                      {data.channel3.mode === "live" && source(o.url) && (
                        <a
                          href={o.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View retail offer
                          <span className="sr-only"> for {o.title}</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="small">
                  Checked{" "}
                  {new Date(data.channel3.data.checkedAt).toLocaleString(
                    "en-GB",
                  )}
                  . Prices can change. This research never changes your agreed
                  quote or payment.
                </p>
              </>
            ) : (
              <p role="status">
                {data.channel3.message ??
                  "Parts-price research is unavailable."}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
