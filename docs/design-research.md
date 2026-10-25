# LapLens design research — 25 October 2026

## References inspected before implementation

- [AI Workspace & Team Collaboration Platform — Roohi Koohi / Black Bulls](https://dribbble.com/shots/27834878-AI-Workspace-Team-Collaboration-Platform): visually inspected in browser. Warm cream, yellow/orange imagery and tightly spaced sans typography informed the surface and type hierarchy. Exact source fonts were not identified.
- [Motorsport Racing Telemetry Interface — Dmytro Demianenko](https://dribbble.com/shots/27317601-Dashboard-Design-Motorsport-Racing-Telemetry-Interface): visually inspected the full composition. Strong racing image, narrow navigation and aligned telemetry labels informed composition; its dark background and floating metrics were not carried into the light workspace.
- [MoTeC i2](https://motec.com.au/products/i2): official product describes concurrent analysis graphs, gauges and reports with customizable layouts. LapLens adopts the principle of keeping related evidence near the footage. It displays only data produced by the current run.
- [Hudl Sportscode](https://t4.static.hudl.com/releases/sportscode): official release notes document aligned timelines, responsive scrubbing and keyboard video navigation. These informed precise timecodes, keyboard transport controls and seekable evidence.

## Two directions

A: Pitwall — condensed display, compact tool rail, continuous inspector, wide video. Chosen for the working app because it allocates more space to repeated video analysis.

B: Frame Journal — horizontal masthead, large geometric title, more open editorial arrangement. Retained as a standalone screen artifact.

Both use the actual CC BY 4.0 Baylands source. Static concepts show an unanalyzed state and no fabricated performance values.

## Implementation boundary

Presentation changes are in Workspace.tsx, Filmstrip.tsx, workspace.css, tokens.css and layout.tsx. analyzer.ts, types.ts and vision.worker.ts remain unchanged. The filmstrip uses a separate video decoder. Every activity bar comes from a measured frame; dashed overlay estimates do not alter exported evidence.
