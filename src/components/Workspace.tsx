"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import Image from "next/image";
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Eye,
  EyeOff,
  Flag,
  Gauge,
  ImagePlus,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  ScanLine,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Upload,
  X,
} from "lucide-react";
import { LocalRaceAnalyzer } from "@/lib/analyzer";
import { Filmstrip } from "./Filmstrip";
import type {
  CarObservation,
  ExposureInterval,
  LogoObservation,
  RunResult,
  SponsorReference,
  SpeedResult,
} from "@/lib/types";

type GatePoint = [number, number];
type IndexedObservation = { time: number; car: CarObservation };
type DisplayCar = {
  observation: CarObservation;
  interpolated: boolean;
  stableTrackId: boolean;
};
type OverlayPalette = {
  yellow: string;
  red: string;
  ink: string;
  outline: string;
  onDark: string;
  mono: string;
};

const DEMO_VIDEO = "/demo/baylands-race.webm";
const DEMO_NAME = "Baylands Raceway · practice laps";

export function Workspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speedDetailsRef = useRef<HTMLDetailsElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<LocalRaceAnalyzer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const referencePixels = useRef<ImageData | null>(null);
  const [videoUrl, setVideoUrl] = useState(DEMO_VIDEO);
  const [videoName, setVideoName] = useState(DEMO_NAME);
  const [duration, setDuration] = useState(10);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notice, setNotice] = useState("");
  const [reference, setReference] = useState<SponsorReference | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    stage: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [gateMode, setGateMode] = useState(false);
  const [gatePoints, setGatePoints] = useState<GatePoint[]>([]);
  const [gateDistance, setGateDistance] = useState(20);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [speedResult, setSpeedResult] = useState<SpeedResult | null>(null);
  const [selectedExposure, setSelectedExposure] =
    useState<ExposureInterval | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const logoSamples =
    result?.frames.reduce((sum, frame) => sum + frame.logos.length, 0) ?? 0;
  const carSamples =
    result?.frames.reduce((sum, frame) => sum + frame.cars.length, 0) ?? 0;
  const uniqueCars = new Set(
    result?.frames.flatMap((frame) => frame.cars.map((car) => car.trackId)) ??
      [],
  ).size;
  const running = progress !== null;
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
  const nearestFrame = result?.frames.reduce<
    (typeof result.frames)[number] | null
  >(
    (best, frame) =>
      !best ||
      Math.abs(frame.time - currentTime) < Math.abs(best.time - currentTime)
        ? frame
        : best,
    null,
  );

  useEffect(() => {
    if (!running || runStartedAt === null) return;
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running, runStartedAt]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      analyzerRef.current?.dispose();
    },
    [],
  );

  useEffect(
    () => () => {
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    },
    [videoObjectUrl],
  );

  useEffect(() => {
    if (!videoExpanded) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    playerRef.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setVideoExpanded(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        playerRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), input:not(:disabled)",
        ) ?? [],
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === playerRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      document.body.style.overflowY = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [videoExpanded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncReadiness = () => {
      const decoded =
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        Number.isFinite(video.duration);
      setVideoReady(decoded);
      if (video.videoWidth)
        setMediaSize({ width: video.videoWidth, height: video.videoHeight });
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    // Cached media may emit loadeddata before client hydration attaches handlers.
    const initialRead = requestAnimationFrame(syncReadiness);
    video.addEventListener("loadeddata", syncReadiness);
    video.addEventListener("canplay", syncReadiness);
    video.addEventListener("emptied", syncReadiness);
    return () => {
      cancelAnimationFrame(initialRead);
      video.removeEventListener("loadeddata", syncReadiness);
      video.removeEventListener("canplay", syncReadiness);
      video.removeEventListener("emptied", syncReadiness);
    };
  }, [videoUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const stage = stageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !video || !stage || !context) return;
    const tokens = getComputedStyle(document.documentElement);
    const palette: OverlayPalette = {
      yellow: tokens.getPropertyValue("--color-yellow").trim(),
      red: tokens.getPropertyValue("--color-red").trim(),
      ink: tokens.getPropertyValue("--color-ink").trim(),
      outline: tokens.getPropertyValue("--color-overlay-outline").trim(),
      onDark: tokens.getPropertyValue("--color-on-dark").trim(),
      mono: tokens.getPropertyValue("--font-mono").trim(),
    };
    let frame = 0;
    let lastUiUpdate = 0;
    const draw = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (video.videoWidth && video.videoHeight) {
        const scale = Math.min(
          rect.width / video.videoWidth,
          rect.height / video.videoHeight,
        );
        const shownWidth = video.videoWidth * scale;
        const shownHeight = video.videoHeight * scale;
        const offsetX = (rect.width - shownWidth) / 2;
        const offsetY = (rect.height - shownHeight) / 2;
        const now = video.currentTime;
        if (!video.paused && performance.now() - lastUiUpdate > 50) {
          setCurrentTime(now);
          lastUiUpdate = performance.now();
        }
        const sample =
          result?.frames.reduce<(typeof result.frames)[number] | null>(
            (best, candidate) =>
              !best ||
              Math.abs(candidate.time - now) < Math.abs(best.time - now)
                ? candidate
                : best,
            null,
          ) ?? null;
        const isSynchronized =
          !!sample &&
          Math.abs(sample.time - now) <=
            Math.min(0.16, 0.5 / (result?.sampleHz ?? 3));
        const position = (x: number, y: number) =>
          [
            offsetX + x * video.videoWidth * scale,
            offsetY + y * video.videoHeight * scale,
          ] as const;

        if (result && sample && overlaysVisible) {
          const occupiedLabels: Array<{
            x: number;
            y: number;
            width: number;
            height: number;
          }> = [];
          const histories = new Map<
            number,
            Array<{ x: number; y: number; time: number }>
          >();
          for (const observedFrame of result!.frames) {
            if (
              observedFrame.time < now - 1.6 ||
              observedFrame.time > now + 0.02
            )
              continue;
            for (const car of observedFrame.cars) {
              const points = histories.get(car.trackId) ?? [];
              points.push({
                x: car.x + car.width / 2,
                y: car.y + car.height / 2,
                time: observedFrame.time,
              });
              histories.set(car.trackId, points);
            }
          }
          for (const points of histories.values()) {
            if (points.length < 2) continue;
            for (let index = 1; index < points.length; index++) {
              if (
                points[index].time - points[index - 1].time > 0.75 ||
                Math.hypot(
                  points[index].x - points[index - 1].x,
                  points[index].y - points[index - 1].y,
                ) > 0.105
              )
                continue;
              const from = position(points[index - 1].x, points[index - 1].y);
              const to = position(points[index].x, points[index].y);
              const age = now - points[index].time;
              context.beginPath();
              context.moveTo(from[0], from[1]);
              context.lineTo(to[0], to[1]);
              context.lineWidth = 1.5;
              context.lineCap = "round";
              context.strokeStyle = palette.yellow;
              context.globalAlpha = Math.max(0.12, 0.6 - age * 0.35);
              context.stroke();
              context.globalAlpha = 1;
            }
          }
          for (const item of carsAtTime(result, now)) {
            const car = item.observation;
            const label = item.interpolated
              ? item.stableTrackId
                ? `C${String(car.trackId).padStart(2, "0")} EST`
                : "CAR EST"
              : `C${String(car.trackId).padStart(2, "0")} ${Math.round(car.detectorScore * 100)}%`;
            drawBox(
              context,
              car,
              position,
              palette.yellow,
              label,
              item.interpolated,
              palette,
              occupiedLabels,
            );
          }
          if (isSynchronized)
            for (const logo of sample.logos)
              drawBox(
                context,
                logo,
                position,
                palette.red,
                `${reference?.name ?? "SPONSOR"} · ${logo.inliers} pts`,
                false,
                palette,
                occupiedLabels,
              );
        }
        drawGateLines(context, gatePoints, position, palette);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [result, reference, gatePoints, overlaysVisible]);

  const handleVideoFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Choose a video file such as MP4 or WebM.");
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      setError("For this local browser demo, choose a clip under 250 MB.");
      return;
    }
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    const objectUrl = URL.createObjectURL(file);
    setVideoObjectUrl(objectUrl);
    setVideoUrl(objectUrl);
    setVideoName(file.name);
    setVideoReady(false);
    setCurrentTime(0);
    setPlaying(false);
    setResult(null);
    setSpeedResult(null);
    setSelectedExposure(null);
    setError("");
    setGatePoints([]);
    setGateMode(false);
    setNotice("");
  };

  const handleLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, or WebP logo image.");
      return;
    }
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG, or WebP logo under 5 MB.");
      return;
    }
    try {
      const image = await createImageBitmap(file);
      if (image.width * image.height > 16_000_000) {
        image.close();
        throw new Error(
          "Logo image exceeds 16 million pixels. Resize it first.",
        );
      }
      if (image.width < 20 || image.height < 12) {
        image.close();
        setError("Choose a sharper logo image at least 20 × 12 pixels.");
        return;
      }
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context)
        throw new Error("Image processing is unavailable in this browser.");
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      image.close();
      referencePixels.current = pixels;
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      if (reference) URL.revokeObjectURL(reference.previewUrl);
      setReference({
        id,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 32),
        previewUrl,
        width,
        height,
        fileName: file.name,
      });
      setResult(null);
      setSpeedResult(null);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not read this logo image.",
      );
    }
  };

  const runAnalysis = async () => {
    const video = videoRef.current;
    if (!video || !videoReady || running) return;
    setError("");
    setNotice("");
    setResult(null);
    setSpeedResult(null);
    setSelectedExposure(null);
    setGateMode(false);
    setGatePoints([]);
    if (video.duration > 30) {
      setError(
        "This browser demo samples clips up to 30 seconds. Trim the video and try again.",
      );
      return;
    }
    const resumeAt = video.currentTime;
    const wasPlaying = !video.paused;
    video.pause();
    setPlaying(false);
    const abort = new AbortController();
    abortRef.current = abort;
    setRunStartedAt(Date.now());
    setElapsedSeconds(0);
    const sampleHz = video.duration <= 12 ? 3 : 1;
    setProgress({
      current: 0,
      total: Math.ceil(video.duration * sampleHz),
      stage: "Loading local vision engine",
    });
    try {
      if (!analyzerRef.current) analyzerRef.current = new LocalRaceAnalyzer();
      const analyzer = analyzerRef.current;
      abort.signal.addEventListener(
        "abort",
        () =>
          analyzer.dispose(
            new DOMException("Analysis cancelled.", "AbortError"),
          ),
        { once: true },
      );
      await analyzer.setReference(reference, referencePixels.current);
      const analysis = await analyzer.analyze(
        video,
        reference ? [reference] : [],
        abort.signal,
        (current, total, stage) => setProgress({ current, total, stage }),
      );
      setResult(analysis);
      video.currentTime = Math.min(
        resumeAt,
        Math.max(0, video.duration - 0.01),
      );
      setCurrentTime(video.currentTime);
      if (wasPlaying) {
        try {
          await video.play();
        } catch {
          setPlaying(false);
        }
      }
    } catch (cause) {
      analyzerRef.current?.dispose();
      analyzerRef.current = null;
      if (cause instanceof DOMException && cause.name === "AbortError")
        setNotice("Run cancelled. Your clip is ready to analyze again.");
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Analysis could not complete. Try the sample clip or choose another video.",
        );
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const onTimeUpdate = () => {
    const time = videoRef.current?.currentTime ?? 0;
    setCurrentTime(time);
  };

  const onStageClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!gateMode || !stageRef.current || !videoRef.current) return;
    const stage = stageRef.current.getBoundingClientRect();
    const video = videoRef.current;
    const scale = Math.min(
      stage.width / video.videoWidth,
      stage.height / video.videoHeight,
    );
    const visibleW = video.videoWidth * scale,
      visibleH = video.videoHeight * scale;
    const left = (stage.width - visibleW) / 2,
      top = (stage.height - visibleH) / 2;
    const point: GatePoint = [
      clamp((event.clientX - stage.left - left) / visibleW),
      clamp((event.clientY - stage.top - top) / visibleH),
    ];
    const next = gatePoints.length >= 4 ? [point] : [...gatePoints, point];
    setGatePoints(next);
    if (next.length === 4) {
      setGateMode(false);
      if (result && cameraFixed && gateDistance > 0)
        setSpeedResult(estimateSpeed(result, next, gateDistance));
    }
  };

  const startGateCalibration = () => {
    setGatePoints([]);
    setSpeedResult(null);
    setGateMode(true);
    setError("");
    videoRef.current?.pause();
    setPlaying(false);
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, time));
    setCurrentTime(video.currentTime);
  };

  const selectExposure = (exposure: ExposureInterval) => {
    setSelectedExposure(exposure);
    seekTo(exposure.start);
  };

  const exportAnalysis = () => {
    if (!result) return;
    const payload = {
      product: "LapLens",
      source: { fileName: videoName, durationSeconds: result.duration },
      method: {
        engine: result.engine,
        sampleHz: result.sampleHz,
        elapsedMs: result.elapsedMs,
        note: "Browser-side sampled detections and logo-template matches. Exposure windows are estimated from observed samples.",
      },
      carDetections: { observations: carSamples, uniqueTrackIds: uniqueCars },
      sponsorReference: reference
        ? { name: reference.name, fileName: reference.fileName }
        : null,
      logoObservations: logoSamples,
      exposureWindows: result.exposures,
      frameObservations: result.frames,
      speedEstimate: speedResult,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "laplens-analysis.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setPlaying(true);
      } catch {
        setError("This video could not play in the current browser.");
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const seekFromLane = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo(clamp((event.clientX - rect.left) / rect.width) * duration);
  };

  const useSampleClip = () => {
    setVideoObjectUrl(null);
    setVideoUrl(DEMO_VIDEO);
    setVideoName(DEMO_NAME);
    setVideoReady(false);
    setResult(null);
    setSpeedResult(null);
    setSelectedExposure(null);
    setCurrentTime(0);
    setError("");
    setNotice("");
    setGatePoints([]);
    setGateMode(false);
  };

  return (
    <div className="app-shell pitwall">
      <aside
        inert={videoExpanded}
        className="tool-rail"
        aria-label="Workspace navigation"
      >
        <a className="rail-brand" href="#top" aria-label="LapLens home">
          <span />
          <span />
        </a>
        <nav className="tool-links">
          <a
            className="tool-link active"
            href="#analysis"
            aria-label="Video analysis"
            title="Video analysis"
          >
            <ScanLine size={20} />
          </a>
          <a
            className="tool-link"
            href="#sponsors"
            aria-label="Sponsor evidence"
            title="Sponsor evidence"
          >
            <Flag size={19} />
          </a>
          <a
            className="tool-link"
            href="#speed"
            aria-label="Speed calibration"
            title="Speed calibration"
            onClick={() => {
              if (speedDetailsRef.current) speedDetailsRef.current.open = true;
            }}
          >
            <Gauge size={20} />
          </a>
        </nav>
        <div className="rail-bottom">
          <details className="workspace-help">
            <summary aria-label="About this demo" title="About this demo">
              <CircleHelp size={20} />
            </summary>
            <div className="help-popover">
              <strong>Every finding has a frame.</strong>
              <p>
                LapLens samples racing footage for cars and supplied sponsor
                references. Track IDs can change; estimated boxes are dashed.
                Speed requires measured gates and a fixed camera.
              </p>
            </div>
          </details>
          <span className="rail-avatar" aria-label="Browser analysis">
            LL
          </span>
        </div>
      </aside>

      <div className="workspace" id="top">
        <header inert={videoExpanded} className="workspace-header">
          <a href="#top" className="workspace-wordmark">
            LAPLENS<span>MOTORSPORT ANALYSIS</span>
          </a>
          <div className="workspace-presence">
            <LockKeyhole size={13} />
            <span>Browser analysis</span>
          </div>
        </header>
        <main className="review-content" id="analysis">
          <div inert={videoExpanded} className="review-heading">
            <div>
              <p className="workspace-path">
                Workspace <ChevronRight size={12} /> Session review
              </p>
              <h1>Exposure review</h1>
              <p className="review-description">
                Follow the cars. Inspect the evidence behind every match.
              </p>
            </div>
            <div className="heading-actions">
              <input
                ref={videoInputRef}
                className="hidden-input"
                id="video-file"
                aria-label="Choose race video"
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                disabled={running}
                onChange={handleVideoFile}
              />
              <button
                className="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={running}
              >
                <Upload size={15} /> Choose clip
              </button>
              <button
                className="button export-button"
                disabled={!result || running}
                onClick={exportAnalysis}
                title={
                  result
                    ? "Download the measured analysis as JSON"
                    : "Analyze a clip to enable export"
                }
              >
                <ArrowDownToLine size={15} />
                <span>Export report</span>
              </button>
              <button
                className={`button primary${running ? " is-running" : ""}`}
                disabled={!videoReady}
                onClick={
                  running ? () => abortRef.current?.abort() : runAnalysis
                }
              >
                {running ? (
                  <>
                    <X size={16} /> Cancel run
                  </>
                ) : (
                  <>
                    <ScanLine size={16} /> Analyze clip
                  </>
                )}
              </button>
            </div>
          </div>

          {error ? (
            <div className="analysis-alert" role="alert">
              <AlertCircle size={19} />
              <div>
                <strong>Analysis needs your attention</strong>
                <p>{error}</p>
              </div>
              <button
                className="text-action"
                onClick={videoUrl === DEMO_VIDEO ? runAnalysis : useSampleClip}
                disabled={running || (videoUrl === DEMO_VIDEO && !videoReady)}
              >
                {videoUrl === DEMO_VIDEO ? "Try again" : "Use sample clip"}
                <ArrowUpRight size={14} />
              </button>
              <button
                className="quiet-icon"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="analysis-notice" role="status">
              <Check size={15} />
              {notice}
            </div>
          ) : null}

          <div className="review-grid">
            <section className="review-player-column" aria-label="Video review">
              <div
                ref={playerRef}
                className="video-panel"
                data-expanded={videoExpanded}
                role={videoExpanded ? "dialog" : "region"}
                aria-modal={videoExpanded || undefined}
                tabIndex={0}
                aria-label="Video player. Space to play or pause; arrow keys to seek."
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || running) return;
                  if (event.key === " ") {
                    event.preventDefault();
                    void togglePlayback();
                  }
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    seekTo(
                      currentTime + (event.key === "ArrowRight" ? 0.5 : -0.5),
                    );
                  }
                }}
              >
                <div className="video-head">
                  <div className="video-title">
                    <span className="live-square" />
                    <span title={videoName}>{videoName}</span>
                  </div>
                  <span className="video-meta">
                    {mediaSize.width
                      ? `${mediaSize.width} × ${mediaSize.height}`
                      : "LOADING VIDEO"}
                    <span className="meta-divider">/</span>
                    {duration.toFixed(1)} SEC
                  </span>
                </div>
                <div
                  ref={stageRef}
                  className={`stage${gateMode ? " gate-mode" : ""}`}
                >
                  <video
                    ref={videoRef}
                    crossOrigin="anonymous"
                    src={videoUrl}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      setDuration(
                        Number.isFinite(video.duration) ? video.duration : 0,
                      );
                      setMediaSize({
                        width: video.videoWidth,
                        height: video.videoHeight,
                      });
                      video.playbackRate = playbackRate;
                    }}
                    onLoadedData={() => setVideoReady(true)}
                    onError={() => {
                      setVideoReady(false);
                      setError(
                        "This video could not be decoded. Choose an MP4 or WebM with a browser-supported codec, or use the sample clip.",
                      );
                    }}
                    onTimeUpdate={onTimeUpdate}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                  />
                  <canvas
                    ref={canvasRef}
                    onClick={onStageClick}
                    aria-label={
                      gateMode
                        ? "Click four points to draw two speed gates"
                        : "Synchronized car detection overlay"
                    }
                  />
                  <div
                    className={`frame-status${running ? " processing" : ""}`}
                  >
                    <span className="status-square" />
                    {running
                      ? "ANALYSIS IN PROGRESS"
                      : result
                        ? overlaysVisible
                          ? "TRACKING OVERLAY"
                          : "CLEAN VIDEO"
                        : "UNANALYZED CLIP"}
                  </div>
                  {result && nearestFrame && overlaysVisible ? (
                    <div className="frame-readout">
                      {nearestFrame.cars.length} cars at{" "}
                      {formatPreciseTime(nearestFrame.time)}
                      <span>NEAREST SAMPLE</span>
                    </div>
                  ) : null}
                  {gateMode ? (
                    <div className="gate-instruction">
                      <Crosshair size={15} />
                      <span>
                        {gatePoints.length < 2
                          ? "Click two points for gate A"
                          : "Click two points for gate B"}
                      </span>
                      <button
                        onClick={() => {
                          setGateMode(false);
                          setGatePoints([]);
                        }}
                        aria-label="Cancel gate calibration"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="transport">
                  <button
                    className="play-button"
                    disabled={running || !videoReady}
                    onClick={togglePlayback}
                    aria-label={playing ? "Pause video" : "Play video"}
                  >
                    {playing ? (
                      <Pause size={16} fill="currentColor" />
                    ) : (
                      <Play size={16} fill="currentColor" />
                    )}
                  </button>
                  <div className="transport-steps">
                    <button
                      className="quiet-icon"
                      disabled={running || !videoReady}
                      onClick={() => seekTo(currentTime - 0.5)}
                      aria-label="Back half a second"
                    >
                      <SkipBack size={16} />
                    </button>
                    <button
                      className="quiet-icon"
                      disabled={running || !videoReady}
                      onClick={() => seekTo(currentTime + 0.5)}
                      aria-label="Forward half a second"
                    >
                      <SkipForward size={16} />
                    </button>
                  </div>
                  <span className="precise-time">
                    {formatPreciseTime(currentTime)}
                    <span> / {formatPreciseTime(duration)}</span>
                  </span>
                  <input
                    aria-label="Video timeline"
                    className="scrubber"
                    type="range"
                    min="0"
                    max={Math.max(0.01, duration)}
                    step="0.01"
                    value={Math.min(currentTime, duration)}
                    disabled={running || !videoReady}
                    onChange={(event) => seekTo(Number(event.target.value))}
                  />
                  <label className="playback-rate">
                    <span className="sr-only">Playback speed</span>
                    <select
                      value={playbackRate}
                      onChange={(event) => {
                        const rate = Number(event.target.value);
                        setPlaybackRate(rate);
                        if (videoRef.current)
                          videoRef.current.playbackRate = rate;
                      }}
                      disabled={running}
                    >
                      <option value="0.5">0.5×</option>
                      <option value="1">1×</option>
                      <option value="1.5">1.5×</option>
                      <option value="2">2×</option>
                    </select>
                  </label>
                  <button
                    className="quiet-icon overlay-control"
                    disabled={!result || running}
                    onClick={() => setOverlaysVisible((value) => !value)}
                    aria-label={
                      overlaysVisible
                        ? "Hide tracking overlay"
                        : "Show tracking overlay"
                    }
                    aria-pressed={overlaysVisible}
                    title={overlaysVisible ? "Hide overlay" : "Show overlay"}
                  >
                    {overlaysVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                  <button
                    className="quiet-icon"
                    onClick={() => setVideoExpanded((value) => !value)}
                    aria-label={
                      videoExpanded ? "Exit expanded video" : "Expand video"
                    }
                    title={
                      videoExpanded
                        ? "Exit expanded video (Esc)"
                        : "Expand video"
                    }
                  >
                    {videoExpanded ? (
                      <Minimize2 size={17} />
                    ) : (
                      <Maximize2 size={17} />
                    )}
                  </button>
                </div>
                {running ? (
                  <div
                    className="player-progress"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="running-indicator" />
                    <span>{progress.stage}</span>
                    <strong>
                      {progress.current}
                      <span> / {progress.total} frames</span>
                    </strong>
                    <div className="progress-bar">
                      <span
                        style={{
                          transform: `scaleX(${progressPercent / 100})`,
                        }}
                      />
                    </div>
                    <span className="elapsed">
                      {formatTime(elapsedSeconds)} elapsed
                    </span>
                  </div>
                ) : null}
              </div>

              <section
                inert={videoExpanded}
                className="session-timeline"
                aria-label="Analysis timeline"
              >
                <div className="timeline-heading">
                  <h2>Session timeline</h2>
                  <div className="timeline-legend">
                    <span>
                      <i className="legend-car" />
                      Cars
                    </span>
                    <span>
                      <i className="legend-sponsor" />
                      Sponsor matches
                    </span>
                  </div>
                </div>
                <Filmstrip
                  key={videoUrl}
                  src={videoUrl}
                  duration={duration}
                  currentTime={currentTime}
                  disabled={running}
                  onSeek={seekTo}
                />
                <div className="timeline-ruler">
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                    <span key={fraction}>
                      {formatPreciseTime(duration * fraction)}
                    </span>
                  ))}
                </div>
                <div className="timeline-lane">
                  <span className="lane-name">CARS</span>
                  <div className="lane-content">
                    <button
                      className="activity-lane"
                      disabled={running}
                      onClick={seekFromLane}
                      aria-label="Seek car detection timeline"
                    >
                      {result ? (
                        result.frames.map((frame, index) =>
                          frame.cars.length ? (
                            <span
                              className="activity-mark"
                              key={index}
                              style={{
                                left: `${(frame.time / Math.max(duration, 0.01)) * 100}%`,
                                height: `${Math.min(28, 8 + frame.cars.length * 3)}px`,
                              }}
                            />
                          ) : null,
                        )
                      ) : (
                        <span className="lane-empty">
                          Run analysis to see observed detections
                        </span>
                      )}
                    </button>
                    <span
                      className="lane-playhead"
                      style={{
                        left: `${clamp(currentTime / Math.max(duration, 0.01)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="timeline-lane">
                  <span className="lane-name">SPONSORS</span>
                  <div className="lane-content sponsor-lane">
                    {result?.exposures.map((exposure, index) => (
                      <button
                        key={`${exposure.sponsorId}-${index}`}
                        className={`exposure-mark${selectedExposure === exposure ? " selected" : ""}`}
                        style={{
                          left: `${(exposure.start / Math.max(duration, 0.01)) * 100}%`,
                          width: `${Math.max(1, ((exposure.end - exposure.start + 1 / result.sampleHz) / Math.max(duration, 0.01)) * 100)}%`,
                        }}
                        onClick={() => selectExposure(exposure)}
                        aria-label={`Exposure from ${formatTime(exposure.start)} to ${formatTime(exposure.end)}`}
                        title={`${reference?.name}: ${formatPreciseTime(exposure.start)}–${formatPreciseTime(exposure.end)}`}
                      />
                    ))}
                    {!result?.exposures.length ? (
                      <span className="lane-empty">
                        {!reference
                          ? "Add a logo reference to look for matching frames"
                          : result
                            ? "No qualifying visual matches in this run"
                            : "Logo matches will appear after analysis"}
                      </span>
                    ) : null}
                    <span
                      className="lane-playhead"
                      style={{
                        left: `${clamp(currentTime / Math.max(duration, 0.01)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="evidence-key">
                  <span className="observed-key" />
                  Observed box
                  <span className="estimate-key" />
                  Display estimate
                  <span className="evidence-key-note">
                    Estimates add no measured detections.
                  </span>
                </div>
              </section>
            </section>

            <aside
              inert={videoExpanded}
              className="analysis-desk"
              aria-label="Analysis details"
            >
              <div className="desk-title">
                <h2>Analysis desk</h2>
                <span
                  className={`desk-state${running ? " running" : result ? " complete" : ""}`}
                >
                  {running ? "RUNNING" : result ? "COMPLETE" : "READY"}
                </span>
              </div>
              <section className="desk-section run-state" aria-live="polite">
                <div className="section-kicker">
                  {running
                    ? "ANALYZING THIS CLIP"
                    : result
                      ? "REVIEW READY"
                      : "START YOUR REVIEW"}
                </div>
                <h3>
                  {running
                    ? `${progressPercent}% of frames analyzed`
                    : result
                      ? "The footage, examined."
                      : "Start with the footage."}
                </h3>
                <p>
                  {running
                    ? progress.current === 0
                      ? "Loading the local model. The first run can take longer."
                      : "Finding cars in sampled frames. Keep this tab open while the run finishes."
                    : result
                      ? `${result.frames.length} frames sampled at ${result.sampleHz} fps. Select a frame below the video to inspect the detections.`
                      : "Scan a short race clip for cars. Add a logo reference when you want to inspect sponsor visibility."}
                </p>
                {running ? (
                  <div className="desk-progress">
                    <div className="progress-bar">
                      <span
                        style={{
                          transform: `scaleX(${progressPercent / 100})`,
                        }}
                      />
                    </div>
                    <span>
                      {formatTime(elapsedSeconds)} elapsed{" "}
                      <span>
                        {progress.current} / {progress.total}
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="run-facts">
                    <span>
                      <span className="small-square" />
                      {result
                        ? `${(result.elapsedMs / 1000).toFixed(1)}s processing time`
                        : "1–30 seconds per clip"}
                    </span>
                    <span>
                      {result
                        ? result.engine.includes("WebGPU")
                          ? "WebGPU"
                          : "WASM"
                        : "On this device"}
                    </span>
                  </div>
                )}
              </section>

              <section className="desk-section vehicle-section">
                <div className="section-row">
                  <h3>Vehicle activity</h3>
                  <Activity size={17} />
                </div>
                <div className="activity-totals">
                  <div>
                    <strong>{result ? carSamples : "—"}</strong>
                    <span>car observations</span>
                  </div>
                  <div>
                    <strong>{result ? uniqueCars : "—"}</strong>
                    <span>track IDs</span>
                  </div>
                </div>
                <p className="desk-caption">
                  {result
                    ? "Track IDs may change through occlusion or camera cuts. They are not verified unique vehicles."
                    : "Measured counts appear when analysis completes."}
                </p>
              </section>

              <section className="desk-section sponsor-section" id="sponsors">
                <div className="section-row">
                  <h3>Sponsor evidence</h3>
                  <Flag size={17} />
                </div>
                <input
                  ref={logoInputRef}
                  className="hidden-input"
                  id="logo-file"
                  type="file"
                  aria-label="Choose sponsor logo reference"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={running}
                  onChange={handleLogoFile}
                />
                {reference ? (
                  <div className="sponsor-reference">
                    <Image
                      src={reference.previewUrl}
                      alt={`${reference.name} reference`}
                      width={44}
                      height={44}
                      unoptimized
                    />
                    <div>
                      <strong title={reference.name}>{reference.name}</strong>
                      <span>
                        {result
                          ? `${logoSamples} observed matches`
                          : "Reference ready"}
                      </span>
                    </div>
                    <button
                      className="quiet-icon"
                      disabled={running}
                      onClick={() => {
                        URL.revokeObjectURL(reference.previewUrl);
                        setReference(null);
                        referencePixels.current = null;
                        setResult(null);
                      }}
                      aria-label="Remove sponsor logo"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <>
                    <p>
                      Add a clear logo crop. LapLens looks for visual matches
                      inside detected cars.
                    </p>
                    <button
                      className="add-reference"
                      disabled={running}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <ImagePlus size={17} />
                      <span>Add logo reference</span>
                      <Plus size={15} />
                    </button>
                  </>
                )}
                {reference && result ? (
                  <div className="match-summary">
                    <strong>{logoSamples}</strong>
                    <span>
                      {logoSamples
                        ? `observed matches across ${result.exposures.length} exposure windows`
                        : "No qualifying visual matches. Try a sharper reference or closer footage."}
                    </span>
                  </div>
                ) : null}
                {result && !reference ? (
                  <div className="reference-needed">
                    <span className="small-square" />
                    Logo reference needed for sponsor results
                  </div>
                ) : null}
                {result?.exposures.length ? (
                  <div className="exposure-list">
                    {result.exposures.map((exposure, index) => (
                      <button
                        key={`${exposure.start}-${index}`}
                        className={`exposure-row${selectedExposure === exposure ? " active" : ""}`}
                        onClick={() => selectExposure(exposure)}
                      >
                        <span className="exposure-time">
                          {formatPreciseTime(exposure.start)}
                          <span>–</span>
                          {formatPreciseTime(exposure.end)}
                        </span>
                        <span>
                          {exposure.observations} matches
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {reference ? (
                  <button
                    className="text-action"
                    disabled={running}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    Change reference <ArrowUpRight size={13} />
                  </button>
                ) : null}
              </section>

              <details
                className="speed-disclosure"
                id="speed"
                ref={speedDetailsRef}
              >
                <summary>
                  <span className="section-row">
                    <span>
                      <Gauge size={18} />
                      Section speed
                    </span>
                    <ChevronDown size={16} />
                  </span>
                  <span className="disclosure-sub">
                    {speedResult
                      ? `${speedResult.speedKmh.toFixed(1)} km/h · section average`
                      : "Calibrate two measured gates"}
                  </span>
                </summary>
                <div className="speed-content">
                  {speedResult ? (
                    <>
                      <div className="speed-result">
                        <strong>
                          {speedResult.speedKmh.toFixed(1)}
                          <small> km/h</small>
                        </strong>
                        <span>
                          section average
                          <br />
                          Track {String(speedResult.trackId).padStart(2, "0")}
                        </span>
                      </div>
                      <p className="desk-caption">
                        Average between gate crossings. Camera movement or track
                        switches can invalidate this estimate.
                      </p>
                      <button
                        className="text-action"
                        onClick={() => {
                          setSpeedResult(null);
                          startGateCalibration();
                        }}
                      >
                        Recalibrate gates <Crosshair size={14} />
                      </button>
                    </>
                  ) : (
                    <div className="speed-setup">
                      <p>
                        Use a stationary camera and a known physical distance
                        between two lines across the track.
                      </p>
                      <label className="field">
                        Distance between gates
                        <span className="distance-control">
                          <input
                            type="number"
                            min="1"
                            max="500"
                            step="0.5"
                            value={gateDistance}
                            disabled={running}
                            onChange={(event) => {
                              setGateDistance(Number(event.target.value));
                              setSpeedResult(null);
                            }}
                          />
                          <span>metres</span>
                        </span>
                      </label>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={cameraFixed}
                          disabled={running}
                          onChange={(event) => {
                            setCameraFixed(event.target.checked);
                            setSpeedResult(null);
                          }}
                        />
                        <span>Camera stayed fixed through this section</span>
                      </label>
                      <div className="gate-status">
                        <span
                          className={`gate-dot${gatePoints.length >= 2 ? " set" : ""}`}
                        />
                        Gate A {gatePoints.length >= 2 ? "placed" : "not set"}
                        <span
                          className={`gate-dot${gatePoints.length >= 4 ? " set" : ""}`}
                        />
                        Gate B {gatePoints.length >= 4 ? "placed" : "not set"}
                      </div>
                      <button
                        className="button yellow full-width"
                        disabled={
                          !result ||
                          running ||
                          !cameraFixed ||
                          !Number.isFinite(gateDistance) ||
                          gateDistance <= 0 ||
                          gateMode
                        }
                        onClick={startGateCalibration}
                      >
                        <Crosshair size={15} />
                        {gateMode
                          ? "Place gates on footage"
                          : "Place gates on video"}
                      </button>
                      {!result ? (
                        <span className="desk-caption">
                          Run car detection to enable gate measurement.
                        </span>
                      ) : null}
                      {gatePoints.length === 4 && !speedResult && !gateMode ? (
                        <p className="error-note">
                          No track crossed both gates in order. Try a clearer
                          section of the clip.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </details>
              <div className="desk-privacy">
                <ShieldCheck size={15} />
                <span>
                  Private by design
                  <small>Your video stays on your device.</small>
                </span>
              </div>
            </aside>
          </div>
          <footer inert={videoExpanded} className="workspace-footer">
            <span>
              RF-DETR NANO <span className="footer-divider">/</span> SAMPLED
              BROWSER INFERENCE
            </span>
            {videoUrl === DEMO_VIDEO ? (
              <a
                href="https://commons.wikimedia.org/wiki/File:Salute_to_Baylands_Raceway_Park_-_July_8_2023_-_Sarah_Stierch.webm"
                target="_blank"
                rel="noreferrer"
              >
                Sample footage · Sarah Stierch · CC BY 4.0{" "}
                <ArrowUpRight size={12} />
              </a>
            ) : (
              <button
                className="text-action"
                disabled={running}
                onClick={useSampleClip}
              >
                Use sample clip <ArrowUpRight size={12} />
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function drawBox(
  context: CanvasRenderingContext2D,
  box: CarObservation | LogoObservation,
  position: (x: number, y: number) => readonly [number, number],
  color: string,
  label: string,
  interpolated: boolean,
  palette: OverlayPalette,
  occupied: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const [x, y] = position(box.x, box.y);
  const [right, bottom] = position(box.x + box.width, box.y + box.height);
  const width = right - x,
    height = bottom - y;
  const corner = Math.min(10, width / 3, height / 3);
  context.save();
  context.setLineDash(interpolated ? [3, 3] : []);
  context.beginPath();
  if (interpolated) context.rect(x, y, width, height);
  else {
    context.moveTo(x, y + corner);
    context.lineTo(x, y);
    context.lineTo(x + corner, y);
    context.moveTo(right - corner, y);
    context.lineTo(right, y);
    context.lineTo(right, y + corner);
    context.moveTo(right, bottom - corner);
    context.lineTo(right, bottom);
    context.lineTo(right - corner, bottom);
    context.moveTo(x + corner, bottom);
    context.lineTo(x, bottom);
    context.lineTo(x, bottom - corner);
  }
  context.strokeStyle = palette.outline;
  context.lineWidth = 3.5;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
  context.font = `400 10px ${palette.mono}`;
  const textWidth = context.measureText(label).width;
  const labelX = Math.max(
    3,
    Math.min(
      x,
      context.canvas.width / context.getTransform().a - textWidth - 12,
    ),
  );
  let labelY = Math.max(3, y - 19);
  const collides = () =>
    occupied.some(
      (other) =>
        labelX < other.x + other.width &&
        labelX + textWidth + 10 > other.x &&
        labelY < other.y + other.height &&
        labelY + 16 > other.y,
    );
  let attempts = 0;
  while (collides() && attempts < 4) {
    labelY = Math.max(3, labelY - 18);
    attempts++;
  }
  if (collides()) {
    context.restore();
    return;
  }
  occupied.push({ x: labelX, y: labelY, width: textWidth + 12, height: 18 });
  context.setLineDash([]);
  context.fillStyle = color;
  context.fillRect(labelX, labelY, textWidth + 10, 16);
  context.fillStyle = color === palette.red ? palette.onDark : palette.ink;
  context.fillText(label, labelX + 5, labelY + 11);
  context.restore();
}

function carsAtTime(result: RunResult, time: number) {
  const { frames, sampleHz } = result;
  const before = [...frames].reverse().find((frame) => frame.time <= time);
  const after = frames.find((frame) => frame.time >= time);
  if (!before && !after) return [];
  if (!before || !after || before === after) {
    const frame = before ?? after!;
    return Math.abs(frame.time - time) <= 0.52 / sampleHz
      ? frame.cars.map(
          (observation) =>
            ({
              observation,
              interpolated: false,
              stableTrackId: true,
            }) satisfies DisplayCar,
        )
      : [];
  }
  const gap = after.time - before.time;
  if (gap > 1.52 / sampleHz) return [];
  const fraction = clamp((time - before.time) / gap);
  const following = new Map(after.cars.map((car) => [car.trackId, car]));
  const displayed: DisplayCar[] = [];
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  for (const observation of before.cars) {
    const next = following.get(observation.trackId);
    if (!next) continue;
    usedBefore.add(observation.trackId);
    usedAfter.add(next.trackId);
    displayed.push(interpolateCar(observation, next, fraction, true));
  }

  // Detection confidence can change a track ID at a single frame. Bridge only
  // adjacent boxes with plausible overlap or center motion, and keep that bridge
  // display-only so measured track evidence is never rewritten.
  const candidates: Array<{
    before: CarObservation;
    after: CarObservation;
    cost: number;
  }> = [];
  for (const first of before.cars) {
    if (usedBefore.has(first.trackId)) continue;
    for (const second of after.cars) {
      if (usedAfter.has(second.trackId)) continue;
      const scale = Math.max(
        0.025,
        (first.width + first.height + second.width + second.height) / 4,
      );
      const distance = Math.hypot(
        first.x + first.width / 2 - second.x - second.width / 2,
        first.y + first.height / 2 - second.y - second.height / 2,
      );
      const overlap = boxIoU(first, second);
      if (overlap <= 0.01 && distance > Math.max(scale * 2.8, 0.035)) continue;
      candidates.push({
        before: first,
        after: second,
        cost: 1 - overlap + (distance / scale) * 0.72,
      });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const candidate of candidates) {
    if (
      usedBefore.has(candidate.before.trackId) ||
      usedAfter.has(candidate.after.trackId)
    )
      continue;
    usedBefore.add(candidate.before.trackId);
    usedAfter.add(candidate.after.trackId);
    displayed.push(
      interpolateCar(candidate.before, candidate.after, fraction, false),
    );
  }
  const nearSampleWindow = Math.min(0.08, 0.24 / sampleHz);
  if (time - before.time <= nearSampleWindow) {
    for (const car of before.cars) {
      if (!usedBefore.has(car.trackId))
        displayed.push({
          observation: car,
          interpolated: true,
          stableTrackId: false,
        });
    }
  }
  if (after.time - time <= nearSampleWindow) {
    for (const car of after.cars) {
      if (!usedAfter.has(car.trackId))
        displayed.push({
          observation: car,
          interpolated: true,
          stableTrackId: false,
        });
    }
  }
  return displayed;
}

function interpolateCar(
  before: CarObservation,
  after: CarObservation,
  fraction: number,
  stableTrackId: boolean,
): DisplayCar {
  return {
    observation: {
      ...before,
      x: lerp(before.x, after.x, fraction),
      y: lerp(before.y, after.y, fraction),
      width: lerp(before.width, after.width, fraction),
      height: lerp(before.height, after.height, fraction),
      detectorScore: Math.min(before.detectorScore, after.detectorScore),
    },
    interpolated: fraction > 0.025 && fraction < 0.975,
    stableTrackId,
  };
}

function boxIoU(a: CarObservation, b: CarObservation) {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  const intersection = width * height;
  return (
    intersection /
    Math.max(1e-8, a.width * a.height + b.width * b.height - intersection)
  );
}

function drawGateLines(
  context: CanvasRenderingContext2D,
  points: GatePoint[],
  position: (x: number, y: number) => readonly [number, number],
  palette: OverlayPalette,
) {
  for (let gate = 0; gate < Math.floor(points.length / 2); gate++) {
    const first = points[gate * 2],
      second = points[gate * 2 + 1];
    const a = position(first[0], first[1]),
      b = position(second[0], second[1]);
    context.save();
    context.strokeStyle = gate === 0 ? palette.yellow : palette.red;
    context.lineWidth = 2;
    context.setLineDash([8, 5]);
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(a[0], a[1], 4, 0, Math.PI * 2);
    context.arc(b[0], b[1], 4, 0, Math.PI * 2);
    context.fillStyle = gate === 0 ? palette.yellow : palette.red;
    context.fill();
    context.font = `400 10px ${palette.mono}`;
    context.fillText(gate === 0 ? "GATE A" : "GATE B", a[0] + 7, a[1] - 7);
    context.restore();
  }
  if (points.length % 2 === 1) {
    const a = position(points.at(-1)![0], points.at(-1)![1]);
    context.beginPath();
    context.arc(a[0], a[1], 5, 0, Math.PI * 2);
    context.fillStyle = palette.red;
    context.fill();
  }
}

function estimateSpeed(
  result: RunResult,
  gates: GatePoint[],
  distanceM: number,
): SpeedResult | null {
  const byTrack = new Map<number, IndexedObservation[]>();
  for (const frame of result.frames)
    for (const car of frame.cars) {
      const items = byTrack.get(car.trackId) ?? [];
      items.push({ time: frame.time, car });
      byTrack.set(car.trackId, items);
    }
  let best: SpeedResult | null = null;
  for (const [trackId, items] of byTrack) {
    items.sort((a, b) => a.time - b.time);
    let first: number | null = null,
      second: number | null = null;
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1],
        current = items[index];
      if (current.time - previous.time > 1.1) continue;
      const p: GatePoint = [
        previous.car.x + previous.car.width / 2,
        previous.car.y + previous.car.height / 2,
      ];
      const q: GatePoint = [
        current.car.x + current.car.width / 2,
        current.car.y + current.car.height / 2,
      ];
      if (first === null)
        first = crossingTime(
          p,
          q,
          gates[0],
          gates[1],
          previous.time,
          current.time,
        );
      else if (second === null && first !== null)
        second = crossingTime(
          p,
          q,
          gates[2],
          gates[3],
          previous.time,
          current.time,
        );
    }
    if (first === null || second === null || second <= first) continue;
    const seconds = second - first;
    if (seconds < 0.1 || seconds > 20) continue;
    const candidate = {
      trackId,
      firstTime: first,
      secondTime: second,
      distanceM,
      speedKmh: (distanceM / seconds) * 3.6,
    };
    if (!best || candidate.speedKmh < best.speedKmh) best = candidate;
  }
  return best;
}

function crossingTime(
  p: GatePoint,
  q: GatePoint,
  a: GatePoint,
  b: GatePoint,
  timeP: number,
  timeQ: number,
): number | null {
  const r: GatePoint = [q[0] - p[0], q[1] - p[1]],
    s: GatePoint = [b[0] - a[0], b[1] - a[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-8) return null;
  const ap: GatePoint = [a[0] - p[0], a[1] - p[1]];
  const t = (ap[0] * s[1] - ap[1] * s[0]) / denominator;
  const u = (ap[0] * r[1] - ap[1] * r[0]) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? timeP + (timeQ - timeP) * t
    : null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatPreciseTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${formatTime(safe)}.${String(Math.floor(safe * 100) % 100).padStart(2, "0")}`;
}
