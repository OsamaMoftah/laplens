import type {
  ExposureInterval,
  RunResult,
  SampleFrame,
  SponsorReference,
} from "./types";

type WorkerReply = {
  id: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

export class LocalRaceAnalyzer {
  private worker: Worker;
  private provider = "WASM";
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ready: Promise<void>;
  private failure?: Error;

  constructor() {
    this.worker = new Worker(new URL("./vision.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      this.pending.delete(data.id);
      clearTimeout(task.timer);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve(data.result ?? data.ok);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.dispose(new Error("Analysis worker failed. Please retry the run."));
    };
    this.worker.onmessageerror = () =>
      this.dispose(
        new Error(
          "Analysis worker returned an unreadable message. Please retry.",
        ),
      );
    this.ready = this.request("load").then((value) => {
      this.provider =
        (value as { provider?: string } | undefined)?.provider ?? "WASM";
    });
    void this.ready.catch(() => {});
  }

  private request(
    type: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.dispose(
            new Error(
              "Analysis worker timed out. Please retry with a shorter clip.",
            ),
          ),
        120_000,
      );
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      this.worker.postMessage({ id, type, ...payload }, transfer);
    } catch {
      this.dispose(new Error("Analysis worker could not receive the frame."));
    }
    return response;
  }

  async setReference(
    reference: SponsorReference | null,
    pixels: ImageData | null,
  ) {
    await this.ready;
    if (!reference || !pixels) {
      await this.request("set-reference", { reference: null });
      return;
    }
    const bytes = pixels.data.buffer.slice(0);
    await this.request(
      "set-reference",
      {
        reference: {
          id: reference.id,
          name: reference.name,
          width: pixels.width,
          height: pixels.height,
          pixels: bytes,
        },
      },
      [bytes],
    );
  }

  async analyze(
    video: HTMLVideoElement,
    references: SponsorReference[],
    signal: AbortSignal,
    progress: (current: number, total: number, stage: string) => void,
  ): Promise<RunResult> {
    await this.ready;
    if (signal.aborted)
      throw new DOMException("Analysis cancelled.", "AbortError");
    const { videoWidth: width, videoHeight: height, duration } = video;
    if (!width || !height || !Number.isFinite(duration))
      throw new Error("The video could not be decoded.");
    if (duration > 30)
      throw new Error("For this browser demo, choose a clip up to 30 seconds.");
    if (duration < 1)
      throw new Error("Choose a clip at least one second long.");
    if (width > 3840 || height > 3840 || width * height > 8_294_400)
      throw new Error(
        "Video resolution exceeds the 4K / 8.3 million pixels limit. Resize the clip first.",
      );
    // Sample short clips more densely so measured boxes stay closer to fast-moving cars.
    // Longer clips use one sample per second to keep browser-side inference bounded.
    const hz = duration <= 12 ? 3 : 1;
    const total = Math.ceil(duration * hz);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable in this browser.");
    const frames: SampleFrame[] = [];
    const started = performance.now();
    let previousTime = -1;
    try {
      for (let index = 0; index < total; index++) {
        if (signal.aborted)
          throw new DOMException("Analysis cancelled.", "AbortError");
        const time = Math.min(duration - 0.01, index / hz);
        if (Math.abs(video.currentTime - time) > 0.001) {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => done(new Error("Video seek timed out.")),
              10_000,
            );
            const onSeek = () => done();
            const onAbort = () =>
              done(new DOMException("Analysis cancelled.", "AbortError"));
            const done = (error?: Error) => {
              window.clearTimeout(timeout);
              video.removeEventListener("seeked", onSeek);
              signal.removeEventListener("abort", onAbort);
              if (error) reject(error);
              else resolve();
            };
            video.addEventListener("seeked", onSeek, { once: true });
            signal.addEventListener("abort", onAbort, { once: true });
            video.currentTime = time;
          });
        }
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const bytes = image.data.buffer;
        const observation = (await this.request(
          "analyze-frame",
          {
            time,
            width,
            height,
            pixels: bytes,
            resetTracks: previousTime < 0 || time - previousTime > 1.25,
          },
          [bytes],
        )) as { cars: SampleFrame["cars"]; logos: SampleFrame["logos"] };
        frames.push({ time, ...observation });
        previousTime = time;
        progress(
          index + 1,
          total,
          observation.logos.length
            ? "Matching sponsor marks"
            : "Finding and following cars",
        );
      }
    } finally {
      video.pause();
    }
    return {
      width,
      height,
      duration,
      sampleHz: hz,
      elapsedMs: Math.round(performance.now() - started),
      frames,
      exposures: buildExposureIntervals(frames, hz),
      engine: `RF-DETR Nano / ${this.provider} / COCO car detections${references.length ? " + ORB logo matching / RANSAC" : ""}`,
    };
  }

  dispose(error: Error = new Error("Analysis worker closed.")) {
    this.failure = error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.worker.terminate();
  }
}

function buildExposureIntervals(frames: SampleFrame[], hz: number) {
  const evidence = new Map<string, Array<{ time: number; trackId: number }>>();
  for (const frame of frames) {
    for (const logo of frame.logos) {
      const points = evidence.get(logo.sponsorId) ?? [];
      points.push({ time: frame.time, trackId: logo.trackId });
      evidence.set(logo.sponsorId, points);
    }
  }
  const intervals: ExposureInterval[] = [];
  for (const [sponsorId, points] of evidence) {
    let start = points[0].time,
      end = start;
    let tracks = new Set([points[0].trackId]);
    let observations = 1;
    const flush = () =>
      intervals.push({
        sponsorId,
        start,
        end,
        observations,
        carTrackIds: [...tracks],
      });
    for (const point of points.slice(1)) {
      if (point.time - end <= 1.5 / hz) {
        end = point.time;
        tracks.add(point.trackId);
        observations++;
      } else {
        flush();
        start = end = point.time;
        tracks = new Set([point.trackId]);
        observations = 1;
      }
    }
    flush();
  }
  return intervals;
}
