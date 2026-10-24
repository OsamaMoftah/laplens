"use client";

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import Image from "next/image";
import { Activity, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleHelp, Crosshair, Gauge, ImagePlus, LockKeyhole, Pause, Play, Radar, ScanLine, ShieldCheck, Upload, X } from "lucide-react";
import { LocalRaceAnalyzer } from "@/lib/analyzer";
import type { CarObservation, ExposureInterval, LogoObservation, RunResult, SponsorReference, SpeedResult } from "@/lib/types";

type GatePoint = [number, number];
type IndexedObservation = { time: number; car: CarObservation };
type DisplayCar = { observation: CarObservation; interpolated: boolean; stableTrackId: boolean };

const DEMO_VIDEO = "/demo/baylands-race.webm";
const DEMO_NAME = "Baylands Raceway · practice laps";

export function Workspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const [reference, setReference] = useState<SponsorReference | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; stage: string } | null>(null);
  const [error, setError] = useState("");
  const [gateMode, setGateMode] = useState(false);
  const [gatePoints, setGatePoints] = useState<GatePoint[]>([]);
  const [gateDistance, setGateDistance] = useState(20);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [speedResult, setSpeedResult] = useState<SpeedResult | null>(null);
  const [selectedExposure, setSelectedExposure] = useState<ExposureInterval | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const logoSamples = result?.frames.reduce((sum, frame) => sum + frame.logos.length, 0) ?? 0;
  const carSamples = result?.frames.reduce((sum, frame) => sum + frame.cars.length, 0) ?? 0;
  const uniqueCars = new Set(result?.frames.flatMap(frame => frame.cars.map(car => car.trackId)) ?? []).size;

  useEffect(() => () => {
    abortRef.current?.abort();
    analyzerRef.current?.dispose();
  }, []);

  useEffect(() => () => { if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl); }, [videoObjectUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const stage = stageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !video || !stage || !context) return;
    let frame = 0;
    const draw = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (video.videoWidth && video.videoHeight) {
        const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
        const shownWidth = video.videoWidth * scale;
        const shownHeight = video.videoHeight * scale;
        const offsetX = (rect.width - shownWidth) / 2;
        const offsetY = (rect.height - shownHeight) / 2;
        const now = video.currentTime;
        const sample = result?.frames.reduce<(typeof result.frames)[number] | null>((best, candidate) =>
          !best || Math.abs(candidate.time - now) < Math.abs(best.time - now) ? candidate : best, null) ?? null;
        const isSynchronized = !!sample && Math.abs(sample.time - now) <= 0.29;
        const position = (x: number, y: number) => [offsetX + x * video.videoWidth * scale, offsetY + y * video.videoHeight * scale] as const;

        if (result && sample) {
          const histories = new Map<number, Array<{ x: number; y: number; time: number }>>();
          for (const observedFrame of result!.frames) {
            if (observedFrame.time < now - 1.6 || observedFrame.time > now + 0.02) continue;
            for (const car of observedFrame.cars) {
              const points = histories.get(car.trackId) ?? [];
              points.push({ x: car.x + car.width / 2, y: car.y + car.height / 2, time: observedFrame.time });
              histories.set(car.trackId, points);
            }
          }
          for (const points of histories.values()) {
            if (points.length < 2) continue;
            for (let index = 1; index < points.length; index++) {
              if (points[index].time - points[index - 1].time > 0.75 || Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) > 0.105) continue;
              const from = position(points[index - 1].x, points[index - 1].y);
              const to = position(points[index].x, points[index].y);
              const age = now - points[index].time;
              context.beginPath(); context.moveTo(from[0], from[1]); context.lineTo(to[0], to[1]);
              context.lineWidth = Math.max(1.5, 3.5 * scale);
              context.lineCap = "round"; context.strokeStyle = `rgba(242, 191, 69, ${Math.max(.12, .78 - age * .42)})`; context.stroke();
            }
          }
          for (const item of carsAtTime(result, now)) {
            const car = item.observation;
            const label = item.interpolated
              ? item.stableTrackId ? `CAR ${String(car.trackId).padStart(2, "0")} · EST` : "CAR · EST"
              : `CAR ${String(car.trackId).padStart(2, "0")} · ${Math.round(car.detectorScore * 100)}%`;
            drawBox(context, car, position, "#f0bf43", label, item.interpolated);
          }
          if (isSynchronized) for (const logo of sample.logos) drawBox(context, logo, position, "#e55b43", `${reference?.name ?? "SPONSOR"} · ${logo.inliers} pts`);
        }
        drawGateLines(context, gatePoints, position);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [result, reference, gatePoints]);

  const handleVideoFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("Choose a video file such as MP4 or WebM."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("For this local browser demo, choose a clip under 250 MB."); return; }
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    const objectUrl = URL.createObjectURL(file);
    setVideoObjectUrl(objectUrl);
    setVideoUrl(objectUrl);
    setVideoName(file.name);
    setResult(null); setSpeedResult(null); setSelectedExposure(null); setError("");
  };

  const handleLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose a PNG, JPEG, or WebP logo image."); return; }
    try {
      const image = await createImageBitmap(file);
      if (image.width < 20 || image.height < 12) { image.close(); setError("Choose a sharper logo image at least 20 × 12 pixels."); return; }
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Image processing is unavailable in this browser.");
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      image.close();
      referencePixels.current = pixels;
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      if (reference) URL.revokeObjectURL(reference.previewUrl);
      setReference({ id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 32), previewUrl, width, height, fileName: file.name });
      setResult(null); setSpeedResult(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read this logo image."); }
  };

  const runAnalysis = async () => {
    const video = videoRef.current;
    if (!video) return;
    setError(""); setResult(null); setSpeedResult(null); setSelectedExposure(null);
    if (video.duration > 30) { setError("This browser demo samples clips up to 30 seconds. Trim the video and try again."); return; }
    const resumeAt = video.currentTime;
    const wasPlaying = !video.paused;
    video.pause(); setPlaying(false);
    const abort = new AbortController(); abortRef.current = abort;
    const sampleHz = video.duration <= 12 ? 3 : 1;
    setProgress({ current: 0, total: Math.ceil(video.duration * sampleHz), stage: "Loading local vision engine" });
    try {
      if (!analyzerRef.current) analyzerRef.current = new LocalRaceAnalyzer();
      const analyzer = analyzerRef.current;
      if (reference && referencePixels.current) await analyzer.addReference(reference, referencePixels.current);
      const analysis = await analyzer.analyze(video, reference ? [reference] : [], abort.signal, (current, total, stage) => setProgress({ current, total, stage }));
      setResult(analysis);
      video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - .01));
      setCurrentTime(video.currentTime);
      if (wasPlaying) { try { await video.play(); } catch { setPlaying(false); } }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Analysis could not complete.");
    } finally { abortRef.current = null; setProgress(null); }
  };

  const onTimeUpdate = () => {
    const time = videoRef.current?.currentTime ?? 0;
    setCurrentTime(time);
  };

  const onStageClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!gateMode || !stageRef.current || !videoRef.current) return;
    const stage = stageRef.current.getBoundingClientRect();
    const video = videoRef.current;
    const scale = Math.min(stage.width / video.videoWidth, stage.height / video.videoHeight);
    const visibleW = video.videoWidth * scale, visibleH = video.videoHeight * scale;
    const left = (stage.width - visibleW) / 2, top = (stage.height - visibleH) / 2;
    const point: GatePoint = [clamp((event.clientX - stage.left - left) / visibleW), clamp((event.clientY - stage.top - top) / visibleH)];
    const next = gatePoints.length >= 4 ? [point] : [...gatePoints, point];
    setGatePoints(next);
    if (next.length === 4) {
      setGateMode(false);
      if (result && cameraFixed && gateDistance > 0) setSpeedResult(estimateSpeed(result, next, gateDistance));
    }
  };

  const startGateCalibration = () => {
    setGatePoints([]); setSpeedResult(null); setGateMode(true); setError("");
    videoRef.current?.pause(); setPlaying(false);
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, time));
    setCurrentTime(video.currentTime);
  };

  const selectExposure = (exposure: ExposureInterval) => {
    setSelectedExposure(exposure); seekTo(exposure.start);
  };

  const exportAnalysis = () => {
    if (!result) return;
    const payload = {
      product: "LapLens",
      source: { fileName: videoName, durationSeconds: result.duration },
      method: { engine: result.engine, sampleHz: result.sampleHz, elapsedMs: result.elapsedMs, note: "Browser-side sampled detections and logo-template matches. Exposure windows are estimated from observed samples." },
      carDetections: { observations: carSamples, uniqueTrackIds: uniqueCars },
      sponsorReference: reference ? { name: reference.name, fileName: reference.fileName } : null,
      logoObservations: logoSamples,
      exposureWindows: result.exposures,
      frameObservations: result.frames,
      speedEstimate: speedResult,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "laplens-analysis.json"; document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { try { await video.play(); setPlaying(true); } catch { setError("This video could not play in the current browser."); } }
    else { video.pause(); setPlaying(false); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="LapLens home">
        <span className="brand-mark"><Radar size={19} strokeWidth={2.4} /></span>
        <span className="brand-copy"><span className="brand-name">LapLens</span><span className="brand-caption">RACE EXPOSURE LAB</span></span>
      </a>
      <div className="rail-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Workspace sections">
        <a className="rail-link active" href="#analysis"><ScanLine size={17} /><span>Analysis</span></a>
        <a className="rail-link" href="#sponsors"><Activity size={17} /><span>Sponsor marks</span></a>
        <a className="rail-link" href="#speed"><Gauge size={17} /><span>Speed estimate</span></a>
      </nav>
      <div className="rail-spacer" />
      <div className="privacy-note"><strong><LockKeyhole size={13} /> Runs on this device</strong>Video and logo files stay in your browser.</div>
      <details className="help-details"><summary className="icon-button" aria-label="About this demo"><CircleHelp size={17} /></summary><div className="help-popover"><strong>About LapLens</strong><p>Sampled computer vision for racing footage. Findings are limited to what is visible in each decoded frame.</p></div></details>
    </aside>

    <div className="workspace" id="top">
      <header className="topbar">
        <div className="crumbs"><span>Workspace</span><ChevronRight size={14} /><strong>Exposure review</strong></div>
        <div className="top-actions"><span className="status-pill"><span className="status-dot" /> Local analysis</span><span className="top-avatar" aria-label="Local workspace">LL</span></div>
      </header>
      <main className="content" id="analysis">
        <div className="page-heading">
          <div><div className="eyebrow"><span className="eyebrow-rule" /> MOTORSPORT INTELLIGENCE <span className="eyebrow-rule" /></div><h1>Exposure review</h1><p>See when a sponsor is visible, and inspect the frame evidence behind each match.</p></div>
          <div className="heading-actions">
            <label className="button" htmlFor="video-file"><Upload size={15} /> Choose clip</label>
            <input className="hidden-input" id="video-file" type="file" accept="video/mp4,video/webm,video/quicktime,video/*" onChange={handleVideoFile} />
            {result ? <button className="button" onClick={exportAnalysis}><ArrowDownToLine size={15} /> Export report</button> : null}
            <button className="button primary" onClick={progress ? () => abortRef.current?.abort() : runAnalysis}>
              {progress ? <><X size={15} /> Cancel</> : <><ScanLine size={15} /> Analyze clip</>}
            </button>
          </div>
        </div>

        <div className="run-summary"><span><span className="summary-dot yellow" /> Source <strong>{videoName}</strong></span><span className="bullet" /><span>Up to 30 sec</span><span className="bullet" /><span>{result ? `${result.sampleHz} frames/sec` : "Up to 3 frames/sec"}</span>{result ? <><span className="bullet" /><span>Processed <strong>{(result.elapsedMs / 1000).toFixed(1)}s</strong></span></> : null}</div>

        <div className="main-grid">
          <section className="left-stack" aria-label="Video review">
            <div className="video-panel">
              <div className="video-head"><div className="video-title"><span className="live-square" /><span title={videoName}>{videoName}</span></div><span className="video-meta">{result ? `${result.width} × ${result.height} · SAMPLED` : "VIDEO EVIDENCE"}</span></div>
              <div ref={stageRef} className={`stage${gateMode ? " gate-mode" : ""}`}>
                <video ref={videoRef} src={videoUrl} playsInline preload="metadata" onLoadedMetadata={event => setDuration(event.currentTarget.duration || 10)} onTimeUpdate={onTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
                <canvas ref={canvasRef} onClick={onStageClick} aria-label={gateMode ? "Click four points to draw two speed gates" : "Synchronized car detection overlay"} />
                {!result && !progress ? <div className="overlay-tip"><span className="tip-mark"><Crosshair size={14} /></span><span>Analysis overlay appears here</span></div> : null}
                {gateMode ? <div className="gate-instruction"><Crosshair size={15} /><span>{gatePoints.length < 2 ? "Click two points for gate A" : gatePoints.length < 4 ? "Click two points for gate B" : "Saving gates…"}</span><button onClick={() => { setGateMode(false); setGatePoints([]); }} aria-label="Cancel gate calibration"><X size={14} /></button></div> : null}
                {result && !reference ? <div className="frame-badge"><Check size={12} /> {carSamples} observed car samples</div> : null}
              </div>
              <div className="video-controls">
                <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause video" : "Play video"}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
                <input aria-label="Video timeline" className="scrubber" type="range" min="0" max={Math.max(.01, duration)} step="0.01" value={Math.min(currentTime, duration)} onChange={event => seekTo(Number(event.target.value))} />
                <span className="timecode">{formatTime(currentTime)} <span>/</span> {formatTime(duration)}</span>
                <button className="video-control-button" onClick={() => seekTo(currentTime + .5)}><span>+0.5s</span><ArrowUpRight size={13} /></button>
              </div>
              {progress ? <div className="progress-wrap" role="status" aria-live="polite"><div className="progress-copy"><span>{progress.stage}…</span><strong>{progress.current} / {progress.total}</strong></div><div className="progress-bar"><span style={{ width: `${Math.min(100, progress.total ? progress.current / progress.total * 100 : 6)}%` }} /></div></div> : null}
            </div>

            <section className="timeline" aria-label="Observed sponsor exposure windows">
              <div className="timeline-top"><h2 className="panel-title">Exposure timeline</h2><span className="micro-label">{result ? `${result.exposures.length} OBSERVED WINDOWS` : "RUN ANALYSIS TO POPULATE"}</span></div>
              <div className="timeline-track" aria-label="Sponsor exposure events">
                {result?.exposures.map((exposure, index) => (
                  <button
                    key={`${exposure.sponsorId}-${exposure.start}-${index}`}
                    title={`${reference?.name ?? "Sponsor"}: ${formatTime(exposure.start)}–${formatTime(exposure.end)}`}
                    className={`timeline-segment${selectedExposure === exposure ? " selected" : ""}`}
                    style={{
                      left: `${exposure.start / Math.max(duration, .01) * 100}%`,
                      width: `${Math.max(.7, (exposure.end - exposure.start + .5) / Math.max(duration, .01) * 100)}%`,
                    }}
                    onClick={() => selectExposure(exposure)}
                    aria-label={`Exposure from ${formatTime(exposure.start)} to ${formatTime(exposure.end)}`}
                  />
                ))}
                <span className="timeline-playhead" style={{ left: `${currentTime / Math.max(duration, .01) * 100}%` }} />
              </div>
              <div className="timeline-ticks"><span>00:00</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration)}</span></div>
            </section>

            <div className="source-line"><span>Solid boxes are observed detections; dashed boxes are best-effort estimates between samples. Logo evidence is time-locked to measured frames.</span><a href="https://commons.wikimedia.org/wiki/File:Salute_to_Baylands_Raceway_Park_-_July_8_2023_-_Sarah_Stierch.webm" target="_blank" rel="noreferrer">Sample footage: Sarah Stierch · CC BY 4.0</a></div>
          </section>

          <aside className="side-panel" aria-label="Analysis details">
            <section className="side-section" id="sponsors">
              <div className="side-heading"><div><div className="micro-label">SPONSOR INTELLIGENCE</div><h2 className="panel-title">Logo evidence</h2></div><label className="icon-button" htmlFor="logo-file" title="Add logo reference"><ImagePlus size={17} /><span className="sr-only">Add sponsor logo reference</span></label></div>
              <input className="hidden-input" id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoFile} />
              {reference ? <div className="sponsor-entry"><Image className="sponsor-thumb" src={reference.previewUrl} alt={`${reference.name} reference`} width={38} height={38} unoptimized /><div className="sponsor-info"><div className="sponsor-name" title={reference.name}>{reference.name}</div><div className="sponsor-sub">{result ? `${logoSamples} frame matches · ${result.sampleHz} Hz` : "Ready to scan"}</div></div><button className="remove-ref" onClick={() => { URL.revokeObjectURL(reference.previewUrl); setReference(null); referencePixels.current = null; setResult(null); }} aria-label="Remove sponsor logo"><X size={14} /></button></div> : <label className="reference-drop" htmlFor="logo-file"><ImagePlus size={18} /><strong>Add a logo reference</strong><span>Tight, clear crop works best. Stays on this device.</span></label>}
              <div className="metric-rule" />
              <div className="metric-kicker">OBSERVED LOGO MATCHES</div>
              <div className="metric-value">{result ? logoSamples : "—"}<em>{result && logoSamples > 0 ? "*" : ""}</em></div>
              <div className="metric-description">{result ? logoSamples ? "Feature matches seen in sampled frames" : "No qualifying template matches found" : "Counted only after adding a reference"}</div>
              {result && result.exposures.length ? <div className="exposure-list">{result.exposures.map((exposure, index) => <button className={`exposure-row${selectedExposure === exposure ? " active" : ""}`} key={`${exposure.start}-${index}`} onClick={() => selectExposure(exposure)}><span className="exposure-time">{formatTime(exposure.start)} <span>–</span> {formatTime(exposure.end)}</span><span>{exposure.observations} samples <ChevronRight size={13} /></span></button>)}</div> : result ? <p className="empty-copy">No sponsor identity was confirmed by the reference matcher. Change the crop or inspect a closer view.</p> : <p className="empty-copy">Detection uses car shape; sponsor identity needs your supplied visual reference. Matching is not OCR.</p>}
            </section>

            <section className="side-section">
              <div className="side-heading"><div><div className="micro-label">VEHICLE DETECTION</div><h2 className="panel-title">Frame activity</h2></div><span className="mini-icon yellow-icon"><Radar size={15} /></span></div>
              <div className="stat-pair"><div><div className="metric-value compact">{result ? uniqueCars : "—"}</div><div className="metric-description">track IDs seen</div></div><div><div className="metric-value compact">{result ? carSamples : "—"}</div><div className="metric-description">car observations</div></div></div>
              <div className="method-note"><span className="method-chip">RF-DETR NANO</span><span>{result ? result.engine.includes("WebGPU") ? "COCO car class · WebGPU" : "COCO car class · WASM" : "WebGPU when available · WASM fallback"}</span></div>
              <p className="note">Track IDs are lightweight frame-to-frame associations. They may change during occlusion or camera cuts.</p>
            </section>

            <section className="side-section" id="speed">
              <div className="side-heading"><div><div className="micro-label">CALIBRATED MEASUREMENT</div><h2 className="panel-title">Section speed</h2></div><span className="mini-icon red-icon"><Gauge size={15} /></span></div>
              {speedResult ? <div className="speed-result"><strong>{speedResult.speedKmh.toFixed(1)}<small> km/h</small></strong><span>section average<br />Track {String(speedResult.trackId).padStart(2, "0")}</span></div> : <div className="speed-setup">
                <p className="note">Measure average speed between two track gates. Requires a stationary camera and a known gate distance.</p>
                <label className="field">Distance between gates <span className="distance-control"><input type="number" min="1" max="500" step="0.5" value={gateDistance} onChange={event => { setGateDistance(Number(event.target.value)); setSpeedResult(null); }} /><span>metres</span></span></label>
                <label className="check-row"><input type="checkbox" checked={cameraFixed} onChange={event => { setCameraFixed(event.target.checked); setSpeedResult(null); }} /> Camera stayed fixed through this section</label>
                <div className="gate-status"><span className={`gate-dot${gatePoints.length >= 2 ? " set" : ""}`} /> Gate A {gatePoints.length >= 2 ? "placed" : "not set"}<span className={`gate-dot${gatePoints.length >= 4 ? " set" : ""}`} /> Gate B {gatePoints.length >= 4 ? "placed" : "not set"}</div>
                <button className="button yellow full-width" disabled={!result || !cameraFixed || gateDistance <= 0 || gateMode} onClick={startGateCalibration}><Crosshair size={14} /> {gateMode ? "Click gates on video" : "Place gates on video"}</button>
                {gatePoints.length === 4 && !speedResult && !gateMode ? <p className="error-note">No observed track crossed both gates in order. Try gates across a clearer, closer part of the lap.</p> : null}
                {!result ? <div className="speed-lock"><LockKeyhole size={13} /> Run car detection before calibrating.</div> : null}
              </div>}
              {speedResult ? <><p className="note speed-caveat">Average between the two gate crossings. Not an instantaneous speed readout.</p><button className="inline-action" onClick={() => { setSpeedResult(null); startGateCalibration(); }}><Crosshair size={13} /> Recalibrate gates</button></> : null}
            </section>

            <section className="side-foot"><span><ShieldCheck size={14} /> PRIVATE BY DESIGN</span><span>Files remain in your browser</span></section>
          </aside>
        </div>
        {error ? <div className="global-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss message"><X size={15} /></button></div> : null}
        {result ? <div className="run-footer"><span><Check size={13} /> Analysis complete in {(result.elapsedMs / 1000).toFixed(1)} seconds</span><span>{logoSamples ? `${logoSamples} logo observations across ${result.exposures.length} windows` : `${carSamples} car observations · no sponsor matches${reference ? "" : " (no logo reference supplied)"}`}</span></div> : null}
      </main>
    </div>
  </div>;
}

function drawBox(context: CanvasRenderingContext2D, box: CarObservation | LogoObservation, position: (x: number, y: number) => readonly [number, number], color: string, label: string, interpolated = false) {
  const [x, y] = position(box.x, box.y); const [right, bottom] = position(box.x + box.width, box.y + box.height);
  const width = right - x, height = bottom - y;
  context.save(); context.setLineDash(interpolated ? [5, 4] : []);
  context.strokeStyle = "rgba(24, 20, 16, .9)"; context.lineWidth = 5; context.strokeRect(x, y, width, height);
  context.strokeStyle = color; context.lineWidth = 2.4; context.strokeRect(x, y, width, height);
  context.font = "600 11px 'SFMono-Regular', Consolas, monospace";
  const textWidth = context.measureText(label).width;
  context.setLineDash([]); context.fillStyle = color; context.fillRect(x, Math.max(3, y - 20), textWidth + 12, 19);
  context.fillStyle = "#211c16"; context.fillText(label, x + 6, Math.max(16, y - 7)); context.restore();
}

function carsAtTime(result: RunResult, time: number) {
  const { frames, sampleHz } = result;
  const before = [...frames].reverse().find(frame => frame.time <= time);
  const after = frames.find(frame => frame.time >= time);
  if (!before && !after) return [];
  if (!before || !after || before === after) {
    const frame = before ?? after!;
    return Math.abs(frame.time - time) <= 0.52 / sampleHz
      ? frame.cars.map(observation => ({ observation, interpolated: false, stableTrackId: true } satisfies DisplayCar))
      : [];
  }
  const gap = after.time - before.time;
  if (gap > 1.52 / sampleHz) return [];
  const fraction = clamp((time - before.time) / gap);
  const following = new Map(after.cars.map(car => [car.trackId, car]));
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
  const candidates: Array<{ before: CarObservation; after: CarObservation; cost: number }> = [];
  for (const first of before.cars) {
    if (usedBefore.has(first.trackId)) continue;
    for (const second of after.cars) {
      if (usedAfter.has(second.trackId)) continue;
      const scale = Math.max(0.025, (first.width + first.height + second.width + second.height) / 4);
      const distance = Math.hypot(first.x + first.width / 2 - second.x - second.width / 2, first.y + first.height / 2 - second.y - second.height / 2);
      const overlap = boxIoU(first, second);
      if (overlap <= 0.01 && distance > Math.max(scale * 2.8, 0.035)) continue;
      candidates.push({ before: first, after: second, cost: 1 - overlap + distance / scale * 0.72 });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const candidate of candidates) {
    if (usedBefore.has(candidate.before.trackId) || usedAfter.has(candidate.after.trackId)) continue;
    usedBefore.add(candidate.before.trackId);
    usedAfter.add(candidate.after.trackId);
    displayed.push(interpolateCar(candidate.before, candidate.after, fraction, false));
  }
  const nearSampleWindow = Math.min(0.08, 0.24 / sampleHz);
  if (time - before.time <= nearSampleWindow) {
    for (const car of before.cars) {
      if (!usedBefore.has(car.trackId)) displayed.push({ observation: car, interpolated: true, stableTrackId: false });
    }
  }
  if (after.time - time <= nearSampleWindow) {
    for (const car of after.cars) {
      if (!usedAfter.has(car.trackId)) displayed.push({ observation: car, interpolated: true, stableTrackId: false });
    }
  }
  return displayed;
}

function interpolateCar(before: CarObservation, after: CarObservation, fraction: number, stableTrackId: boolean): DisplayCar {
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
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / Math.max(1e-8, a.width * a.height + b.width * b.height - intersection);
}

function drawGateLines(context: CanvasRenderingContext2D, points: GatePoint[], position: (x: number, y: number) => readonly [number, number]) {
  for (let gate = 0; gate < Math.floor(points.length / 2); gate++) {
    const first = points[gate * 2], second = points[gate * 2 + 1];
    const a = position(first[0], first[1]), b = position(second[0], second[1]);
    context.save(); context.strokeStyle = gate === 0 ? "#f0bf43" : "#e55b43"; context.lineWidth = 3; context.setLineDash([8, 5]);
    context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke();
    context.setLineDash([]); context.beginPath(); context.arc(a[0], a[1], 4, 0, Math.PI * 2); context.arc(b[0], b[1], 4, 0, Math.PI * 2); context.fillStyle = gate === 0 ? "#f0bf43" : "#e55b43"; context.fill();
    context.font = "600 10px 'SFMono-Regular', Consolas, monospace"; context.fillText(gate === 0 ? "GATE A" : "GATE B", a[0] + 7, a[1] - 7); context.restore();
  }
  if (points.length % 2 === 1) {
    const a = position(points.at(-1)![0], points.at(-1)![1]); context.beginPath(); context.arc(a[0], a[1], 5, 0, Math.PI * 2); context.fillStyle = "#e55b43"; context.fill();
  }
}

function estimateSpeed(result: RunResult, gates: GatePoint[], distanceM: number): SpeedResult | null {
  const byTrack = new Map<number, IndexedObservation[]>();
  for (const frame of result.frames) for (const car of frame.cars) {
    const items = byTrack.get(car.trackId) ?? [];
    items.push({ time: frame.time, car }); byTrack.set(car.trackId, items);
  }
  let best: SpeedResult | null = null;
  for (const [trackId, items] of byTrack) {
    items.sort((a, b) => a.time - b.time);
    let first: number | null = null, second: number | null = null;
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1], current = items[index];
      if (current.time - previous.time > 1.1) continue;
      const p: GatePoint = [previous.car.x + previous.car.width / 2, previous.car.y + previous.car.height / 2];
      const q: GatePoint = [current.car.x + current.car.width / 2, current.car.y + current.car.height / 2];
      if (first === null) first = crossingTime(p, q, gates[0], gates[1], previous.time, current.time);
      else if (second === null && first !== null) second = crossingTime(p, q, gates[2], gates[3], previous.time, current.time);
    }
    if (first === null || second === null || second <= first) continue;
    const seconds = second - first;
    if (seconds < .1 || seconds > 20) continue;
    const candidate = { trackId, firstTime: first, secondTime: second, distanceM, speedKmh: distanceM / seconds * 3.6 };
    if (!best || candidate.speedKmh < best.speedKmh) best = candidate;
  }
  return best;
}

function crossingTime(p: GatePoint, q: GatePoint, a: GatePoint, b: GatePoint, timeP: number, timeQ: number): number | null {
  const r: GatePoint = [q[0] - p[0], q[1] - p[1]], s: GatePoint = [b[0] - a[0], b[1] - a[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-8) return null;
  const ap: GatePoint = [a[0] - p[0], a[1] - p[1]];
  const t = (ap[0] * s[1] - ap[1] * s[0]) / denominator;
  const u = (ap[0] * r[1] - ap[1] * r[0]) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? timeP + (timeQ - timeP) * t : null;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function lerp(from: number, to: number, amount: number) { return from + (to - from) * amount; }
function formatTime(seconds: number) { const safe = Math.max(0, Math.floor(seconds || 0)); return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`; }
