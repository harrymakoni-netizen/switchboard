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
export function QuoteBoard({
  rows,
  budget,
  state,
  chosen,
  busy,
  payment,
  onListen,
  onBook,
}: {
  rows: BoardRow[];
  budget: number;
  state: State;
  chosen: string | null;
  busy: boolean;
  payment: string;
  onListen: (row: BoardRow) => void;
  onBook: (id: string) => void;
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
                {data.isBot && <span className="badge bot">BOT</span>}
              </div>
              <div className="status-line">
                {data.rating ? `${data.rating.toFixed(1)} / 5 · ` : ""}
                {data.phone}
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
            {data?.call?.status?.replaceAll("_", " ") ?? "queued"}
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
        headerName: "Earliest slot",
        field: "earliestSlot",
        width: 150,
        sort: "asc",
        sortIndex: 1,
        valueFormatter: (p) =>
          p.value
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Harare",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(p.value))
            : "—",
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
                Listen
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
    [budget, state, chosen, busy, payment, onListen, onBook, compact],
  );
  const selected = rows.filter((r) => r.quote?.id === chosen);
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
          normal.sort(
            (a, b) =>
              (a.data?.priceCents ?? Infinity) -
                (b.data?.priceCents ?? Infinity) ||
              new Date(a.data?.earliestSlot ?? "9999-01-01").getTime() -
                new Date(b.data?.earliestSlot ?? "9999-01-01").getTime(),
          );
          const rest = p.nodes.filter((n) => !normal.includes(n));
          p.nodes.splice(0, p.nodes.length, ...normal, ...rest);
        }}
      />
    </div>
  );
}
