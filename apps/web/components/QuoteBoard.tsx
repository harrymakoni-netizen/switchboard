"use client";
import { useMemo, useEffect, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import type { Business, Quote, Call, State } from "@switchboard/shared";
ModuleRegistry.registerModules([AllCommunityModule]);
export interface BoardRow extends Business {
  quote?: Quote;
  call?: Omit<Call, "transcript">;
  priceCents: number | null;
  earliestSlot: string | null;
}
function slot(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Harare",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Time not confirmed";
}
function outsideWindow(value: string | null, start?: string, end?: string) {
  if (!value || !start || !end) return false;
  const date = new Date(value).getTime();
  return date < new Date(start).getTime() || date > new Date(end).getTime();
}
export function QuoteBoard({
  rows,
  budget,
  state,
  chosen,
  busy,
  payment,
  onListen,
  onBook,
  windowStart,
  windowEnd,
}: {
  rows: BoardRow[];
  budget: number;
  state: State;
  chosen: string | null;
  busy: boolean;
  payment: string;
  onListen: (row: BoardRow) => void;
  onBook: (id: string) => void;
  windowStart?: string;
  windowEnd?: string;
}) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width:650px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const columns = useMemo<ColDef<BoardRow>[]>(
    () => [
      {
        headerName: "Business",
        field: "name",
        minWidth: compact ? 190 : 220,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<BoardRow>) =>
          data && (
            <div>
              <div className="business-name">
                <span>{data.name}</span>
                {data.isBot && <span className="badge bot">DEMO</span>}
              </div>
              <div className="status-line">
                {data.isBot
                  ? data.rating
                    ? `Sample rating ${data.rating.toFixed(1)}/5`
                    : "Simulated provider"
                  : `${data.rating ? `${data.rating.toFixed(1)} / 5 · ` : ""}${data.phone}`}
              </div>
            </div>
          ),
      },
      {
        headerName: "Call",
        colId: "call",
        width: 130,
        hide: compact,
        cellRenderer: ({ data }: ICellRendererParams<BoardRow>) => (
          <span
            className={
              "badge " + (data?.call?.status === "in_progress" ? "live" : "")
            }
          >
            {data?.quote?.declined
              ? "declined"
              : (data?.call?.status?.replaceAll("_", " ") ?? "queued")}
          </span>
        ),
      },
      {
        headerName: "Price",
        field: "priceCents",
        width: 115,
        sort: "asc",
        sortIndex: 0,
        valueFormatter: (p) =>
          p.value === null || p.value === undefined
            ? "—"
            : "$" + (p.value / 100).toFixed(2),
        cellClass: (p) => (p.value > budget ? "money over-budget" : "money"),
      },
      {
        headerName: "Available",
        field: "earliestSlot",
        width: 180,
        sort: "asc",
        sortIndex: 1,
        cellRenderer: ({ data }: ICellRendererParams<BoardRow>) =>
          data && (
            <div>
              {slot(data.earliestSlot)}
              {outsideWindow(data.earliestSlot, windowStart, windowEnd) && (
                <div className="status-line quote-caution">
                  Outside your window
                </div>
              )}
            </div>
          ),
      },
      {
        headerName: "Includes",
        width: 180,
        valueGetter: (p) => p.data?.quote?.includes.join(", ") || "—",
      },
      {
        headerName: "Guarantee",
        width: 115,
        valueGetter: (p) => p.data?.quote?.guarantee ?? "—",
      },
      {
        headerName: "Confidence",
        width: 145,
        cellRenderer: ({ data }: ICellRendererParams<BoardRow>) =>
          data?.quote ? (
            data.quote.confidence < 0.7 ? (
              <button className="badge warn" onClick={() => onListen(data)}>
                Check transcript
              </button>
            ) : (
              <span>{Math.round(data.quote.confidence * 100)}%</span>
            )
          ) : (
            "—"
          ),
      },
      {
        headerName: "Actions",
        width: 174,
        pinned: compact ? undefined : "right",
        cellRenderer: ({ data }: ICellRendererParams<BoardRow>) =>
          data && (
            <div className="grid-actions">
              <button
                className="secondary"
                disabled={!data.call}
                onClick={() => onListen(data)}
              >
                Transcript
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  state !== "QUOTED" ||
                  data.priceCents === null ||
                  data.priceCents > budget ||
                  data.quote?.declined
                }
                onClick={() => data.quote && onBook(data.quote.id)}
              >
                {data.quote?.id === chosen ? "Chosen" : "Book"}
              </button>
            </div>
          ),
      },
      {
        headerName: "Payment",
        width: 130,
        valueGetter: (p) => (p.data?.quote?.id === chosen ? payment : "—"),
      },
    ],
    [
      budget,
      state,
      chosen,
      busy,
      payment,
      onListen,
      onBook,
      compact,
      windowStart,
      windowEnd,
    ],
  );
  const selected = rows.filter((r) => r.quote?.id === chosen);
  if (compact) {
    const ordered = [...rows].sort((a, b) => {
      if (a.quote?.id === chosen) return -1;
      if (b.quote?.id === chosen) return 1;
      const tier = (r: BoardRow) =>
        r.quote && !r.quote.declined && r.quote.confidence >= 0.7 ? 0 : 1;
      return (
        tier(a) - tier(b) ||
        (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity)
      );
    });
    return (
      <ul className="mobile-quotes" aria-label="Provider quotes">
        {ordered.map((row) => (
          <li
            key={row.id}
            className={row.quote?.id === chosen ? "selected" : ""}
          >
            <div className="mobile-quote-heading">
              <h3>{row.name}</h3>
              <strong className="quote-price">
                {row.quote?.declined
                  ? "Declined"
                  : row.priceCents === null
                    ? "Awaiting quote"
                    : `$${(row.priceCents / 100).toFixed(2)}`}
              </strong>
            </div>
            <p className="small">
              {row.quote?.id === chosen
                ? "Your chosen provider"
                : row.isBot
                  ? "Simulated demo provider"
                  : (row.call?.status.replaceAll("_", " ") ?? "Queued")}
            </p>
            {row.quote && !row.quote.declined && (
              <dl className="quote-facts">
                <div>
                  <dt>Available</dt>
                  <dd>{slot(row.earliestSlot)} · Harare</dd>
                </div>
                <div>
                  <dt>Includes</dt>
                  <dd>{row.quote.includes.join(", ") || "Not specified"}</dd>
                </div>
                <div>
                  <dt>Guarantee</dt>
                  <dd>{row.quote.guarantee || "Not specified"}</dd>
                </div>
              </dl>
            )}
            {outsideWindow(row.earliestSlot, windowStart, windowEnd) && (
              <p className="quote-caution">
                Outside your requested time window
              </p>
            )}
            {row.priceCents !== null && row.priceCents > budget && (
              <p className="quote-caution">
                Over your budget · booking unavailable
              </p>
            )}
            {row.quote && !row.quote.declined && row.quote.confidence < 0.7 && (
              <p className="quote-caution">
                Uncertain extraction · check the transcript
              </p>
            )}
            <div className="mobile-quote-actions">
              <button
                className="secondary"
                disabled={!row.call}
                onClick={() => onListen(row)}
              >
                Transcript<span className="sr-only"> for {row.name}</span>
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  state !== "QUOTED" ||
                  !row.quote ||
                  row.priceCents === null ||
                  row.priceCents > budget ||
                  row.quote.declined
                }
                onClick={() => row.quote && onBook(row.quote.id)}
              >
                {row.quote?.id === chosen ? "Chosen" : "Book"}
                <span className="sr-only"> {row.name}</span>
              </button>
            </div>
          </li>
        ))}
        {!ordered.length && <li>Finding demo providers…</li>}
      </ul>
    );
  }
  return (
    <div style={{ height: 390, width: "100%" }}>
      <AgGridReact<BoardRow>
        theme={themeQuartz.withParams({
          accentColor: "#1e44bb",
          fontFamily: "Public Sans, sans-serif",
          fontSize: 13,
          backgroundColor: "#ffffff",
          headerBackgroundColor: "#e9eff5",
          borderColor: "#d7e0e8",
          rowBorder: { color: "#e6edf3" },
        })}
        rowData={rows.filter((r) => r.quote?.id !== chosen)}
        pinnedTopRowData={selected}
        columnDefs={columns}
        getRowId={(p) => p.data.id}
        rowHeight={76}
        headerHeight={44}
        animateRows
        overlayNoRowsTemplate="<span>Finding local businesses…</span>"
        postSortRows={(p) => {
          const normal = p.nodes.filter(
            (n) =>
              n.data?.quote &&
              !n.data.quote.declined &&
              n.data.quote.confidence >= 0.7,
          );
          const rest = p.nodes.filter((n) => !normal.includes(n));
          p.nodes.splice(0, p.nodes.length, ...normal, ...rest);
        }}
      />
    </div>
  );
}
