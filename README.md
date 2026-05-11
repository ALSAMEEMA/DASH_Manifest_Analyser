# 📡 DASH MPD Analyser

A browser-based DASH MPD (.mpd) analyzer — inspect periods, adaptation sets, representations, segments, DRM, low-latency DASH, and more with a modern visual UI. Zero dependencies, no build step.

**[Live Demo →](https://alsameema.github.io/DASH_Manifest_Analyser/)**

## Features

### Manifest Analysis
- **Periods** — multi-period support with duration, start time, adaptation set details
- **Video Representations** — resolution, bandwidth, codecs, frame rate, segment URLs
- **Audio Representations** — codec, channels, sample rate, language, segment URLs
- **Subtitle / Text Representations** — language, codec, MIME type, segment URLs
- **Trick Mode Streams** — EssentialProperty-based trick play detection
- **Thumbnail Tracks** — tile-based thumbnail adaptation sets

### MPD Elements Parsed
| Element | Details |
|---------|---------|
| `Period` | ID, start, duration, adaptation sets |
| `AdaptationSet` | Content type, codec, language, roles, DRM |
| `Representation` | ID, bandwidth, resolution, frame rate, codec |
| `SegmentTemplate` | Media/init templates, timeline, duration, availabilityTimeOffset |
| `SegmentList` | Explicit segment URLs with byte ranges |
| `SegmentBase` | Single-file with index range |
| `ContentProtection` | Widevine, PlayReady, FairPlay, ClearKey, Marlin |
| `EssentialProperty` | Trick mode, thumbnails, supplemental codecs |
| `SupplementalProperty` | Additional adaptation set properties |
| `InbandEventStream` | Inband event signaling |
| `EventStream` | MPD-level and period-level events |
| `ProgramInformation` | Title, source, copyright |
| `ServiceDescription` | Low-latency target/max/min latency, playback rate |
| `ProducerReferenceTime` | Encoder wall clock synchronization |
| `UTCTiming` | Server time synchronization |
| `AudioChannelConfiguration` | Channel count and layout |
| `Location` | MPD reload URL |

### DRM / PSSH Decoding
- **Widevine** — PSSH box decoding with provider, content ID, key IDs
- **PlayReady** — PRO header XML, license URL, key IDs, algorithm
- **FairPlay, ClearKey, Marlin** — system ID detection
- Base64 PSSH → decoded table with copy buttons

### Segment URL Computation
- **SegmentTemplate + SegmentTimeline** — exact segment URLs from `<S>` entries
- **SegmentTemplate + duration** — computed segments from duration/timescale
- **Dynamic manifests** — sliding window based on wall clock time + timeShiftBufferDepth
- **SegmentList** — explicit segment URLs
- **SegmentBase** — single file with byte ranges
- Copy individual or all segment URLs

### Low-Latency DASH (LL-DASH)
- `availabilityTimeOffset` detection and display
- `ProducerReferenceTime` parsing with UTCTiming
- `ServiceDescription` with target/max/min latency
- ⚡ LL-DASH badge indicator

### Visualization
- **Segment Duration Chart** — canvas bar chart with segment timing
- **Collapsible Sections** — compact tables with expand/collapse
- **Jump Navigation** — quick-jump buttons to sections
- **Validation Warnings** — missing elements, schema issues

### Live / Dynamic MPD Support
- 🔄 Auto-refresh for dynamic manifests (uses `minimumUpdatePeriod`)
- Live badge with refresh counter and timestamp (`LIVE · #5 · 12:34:56 · ✓ Updated`)
- Sliding window segment computation from wall clock time
- Section expand/collapse states preserved during refresh

### UX
- 🌙 Dark / ☀️ Light theme with glassmorphism design
- 📁 Drag-and-drop file upload
- 🔗 Load manifest from URL
- 📋 Copy segment URLs, raw manifest, results
- 💾 Export analysis as JSON
- 🕑 URL history with localStorage persistence
- 📱 Responsive design

## Usage

### Option 1: Open directly
Open `index.html` in any modern browser.

> **Note:** Loading manifests from URL requires serving via HTTP due to browser CORS restrictions.
> Use a local server: `python -m http.server 8080` or VS Code Live Server.

### Option 2: GitHub Pages
Push to GitHub and enable Pages in Settings — the site works as-is with no build step.

### How to analyze
1. **Paste a URL** and click **Load URL**, or
2. **Drag & drop** a `.mpd` file, or
3. **Paste** MPD XML content directly into the textarea

Then click **Analyze MPD**.

## Tech Stack

- **HTML5 / CSS3 / Vanilla JS** — zero dependencies, no build step
- **CSS Variables** — full dark/light theming
- **Canvas API** — segment duration chart
- **Google Fonts** — Inter + JetBrains Mono
