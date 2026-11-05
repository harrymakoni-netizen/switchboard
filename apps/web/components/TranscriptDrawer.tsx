"use client";
import { useEffect, useRef, useState } from "react";
import type { TranscriptLine } from "@switchboard/shared";
export function TranscriptDrawer({
  jobId,
  callId,
  name,
  revision,
  simulated,
  onClose,
}: {
  jobId: string;
  callId: string;
  name: string;
  revision: number;
  simulated: boolean;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    close.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = original;
      if (before instanceof HTMLElement) before.focus();
    };
  }, [onClose]);
  useEffect(() => {
    if (!error && document.activeElement === document.body)
      close.current?.focus();
  }, [error]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/jobs/${jobId}/calls/${callId}/transcript`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            "The transcript couldn’t load. Retry to read the saved conversation.",
          );
        return r.json();
      })
      .then((data) => {
        if (active && Array.isArray(data)) {
          setLines(data);
          setError("");
        }
      })
      .catch((e: Error) => {
        if (active && e.name !== "AbortError") setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, callId, revision, attempt]);
  return (
    <div className="transcript-backdrop" onClick={onClose}>
      <section
        className="transcript"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const focusable = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), a[href]",
              ),
            );
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="drawer-heading">
          <div>
            <h2 id="transcript-title">{name}</h2>
            <p className="small">
              {simulated ? "Simulated conversation" : "Call transcript"} · AI
              disclosure included
            </p>
          </div>
          <button
            ref={close}
            className="secondary"
            onClick={onClose}
            aria-label="Close transcript"
          >
            Close
          </button>
        </div>
        {simulated && (
          <p className="transcript-disclosure">
            This conversation is scripted for the demo. Quote details are
            extracted from its text; no repair business was called.
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Retry transcript
            </button>
          </div>
        )}
        {lines.length === 0 ? (
          <p className="empty-note">Waiting for the conversation to begin…</p>
        ) : (
          lines.map((line, i) => (
            <div className={"transcript-line " + line.speaker} key={i}>
              <span className="speaker">
                {line.speaker === "agent" ? "Switchboard AI" : name} ·{" "}
                {new Date(line.at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Africa/Harare",
                })}
              </span>
              <p>{line.text}</p>
            </div>
          ))
        )}
        <p className="small">
          Text transcript · no audio recording · Harare time
        </p>
      </section>
    </div>
  );
}
