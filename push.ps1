Set-Location -Path $PSScriptRoot

$msg = @"
fix: APNG export, CORS, XSS, perf optimizations

- Replace fake APNG (gif.js fallback) with real APNG via UPNG.js
- Rename WebP label to WebM (actual output format)
- Fix CORS: strict allowlist check, return 403 for unknown origins
- Fix XSS: region label/description via textContent instead of innerHTML
- Perf: replace per-frame pinsHash/polyHash string joins with _geoVer counter
- Perf: skip Math.sqrt for pin distance search, sqrt only for winner
- Perf: short-circuit interact sqrt with squared distance check
- Remove dead code: src/index.js, src/tmp.txt, Anthropic proxy endpoint
- Deduplicate REGION_COLORS array
"@

git add -A
git commit -m $msg
git push origin main

Write-Host "`nDone." -ForegroundColor Green
Read-Host "Press Enter to close"
