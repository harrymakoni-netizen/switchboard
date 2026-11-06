"use client";
import { useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_SECONDS,
} from "../../../packages/shared/src/audio";
type Phase = "idle" | "permission" | "recording" | "transcribing";
export function VoiceRecorder({
  disabled,
  onTranscript,
  onBusyChange,
}: {
  disabled: boolean;
  onTranscript: (text: string) => boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const deadline = useRef<ReturnType<typeof setTimeout>>();
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  function cleanup() {
    clearInterval(timer.current);
    clearTimeout(deadline.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function status(next: Phase) {
    if (mounted.current) {
      setPhase(next);
      onBusyChange(next !== "idle");
    }
  }
  function fail(message: string) {
    if (mounted.current) {
      setError(message);
      status("idle");
    }
  }
  function cancel() {
    generation.current++;
    request.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    cleanup();
    status("idle");
    setNotice("Recording cancelled. Your typed request is unchanged.");
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      cleanup();
    };
  }, []);
  function stop() {
    if (recorder.current?.state !== "recording") return;
    status("transcribing");
    recorder.current.stop();
    cleanup();
  }
  async function start() {
    setError("");
    setNotice("");
    setElapsed(0);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined" ||
      typeof MediaRecorder.isTypeSupported !== "function"
    ) {
      fail(
        "Voice recording isn’t supported in this browser. Try a current version of Safari, Chrome or Edge, or type your request.",
      );
      return;
    }
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      fail(
        "This browser can’t create a supported recording. Please type your request.",
      );
      return;
    }
    const token = ++generation.current;
    status("permission");
    try {
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || token !== generation.current) {
        audio.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = audio;
      const recording = new MediaRecorder(audio, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      recorder.current = recording;
      const chunks: Blob[] = [];
      let total = 0;
      recording.ondataavailable = (event) => {
        if (token !== generation.current) return;
        if (event.data.size) {
          chunks.push(event.data);
          total += event.data.size;
        }
        if (total > MAX_RECORDING_BYTES) {
          cancel();
          setNotice("");
          fail("The recording is too large. Please record a shorter message.");
        }
      };
      recording.onerror = () => {
        if (token === generation.current) {
          cancel();
          setNotice("");
          fail("The microphone recording was interrupted. Please try again.");
        }
      };
      recording.onstop = async () => {
        if (!mounted.current || token !== generation.current) return;
        cleanup();
        recorder.current = null;
        const blob = new Blob(chunks, {
          type: recording.mimeType.split(";")[0],
        });
        if (!blob.size) {
          fail("No audio was recorded. Please try again.");
          return;
        }
        status("transcribing");
        const controller = new AbortController();
        request.current = controller;
        const form = new FormData();
        form.append("audio", blob, "request-audio");
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          const result = await response.json();
          if (!mounted.current || token !== generation.current) return;
          if (!response.ok)
            throw new Error(
              typeof result.error === "string"
                ? result.error
                : "The recording couldn’t be transcribed. Please try again.",
            );
          if (
            typeof result.transcript !== "string" ||
            !result.transcript.trim()
          )
            throw new Error("No clear speech was found. Please record again.");
          if (!onTranscript(result.transcript.trim()))
            throw new Error(
              "There isn’t enough room to add that recording. Shorten your typed request or record a shorter message.",
            );
          setNotice(
            "Recording added. Review and edit the text before finding quotes.",
          );
          status("idle");
        } catch (cause) {
          if (mounted.current && token === generation.current)
            fail(
              cause instanceof Error
                ? cause.message
                : "The recording couldn’t be transcribed. Please try again.",
            );
        } finally {
          if (request.current === controller) request.current = null;
        }
      };
      recording.start(1000);
      status("recording");
      const started = Date.now();
      timer.current = setInterval(
        () =>
          setElapsed(
            Math.min(
              MAX_RECORDING_SECONDS,
              Math.floor((Date.now() - started) / 1000),
            ),
          ),
        250,
      );
      deadline.current = setTimeout(stop, MAX_RECORDING_SECONDS * 1000);
    } catch (cause) {
      if (!mounted.current || token !== generation.current) return;
      cleanup();
      const name = cause instanceof Error ? cause.name : "";
      fail(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was blocked. Allow it in your browser’s site settings, then try again—or type your request."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one or type your request."
            : "The microphone couldn’t start. Check that another app isn’t using it, then try again.",
      );
    }
  }
  return (
    <div className="voice-input">
      <div className="voice-controls">
        <button
          type="button"
          className={
            "voice-record" + (phase === "recording" ? " is-recording" : "")
          }
          onClick={phase === "recording" ? stop : () => void start()}
          disabled={
            disabled || phase === "permission" || phase === "transcribing"
          }
          aria-describedby="voice-privacy"
          aria-pressed={phase === "recording"}
        >
          {phase === "recording" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect
                x="6"
                y="6"
                width="12"
                height="12"
                rx="2"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
          )}
          {phase === "recording"
            ? "Stop recording"
            : phase === "permission"
              ? "Allow microphone…"
              : phase === "transcribing"
                ? "Transcribing…"
                : "Record request"}
        </button>
        {phase === "recording" && (
          <span
            className="recording-clock"
            aria-label={`${elapsed} seconds recorded`}
          >
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} /
            1:00
          </span>
        )}
        {phase !== "idle" && (
          <button type="button" className="voice-cancel" onClick={cancel}>
            Cancel<span className="sr-only"> recording</span>
          </button>
        )}
      </div>
      <p id="voice-privacy" className="voice-help">
        Up to 60 seconds. Audio is sent to Gemini to turn into text; Switchboard
        doesn’t save the recording.
      </p>
      {(phase !== "idle" || notice) && (
        <p className="voice-status" role="status">
          {phase === "permission"
            ? "Allow microphone access in your browser to start."
            : phase === "recording"
              ? "Listening. Describe the repair, location, time and budget."
              : phase === "transcribing"
                ? "Turning your recording into text…"
                : notice}
        </p>
      )}
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
