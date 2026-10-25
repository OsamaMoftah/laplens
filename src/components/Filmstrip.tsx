"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type FramePreview = { time: number; image: string };

/** Uses a separate decoder so preview generation cannot seek the analysis video. */
export function Filmstrip({
  src,
  duration,
  currentTime,
  disabled,
  onSeek,
}: {
  src: string;
  duration: number;
  currentTime: number;
  disabled: boolean;
  onSeek: (time: number) => void;
}) {
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const selectedIndex = Math.min(
    5,
    Math.floor((currentTime / Math.max(duration, 0.01)) * 6),
  );

  useEffect(() => {
    const abort = new AbortController();
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 135;
    const context = canvas.getContext("2d");

    const capture = async () => {
      try {
        const ready = waitForMedia(video, "loadeddata", abort.signal);
        video.src = src;
        video.load();
        await ready;
        if (!context || !Number.isFinite(video.duration) || !video.videoWidth)
          throw new Error("Video dimensions unavailable.");
        const previews: FramePreview[] = [];
        for (let index = 0; index < 6; index++) {
          const time = Math.min(
            video.duration - 0.01,
            (video.duration * (index + 0.5)) / 6,
          );
          const sought = waitForMedia(video, "seeked", abort.signal);
          video.currentTime = time;
          await sought;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          previews.push({ time, image: canvas.toDataURL("image/jpeg", 0.7) });
        }
        if (!abort.signal.aborted) setFrames(previews);
      } catch {
        if (!abort.signal.aborted) setUnavailable(true);
      }
    };
    void capture();
    return () => {
      abort.abort();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return (
    <div className="filmstrip" role="group" aria-label="Video frame previews">
      {frames.length ? (
        frames.map((frame, index) => (
          <button
            key={index}
            className={`filmstrip-frame${index === selectedIndex ? " is-current" : ""}`}
            onClick={() => onSeek(frame.time)}
            disabled={disabled}
            aria-label={`Seek to ${frame.time.toFixed(2)} seconds`}
          >
            <Image
              src={frame.image}
              alt=""
              width={240}
              height={135}
              unoptimized
            />
            <span>{frame.time.toFixed(2)}s</span>
          </button>
        ))
      ) : (
        <div className="filmstrip-placeholder">
          {unavailable
            ? "Frame previews unavailable · use the timeline to seek"
            : "Preparing frame previews…"}
        </div>
      )}
    </div>
  );
}

function waitForMedia(
  video: HTMLVideoElement,
  event: string,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(event, success);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", cancelled);
    };
    const success = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Video preview could not decode."));
    };
    const cancelled = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timeout = window.setTimeout(failed, 10000);
    video.addEventListener(event, success, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}
