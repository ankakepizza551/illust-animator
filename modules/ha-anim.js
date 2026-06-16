// ============================================================
// ha-anim.js — アニメーション描画
// ロード順: 3番目（ha-state.js, hair-animator.js の後）
// ============================================================

function startAnim() {
  stopAnim();
  cacheInpaintedBackgrounds();
  startTime = performance.now();
  rafId = requestAnimationFrame(animLoop);
}
function stopAnim() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function animLoop(now) {
  const elapsed = (now - startTime) / 1000;
  renderAnimFrame(elapsed);
  rafId = requestAnimationFrame(animLoop);
}

function renderAnimFrame(t) {
  const W = mainCanvas.width, H = mainCanvas.height;
  const spd     = cachedSpd;
  const amp     = cachedAmp;
  const smooth  = cachedSmooth;
  const feather = cachedFeather;

  currentPointerX += (targetPointerX - currentPointerX) * 0.15;
  currentPointerY += (targetPointerY - currentPointerY) * 0.15;
  currentPullStrength += (targetPullStrength - currentPullStrength) * 0.1;

  mCtx.clearRect(0, 0, W, H);

  if (inpaintBaseCanvas) {
    mCtx.drawImage(inpaintBaseCanvas, 0, 0);
  } else if (originalCanvas) {
    mCtx.drawImage(originalCanvas, 0, 0);
  } else {
    mCtx.drawImage(imageEl, 0, 0, W, H);
  }

  detectedRegions.forEach(region => {
    if (!region.enabled || !region.polygon || region.polygon.length < 3) return;

    const rSpd = region.animSpd ?? spd;
    const rAmp = region.animAmp ?? amp;
    const rType = region.animType ?? animType;

    const phase = (t / rSpd) * Math.PI * 2 + region.animOffset;

    const xs = region.polygon.map(([x]) => x * W);
    const ys = region.polygon.map(([, y]) => y * H);

    const pad = Math.ceil(feather) + 4;
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - pad);
    const maxX = Math.min(W, Math.ceil(Math.max(...xs)) + pad);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - pad);
    const maxY = Math.min(H, Math.ceil(Math.max(...ys)) + pad);

    const anchorX = (region.anchor?.[0] ?? 0.5) * W;
    const anchorY = (region.anchor?.[1] ?? 0) * H;
    const pins = region.pins || [];

    const regionDiag = Math.hypot(maxX - minX, maxY - minY);
    const influenceScale = regionDiag > 0 ? regionDiag * 0.6 : 100;
    const pinRadius = Math.max(50, regionDiag * 0.4);

    const regionW = maxX - minX, regionH = maxY - minY;
    if (regionW <= 0 || regionH <= 0) return;

    const geoVer = region._geoVer || 0;
    if (!region._cache || region._cache.W !== W || region._cache.H !== H || region._cache.feather !== feather || region._cache.geoVer !== geoVer) {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = regionW; maskCanvas.height = regionH;
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

      maskCtx.translate(-minX, -minY);
      if (feather > 0) maskCtx.filter = `blur(${feather}px)`;
      maskCtx.beginPath();
      region.polygon.forEach(([px, py], idx) => {
        const x = px * W, y = py * H;
        idx === 0 ? maskCtx.moveTo(x, y) : maskCtx.lineTo(x, y);
      });
      maskCtx.closePath();
      maskCtx.fillStyle = '#fff';
      maskCtx.fill();
      const maskData = maskCtx.getImageData(0, 0, regionW, regionH).data;

      const tmp = document.createElement('canvas');
      tmp.width = regionW; tmp.height = regionH;
      const tCtx = tmp.getContext('2d', { willReadFrequently: true });
      tCtx.drawImage(originalCanvas || imageEl, minX, minY, regionW, regionH, 0, 0, regionW, regionH);

      const imgData = tCtx.getImageData(0, 0, regionW, regionH);
      const out = tCtx.createImageData(regionW, regionH);

      region._cache = {
        W, H, feather, geoVer,
        maskData, tmp, tCtx,
        src: imgData.data,
        out, dst: out.data
      };
    }

    const { maskData, tmp, tCtx, src, out, dst } = region._cache;

    for (let py = 0; py < regionH; py++) {
      for (let px = 0; px < regionW; px++) {
        const maskAlpha = maskData[(py * regionW + px) * 4 + 3] / 255;
        const idx = (py * regionW + px) * 4;

        if (maskAlpha <= 0) {
          dst[idx]   = src[idx];
          dst[idx+1] = src[idx+1];
          dst[idx+2] = src[idx+2];
          dst[idx+3] = src[idx+3];
          continue;
        }

        const worldX = minX + px;
        const worldY = minY + py;
        const distFromAnchor = Math.sqrt((worldX - anchorX) ** 2 + (worldY - anchorY) ** 2);

        let pinAttenuation = 1.0;
        if (pins.length > 0) {
          const pinRadiusSq = pinRadius * pinRadius;
          let minDistSq = Infinity;
          for (let i = 0; i < pins.length; i++) {
            const ppx = pins[i][0] * W;
            const ppy = pins[i][1] * H;
            const dSq = (worldX - ppx) ** 2 + (worldY - ppy) ** 2;
            if (dSq < minDistSq) minDistSq = dSq;
          }
          if (minDistSq < pinRadiusSq) {
            const t_atten = Math.sqrt(minDistSq) / pinRadius;
            pinAttenuation = t_atten * t_atten * (3 - 2 * t_atten);
          }
        }

        const influence = Math.min(distFromAnchor / influenceScale, 1) * rAmp * pinAttenuation;

        let offsetX = 0, offsetY = 0;
        if (rType === 'sway') {
          offsetX = Math.sin(phase + distFromAnchor * 0.02 * smooth) * influence;
          offsetY = Math.cos(phase * 0.7 + distFromAnchor * 0.02 * smooth) * influence * 0.3;
        } else if (rType === 'wave' || rType === 'flutter') {
          offsetX = Math.sin(phase + distFromAnchor * 0.04 * smooth) * influence * 0.5;
          offsetY = Math.sin(phase * 1.2 + distFromAnchor * 0.03 * smooth) * influence;
        } else if (rType === 'bounce') {
          const b = Math.abs(Math.sin(phase));
          offsetY = -b * influence * 0.8;
          offsetX = Math.sin(phase * 2) * influence * 0.2;
        } else if (rType === 'ripple') {
          const wave = Math.sin(phase * 1.5 + distFromAnchor * 0.05);
          offsetX = wave * influence * 0.6;
          offsetY = Math.cos(phase + distFromAnchor * 0.03) * influence * 0.6;
        } else {
          offsetX = Math.sin(phase + distFromAnchor * 0.02 * smooth) * influence;
          offsetY = Math.cos(phase * 0.7 + distFromAnchor * 0.02 * smooth) * influence * 0.3;
        }

        let interactX = 0, interactY = 0;
        if (useInteract && currentPullStrength > 0.01) {
          const pdx = currentPointerX - worldX;
          const pdy = currentPointerY - worldY;
          const pRad = 150;
          const pDistSq = pdx * pdx + pdy * pdy;
          if (pDistSq < pRad * pRad && pDistSq > 0) {
            const pDist = Math.sqrt(pDistSq);
            const pull = (1 - pDist / pRad) * 20 * currentPullStrength;
            const normInfl = rAmp > 0 ? Math.min(influence / rAmp, 1) : 0;
            interactX = (pdx / pDist) * pull * normInfl;
            interactY = (pdy / pDist) * pull * normInfl;
          }
        }

        const srcX = Math.round(px - offsetX - interactX);
        const srcY = Math.round(py - offsetY - interactY);

        if (srcX >= 0 && srcX < regionW && srcY >= 0 && srcY < regionH) {
          const srcIdx = (srcY * regionW + srcX) * 4;
          dst[idx]   = src[srcIdx]   * maskAlpha + src[idx]   * (1 - maskAlpha);
          dst[idx+1] = src[srcIdx+1] * maskAlpha + src[idx+1] * (1 - maskAlpha);
          dst[idx+2] = src[srcIdx+2] * maskAlpha + src[idx+2] * (1 - maskAlpha);
          dst[idx+3] = src[srcIdx+3] * maskAlpha + src[idx+3] * (1 - maskAlpha);
        } else {
          dst[idx]   = src[idx];
          dst[idx+1] = src[idx+1];
          dst[idx+2] = src[idx+2];
          dst[idx+3] = src[idx+3];
        }
      }
    }

    tCtx.putImageData(out, 0, 0);
    mCtx.clearRect(minX, minY, regionW, regionH);
    mCtx.drawImage(tmp, minX, minY);
  });
}
