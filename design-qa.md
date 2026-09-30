# Design QA

- Source visual truth: `C:\Users\micro\AppData\Local\Temp\codex-clipboard-ab97387d-7cef-4b65-8500-0e9a815e280c.png` (853 × 1844 px).
- Implementation: `http://localhost:4173/`, captured inline with the Codex in-app Browser at a 390 × 844 CSS viewport (DPR 1). The browser API supplied screenshots inline rather than a saved screenshot path.
- State compared: source shows `LIVE` with +15 minutes; the implementation was captured in that state using an imported activity, then restored to the default Demo. The live clock values differed because the app uses the actual system time.
- Density normalization: source is about 2.19 pixels per target CSS pixel; implementation capture is DPR 1. Comparison focused on section proportions, color, spacing, and state hierarchy.

## Findings and iteration

1. Initial 390 px capture: delay controls extended past the card edge and the header occupied too much height (P2). Reduced control minimum widths and compressed the header and timeline rhythm. Subsequent 390 px captures showed no horizontal overflow (`scrollWidth` 375 px within a 390 px viewport).
2. The reference includes nine supplied group photographs; the Demo uses styled placeholders because no individual photo assets were supplied and the request explicitly permits placeholders (accepted deviation). Uploaded posters now provide cropped photos through the OCR flow.
3. Fonts, colors, and copy: system font, aqua background, sakura pink emphasis, white cards, English status labels, Chinese details, and the original nine group names follow the reference. Browser-owned phone status icons were omitted from web content.
4. Focused checks: imported `LIVE` +15 view kept the hero card, progress, Next Up, and status colors; the new OCR sheet fit at 390 px. A 200 × 100 red/blue test poster produced red and blue thumbnails plus two correctly placed 50% overlay boxes. No browser console errors were observed.

## Interaction checks

- JSON validation, Markdown fence cleanup, candidate preview, confirm/cancel, missing image fallback, poster ratio warning, and cropped image display in all three locations passed browser checks.
- Delay +1/+5/-1/-5, custom +15, reset, and refresh retention passed. Crop images stayed unchanged when delay changed.
- Replacing an activity with another using the same group IDs removed the prior Blob images. Reload preserved the activity and used placeholders, matching the documented no-IndexedDB behavior.
- `npm run build`, `npm test` (14 tests), and Prettier check passed.

Remaining visual polish is limited to artwork the user has not provided. `final result: passed`
