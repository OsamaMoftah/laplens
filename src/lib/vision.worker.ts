/// <reference lib="webworker" />
import type { CarObservation, LogoObservation } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
type OrtApi = typeof import("onnxruntime-web/wasm");
let ort: OrtApi;
let session: import("onnxruntime-web/wasm").InferenceSession | undefined;
let modelBuffer: ArrayBuffer | undefined;
let executionProvider: "WebGPU" | "WASM" = "WASM";
type CvRuntime = typeof import("@techstark/opencv-js");
let cv: CvRuntime;
let cvReady: Promise<void> | undefined;
let nextTrackId = 1;
type ActiveTrack = CarObservation & { seen: number; previous?: { x: number; y: number; time: number } };
let tracks: ActiveTrack[] = [];
type FrameMessage = { id: number; type: "load" | "add-reference" | "analyze-frame"; [key: string]: unknown };
type RgbFrame = { width: number; height: number; pixels: ArrayBuffer };
type Roi = { x: number; y: number; width: number; height: number };
type ReferenceFeatures = { name: string; width: number; height: number; points: Array<[number, number]>; descriptors: Uint8Array<ArrayBufferLike> };

const references = new Map<string, ReferenceFeatures>();

function loadOpenCv() {
  if (!cvReady) {
    cvReady = (async () => {
      const namespace = await import("@techstark/opencv-js");
      const cvModule = (namespace as unknown as { default?: unknown }).default ?? namespace;
      if (cvModule instanceof Promise) cv = await cvModule as CvRuntime;
      else {
        cv = cvModule as CvRuntime;
        if (!cv.Mat) await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("OpenCV initialization timed out.")), 30_000);
          cv.onRuntimeInitialized = () => { clearTimeout(timeout); resolve(); };
        });
      }
    })();
  }
  return cvReady;
}

async function initialize() {
  const response = await fetch("/models/rfdetr-nano/model_quantized.onnx", { cache: "force-cache" });
  if (!response.ok) throw new Error(`Car detector could not load (${response.status}).`);
  modelBuffer = await response.arrayBuffer();
  if ("gpu" in navigator) {
    try {
      const webgpu = await import("onnxruntime-web/webgpu");
      session = await webgpu.InferenceSession.create(modelBuffer, {
        executionProviders: ["webgpu"], graphOptimizationLevel: "all",
      });
      ort = webgpu as unknown as OrtApi;
      executionProvider = "WebGPU";
      return;
    } catch {
      session = undefined;
    }
  }
  await initializeWasm();
}

async function initializeWasm() {
  if (!modelBuffer) throw new Error("Car detector weights are unavailable.");
  const wasm = await import("onnxruntime-web/wasm");
  ort = wasm;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL("/ort/", scope.location.origin).href;
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"], graphOptimizationLevel: "all",
  });
  executionProvider = "WASM";
}

function matFromPixels(width: number, height: number, pixels: ArrayBuffer) {
  return cv.matFromImageData(new ImageData(new Uint8ClampedArray(pixels), width, height));
}

function computeFeatures(image: InstanceType<typeof cv.Mat>) {
  const gray = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const orb = new cv.ORB(650, 1.2, 7, 19, 0, 2, cv.ORB_HARRIS_SCORE, 31, 12);
  try {
    if (image.channels() === 4) cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    else if (image.channels() === 3) cv.cvtColor(image, gray, cv.COLOR_RGB2GRAY);
    else image.copyTo(gray);
    orb.detectAndCompute(gray, new cv.Mat(), keypoints, descriptors);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const point = keypoints.get(i).pt;
      points.push([point.x, point.y]);
    }
    return { points, descriptors: Uint8Array.from(descriptors.data), cols: descriptors.cols };
  } finally {
    gray.delete(); keypoints.delete(); descriptors.delete(); orb.delete();
  }
}

function sigmoid(value: number) { return 1 / (1 + Math.exp(-value)); }

async function detectCars(frame: RgbFrame): Promise<CarObservation[]> {
  if (!session) throw new Error("Car detector is not initialized.");
  const sourceCanvas = new OffscreenCanvas(frame.width, frame.height);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const tileCanvas = new OffscreenCanvas(384, 384);
  const tileContext = tileCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !tileContext) throw new Error("Browser canvas is unavailable.");
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  const regions: Roi[] = [
    { x: 0, y: 0.2, width: 0.6, height: 0.65 },
    { x: 0.4, y: 0.2, width: 0.6, height: 0.65 },
  ];
  const found: Array<CarObservation & { score: number }> = [];
  for (const region of regions) {
      const left = Math.round(region.x * frame.width);
      const top = Math.round(region.y * frame.height);
      const tileWidth = Math.min(frame.width - left, Math.round(region.width * frame.width));
      const tileHeight = Math.min(frame.height - top, Math.round(region.height * frame.height));
      tileContext.clearRect(0, 0, 384, 384);
      tileContext.drawImage(sourceCanvas, left, top, tileWidth, tileHeight, 0, 0, 384, 384);
      const bytes = tileContext.getImageData(0, 0, 384, 384).data;
      const inputData = new Float32Array(3 * 384 * 384);
      const size = 384 * 384;
      for (let index = 0; index < size; index++) {
        inputData[index] = bytes[index * 4] / 255;
        inputData[size + index] = bytes[index * 4 + 1] / 255;
        inputData[2 * size + index] = bytes[index * 4 + 2] / 255;
      }
      let input = new ort.Tensor("float32", inputData, [1, 3, 384, 384]);
      let output: Awaited<ReturnType<typeof session.run>>;
      try { output = await session.run({ pixel_values: input }); }
      catch (error) {
        input.dispose();
        if (executionProvider !== "WebGPU") throw error;
        try { await session.release(); } catch { /* A failed GPU context may already be released. */ }
        await initializeWasm();
        input = new ort.Tensor("float32", inputData, [1, 3, 384, 384]);
        output = await session!.run({ pixel_values: input });
      }
      const boxes = output.pred_boxes.data as Float32Array;
      const logits = output.logits.data as Float32Array;
      const queries = boxes.length / 4;
      for (let query = 0; query < queries; query++) {
        const score = sigmoid(logits[query * 91 + 3]); // COCO category 3 is car.
        if (score < 0.3) continue;
        const [cx, cy, width, height] = boxes.subarray(query * 4, query * 4 + 4);
        if (![cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
        const x = Math.max(0, Math.min(1, region.x + (cx - width / 2) * region.width));
        const y = Math.max(0, Math.min(1, region.y + (cy - height / 2) * region.height));
        const right = Math.max(0, Math.min(1, region.x + (cx + width / 2) * region.width));
        const bottom = Math.max(0, Math.min(1, region.y + (cy + height / 2) * region.height));
        if (right <= x || bottom <= y) continue;
        found.push({ x, y, width: right - x, height: bottom - y, trackId: 0, detectorScore: score, observed: true, score });
      }
      input.dispose();
      for (const tensor of Object.values(output)) tensor.dispose();
  }
  const unique: typeof found = [];
  for (const candidate of found.sort((a, b) => b.score - a.score)) {
    if (!unique.some(other => intersectionOverUnion(other, candidate) > 0.45)) unique.push(candidate);
  }
  return associateTracks(unique, currentTime);
}

let currentTime = 0;
function associateTracks(detections: Array<CarObservation & { score: number }>, time: number): CarObservation[] {
  tracks = tracks.filter(track => time - track.seen <= 1.6 && time >= track.seen);
  const unmatchedCost = 1.65;
  const size = tracks.length + detections.length;
  const costs = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const eligible = Array.from({ length: tracks.length }, () => Array<boolean>(detections.length).fill(false));

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex++) {
      const detection = detections[detectionIndex];
      const iou = intersectionOverUnion(track, detection);
      const centerX = track.x + track.width / 2, centerY = track.y + track.height / 2;
      const dt = time - track.seen;
      let predictedX = centerX, predictedY = centerY;
      if (track.previous && track.seen > track.previous.time) {
        const historyDt = track.seen - track.previous.time;
        predictedX += (centerX - track.previous.x) / historyDt * dt;
        predictedY += (centerY - track.previous.y) / historyDt * dt;
      }
      const distance = Math.hypot(predictedX - detection.x - detection.width / 2, predictedY - detection.y - detection.height / 2);
      const scale = Math.max(0.025, (track.width + track.height + detection.width + detection.height) / 4);
      const areaRatio = (detection.width * detection.height) / Math.max(1e-8, track.width * track.height);
      const scaleChange = Math.abs(Math.log(areaRatio)) * 0.12;
      const cost = 1 - iou + distance / scale * 0.72 + scaleChange;
      const canMatch = iou > 0.01 || distance < scale * 2.8;
      eligible[trackIndex][detectionIndex] = canMatch;
      costs[trackIndex][detectionIndex] = canMatch ? cost : 1e6;
    }

    // Every real track can choose an unmatched dummy column.
    for (let dummy = detections.length; dummy < size; dummy++) costs[trackIndex][dummy] = unmatchedCost;
  }
  // Every detection can remain unmatched through a dummy row; dummy-to-dummy assignments are free.
  for (let dummyRow = tracks.length; dummyRow < size; dummyRow++) {
    for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex++) costs[dummyRow][detectionIndex] = unmatchedCost;
  }

  const assignment = minimumCostAssignment(costs);
  const matchedByDetection = new Map<number, ActiveTrack>();
  const usedTrackIds = new Set<number>();
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const detectionIndex = assignment[trackIndex];
    if (detectionIndex < detections.length && eligible[trackIndex][detectionIndex] && costs[trackIndex][detectionIndex] < unmatchedCost * 2) {
      matchedByDetection.set(detectionIndex, tracks[trackIndex]);
      usedTrackIds.add(tracks[trackIndex].trackId);
    }
  }

  const result = detections.map((detection, detectionIndex) => {
    const best = matchedByDetection.get(detectionIndex);
    return {
      x: detection.x,
      y: detection.y,
      width: detection.width,
      height: detection.height,
      trackId: best?.trackId ?? nextTrackId++,
      detectorScore: detection.detectorScore,
      observed: true as const,
      previous: best ? { x: best.x + best.width / 2, y: best.y + best.height / 2, time: best.seen } : undefined,
    };
  });
  tracks = [...tracks.filter(track => !usedTrackIds.has(track.trackId)), ...result.map(d => ({ ...d, seen: time }))];
  return result;
}

function minimumCostAssignment(costs: number[][]): number[] {
  const size = costs.length;
  if (!size) return [];
  const rowPotential = Array<number>(size + 1).fill(0);
  const columnPotential = Array<number>(size + 1).fill(0);
  const rowAtColumn = Array<number>(size + 1).fill(0);
  const previousColumn = Array<number>(size + 1).fill(0);

  for (let row = 1; row <= size; row++) {
    rowAtColumn[0] = row;
    let column = 0;
    const minimum = Array<number>(size + 1).fill(Infinity);
    const visited = Array<boolean>(size + 1).fill(false);
    do {
      visited[column] = true;
      const activeRow = rowAtColumn[column];
      let delta = Infinity;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= size; candidate++) {
        if (visited[candidate]) continue;
        const reduced = costs[activeRow - 1][candidate - 1] - rowPotential[activeRow] - columnPotential[candidate];
        if (reduced < minimum[candidate]) {
          minimum[candidate] = reduced;
          previousColumn[candidate] = column;
        }
        if (minimum[candidate] < delta) { delta = minimum[candidate]; nextColumn = candidate; }
      }
      for (let candidate = 0; candidate <= size; candidate++) {
        if (visited[candidate]) {
          rowPotential[rowAtColumn[candidate]] += delta;
          columnPotential[candidate] -= delta;
        } else minimum[candidate] -= delta;
      }
      column = nextColumn;
    } while (rowAtColumn[column] !== 0);

    do {
      const prior = previousColumn[column];
      rowAtColumn[column] = rowAtColumn[prior];
      column = prior;
    } while (column !== 0);
  }

  const assignment = Array<number>(size).fill(size);
  for (let column = 1; column <= size; column++) {
    if (rowAtColumn[column]) assignment[rowAtColumn[column] - 1] = column - 1;
  }
  return assignment;
}

function intersectionOverUnion(a: Roi, b: Roi) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h / Math.max(1e-8, a.width * a.height + b.width * b.height - w * h);
}

function hamming(dataA: Uint8Array, offsetA: number, dataB: Uint8Array, offsetB: number, length: number) {
  let distance = 0;
  for (let i = 0; i < length; i++) {
    let value = dataA[offsetA + i] ^ dataB[offsetB + i];
    value = value - ((value >>> 1) & 0x55);
    value = (value & 0x33) + ((value >>> 2) & 0x33);
    distance += (value + (value >>> 4)) & 0x0f;
  }
  return distance;
}

function matchReference(template: ReferenceFeatures, image: InstanceType<typeof cv.Mat>, roi: Roi, sponsorId: string, trackId: number): LogoObservation | null {
  const query = computeFeatures(image);
  const descriptorWidth = 32;
  if (template.points.length < 6 || query.points.length < 6 || !query.cols) return null;
  const matches: Array<{ src: [number, number]; dst: [number, number]; distance: number }> = [];
  for (let i = 0; i < template.points.length; i++) {
    let best = 257, second = 257, bestIndex = -1;
    for (let j = 0; j < query.points.length; j++) {
      const distance = hamming(template.descriptors, i * descriptorWidth, query.descriptors, j * descriptorWidth, descriptorWidth);
      if (distance < best) { second = best; best = distance; bestIndex = j; }
      else if (distance < second) second = distance;
    }
    if (bestIndex >= 0 && best < 64 && best < second * 0.78)
      matches.push({ src: template.points[i], dst: query.points[bestIndex], distance: best });
  }
  if (matches.length < 6) return null;
  const srcPoints = cv.matFromArray(matches.length, 1, cv.CV_32FC2, matches.flatMap(m => m.src));
  const dstPoints = cv.matFromArray(matches.length, 1, cv.CV_32FC2, matches.flatMap(m => m.dst));
  const inlierMask = new cv.Mat();
  let homography: InstanceType<typeof cv.Mat> | undefined;
  try {
    homography = cv.findHomography(srcPoints, dstPoints, cv.RANSAC, 4, inlierMask, 800, 0.99);
    if (homography.empty()) return null;
    const inlierValues = inlierMask.data as Uint8Array;
    let inliers = 0;
    for (const value of inlierValues) if (value) inliers++;
    const matchRatio = inliers / matches.length;
    if (inliers < 6 || matchRatio < 0.48) return null;
    const corners = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, template.width, 0, template.width, template.height, 0, template.height]);
    const projected = new cv.Mat();
    try {
      cv.perspectiveTransform(corners, projected, homography);
      const values = projected.data32F;
      const xs = [values[0], values[2], values[4], values[6]];
      const ys = [values[1], values[3], values[5], values[7]];
      const x = Math.max(0, Math.min(...xs));
      const y = Math.max(0, Math.min(...ys));
      const right = Math.min(image.cols, Math.max(...xs));
      const bottom = Math.min(image.rows, Math.max(...ys));
      const width = right - x, height = bottom - y;
      if (width < 7 || height < 5 || width > image.cols * 0.9 || height > image.rows * 0.9) return null;
      return {
        x: roi.x + (x / image.cols) * roi.width,
        y: roi.y + (y / image.rows) * roi.height,
        width: (width / image.cols) * roi.width,
        height: (height / image.rows) * roi.height,
        sponsorId, trackId, inliers, matchRatio,
      };
    } finally { corners.delete(); projected.delete(); }
  } finally { srcPoints.delete(); dstPoints.delete(); inlierMask.delete(); homography?.delete(); }
}

function identifyLogos(frame: RgbFrame, cars: CarObservation[]): LogoObservation[] {
  if (!references.size) return [];
  const source = matFromPixels(frame.width, frame.height, frame.pixels);
  const observations: LogoObservation[] = [];
  try {
    for (const car of cars) {
      const paddingX = car.width * 0.08, paddingY = car.height * 0.08;
      const roi: Roi = {
        x: Math.max(0, car.x - paddingX), y: Math.max(0, car.y - paddingY),
        width: Math.min(1, car.x + car.width + paddingX) - Math.max(0, car.x - paddingX),
        height: Math.min(1, car.y + car.height + paddingY) - Math.max(0, car.y - paddingY),
      };
      const pixelRoi = new cv.Rect(Math.floor(roi.x * frame.width), Math.floor(roi.y * frame.height), Math.max(1, Math.floor(roi.width * frame.width)), Math.max(1, Math.floor(roi.height * frame.height)));
      const crop = source.roi(pixelRoi);
      try {
        for (const [sponsorId, reference] of references) {
          const match = matchReference(reference, crop, roi, sponsorId, car.trackId);
          if (match) observations.push(match);
        }
      } finally { crop.delete(); }
    }
  } finally { source.delete(); }
  return observations;
}

scope.onmessage = async ({ data }: MessageEvent<FrameMessage>) => {
  const { id, type } = data;
  try {
    if (type === "load") {
      await initialize();
      scope.postMessage({ id, result: { provider: executionProvider } });
      return;
    }
    if (!session) throw new Error("The vision engine is not ready.");
    if (type === "add-reference") {
      await loadOpenCv();
      const reference = data.reference as { id: string; name: string; width: number; height: number; pixels: ArrayBuffer };
      if (reference.width < 20 || reference.height < 12) throw new Error("Use a logo crop at least 20 × 12 pixels.");
      const image = matFromPixels(reference.width, reference.height, reference.pixels);
      try {
        const features = computeFeatures(image);
        if (features.points.length < 8) throw new Error("This mark has too few distinct visual features. Try a tighter, sharper crop.");
        references.set(reference.id, { name: reference.name, width: reference.width, height: reference.height, ...features });
      } finally { image.delete(); }
      scope.postMessage({ id, result: true });
      return;
    }
    if (type === "analyze-frame") {
      if (references.size) await loadOpenCv();
      const frame: RgbFrame = { width: data.width as number, height: data.height as number, pixels: data.pixels as ArrayBuffer };
      currentTime = data.time as number;
      if (data.resetTracks) { tracks = []; nextTrackId = 1; }
      const cars = await detectCars(frame);
      const logos = identifyLogos(frame, cars);
      scope.postMessage({ id, result: { cars, logos } });
    }
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
