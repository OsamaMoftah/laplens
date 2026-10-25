# LapLens premium workspace implementation plan

**Goal:** Ship two real-footage screen directions, then implement the Pitwall direction in the working app.

**Architecture:** Keep the existing route and Workspace ownership. Add a filmstrip component with its own video decoder, a presentation stylesheet, and theme tokens. Preserve analyzer.ts, types.ts, and vision.worker.ts.

**Stack:** Next.js App Router, React, TypeScript, CSS tokens, Lucide, existing browser CV worker.

## Constraints
- Light paper, warm yellow tracking accents, sharp red action accents.
- Real licensed footage; display estimates and measured detections stay explicit.
- All controls work with keyboard and touch. Reduced motion supported.
- No file deletions, no fabricated telemetry, no generic card grid.

## Work
- [x] Read existing UI, local Next CSS/client documentation, Hallmark rules and reference products.
- [x] Publish two standalone HTML screen artifacts in public/design/ before editing Workspace.
- [x] Implement compact rail, strong video presentation, useful inspector and timeline.
- [x] Add Filmstrip.tsx with separate decoder and cleanup on source change; clicks call onSeek(time).
- [x] Add playback speed, overlay visibility, fullscreen and accurate timecode controls.
- [x] Make pending, running, success, missing reference and error states explicit.
- [x] Check lint, TypeScript, production build and a real browser analysis run.
- [x] Inspect 320/375/414/768 and desktop; save browser screenshots and provide local demo URL.

## Verification
Run pnpm lint, pnpm typecheck and pnpm build. In the browser run the included 10s clip, inspect observed and estimated boxes, seek from the ruler and thumbnails, toggle overlays, change playback rate and verify error recovery. Check document width against viewport width at each required breakpoint. Save screenshots to public/design/ and reset viewport overrides.
