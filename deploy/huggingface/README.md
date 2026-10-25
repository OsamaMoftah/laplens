---
title: LapLens
emoji: 🏁
colorFrom: yellow
colorTo: red
sdk: static
app_file: index.html
license: mit
short_description: Motorsport video review with local browser computer vision.
---

# LapLens

Review racing footage with car detections, a synchronized timeline, optional sponsor-reference matching, and calibrated section-speed estimates. Video and logo files remain in your browser.

**[Source code and setup](https://github.com/OsamaMoftah/laplens)** · **[Design direction A](https://sammoftah-laplens.static.hf.space/design/direction-a.html)** · **[Design direction B](https://sammoftah-laplens.static.hf.space/design/direction-b.html)**

Use a desktop browser and a clip from 1 to 30 seconds. The first analysis downloads the included model. WebGPU is preferred where available, with a WebAssembly fallback. Analysis time depends on the device.

This portfolio MVP has no validated detection-accuracy or speed-error figures. Track IDs can switch. Dashed boxes are visual estimates; sponsor results require a supplied logo reference and are limited to detected car crops. Speed requires a fixed camera and a measured physical distance between gates.

Sample footage: Sarah Stierch, *Salute to Baylands Raceway Park — July 8, 2023*, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Salute_to_Baylands_Raceway_Park_-_July_8_2023_-_Sarah_Stierch.webm), CC BY 4.0. Included model, libraries, and fonts retain their own licenses; see THIRD_PARTY_NOTICES.md.
