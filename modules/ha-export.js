// ============================================================
// ha-export.js — プロジェクト保存・読込・エクスポート
// ロード順: 5番目（最後）
// ============================================================

// ---- プロジェクト保存 ----
if (saveProjectBtn) {
  saveProjectBtn.addEventListener('click', () => {
    if (detectedRegions.length === 0) {
      showToast('保存する部位データがありません。');
      return;
    }
    const projectData = {
      version: 2,
      imageDataUrl: originalCanvas ? originalCanvas.toDataURL('image/png') : null,
      regions: detectedRegions,
      settings: {
        animType,
        spd: document.getElementById('spd').value,
        amp: document.getElementById('amp').value,
        smooth: document.getElementById('smooth').value,
        feather: document.getElementById('feather').value
      }
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hair_animator_project.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---- プロジェクト読込 ----
if (loadProjectBtn && projectFileInput) {
  loadProjectBtn.addEventListener('click', () => projectFileInput.click());
  projectFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.regions && Array.isArray(data.regions)) {
          detectedRegions = data.regions.map(r => ({
              ...r,
              pins: r.pins ? r.pins : []
          }));

          if (data.settings) {
            animType = data.settings.animType || 'sway';
            document.querySelectorAll('.anim-chip').forEach(c => {
              c.classList.toggle('active', c.dataset.anim === animType);
            });
            ['spd','amp','smooth','feather'].forEach(id => {
              if (data.settings[id]) {
                const v = parseFloat(data.settings[id]);
                document.getElementById(id).value = data.settings[id];
                const valEl = document.getElementById(id + '-val');
                if (valEl) valEl.textContent = id === 'spd' ? v.toFixed(1) + 's' : (id === 'feather' ? data.settings[id] + 'px' : data.settings[id]);
                if (id === 'spd')       cachedSpd = v;
                else if (id === 'amp')     cachedAmp = v;
                else if (id === 'smooth')  cachedSmooth = v;
                else if (id === 'feather') cachedFeather = v;
              }
            });
          }

          const applyProject = () => {
            undoStack = [];
            saveUndoState();
            renderRegionList();
            drawOverlay();
            startAnim();
            regionsPanel.style.display = 'block';
            animPanel.style.display = 'block';
            const exPanel = document.getElementById('export-panel');
            if (exPanel) exPanel.style.display = 'block';
            const rdb = document.getElementById('redetect-btn');
            if (rdb) rdb.style.display = 'block';
            setStatus('done', `プロジェクトを読み込みました（${detectedRegions.length}部位）`);
          };

          if (data.imageDataUrl) {
            const img = new Image();
            img.onload = () => {
              imageEl = img;
              imageLoaded = true;
              const maxW = canvasBox.offsetWidth - 32;
              const maxH = 440;
              const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
              mainCanvas.width  = Math.round(img.naturalWidth * scale);
              mainCanvas.height = Math.round(img.naturalHeight * scale);
              overlayCanvas.width  = mainCanvas.width;
              overlayCanvas.height = mainCanvas.height;
              mainCanvas.style.display = 'block';
              overlayCanvas.style.display = 'block';
              if (!mCtx) mCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
              if (!oCtx) oCtx = overlayCanvas.getContext('2d');
              originalCanvas = document.createElement('canvas');
              originalCanvas.width = mainCanvas.width;
              originalCanvas.height = mainCanvas.height;
              originalCanvas.getContext('2d').drawImage(img, 0, 0, mainCanvas.width, mainCanvas.height);
              drawBase();
              dropzone.classList.add('hidden');
              detectBtn.disabled = false;
              changeBtn.style.display = 'block';
              applyProject();
            };
            img.src = data.imageDataUrl;
          } else {
            applyProject();
          }
        } else {
          throw new Error('無効なデータ形式です');
        }
      } catch (err) {
        showToast('読み込みに失敗しました。正しいプロジェクトファイル(.json)を選択してください。');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ---- エクスポート設定 ----
function segGroupEx(groupId, attr, setter) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.seg-btn').forEach(btn => {
    if (btn.id === 'inpaint-toggle-btn' || btn.id === 'interact-toggle-btn') return;
    btn.addEventListener('click', () => {
      group.querySelectorAll('.seg-btn').forEach(b => {
        if (b.id === 'inpaint-toggle-btn' || b.id === 'interact-toggle-btn') return;
        b.style.background = 'var(--surface2)';
        b.style.color = 'var(--muted)';
        b.style.borderColor = 'var(--border)';
      });
      btn.style.background = 'rgba(167,139,250,0.12)';
      btn.style.color = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
      setter(btn.dataset[attr]);
    });
  });
}

segGroupEx('ex-res-group', 'res', v => { exportRes = parseFloat(v); updateExportHint(); });
segGroupEx('ex-fmt-group', 'fmt', v => {
  exportFmt = v;
  const qRow = document.getElementById('gif-quality-row');
  if (qRow) qRow.style.display = v === 'gif' ? 'flex' : 'none';
  updateExportHint();
});
segGroupEx('ex-frames-group', 'frames', v => { exportFrames = parseInt(v); updateExportHint(); });
segGroupEx('ex-quality-group', 'quality', v => { exportQuality = parseInt(v); updateExportHint(); });

function updateExportHint() {
  const warning = document.getElementById('gif-heavy-warning');
  const recommend = document.getElementById('ex-recommend-text');

  if (warning) {
    warning.style.display = (exportFmt === 'gif' && exportQuality === 1) ? 'block' : 'none';
  }

  if (!recommend) return;
  if (exportFmt === 'webm' || exportFmt === 'webp') {
    recommend.textContent = '✅ 動画形式は速くて高品質。動画編集ソフトへの素材に最適';
  } else if (exportFmt === 'gif' && exportRes <= 0.5 && exportFrames <= 12) {
    recommend.textContent = '⚡ SNS・Discord向け。軽くて速い';
  } else if (exportFmt === 'gif' && exportQuality === 1) {
    recommend.textContent = '⚠ GIF高品質は時間がかかる割に効果小。WebMを推奨';
    recommend.style.color = '#fbbf24';
    return;
  } else if (exportFmt === 'gif' && exportRes >= 1 && exportFrames >= 30) {
    recommend.textContent = '⚠ 等倍×30フレームは重い。75%×20fでも十分きれい';
    recommend.style.color = '#fbbf24';
    return;
  } else if (exportFmt === 'gif' && exportRes === 0.75 && exportFrames === 20) {
    recommend.textContent = '✅ バランス重視のおすすめ設定';
  } else if (exportFmt === 'apng') {
    recommend.textContent = '🎨 透過PNG素材向け。ファイルサイズは大きめ';
  } else {
    recommend.textContent = 'GIF・75%・20f・速い — バランス重視';
  }
  recommend.style.color = 'var(--muted)';
}

function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ---- エクスポート実行 ----
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    if (!imageLoaded || detectedRegions.length === 0) return;
    exportBtn.disabled = true;
    exportBtn.textContent = '⏳ 処理中...';
    const wrap = document.getElementById('ex-progress-wrap');
    const fill = document.getElementById('ex-progress-fill');
    const label = document.getElementById('ex-progress-label');
    wrap.style.display = 'flex';
    fill.style.width = '0%';

    if (editMode) {
      editMode = false;
      overlayCanvas.classList.remove('edit-mode');
      if (editBar) editBar.classList.remove('visible');
    }
    stopAnim();

    try {
      const W = mainCanvas.width, H = mainCanvas.height;
      const expW = Math.round(W * exportRes);
      const expH = Math.round(H * exportRes);

      detectedRegions.forEach(r => { r._cache = null; });
      cacheInpaintedBackgrounds();
      const dur = cachedSpd * 1000;
      const delay = Math.round(dur / exportFrames);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = expW; offCanvas.height = expH;
      const offCtx = offCanvas.getContext('2d');

      function captureFrame(t) {
        renderAnimFrame(t);
        offCtx.clearRect(0, 0, expW, expH);
        offCtx.drawImage(mainCanvas, 0, 0, W, H, 0, 0, expW, expH);
      }

      function updateProgress(i, total, prefix) {
        const pct = Math.round((i / total) * 100);
        fill.style.width = pct + '%';
        label.textContent = (prefix || '') + i + ' / ' + total + ' フレーム';
      }

      if (exportFmt === 'gif') {
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        const gif = new GIF({ workers: 4, quality: exportQuality, width: expW, height: expH });
        for (let i = 0; i < exportFrames; i++) {
          captureFrame(i / exportFrames * (dur / 1000));
          gif.addFrame(offCanvas, { delay, copy: true });
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, 0));
        }
        gif.on('progress', p => {
          fill.style.width = (50 + p * 50) + '%';
          label.textContent = 'エンコード中... ' + Math.round(p * 100) + '%';
        });
        gif.on('finished', blob => { showPreview(blob, 'hair_animated.gif', 'image/gif', expW, expH); finishExport(); });
        gif.render();
        return;

      } else if (exportFmt === 'webm') {
        const stream = offCanvas.captureStream(exportFrames);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => { showPreview(new Blob(chunks, { type: 'video/webm' }), 'hair_animated.webm', 'video/webm', expW, expH); finishExport(); };
        recorder.start();
        for (let i = 0; i < exportFrames; i++) {
          captureFrame(i / exportFrames * (dur / 1000));
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, delay));
        }
        recorder.stop();
        return;

      } else if (exportFmt === 'webp') {
        const stream = offCanvas.captureStream(exportFrames);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => { showPreview(new Blob(chunks, { type: 'video/webm' }), 'hair_animated_alpha.webm', 'video/webm', expW, expH); finishExport(); };
        recorder.start();
        for (let i = 0; i < exportFrames; i++) {
          renderAnimFrame(i / exportFrames * (dur / 1000));
          offCtx.clearRect(0, 0, W, H);
          offCtx.drawImage(mainCanvas, 0, 0);
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, delay));
        }
        recorder.stop();
        return;

      } else if (exportFmt === 'apng') {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js');
        const frames = [];
        for (let i = 0; i < exportFrames; i++) {
          renderAnimFrame(i / exportFrames * (dur / 1000));
          offCtx.clearRect(0, 0, W, H);
          offCtx.drawImage(mainCanvas, 0, 0);
          frames.push(offCtx.getImageData(0, 0, expW, expH).data.buffer);
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, 0));
        }
        label.textContent = 'エンコード中...';
        const apngBuf = UPNG.encode(frames, expW, expH, 0, Array(exportFrames).fill(delay));
        const blob = new Blob([apngBuf], { type: 'image/png' });
        showPreview(blob, 'hair_animated.apng', 'image/png', expW, expH);
        finishExport();
        return;
      }

      finishExport();

    } catch (err) {
      showToast('エクスポートエラー: ' + err.message);
      finishExport();
    }

    function showPreview(blob, filename, mimeType, w, h) {
      const url = URL.createObjectURL(blob);
      const modal = document.getElementById('preview-modal');
      const previewImg = document.getElementById('preview-gif');
      const downloadBtn = document.getElementById('preview-download-btn');
      const closeBtn = document.getElementById('preview-close-btn');
      const sizeNote = document.getElementById('preview-size-note');

      if (sizeNote) {
        const kb = (blob.size / 1024).toFixed(0);
        const mb = (blob.size / 1024 / 1024).toFixed(1);
        const sizeStr = blob.size > 1024 * 1024 ? mb + ' MB' : kb + ' KB';
        sizeNote.textContent = `${w}×${h}px · ${sizeStr}`;
      }

      if (mimeType === 'video/webm') {
        let video = document.getElementById('preview-video');
        if (!video) {
          video = document.createElement('video');
          video.id = 'preview-video';
          video.autoplay = true;
          video.loop = true;
          video.muted = true;
          video.style.cssText = 'max-width:min(400px,80vw);max-height:50vh;border-radius:8px;display:block;margin:0 auto';
          previewImg.parentNode.insertBefore(video, previewImg);
        }
        previewImg.style.display = 'none';
        video.style.display = 'block';
        video.src = url;
      } else {
        const video = document.getElementById('preview-video');
        if (video) video.style.display = 'none';
        previewImg.style.display = 'block';
        previewImg.src = url;
      }

      modal.style.display = 'flex';
      downloadBtn.onclick = () => downloadBlob(blob, filename);
      closeBtn.onclick = () => {
        modal.style.display = 'none';
        URL.revokeObjectURL(url);
      };
    }

    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function finishExport() {
      exportBtn.disabled = false;
      exportBtn.textContent = '🎬 保存する';
      wrap.style.display = 'none';
      fill.style.width = '0%';
      startAnim();
    }
  });
}
