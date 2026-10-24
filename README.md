# LapLens

LapLens is a local-first motorsport footage review demo. It detects cars in sampled video frames, optionally looks for a user-supplied sponsor mark inside those cars, and lets an analyst calculate section-average speed from two measured gates in a fixed-camera shot.

The UI is an evidence viewer: seek to the sampled frame, inspect the detection overlay, select an observed exposure window, and export the run as JSON. The sample uses a warm paper and yellow palette with red measurement accents. Jost is used for display text, Karla for interface copy, and a compact monospace face for telemetry.

## Run locally

Requirements: Node.js 22 or newer, pnpm 9, and a current desktop browser with WebAssembly support.

```sh
pnpm install
pnpm dev
```

Open [http://localhost:3210](http://localhost:3210). The first analysis initializes the local RF-DETR model; OpenCV.js loads only when you add a sponsor reference. Initial model download and analysis time depend on your connection and device.

The built-in clip is optional. Use **Choose clip** to select a video supported by your browser. For this demo, clips must be 1–30 seconds and under 250 MB. Short clips are sampled at 3 frames per second; longer clips use 1 frame per second to bound browser-side work. All inference runs locally. No video or logo image is sent to a server.

## Workflow

1. Load the example or select an authorized race clip.
2. Optionally add a tight, clear sponsor-logo crop. The reference is matched with ORB visual features inside detected car boxes; this is not OCR or a pretrained sponsor classifier.
3. Run analysis. Solid yellow boxes are observed car detections. A dashed yellow box appears only between adjacent samples that share a track ID; it interpolates those two observed positions for smoother playback. Red logo boxes are shown only at measured match frames. Short yellow traces connect nearby observed car centers.
4. Select an exposure window to seek to its first observed match. Export a JSON report for a run record.
5. For a section-speed estimate, confirm the camera stayed fixed, enter the real distance between gates, and place two lines across the track. A result appears only when one associated car track crosses both lines in order.

## What the numbers mean

- **Car observations** are the COCO `car` category detections returned by the included RF-DETR Nano ONNX model at 2 Hz for clips up to 12 seconds and 1 Hz for longer clips. They are frame observations, not verified unique vehicles. Dashed playback boxes interpolate only when the same track ID appears in adjacent sampled frames; they are visual estimates, not additional detections.
- **Track IDs** are lightweight association by overlap and center distance. They can switch or fragment under occlusion, camera motion, or cuts.
- **Sponsor matches** require a user-provided reference image. ORB descriptors and a RANSAC homography test for local visual-feature agreement within a detected car crop. The count is observed matching frames, not a validated broadcast-exposure rating or a brand identity guarantee.
- **Exposure windows** group matches that occur close together in the 2 Hz sample stream. The displayed window between those observations is estimated; the app does not measure every intervening frame.
- **Section speed** is distance between user-marked gates divided by interpolated crossing time for one track. It is an approximate average over that section, not instantaneous speed. It is hidden until the analyst confirms a stationary camera and supplies the distance. Camera movement, variable frame timing, poor detections, or track switches can invalidate the estimate.

This is an engineering portfolio MVP, not an operationally validated sponsorship measurement service. There are no claimed precision, recall, sponsor-attribution, or speed-error figures. Validation datasets and independent ground truth are future work.

## Model and browser runtime

- Car detector: [RF-DETR Nano ONNX, COCO](https://huggingface.co/onnx-community/rfdetr_nano-ONNX), quantized ONNX model served from `public/models/rfdetr-nano/`.
- Inference: ONNX Runtime Web prefers WebGPU when the browser exposes it, then falls back to WebAssembly if GPU session setup or inference fails.
- Sponsor reference matching and image crops: OpenCV.js ORB features, Hamming matching, and RANSAC homography.
- Sampling and rendering: a dedicated worker performs inference; the video remains on the main page and overlays follow `video.currentTime`.

## Licenses and attribution

The application source is MIT licensed. Included third-party code, model files, fonts, and sample media retain their own licenses; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). In particular, the built-in video is an adapted excerpt of Sarah Stierch's CC BY 4.0 raceway video and must retain its attribution when redistributed.
