// hair-animator.js

window.onerror = (msg, src, line) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="background:red;color:white;padding:12px;font-size:13px;position:fixed;top:0;left:0;right:0;z-index:9999;word-break:break-all">JS Error 行${line}: ${msg}</div>`
  );
};

// ============================================================
// STATE
// ============================================================
let imageFile = null;
let imageEl = null;
let imageLoaded = false;
let detectedRegions = []; // [{label, color, polygon, enabled, animOffset}]
let animType = 'sway';
let rafId = null;
let startTime = null;

const REGION_COLORS = ['#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171'];

// ============================================================
// DOM
// ============================================================
const dropzone    = document.getElementById('dropzone');
const canvasBox   = document.getElementById('canvas-box');
const mainCanvas  = document.getElementById('main-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
let mCtx = null;
let oCtx = null;
const fileInput   = document.getElementById('file-input');
const detectBtn   = document.getElementById('detect-btn');
const regionsPanel= document.getElementById('regions-panel');
const animPanel   = document.getElementById('anim-panel');
const regionList  = document.getElementById('region-list');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const changeBtn   = document.getElementById('change-btn');

// ============================================================
// FILE LOAD
// ============================================================
// dropzoneはlabelなので自動でfile-inputを開く
changeBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  // デバッグ: changeイベント発火確認
  document.body.insertAdjacentHTML('afterbegin',
    `<div id="dbg" style="background:blue;color:white;padding:10px;font-size:13px;position:fixed;top:0;left:0;right:0;z-index:9999">change発火: ${file.name}</div>`
  );
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
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="background:green;color:white;padding:10px;font-size:13px;position:fixed;top:40px;left:0;right:0;z-index:9999">loadImage呼ばれた: ${file.name}</div>`
  );
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

    // center canvas in box
    mainCanvas.style.display = 'block';
    overlayCanvas.style.display = 'block';

    // canvasが表示されてからcontextを取得
    if (!mCtx) mCtx = mainCanvas.getContext('2d');
    if (!oCtx) oCtx = overlayCanvas.getContext('2d');
    overlayCanvas.style.width  = mainCanvas.width + 'px';
    overlayCanvas.style.height = mainCanvas.height + 'px';
    overlayCanvas.style.left   = mainCanvas.offsetLeft + 'px';
    overlayCanvas.style.top    = mainCanvas.offsetTop + 'px';

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
    // Convert image to base64
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

    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey) {
      setStatus('error', 'APIキーを入力してください');
      detectBtn.disabled = false;
      return;
    }

    // Gemini API エンドポイント
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
    
    // エラーハンドリング
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Geminiのレスポンスからテキスト（JSON文字列）を抽出
    const raw = data.candidates[0].content.parts[0].text || '';

    // parse JSON (strip possible markdown fences)
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    const regions = parsed.regions || [];

    if (regions.length === 0) {
      setStatus('error', '動かせる部位が見つかりませんでした。別のイラストを試してみてください。');
      detectBtn.disabled = false;
      return;
    }

    // Store with color and enabled state
    detectedRegions = regions.map((r, i) => ({
      ...r,
      color: REGION_COLORS[i % REGION_COLORS.length],
      enabled: true,
      animOffset: Math.random() * Math.PI * 2,
      // 部位ごとのアニメ設定（デフォルトはグローバル値）
      animType: null,   // nullの場合はグローバルのanimTypeを使う
      animSpd: null,    // nullの場合はグローバルのspdを使う
      animAmp: null,    // nullの場合はグローバルのampを使う
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
      <div class="region-label">${region.label}<div style="font-size:10px;color:var(--muted);margin-top:2px">${region.description||''}</div></div>
      <div class="region-toggle ${region.enabled ? 'on' : ''}" data-idx="${i}"></div>
    `;
    item.querySelector('.region-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      detectedRegions[i].enabled = !detectedRegions[i].enabled;
      renderRegionList();
      drawOverlay();
    });

    // 部位ごとの設定パネル（タップで展開）
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

    // アニメ種類ボタン
    settingPanel.querySelectorAll('[data-atype]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.atype;
        detectedRegions[i].animType = t === 'global' ? null : t;
        renderRegionList(); // 再描画
      });
    });

    // スピードスライダー
    settingPanel.querySelector('.reg-spd').addEventListener('input', function() {
      detectedRegions[i].animSpd = parseFloat(this.value);
      const v = document.getElementById('reg-spd-val-' + i);
      if (v) v.textContent = parseFloat(this.value).toFixed(1) + 's';
    });

    // 揺れ幅スライダー
    settingPanel.querySelector('.reg-amp').addEventListener('input', function() {
      detectedRegions[i].animAmp = parseFloat(this.value);
      const v = document.getElementById('reg-amp-val-' + i);
      if (v) v.textContent = this.value;
    });

    // リセットボタン
    settingPanel.querySelector('.reg-reset').addEventListener('click', () => {
      detectedRegions[i].animType = null;
      detectedRegions[i].animSpd = null;
      detectedRegions[i].animAmp = null;
      renderRegionList();
    });

    // 部位名クリックで設定パネル開閉
    item.querySelector('.region-label').style.cursor = 'pointer';
    item.querySelector('.region-label').addEventListener('click', () => {
      settingPanel.style.display = settingPanel.style.display === 'none' ? 'block' : 'none';
    });

    regionList.appendChild(item);
    regionList.appendChild(settingPanel);
  });
}

// ============================================================
// OVERLAY DRAWING (static polygon outlines)
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
// ANIMATION — warp the canvas pixels inside each polygon
// ============================================================
function startAnim() {
  stopAnim();
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
  const spd  = parseFloat(document.getElementById('spd').value);
  const amp  = parseFloat(document.getElementById('amp').value);
  const smooth = parseFloat(document.getElementById('smooth').value);

  // Start from original image
  mCtx.clearRect(0, 0, W, H);
  mCtx.drawImage(imageEl, 0, 0, W, H);

  // For each enabled region: warp pixels using displacement map
  detectedRegions.forEach(region => {
    if (!region.enabled || !region.polygon || region.polygon.length < 3) return;

    // 部位ごとの設定（nullなら共通設定を使う）
    const rSpd = region.animSpd ?? spd;
    const rAmp = region.animAmp ?? amp;
    const rType = region.animType ?? animType;

    const phase = (t / rSpd) * Math.PI * 2 + region.animOffset;

    // Get bounding box of polygon
    const xs = region.polygon.map(([x]) => x * W);
    const ys = region.polygon.map(([, y]) => y * H);
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - 2);
    const maxX = Math.min(W, Math.ceil(Math.max(...xs)) + 2);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const maxY = Math.min(H, Math.ceil(Math.max(...ys)) + 2);

    const anchorX = (region.anchor?.[0] ?? 0.5) * W;
    const anchorY = (region.anchor?.[1] ?? 0) * H;

    // アンカー自動追従: 部位サイズに応じてinfluenceのスケールを自動調整
    const regionDiag = Math.hypot(maxX - minX, maxY - minY);
    const influenceScale = regionDiag > 0 ? regionDiag * 0.6 : 100;

    // Get bounding box of polygon
    const xs = region.polygon.map(([x]) => x * W);
    const ys = region.polygon.map(([, y]) => y * H);
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - 2);
    const maxX = Math.min(W, Math.ceil(Math.max(...xs)) + 2);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const maxY = Math.min(H, Math.ceil(Math.max(...ys)) + 2);

    const anchorX = (region.anchor?.[0] ?? 0.5) * W;
    const anchorY = (region.anchor?.[1] ?? 0) * H;

    // Extract region pixels from original
    const regionW = maxX - minX, regionH = maxY - minY;
    if (regionW <= 0 || regionH <= 0) return;

    // Draw warped region into temp canvas
    const tmp = document.createElement('canvas');
    tmp.width = regionW; tmp.height = regionH;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(mainCanvas, minX, minY, regionW, regionH, 0, 0, regionW, regionH);
    const imgData = tCtx.getImageData(0, 0, regionW, regionH);
    const src = new Uint8ClampedArray(imgData.data);

    const out = tCtx.createImageData(regionW, regionH);
    const dst = out.data;

    for (let py = 0; py < regionH; py++) {
      for (let px = 0; px < regionW; px++) {
        const worldX = minX + px;
        const worldY = minY + py;

        if (!pointInPolygon(worldX / W, worldY / H, region.polygon)) {
          // Outside polygon: copy as-is
          const idx = (py * regionW + px) * 4;
          dst[idx]   = src[idx];
          dst[idx+1] = src[idx+1];
          dst[idx+2] = src[idx+2];
          dst[idx+3] = src[idx+3];
          continue;
        }

        // Inside polygon: apply warp based on distance from anchor
        const distFromAnchor = Math.sqrt((worldX - anchorX) ** 2 + (worldY - anchorY) ** 2);
        // アンカー自動追従: 部位サイズに応じたinfluenceScale
        const influence = Math.min(distFromAnchor / influenceScale, 1) * rAmp;

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

        // 境界なめらか化: ポリゴン境界に近いほどアルファをフェード
        const FADE_PX = 4;
        const dLeft = worldX - minX, dRight = maxX - worldX;
        const dTop = worldY - minY, dBottom = maxY - worldY;
        const minEdgeDist = Math.min(dLeft, dRight, dTop, dBottom);
        const edgeFade = minEdgeDist < FADE_PX ? minEdgeDist / FADE_PX : 1;

        const srcX = Math.round(px - offsetX);
        const srcY = Math.round(py - offsetY);
        const idx = (py * regionW + px) * 4;

        if (srcX >= 0 && srcX < regionW && srcY >= 0 && srcY < regionH) {
          const srcIdx = (srcY * regionW + srcX) * 4;
          dst[idx]   = src[srcIdx];
          dst[idx+1] = src[srcIdx+1];
          dst[idx+2] = src[srcIdx+2];
          // 境界フェード適用
          dst[idx+3] = Math.round(src[srcIdx+3] * edgeFade);
        } else {
          dst[idx+3] = 0;
        }
      }
    }

    tCtx.putImageData(out, 0, 0);
    mCtx.clearRect(minX, minY, regionW, regionH);
    mCtx.drawImage(tmp, minX, minY);
  });
}

// ============================================================
// UTILITY
// ============================================================
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ============================================================
// ANIM TYPE SELECTOR
// ============================================================
document.querySelectorAll('.anim-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.anim-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    animType = chip.dataset.anim;
  });
});

// ============================================================
// SLIDER VALUE DISPLAY
// ============================================================
['spd','amp','smooth'].forEach(id => {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  if (el && valEl) {
    el.addEventListener('input', () => {
      valEl.textContent = id === 'spd' ? parseFloat(el.value).toFixed(1) + 's' : el.value;
    });
  }
});

// ============================================================
// 頂点編集モード（ポリゴンの頂点を直接動かす）
// ============================================================
let editMode = false;
let editingRegionIdx = -1;
let draggingVertexIdx = -1;
let draggingAnchor = false;
let lastTapTime = 0;
let lastTapVertexIdx = -1;

const editBtn     = document.getElementById('edit-btn');
const editBar     = document.getElementById('edit-bar');
const editDoneBtn = document.getElementById('edit-done-btn');

if (editBtn && editBar && editDoneBtn) {
  editBtn.addEventListener('click', () => {
    if (detectedRegions.length === 0) return;
    editMode = false; addingRegionMode = false;
    editMode = true;
    editingRegionIdx = detectedRegions.findIndex(r => r.enabled);
    if (editingRegionIdx < 0) editingRegionIdx = 0;
    overlayCanvas.classList.add('edit-mode');
    editBar.classList.add('visible');
    const tip = document.getElementById('edit-tip-text');
    if (tip) tip.innerHTML = '<b>編集モード：</b>頂点ドラッグで移動 / 辺タップで追加 / 頂点ダブルタップで削除 / ⚓ドラッグでアンカー移動';
    stopAnim();
    saveUndoState();
    drawEditOverlay();
    const zc = document.getElementById('zoom-controls');
    if (zc) zc.classList.add('visible');
  });

  editDoneBtn.addEventListener('click', () => {
    editMode = false;
    addingRegionMode = false;
    editingRegionIdx = -1;
    draggingVertexIdx = -1;
    draggingAnchor = false;
    overlayCanvas.classList.remove('edit-mode');
    editBar.classList.remove('visible');
    resetZoom();
    const zc = document.getElementById('zoom-controls');
    if (zc) zc.classList.remove('visible');
    drawOverlay();
    startAnim();
  });
}

// 点が多角形の中にあるか（編集対象切り替え用）
function pointInPolygonRatio(x, y, polygon) {
  return pointInPolygon(x, y, polygon);
}

// 編集モードのオーバーレイ描画
function drawEditOverlay() {
  if (!oCtx) return;
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const W = overlayCanvas.width, H = overlayCanvas.height;

  detectedRegions.forEach((region, i) => {
    if (!region.polygon || region.polygon.length < 3) return;
    const isEditing = i === editingRegionIdx;
    const color = region.color;

    // ポリゴン本体
    oCtx.beginPath();
    region.polygon.forEach(([px, py], idx) => {
      const x = px * W, y = py * H;
      idx === 0 ? oCtx.moveTo(x, y) : oCtx.lineTo(x, y);
    });
    oCtx.closePath();
    oCtx.fillStyle = color + (isEditing ? '33' : '11');
    oCtx.fill();
    oCtx.strokeStyle = color + (isEditing ? 'ff' : '66');
    oCtx.lineWidth = isEditing ? 2 : 1;
    oCtx.setLineDash(isEditing ? [] : [4, 4]);
    oCtx.stroke();
    oCtx.setLineDash([]);

    // ラベル
    const xs = region.polygon.map(p => p[0]);
    const ys = region.polygon.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    oCtx.fillStyle = color;
    oCtx.font = isEditing ? 'bold 13px sans-serif' : '11px sans-serif';
    oCtx.fillText(region.label || '部位' + (i+1), minX * W + 4, minY * H - 4);

    // 編集中の部位は頂点ハンドルを描く
    if (isEditing) {
      region.polygon.forEach(([px, py], idx) => {
        const x = px * W, y = py * H;
        // 外側の白い円
        oCtx.beginPath();
        oCtx.arc(x, y, 9, 0, Math.PI * 2);
        oCtx.fillStyle = '#fff';
        oCtx.fill();
        // 内側の色付き円
        oCtx.beginPath();
        oCtx.arc(x, y, 6, 0, Math.PI * 2);
        oCtx.fillStyle = color;
        oCtx.fill();
        // 縁取り
        oCtx.beginPath();
        oCtx.arc(x, y, 9, 0, Math.PI * 2);
        oCtx.strokeStyle = color;
        oCtx.lineWidth = 1.5;
        oCtx.stroke();
      });

      // anchor を描く（あれば）- ドラッグ可能な大きめのハンドル
      if (region.anchor) {
        const ax = region.anchor[0] * W, ay = region.anchor[1] * H;
        // 外側リング
        oCtx.beginPath();
        oCtx.arc(ax, ay, 12, 0, Math.PI * 2);
        oCtx.strokeStyle = color;
        oCtx.lineWidth = 2;
        oCtx.setLineDash([3, 3]);
        oCtx.stroke();
        oCtx.setLineDash([]);
        // 内側円
        oCtx.beginPath();
        oCtx.arc(ax, ay, 7, 0, Math.PI * 2);
        oCtx.fillStyle = '#fff';
        oCtx.fill();
        oCtx.strokeStyle = color;
        oCtx.lineWidth = 2;
        oCtx.stroke();
        // 十字マーク
        oCtx.strokeStyle = color;
        oCtx.lineWidth = 2;
        oCtx.beginPath();
        oCtx.moveTo(ax - 10, ay); oCtx.lineTo(ax + 10, ay);
        oCtx.moveTo(ax, ay - 10); oCtx.lineTo(ax, ay + 10);
        oCtx.stroke();
        // ラベル
        oCtx.fillStyle = color;
        oCtx.font = '10px sans-serif';
        oCtx.fillText('⚓', ax + 13, ay + 4);
      }
    }
  });
}

function getEventPos(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const touch = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  };
}

// pt座標(px) から最も近い頂点を探す
function findNearestVertex(pt) {
  if (editingRegionIdx < 0) return -1;
  const region = detectedRegions[editingRegionIdx];
  if (!region || !region.polygon) return -1;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const threshold = 22; // タッチ判定の半径(px)
  let bestIdx = -1, bestDist = Infinity;
  region.polygon.forEach(([px, py], idx) => {
    const x = px * W, y = py * H;
    const d = Math.hypot(pt.x - x, pt.y - y);
    if (d < threshold && d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

// 辺との距離から、辺の中点に頂点追加できるか判定（追加位置を返す or null）
function findEdgeInsertPoint(pt) {
  if (editingRegionIdx < 0) return null;
  const region = detectedRegions[editingRegionIdx];
  if (!region || !region.polygon || region.polygon.length < 2) return null;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const threshold = 14;
  let best = null;

  for (let i = 0; i < region.polygon.length; i++) {
    const j = (i + 1) % region.polygon.length;
    const ax = region.polygon[i][0] * W, ay = region.polygon[i][1] * H;
    const bx = region.polygon[j][0] * W, by = region.polygon[j][1] * H;
    // pt から線分ABへの最短距離
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    let t = ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq;
    t = Math.max(0.05, Math.min(0.95, t)); // 端ぎりぎりは除外
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const dist = Math.hypot(pt.x - projX, pt.y - projY);
    if (dist < threshold && (!best || dist < best.dist)) {
      best = {
        dist,
        insertAfter: i,
        point: [projX / W, projY / H],
      };
    }
  }
  return best;
}

// 他の部位の内部をタップしたか
function findRegionContaining(pt) {
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const ratioX = pt.x / W, ratioY = pt.y / H;
  for (let i = 0; i < detectedRegions.length; i++) {
    const region = detectedRegions[i];
    if (!region.polygon || region.polygon.length < 3) continue;
    if (pointInPolygon(ratioX, ratioY, region.polygon)) {
      return i;
    }
  }
  return -1;
}

function onEditStart(e) {
  if (!editMode || editingRegionIdx < 0) return;
  if (e.touches && e.touches.length === 2) return; // ピンチは無視
  e.preventDefault();
  const pt = getEventPos(e);
  const W = overlayCanvas.width, H = overlayCanvas.height;

  // 部位追加モード
  if (addingRegionMode) {
    const rx = pt.x / W, ry = pt.y / H;
    // 最初の点に近ければ確定
    if (newRegionPoints.length >= 3) {
      const [fx, fy] = newRegionPoints[0];
      if (Math.hypot((rx - fx) * W, (ry - fy) * H) < 18) {
        // 確定: 新しい部位として追加
        saveUndoState();
        const colors = ['#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171'];
        const xs = newRegionPoints.map(p => p[0]);
        const ys = newRegionPoints.map(p => p[1]);
        const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
        const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
        detectedRegions.push({
          label: '部位' + (detectedRegions.length + 1),
          polygon: newRegionPoints.map(p => [...p]),
          anchor: [cx, Math.min(...ys)],
          color: colors[detectedRegions.length % colors.length],
          enabled: true,
          animOffset: Math.random() * Math.PI * 2,
          animType: null, animSpd: null, animAmp: null,
          description: '手動追加',
        });
        editingRegionIdx = detectedRegions.length - 1;
        newRegionPoints = [];
        addingRegionMode = false;
        if (addRegionBtn) {
          addRegionBtn.style.background = '';
          addRegionBtn.style.borderColor = '';
          addRegionBtn.style.color = '';
        }
        const tip = document.getElementById('edit-tip-text');
        if (tip) tip.innerHTML = '<b>編集モード：</b>頂点ドラッグで移動 / 辺タップで追加 / 頂点ダブルタップで削除';
        renderRegionList();
        saveUndoState();
        drawEditOverlay();
        return;
      }
    }
    newRegionPoints.push([rx, ry]);
    drawAddingOverlay();
    return;
  }

  const region = detectedRegions[editingRegionIdx];

  // 0. アンカー点をつかんだか？
  if (region.anchor) {
    const ax = region.anchor[0] * W, ay = region.anchor[1] * H;
    if (Math.hypot(pt.x - ax, pt.y - ay) < 20) {
      saveUndoState();
      draggingAnchor = true;
      overlayCanvas.classList.add('dragging');
      return;
    }
  }

  // 1. 頂点をつかんだか？
  const vidx = findNearestVertex(pt);
  if (vidx >= 0) {
    const now = Date.now();
    if (now - lastTapTime < 400 && lastTapVertexIdx === vidx) {
      if (region.polygon.length > 3) {
        saveUndoState();
        region.polygon.splice(vidx, 1);
        drawEditOverlay();
      }
      lastTapTime = 0; lastTapVertexIdx = -1;
      return;
    }
    lastTapTime = now; lastTapVertexIdx = vidx;
    saveUndoState();
    draggingVertexIdx = vidx;
    overlayCanvas.classList.add('dragging');
    return;
  }

  // 2. 辺の上をタップ（頂点追加）
  const edge = findEdgeInsertPoint(pt);
  if (edge) {
    saveUndoState();
    region.polygon.splice(edge.insertAfter + 1, 0, edge.point);
    draggingVertexIdx = edge.insertAfter + 1;
    overlayCanvas.classList.add('dragging');
    drawEditOverlay();
    return;
  }

  // 3. 他の部位をタップ → 切り替え
  const ridx = findRegionContaining(pt);
  if (ridx >= 0 && ridx !== editingRegionIdx) {
    editingRegionIdx = ridx;
    drawEditOverlay();
  }
}

function onEditMove(e) {
  if (!editMode || editingRegionIdx < 0) return;
  e.preventDefault();
  const pt = getEventPos(e);
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const region = detectedRegions[editingRegionIdx];

  if (draggingAnchor) {
    region.anchor = [
      Math.max(0, Math.min(1, pt.x / W)),
      Math.max(0, Math.min(1, pt.y / H)),
    ];
    drawEditOverlay();
    return;
  }

  if (draggingVertexIdx < 0) return;
  region.polygon[draggingVertexIdx] = [
    Math.max(0, Math.min(1, pt.x / W)),
    Math.max(0, Math.min(1, pt.y / H)),
  ];
  drawEditOverlay();
}

function onEditEnd(e) {
  if (draggingVertexIdx >= 0 || draggingAnchor) {
    draggingVertexIdx = -1;
    draggingAnchor = false;
    overlayCanvas.classList.remove('dragging');
  }
}

overlayCanvas.addEventListener('mousedown', onEditStart);
overlayCanvas.addEventListener('mousemove', onEditMove);
overlayCanvas.addEventListener('mouseup', onEditEnd);
overlayCanvas.addEventListener('mouseleave', onEditEnd);
overlayCanvas.addEventListener('touchstart', onEditStart, { passive: false });
overlayCanvas.addEventListener('touchmove', onEditMove, { passive: false });
overlayCanvas.addEventListener('touchend', onEditEnd);

// ============================================================
// UNDO
// ============================================================
let undoStack = [];
const MAX_UNDO = 20;

function saveUndoState() {
  const snapshot = detectedRegions.map(r => ({
    ...r,
    polygon: r.polygon.map(p => [...p]),
    anchor: r.anchor ? [...r.anchor] : null,
  }));
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (undoStack.length < 2) return;
  undoStack.pop();
  const prev = undoStack[undoStack.length - 1];
  detectedRegions = prev.map(r => ({
    ...r,
    polygon: r.polygon.map(p => [...p]),
    anchor: r.anchor ? [...r.anchor] : null,
  }));
  if (editingRegionIdx >= detectedRegions.length) editingRegionIdx = detectedRegions.length - 1;
  drawEditOverlay();
}

const undoBtn = document.getElementById('undo-btn');
if (undoBtn) undoBtn.addEventListener('click', undo);

// ============================================================
// 部位を新規手動追加
// ============================================================
let addingRegionMode = false;
let newRegionPoints = [];

const addRegionBtn = document.getElementById('add-region-btn');
if (addRegionBtn) {
  addRegionBtn.addEventListener('click', () => {
    addingRegionMode = !addingRegionMode;
    newRegionPoints = [];
    const tip = document.getElementById('edit-tip-text');
    if (addingRegionMode) {
      addRegionBtn.style.background = 'rgba(167,139,250,0.2)';
      addRegionBtn.style.borderColor = 'var(--accent)';
      addRegionBtn.style.color = 'var(--accent)';
      if (tip) tip.innerHTML = '<b>部位追加：</b>タップで頂点を打つ（3点以上）→ 最初の点をタップで確定';
    } else {
      addRegionBtn.style.background = '';
      addRegionBtn.style.borderColor = '';
      addRegionBtn.style.color = '';
      if (tip) tip.innerHTML = '<b>編集モード：</b>頂点ドラッグで移動 / 辺タップで追加 / 頂点ダブルタップで削除';
      newRegionPoints = [];
      drawEditOverlay();
    }
  });
}

function drawAddingOverlay() {
  drawEditOverlay();
  if (newRegionPoints.length === 0) return;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  oCtx.beginPath();
  newRegionPoints.forEach(([px, py], idx) => {
    const x = px * W, y = py * H;
    idx === 0 ? oCtx.moveTo(x, y) : oCtx.lineTo(x, y);
  });
  oCtx.strokeStyle = '#fff';
  oCtx.lineWidth = 1.5;
  oCtx.setLineDash([4, 4]);
  oCtx.stroke();
  oCtx.setLineDash([]);
  newRegionPoints.forEach(([px, py], idx) => {
    const x = px * W, y = py * H;
    oCtx.beginPath();
    oCtx.arc(x, y, idx === 0 ? 10 : 7, 0, Math.PI * 2);
    oCtx.fillStyle = idx === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(167,139,250,0.9)';
    oCtx.fill();
    oCtx.strokeStyle = 'var(--accent)';
    oCtx.lineWidth = 2;
    oCtx.stroke();
  });
}

// ============================================================
// PINCH ZOOM
// ============================================================
let zoomScale = 1;
let zoomOriginX = 0.5, zoomOriginY = 0.5;
let pinchStartDist = 0;
let pinchStartScale = 1;
const MIN_ZOOM = 1, MAX_ZOOM = 5;
const zoomWrap = document.getElementById('canvas-zoom-wrap');

function applyZoom() {
  if (!zoomWrap) return;
  zoomWrap.style.transformOrigin = `${zoomOriginX * 100}% ${zoomOriginY * 100}%`;
  zoomWrap.style.transform = `scale(${zoomScale})`;
  const zBtn = document.getElementById('zoom-reset-btn');
  if (zBtn) zBtn.textContent = Math.round(zoomScale * 100) + '%';
}

function resetZoom() {
  zoomScale = 1; zoomOriginX = 0.5; zoomOriginY = 0.5;
  applyZoom();
}

document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
  zoomScale = Math.min(MAX_ZOOM, zoomScale * 1.4); applyZoom();
});
document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
  zoomScale = Math.max(MIN_ZOOM, zoomScale / 1.4); applyZoom();
});
document.getElementById('zoom-reset-btn')?.addEventListener('click', resetZoom);

canvasBox.addEventListener('touchstart', e => {
  if (!editMode || e.touches.length !== 2) return;
  pinchStartDist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  pinchStartScale = zoomScale;
  const rect = canvasBox.getBoundingClientRect();
  zoomOriginX = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) / rect.width;
  zoomOriginY = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) / rect.height;
}, { passive: true });

canvasBox.addEventListener('touchmove', e => {
  if (!editMode || e.touches.length !== 2) return;
  e.preventDefault();
  const dist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  zoomScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartScale * (dist / pinchStartDist)));
  applyZoom();
}, { passive: false });

// ============================================================
// 再検出ボタン
// ============================================================
const redetectBtn = document.getElementById('redetect-btn');
if (redetectBtn) {
  redetectBtn.addEventListener('click', () => {
    stopAnim();
    detectedRegions = [];
    undoStack = [];
    document.getElementById('detect-btn').click();
  });
}

// ============================================================
// EXPORT (GIF / WebM)
// ============================================================
let exportFmt = 'gif';
let exportFrames = 20;
let exportQuality = 10;

function segGroupEx(groupId, attr, setter) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.seg-btn').forEach(b => {
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

segGroupEx('ex-fmt-group', 'fmt', v => {
  exportFmt = v;
  // GIF品質行の表示切替
  const qRow = document.getElementById('gif-quality-row');
  if (qRow) qRow.style.display = v === 'gif' ? 'flex' : 'none';
});
segGroupEx('ex-frames-group', 'frames', v => { exportFrames = parseInt(v); });
segGroupEx('ex-quality-group', 'quality', v => { exportQuality = parseInt(v); });

function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

const exportBtn = document.getElementById('export-btn');
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
      const dur = parseFloat(document.getElementById('spd').value) * 1000;
      const delay = Math.round(dur / exportFrames);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = W; offCanvas.height = H;
      const offCtx = offCanvas.getContext('2d');

      // 透過対応キャンバス（元画像の透過をそのまま保持）
      const isTransparent = exportFmt === 'webp' || exportFmt === 'apng';

      function captureFrame(t) {
        if (isTransparent) {
          // 透過: 背景を描かず画像のアルファをそのまま使う
          offCtx.clearRect(0, 0, W, H);
        }
        renderAnimFrame(t);
        if (isTransparent) {
          offCtx.clearRect(0, 0, W, H);
          offCtx.drawImage(mainCanvas, 0, 0);
        } else {
          offCtx.clearRect(0, 0, W, H);
          offCtx.drawImage(mainCanvas, 0, 0);
        }
      }

      function updateProgress(i, total, prefix) {
        const pct = Math.round((i / total) * 100);
        fill.style.width = pct + '%';
        label.textContent = (prefix || '') + i + ' / ' + total + ' フレーム';
      }

      // ---- GIF ----
      if (exportFmt === 'gif') {
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        const gif = new GIF({ workers: 2, quality: exportQuality, width: W, height: H });
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
        gif.on('finished', blob => {
          downloadBlob(blob, 'hair_animated.gif');
          finishExport();
        });
        gif.render();
        return; // finishExportはgif.finishedで呼ばれる

      // ---- WebM ----
      } else if (exportFmt === 'webm') {
        const stream = offCanvas.captureStream(exportFrames);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
          downloadBlob(new Blob(chunks, { type: 'video/webm' }), 'hair_animated.webm');
          finishExport();
        };
        recorder.start();
        for (let i = 0; i < exportFrames; i++) {
          captureFrame(i / exportFrames * (dur / 1000));
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, delay));
        }
        recorder.stop();
        return;

      // ---- WebP (アニメーション) ----
      } else if (exportFmt === 'webp') {
        // アニメWebPはブラウザネイティブでは作れないのでフレームをZIPして
        // 代わりにCanvas APIのtoBlob('image/webp')で1枚ずつ保存するシートを作る
        // 実用的な代替: WebMはVP8/VP9で透過対応 → webm透過として保存
        const stream = offCanvas.captureStream(exportFrames);
        // VP9はアルファチャンネル対応
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
          downloadBlob(new Blob(chunks, { type: 'video/webm' }), 'hair_animated_alpha.webm');
          finishExport();
        };
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

      // ---- APNG ----
      } else if (exportFmt === 'apng') {
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        // APNGライブラリがないので、高品質GIFとして保存＋注記
        const gif = new GIF({ workers: 2, quality: 1, width: W, height: H, transparent: 0x000000 });
        for (let i = 0; i < exportFrames; i++) {
          renderAnimFrame(i / exportFrames * (dur / 1000));
          offCtx.clearRect(0, 0, W, H);
          offCtx.drawImage(mainCanvas, 0, 0);
          gif.addFrame(offCanvas, { delay, copy: true });
          updateProgress(i + 1, exportFrames);
          await new Promise(r => setTimeout(r, 0));
        }
        gif.on('progress', p => {
          fill.style.width = (50 + p * 50) + '%';
          label.textContent = 'エンコード中... ' + Math.round(p * 100) + '%';
        });
        gif.on('finished', blob => {
          downloadBlob(blob, 'hair_animated_hq.gif');
          finishExport();
        });
        gif.render();
        return;
      }

      finishExport();

    } catch (err) {
      alert('エクスポートエラー: ' + err.message);
      finishExport();
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
