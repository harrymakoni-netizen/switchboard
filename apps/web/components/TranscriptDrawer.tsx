"use client";
import { useEffect, useRef, useState } from "react";
import type { TranscriptLine } from "@switchboard/shared";
export function TranscriptDrawer({
  jobId,
  callId,
  name,
  revision,
  onClose,
}: {
  jobId: string;
  callId: string;
  name: string;
  revision: number;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    close.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void fetch(`/api/jobs/${jobId}/calls/${callId}/transcript`)
      .then((r) => r.json())
      .then((data) => {
        if (active && Array.isArray(data)) setLines(data);
      });
    return () => {
      active = false;
    };
  }, [jobId, callId, revision]);
  return (
    <div className="transcript-backdrop" onClick={onClose}>
      <section
        className="transcript"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            e.preventDefault();
            close.current?.focus();
          }
        }}
      >
        <div className="drawer-heading">
          <div>
            <h2 id="transcript-title">{name}</h2>
            <p className="small">Call transcript · AI disclosure included</p>
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
                })}
              </span>
              <p>{line.text}</p>
            </div>
          ))
        )}
        <p className="small">No audio recording is made in mock mode.</p>
      </section>
    </div>
  );
}
