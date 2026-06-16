@echo off
cd /d "J:\制作データ\tools\illust-animator\illust-animator-main"

git add -A

git commit -m "fix: APNG export, CORS, XSS, perf optimizations

- Replace fake APNG (gif.js fallback) with real APNG via UPNG.js in both animator.html and ha-export.js
- Rename WebP label to WebM (actual output format)
- Fix CORS: strict allowlist check, return 403 for unknown origins
- Fix XSS: region label/description via textContent instead of innerHTML
- Perf: replace per-frame pinsHash/polyHash string joins with _geoVer counter
- Perf: skip Math.sqrt for pin distance search (squared comparison), sqrt only for winner
- Perf: short-circuit interact sqrt with squared distance check
- Remove dead code: src/index.js, src/tmp.txt, Anthropic proxy endpoint
- Deduplicate REGION_COLORS array"

git push origin main

echo.
echo Done.
pause
