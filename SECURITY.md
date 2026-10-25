# Security review

Scope: the static LapLens application, its browser-side worker, dependencies, and published assets. The review uses benign input tests and low-volume HTTP probes. It excludes the hosting provider's infrastructure, denial-of-service testing, browser or GPU-driver exploitation, and independent model-accuracy validation. This is a bounded application assessment, not a security certification.

## Controls

- No accounts, upload API, server-side inference, or application telemetry. Local media is read through browser object URLs.
- Video limits: 250 MB, 1–30 seconds, maximum dimension 3840 pixels, and 8,294,400 pixels per frame.
- Logo limits: PNG, JPEG, or WebP; 5 MB; 16 million decoded pixels. Images are reduced before feature matching. Browsers still decode the original image before the pixel check.
- Worker failures, unreadable messages, and 120-second request timeouts terminate the worker and reject pending work. Cancelled runs can be retried with a fresh worker.
- Sponsor references are replaced or cleared before every run. OpenCV matrices are released after feature extraction.
- The static export adds a Content Security Policy before scripts. Inline bootstrap scripts use SHA-256 hashes; arbitrary inline scripts, objects, frames, and form submissions are blocked. Media/model CDN access is restricted to the hosting provider's asset domains.
- The local preview dependency is pinned to a patched compression release. Run `pnpm audit` to refresh advisory coverage.

## Verification

Assessment date: 2026-10-25.

- 14 automated regression and security checks pass.
- 10 HTTP probes pass on each of the local and published builds: private file paths are unavailable, query payloads are not reflected as markup, no analysis API accepts writes, CSP is present, and video byte ranges work.
- Browser CSP test: injected script and event-handler markers execute in an unprotected local control page and are blocked in the protected page. Probe pages are removed before publication.
- Native file tests: corrupt PNG decoding fails safely; a PNG over 5 MB is rejected; an HTML-like filename is displayed literally and creates no injected element.
- Real 30-frame WebGPU runs complete under the policy, both with and without a supplied reference. The reference test exercises ORB matching; it is not a sponsor-accuracy benchmark. Exported JSON is saved through the native dialog and parsed; it includes the same 30 frames and observation totals shown in the UI.
- Dependency audit reports zero known advisories, including development dependencies. Advisory coverage is time-dependent.


`pnpm test` exercises worker crash/timeout/cancellation paths, sponsor reset, excessive frame dimensions, matrix cleanup, rejected oversized/active images, corrupt image handling, and generated CSP behavior. `pnpm lint`, `pnpm typecheck`, and `pnpm build:space` check the source and deployment build.

## Remaining limits

Hugging Face Static Spaces controls HTTP response headers. This deployment cannot set `X-Content-Type-Options`, `Permissions-Policy`, or a header-only `frame-ancestors` directive; the HTML policy does not replace those headers. The model, fonts, runtime, and sample footage are intentionally public. Account names and earlier Git commits remain public.

The browser extension could not directly supply local files. Native browser dialogs were used instead: a corrupt PNG failed safely, a PNG over 5 MB was rejected, and an exported report was saved and parsed with all 30 sampled frames. Active SVG rejection and decoded-image pixel limits were additionally exercised against the actual upload handler in isolated tests. No claim is made that all possible malformed media has been fuzz-tested.

Exported JSON contains the selected media and logo filenames. Review reports before sharing. Sponsor attribution and speed estimates require separate ground-truth validation before commercial decisions.
