// hair-animator.js
// ロード順: 2番目（ha-state.js の後、ha-anim.js の前）
// 担当: FILE LOAD / TOAST / STATUS / AI検出 / リージョンリスト / 背景インペイント / オーバーレイ描画 / スライダー

// ============================================================
// FILE LOAD
// ============================================================
changeBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  loadImage(file);
  e.target.value = '';
});
canvasBox.addEventListener('dragover', e => { e.preventDefault(); canvasBox.classList.add('dragover'); });
canvasBox.addEventListener('dragleave', () => canvasBox.classList.remove('dragover'));
canvasBox.addEventListener('drop', e => {
  e.preventDefault(); canvasBox.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadImage(f);
});

function loadImage(file) {
  imageFile = file;
  const url = URL.createObjectURL(file);
  imageEl = new Image();
  imageEl.onload = () => {
    imageLoaded = true;
    const maxW = canvasBox.offsetWidth - 32;
    const maxH = 440;
    const scale = Math.min(maxW / imageEl.naturalWidth, maxH / imageEl.naturalHeight, 1);
    mainCanvas.width  = Math.round(imageEl.naturalWidth * scale);
    mainCanvas.height = Math.round(imageEl.naturalHeight * scale);
    overlayCanvas.width  = mainCanvas.width;
    overlayCanvas.height = mainCanvas.height;

    mainCanvas.style.display = 'block';
    overlayCanvas.style.display = 'block';

    if (!mCtx) mCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
    if (!oCtx) oCtx = overlayCanvas.getContext('2d');
    overlayCanvas.style.width  = mainCanvas.width + 'px';
    overlayCanvas.style.height = mainCanvas.height + 'px';
    overlayCanvas.style.left   = mainCanvas.offsetLeft + 'px';
    overlayCanvas.style.top    = mainCanvas.offsetTop + 'px';

    originalCanvas = document.createElement('canvas');
    originalCanvas.width = mainCanvas.width;
    originalCanvas.height = mainCanvas.height;
    originalCanvas.getContext('2d').drawImage(imageEl, 0, 0, mainCanvas.width, mainCanvas.height);

    drawBase();
    dropzone.classList.add('hidden');
    detectBtn.disabled = false;
    changeBtn.style.display = 'block';
    detectedRegions = [];
    regionsPanel.style.display = 'none';
    animPanel.style.display = 'none';
    stopAnim();
    setStatus('idle', 'イラスト読み込み完了。「部位を自動検出」を押してください。');
  };
  imageEl.src = url;
}

function drawBase() {
  mCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  mCtx.drawImage(imageEl, 0, 0, mainCanvas.width, mainCanvas.height);
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ============================================================
// STATUS
// ============================================================
function setStatus(state, msg) {
  statusDot.className = 'status-dot' + (state === 'loading' ? ' active' : state === 'done' ? ' done' : state === 'error' ? ' error' : '');
  statusText.textContent = msg;
}

// ============================================================
// AI DETECTION
// ============================================================
detectBtn.addEventListener('click', async () => {
  if (!imageLoaded) return;
  detectBtn.disabled = true;
  setStatus('loading', 'AIが部位を解析中...');

  try {
    const base64 = await fileToBase64(imageFile);
    const mimeType = imageFile.type || 'image/png';

    const prompt = `このイラスト画像を解析して、アニメーション（揺らすこと）に適した部位を検出してください。

以下のJSON形式のみで返答してください（説明文・マークダウン不要）:
{
  "regions": [
    {
      "label": "部位名（日本語、例: 髪の毛、スカート、リボン、袖、尻尾など）",
      "polygon": [[x1,y1],[x2,y2],...],
      "anchor": [ax, ay],
      "description": "どんな動きが自然か一言で"
    }
  ]
}

重要なルール:
- polygonの座標は画像の幅・高さに対する0〜1の比率で指定（例: 0.5 = 中央）
- anchorは揺れの起点（根元）となる点
- 最大5部位まで
- 動かせそうな部位がない場合は regions: [] を返す
- 必ずJSONのみ返すこと、前後に文字を入れないこと`;

    const endpoint = '/api/gemini-detect';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const raw = data.candidates[0].content.parts[0].text || '';
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    const regions = parsed.regions || [];

    if (regions.length === 0) {
      setStatus('error', '動かせる部位が見つかりませんでした。別のイラストを試してみてください。');
      detectBtn.disabled = false;
      return;
    }

    detectedRegions = regions.map((r, i) => ({
      ...r,
      color: REGION_COLORS[i % REGION_COLORS.length],
      enabled: true,
      animOffset: Math.random() * Math.PI * 2,
      animType: null,
      animSpd: null,
      animAmp: null,
      pins: []
    }));

    renderRegionList();
    drawOverlay();
    startAnim();

    regionsPanel.style.display = 'block';
    animPanel.style.display = 'block';
    const exPanel = document.getElementById('export-panel');
    if (exPanel) exPanel.style.display = 'block';
    const rdb = document.getElementById('redetect-btn');
    if (rdb) rdb.style.display = 'block';
    undoStack = [];
    saveUndoState();
    setStatus('done', `${detectedRegions.length}つの部位を検出しました。`);
    detectBtn.disabled = false;

  } catch (e) {
    console.error(e);
    setStatus('error', 'エラーが発生しました: ' + e.message);
    detectBtn.disabled = false;
  }
});

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ============================================================
// REGION LIST UI
// ============================================================
function renderRegionList() {
  regionList.innerHTML = '';
  detectedRegions.forEach((region, i) => {
    const item = document.createElement('div');
    item.className = 'region-item' + (region.enabled ? ' active' : '');

    item.innerHTML = `
      <div class="region-color" style="background:${region.color}"></div>
      <div class="region-label" style="flex:1;">
        <span class="region-label-text"></span>
        <div class="region-desc-text" style="font-size:10px;color:var(--muted);margin-top:2px"></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:2px; margin-right:8px; align-items:center;">
        <button class="layer-up" style="background:none; border:none; color:${i === 0 ? 'transparent' : 'var(--muted)'}; cursor:${i === 0 ? 'default' : 'pointer'}; font-size:10px; padding:2px;" title="順序を奥へ">▲</button>
        <button class="layer-down" style="background:none; border:none; color:${i === detectedRegions.length - 1 ? 'transparent' : 'var(--muted)'}; cursor:${i === detectedRegions.length - 1 ? 'default' : 'pointer'}; font-size:10px; padding:2px;" title="順序を手前へ">▼</button>
      </div>
      <button class="layer-delete" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:13px; margin-right:6px; padding:4px;" title="この部位を削除">🗑️</button>
      <div class="region-toggle ${region.enabled ? 'on' : ''}" data-idx="${i}"></div>
    `;
    item.querySelector('.region-label-text').textContent = region.label || '';
    item.querySelector('.region-desc-text').textContent = region.description || '';

    const upBtn = item.querySelector('.layer-up');
    const downBtn = item.querySelector('.layer-down');
    const delBtn = item.querySelector('.layer-delete');

    if (i > 0) {
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        [detectedRegions[i - 1], detectedRegions[i]] = [detectedRegions[i], detectedRegions[i - 1]];
        if (editingRegionIdx === i) editingRegionIdx = i - 1;
        else if (editingRegionIdx === i - 1) editingRegionIdx = i;
        saveUndoState();
        renderRegionList();
        cacheInpaintedBackgrounds();
        if(editMode) drawEditOverlay(); else drawOverlay();
      });
    }
    if (i < detectedRegions.length - 1) {
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        [detectedRegions[i + 1], detectedRegions[i]] = [detectedRegions[i], detectedRegions[i + 1]];
        if (editingRegionIdx === i) editingRegionIdx = i + 1;
        else if (editingRegionIdx === i + 1) editingRegionIdx = i;
        saveUndoState();
        renderRegionList();
        cacheInpaintedBackgrounds();
        if(editMode) drawEditOverlay(); else drawOverlay();
      });
    }

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (delBtn.dataset.confirming === '1') {
        saveUndoState();
        detectedRegions.splice(i, 1);
        if (editingRegionIdx === i) editingRegionIdx = -1;
        else if (editingRegionIdx > i) editingRegionIdx--;
        renderRegionList();
        cacheInpaintedBackgrounds();
        if (editMode) drawEditOverlay(); else drawOverlay();
      } else {
        delBtn.dataset.confirming = '1';
        delBtn.textContent = '本当に削除？';
        delBtn.style.color = '#fff';
        delBtn.style.background = '#ef4444';
        delBtn.style.borderRadius = '6px';
        delBtn.style.padding = '2px 6px';
        delBtn.style.fontSize = '10px';
        setTimeout(() => {
          if (delBtn.dataset.confirming === '1') {
            delBtn.dataset.confirming = '0';
            delBtn.textContent = '🗑️';
            delBtn.style.cssText = 'background:none; border:none; color:#f87171; cursor:pointer; font-size:13px; margin-right:6px; padding:4px;';
          }
        }, 2500);
      }
    });

    item.querySelector('.region-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      detectedRegions[i].enabled = !detectedRegions[i].enabled;
      renderRegionList();
      cacheInpaintedBackgrounds();
      drawOverlay();
    });

    const settingPanel = document.createElement('div');
    settingPanel.style.cssText = 'display:none;padding:10px 12px;background:var(--surface2);border-radius:0 0 8px 8px;border:1px solid var(--border);border-top:none;margin-top:-4px;margin-bottom:4px';
    const animTypes = [
      { val: 'sway', label: 'ゆらゆら' },
      { val: 'wave', label: 'なびく' },
      { val: 'bounce', label: 'はずむ' },
      { val: 'ripple', label: '波打つ' },
    ];
    const currentType = region.animType || animType;
    settingPanel.innerHTML = `
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">アニメーション種類</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">
        ${animTypes.map(t => `<button data-atype="${t.val}" style="
          background:${currentType===t.val?'rgba(167,139,250,0.15)':'var(--surface)'};
          border:1px solid ${currentType===t.val?'var(--accent)':'var(--border)'};
          color:${currentType===t.val?'var(--accent)':'var(--muted)'};
          border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer
        ">${t.label}</button>`).join('')}
        <button data-atype="global" style="
          background:${!region.animType?'rgba(167,139,250,0.15)':'var(--surface)'};
          border:1px solid ${!region.animType?'var(--accent)':'var(--border)'};
          color:${!region.animType?'var(--accent)':'var(--muted)'};
          border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer
        ">共通</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">スピード <span id="reg-spd-val-${i}">${region.animSpd ?? '共通'}</span></div>
      <input type="range" data-ridx="${i}" class="reg-spd" min="0.8" max="5" step="0.1" value="${region.animSpd ?? parseFloat(document.getElementById('spd').value)}"
        style="-webkit-appearance:none;width:100%;height:3px;background:var(--border);border-radius:2px;outline:none;cursor:pointer;margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">揺れ幅 <span id="reg-amp-val-${i}">${region.animAmp ?? '共通'}</span></div>
      <input type="range" data-ridx="${i}" class="reg-amp" min="3" max="30" step="1" value="${region.animAmp ?? parseFloat(document.getElementById('amp').value)}"
        style="-webkit-appearance:none;width:100%;height:3px;background:var(--border);border-radius:2px;outline:none;cursor:pointer">
      <div style="margin-top:8px">
        <button class="reg-reset" data-ridx="${i}" style="font-size:10px;color:var(--muted);background:none;border:none;cursor:pointer;text-decoration:underline">共通設定にリセット</button>
      </div>
    `;

    settingPanel.querySelectorAll('[data-atype]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.atype;
        detectedRegions[i].animType = t === 'global' ? null : t;
        renderRegionList();
      });
    });

    settingPanel.querySelector('.reg-spd').addEventListener('input', function() {
      detectedRegions[i].animSpd = parseFloat(this.value);
      const v = document.getElementById('reg-spd-val-' + i);
      if (v) v.textContent = parseFloat(this.value).toFixed(1) + 's';
    });

    settingPanel.querySelector('.reg-amp').addEventListener('input', function() {
      detectedRegions[i].animAmp = parseFloat(this.value);
      const v = document.getElementById('reg-amp-val-' + i);
      if (v) v.textContent = this.value;
    });

    settingPanel.querySelector('.reg-reset').addEventListener('click', () => {
      detectedRegions[i].animType = null;
      detectedRegions[i].animSpd = null;
      detectedRegions[i].animAmp = null;
      renderRegionList();
    });

    item.querySelector('.region-label').style.cursor = 'pointer';
    item.querySelector('.region-label').addEventListener('click', (e) => {
      if (e.detail === 2) {
        const labelEl = item.querySelector('.region-label');
        const current = region.label;
        const input = document.createElement('input');
        input.value = current;
        input.style.cssText = 'background:var(--surface);border:1px solid var(--accent);border-radius:4px;color:var(--text);font-size:13px;padding:2px 6px;width:100%;outline:none';
        labelEl.innerHTML = '';
        labelEl.appendChild(input);
        input.focus();
        input.select();
        const finish = () => {
          const newLabel = input.value.trim() || current;
          detectedRegions[i].label = newLabel;
          renderRegionList();
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', e2 => {
          if (e2.key === 'Enter') finish();
          if (e2.key === 'Escape') { detectedRegions[i].label = current; renderRegionList(); }
        });
      } else {
        settingPanel.style.display = settingPanel.style.display === 'none' ? 'block' : 'none';
      }
    });

    regionList.appendChild(item);
    regionList.appendChild(settingPanel);
  });
}

// ============================================================
// BACKGROUND INPAINTING
// ============================================================
function cacheInpaintedBackgrounds() {
  if (!imageLoaded || !originalCanvas) return;
  const W = originalCanvas.width, H = originalCanvas.height;

  if (!inpaintBaseCanvas) {
    inpaintBaseCanvas = document.createElement('canvas');
  }
  inpaintBaseCanvas.width = W;
  inpaintBaseCanvas.height = H;
  const bgCtx = inpaintBaseCanvas.getContext('2d', { willReadFrequently: true });
  bgCtx.drawImage(originalCanvas, 0, 0);

  if (!useInpaint) return;

  detectedRegions.forEach(region => {
    if (!region.enabled || !region.polygon || region.polygon.length < 3) return;

    const xs = region.polygon.map(([x]) => x * W);
    const ys = region.polygon.map(([, y]) => y * H);
    const minX = Math.floor(Math.min(...xs));
    const maxX = Math.ceil(Math.max(...xs));
    const minY = Math.floor(Math.min(...ys));
    const maxY = Math.ceil(Math.max(...ys));
    const rw = maxX - minX, rh = maxY - minY;

    if (rw <= 0 || rh <= 0) return;

    const pad = 24;
    const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    const sw = Math.min(W - sx, rw + pad * 2), sh = Math.min(H - sy, rh + pad * 2);
    if (sw <= 0 || sh <= 0) return;

    const mask = document.createElement('canvas');
    mask.width = sw; mask.height = sh;
    const mCtx2 = mask.getContext('2d');
    mCtx2.fillStyle = '#fff';
    mCtx2.beginPath();
    region.polygon.forEach(([px, py], idx) => {
      const x = px * W - sx, y = py * H - sy;
      idx === 0 ? mCtx2.moveTo(x, y) : mCtx2.lineTo(x, y);
    });
    mCtx2.closePath();
    mCtx2.fill();

    const patch = document.createElement('canvas');
    patch.width = sw; patch.height = sh;
    const pCtx = patch.getContext('2d');
    pCtx.drawImage(originalCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    pCtx.globalCompositeOperation = 'destination-out';
    pCtx.drawImage(mask, 0, 0);

    pCtx.globalCompositeOperation = 'destination-over';
    let pass = document.createElement('canvas');
    pass.width = sw; pass.height = sh;
    let passCtx = pass.getContext('2d', {willReadFrequently: true});
    passCtx.drawImage(patch, 0, 0);

    for(let i = 0; i < 8; i++) {
       const temp = document.createElement('canvas');
       temp.width = sw; temp.height = sh;
       const tCtx = temp.getContext('2d');
       tCtx.drawImage(pass, 0, 0);

       passCtx.clearRect(0,0,sw,sh);
       const offsets = [[2,0],[-2,0],[0,2],[0,-2], [2,2],[-2,-2],[2,-2],[-2,2]];
       passCtx.globalAlpha = 0.7;
       offsets.forEach(([dx,dy]) => {
           passCtx.drawImage(temp, dx, dy);
       });
       passCtx.globalAlpha = 1.0;
    }

    bgCtx.save();
    bgCtx.beginPath();
    region.polygon.forEach(([px, py], idx) => {
      const x = px * W, y = py * H;
      idx === 0 ? bgCtx.moveTo(x, y) : bgCtx.lineTo(x, y);
    });
    bgCtx.closePath();
    bgCtx.clip();

    bgCtx.filter = 'blur(6px)';
    bgCtx.drawImage(pass, sx, sy);
    bgCtx.restore();
  });
}

const inpaintToggleBtn = document.getElementById('inpaint-toggle-btn');
if (inpaintToggleBtn) {
  inpaintToggleBtn.addEventListener('click', () => {
    useInpaint = !useInpaint;
    if (useInpaint) {
      inpaintToggleBtn.textContent = 'ON';
      inpaintToggleBtn.style.background = 'rgba(167,139,250,0.12)';
      inpaintToggleBtn.style.color = 'var(--accent)';
      inpaintToggleBtn.style.borderColor = 'var(--accent)';
    } else {
      inpaintToggleBtn.textContent = 'OFF';
      inpaintToggleBtn.style.background = 'var(--surface2)';
      inpaintToggleBtn.style.color = 'var(--muted)';
      inpaintToggleBtn.style.borderColor = 'var(--border)';
    }
    cacheInpaintedBackgrounds();
  });
}

const interactToggleBtn = document.getElementById('interact-toggle-btn');
if (interactToggleBtn) {
  interactToggleBtn.addEventListener('click', () => {
    useInteract = !useInteract;
    if (useInteract) {
      interactToggleBtn.textContent = 'ON';
      interactToggleBtn.style.background = 'rgba(167,139,250,0.12)';
      interactToggleBtn.style.color = 'var(--accent)';
      interactToggleBtn.style.borderColor = 'var(--accent)';
    } else {
      interactToggleBtn.textContent = 'OFF';
      interactToggleBtn.style.background = 'var(--surface2)';
      interactToggleBtn.style.color = 'var(--muted)';
      interactToggleBtn.style.borderColor = 'var(--border)';
    }
  });
}

// ============================================================
// OVERLAY DRAWING
// ============================================================
function drawOverlay(t = 0) {
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const W = overlayCanvas.width, H = overlayCanvas.height;

  detectedRegions.forEach(region => {
    if (!region.polygon || region.polygon.length < 3) return;
    const color = region.color;

    oCtx.beginPath();
    region.polygon.forEach(([px, py], idx) => {
      const x = px * W, y = py * H;
      idx === 0 ? oCtx.moveTo(x, y) : oCtx.lineTo(x, y);
    });
    oCtx.closePath();

    if (region.enabled) {
      oCtx.fillStyle = color + '22';
      oCtx.fill();
      oCtx.strokeStyle = color;
      oCtx.lineWidth = 1.5;
      oCtx.setLineDash([]);
      oCtx.stroke();
    } else {
      oCtx.strokeStyle = color + '55';
      oCtx.lineWidth = 1;
      oCtx.setLineDash([4, 4]);
      oCtx.stroke();
      oCtx.setLineDash([]);
    }
  });
}

// ============================================================
// ANIM TYPE SELECTOR & SLIDERS
// ============================================================
document.querySelectorAll('.anim-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.anim-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    animType = chip.dataset.anim;
  });
});

['spd','amp','smooth','feather'].forEach(id => {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  if (el && valEl) {
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (id === 'spd')     { valEl.textContent = v.toFixed(1) + 's'; cachedSpd = v; }
      else if (id === 'amp')    { valEl.textContent = el.value; cachedAmp = v; }
      else if (id === 'smooth') { valEl.textContent = el.value; cachedSmooth = v; }
      else if (id === 'feather'){ valEl.textContent = el.value + 'px'; cachedFeather = v; }
    });
  }
});
