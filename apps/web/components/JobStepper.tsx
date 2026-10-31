import type { State } from "@switchboard/shared";
const states: State[] = [
  "FINDING",
  "CALLING",
  "QUOTED",
  "BOOK_APPROVED",
  "CONFIRMED",
  "AWAITING_COMPLETION",
  "CLOSED",
];
export function JobStepper({ state }: { state: State }) {
  const index =
    state === "FUNDS_HELD"
      ? 3
      : state === "COMPLETED" || state === "PAID_OUT"
        ? 6
        : states.indexOf(state);
  return (
    <ol className="stepper" aria-label="Job progress">
      {["Find", "Call", "Compare", "Book", "Confirm", "Done", "Paid"].map(
        (name, i) => (
          <li
            key={name}
            className={i === index ? "active" : i < index ? "passed" : ""}
            aria-current={i === index ? "step" : undefined}
          >
            <span className="number">{i < index ? "✓" : i + 1}</span>
            {name}
          </li>
        ),
      )}
    </ol>
  );
}
