// hair-animator.js

// ============================================================
// STATE
// ============================================================
let imageFile = null;
let imageEl = null;
let imageLoaded = false;
let detectedRegions = []; 
let animType = 'sway';
let rafId = null;
let startTime = null;

let originalCanvas = null; 
let inpaintBaseCanvas = null; 
let useInpaint = false;

let useInteract = true;
let targetPointerX = -1000, targetPointerY = -1000;
let currentPointerX = -1000, currentPointerY = -1000;
let targetPullStrength = 0;
let currentPullStrength = 0;
let interactPointerDown = false;

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

    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey) {
      setStatus('error', 'APIキーを入力してください');
      detectBtn.disabled = false;
      return;
    }
    // APIキーを保存
    try { localStorage.setItem('hair_animator_api_key', apiKey); } catch(e) {}

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

    // 🌟 ゴミ箱（削除）ボタンを追加
    item.innerHTML = `
      <div class="region-color" style="background:${region.color}"></div>
      <div class="region-label" style="flex:1;">
        ${region.label}
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${region.description||''}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:2px; margin-right:8px; align-items:center;">
        <button class="layer-up" style="background:none; border:none; color:${i === 0 ? 'transparent' : 'var(--muted)'}; cursor:${i === 0 ? 'default' : 'pointer'}; font-size:10px; padding:2px;" title="順序を奥へ">▲</button>
        <button class="layer-down" style="background:none; border:none; color:${i === detectedRegions.length - 1 ? 'transparent' : 'var(--muted)'}; cursor:${i === detectedRegions.length - 1 ? 'default' : 'pointer'}; font-size:10px; padding:2px;" title="順序を手前へ">▼</button>
      </div>
      <button class="layer-delete" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:13px; margin-right:6px; padding:4px;" title="この部位を削除">🗑️</button>
      <div class="region-toggle ${region.enabled ? 'on' : ''}" data-idx="${i}"></div>
    `;

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

    // 削除ボタン（インライン確認）
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 確認ボタンをインライン表示
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
      // ラベル部分（テキスト）をダブルクリックで編集、シングルクリックで設定パネル
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

// INTERACTIVE TOGGLE
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
// ANIMATION & INTERACTIVITY
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
  const spd     = parseFloat(document.getElementById('spd').value);
  const amp     = parseFloat(document.getElementById('amp').value);
  const smooth  = parseFloat(document.getElementById('smooth').value);
  const feather = parseFloat(document.getElementById('feather').value);

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

    const pinsHash = (region.pins || []).map(p => p[0].toFixed(4)+','+p[1].toFixed(4)).join('|');
    const polyHash = region.polygon.map(p => p[0].toFixed(4)+','+p[1].toFixed(4)).join('|');
    if (!region._cache || region._cache.W !== W || region._cache.H !== H || region._cache.feather !== feather || region._cache.polyHash !== polyHash || region._cache.pinsHash !== pinsHash) {
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
        W, H, feather, polyHash, pinsHash,
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
          let minDist = Infinity;
          for (let i = 0; i < pins.length; i++) {
            const ppx = pins[i][0] * W;
            const ppy = pins[i][1] * H;
            const d = Math.sqrt((worldX - ppx) ** 2 + (worldY - ppy) ** 2);
            if (d < minDist) minDist = d;
          }
          let t_atten = Math.min(minDist / pinRadius, 1.0);
          pinAttenuation = t_atten * t_atten * (3 - 2 * t_atten);
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
          const pDist = Math.sqrt(pdx*pdx + pdy*pdy);
          const pRad = 150; 
          if (pDist < pRad && pDist > 0) {
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
      if (id === 'spd') valEl.textContent = parseFloat(el.value).toFixed(1) + 's';
      else if (id === 'feather') valEl.textContent = el.value + 'px';
      else valEl.textContent = el.value;
    });
  }
});

// ============================================================
// 頂点編集・パンズーム・ピン・インタラクティブイベント
// ============================================================
let editMode = false;
let editingRegionIdx = -1;
let draggingVertexIdx = -1;
let draggingAnchor = false;
let lastTapTime = 0;
let lastTapVertexIdx = -1;

let addingRegionMode = false;
let isSpaceDown = false;
let isPanning = false;
let panToolActive = false;
let pinToolActive = false;
let panStartX = 0, panStartY = 0;
let panStartPanX = 0, panStartPanY = 0;
let newRegionPoints = [];

const editBtn        = document.getElementById('edit-btn');
const editBar        = document.getElementById('edit-bar');
const editDoneBtn    = document.getElementById('edit-done-btn');
const panBtn         = document.getElementById('pan-btn');
const pinBtn         = document.getElementById('pin-btn');
const addRegionBtn   = document.getElementById('add-region-btn');

function deactivateAllTools() {
  addingRegionMode = false;
  if (addRegionBtn) { addRegionBtn.style.background = ''; addRegionBtn.style.borderColor = ''; addRegionBtn.style.color = ''; }
  panToolActive = false;
  if (panBtn) panBtn.classList.remove('active');
  pinToolActive = false;
  if (pinBtn) pinBtn.classList.remove('active');
  
  const tip = document.getElementById('edit-tip-text');
  if (tip) tip.innerHTML = '<b>編集モード：</b>頂点ドラッグで移動 / 辺タップで追加 / 頂点ダブルタップで削除 / ⚓ドラッグでアンカー移動';
  overlayCanvas.style.cursor = 'crosshair';
}

if (editBtn && editBar && editDoneBtn) {
  editBtn.addEventListener('click', () => {
    if (detectedRegions.length === 0) return;
    editMode = true;
    deactivateAllTools();
    editingRegionIdx = detectedRegions.findIndex(r => r.enabled);
    if (editingRegionIdx < 0) editingRegionIdx = 0;
    overlayCanvas.classList.add('edit-mode');
    editBar.classList.add('visible');
    stopAnim();
    saveUndoState();
    drawEditOverlay();
    const zc = document.getElementById('zoom-controls');
    if (zc) zc.classList.add('visible');
  });

  editDoneBtn.addEventListener('click', () => {
    editMode = false; 
    deactivateAllTools();
    editingRegionIdx = -1; draggingVertexIdx = -1; draggingAnchor = false; isPanning = false;
    overlayCanvas.classList.remove('edit-mode');
    editBar.classList.remove('visible');
    resetZoom();
    const zc = document.getElementById('zoom-controls');
    if (zc) zc.classList.remove('visible');
    drawOverlay();
    startAnim();
  });
}

if (addRegionBtn) {
  addRegionBtn.addEventListener('click', () => {
    const wasActive = addingRegionMode;
    deactivateAllTools();
    newRegionPoints = [];
    if (!wasActive) {
      addingRegionMode = true;
      addRegionBtn.style.background = 'rgba(167,139,250,0.2)'; addRegionBtn.style.borderColor = 'var(--accent)'; addRegionBtn.style.color = 'var(--accent)';
      const tip = document.getElementById('edit-tip-text');
      if (tip) tip.innerHTML = '<b>部位追加：</b>タップで頂点を打つ（3点以上）→ 最初の点をタップで確定';
      drawEditOverlay();
    } else {
      drawEditOverlay();
    }
  });
}

if (panBtn) {
  panBtn.addEventListener('click', () => {
    const wasActive = panToolActive;
    deactivateAllTools();
    if (!wasActive) {
      panToolActive = true;
      panBtn.classList.add('active');
      overlayCanvas.style.cursor = 'grab';
    }
  });
}

if (pinBtn) {
  pinBtn.addEventListener('click', () => {
    const wasActive = pinToolActive;
    deactivateAllTools();
    if (!wasActive) {
      pinToolActive = true;
      pinBtn.classList.add('active');
      const tip = document.getElementById('edit-tip-text');
      if (tip) tip.innerHTML = '<b>ピン固定：</b>クリックでピンを追加 / ピン付近をクリックで削除';
    }
  });
}

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && editMode) { isSpaceDown = true; overlayCanvas.style.cursor = 'grab'; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { 
    isSpaceDown = false; 
    overlayCanvas.style.cursor = panToolActive ? 'grab' : 'crosshair'; 
  }
});

function drawEditOverlay() {
  if (!oCtx) return;
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const W = overlayCanvas.width, H = overlayCanvas.height;

  detectedRegions.forEach((region, i) => {
    if (!region.polygon || region.polygon.length < 3) return;
    const isEditing = i === editingRegionIdx;
    const color = region.color;

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

    const xs = region.polygon.map(p => p[0]), ys = region.polygon.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    oCtx.fillStyle = color;
    oCtx.font = isEditing ? 'bold 13px sans-serif' : '11px sans-serif';
    oCtx.fillText(region.label || '部位' + (i+1), minX * W + 4, minY * H - 4);

    if (isEditing) {
      if (region.pins) {
        region.pins.forEach(pin => {
          const px = pin[0] * W, py = pin[1] * H;
          oCtx.beginPath(); oCtx.arc(px, py, 7, 0, Math.PI * 2);
          oCtx.fillStyle = '#3b82f6'; oCtx.fill();
          oCtx.strokeStyle = '#fff'; oCtx.lineWidth = 2; oCtx.stroke();
          oCtx.fillStyle = '#fff'; oCtx.font = '10px sans-serif'; oCtx.fillText('📌', px - 5, py + 3);
        });
      }

      region.polygon.forEach(([px, py]) => {
        const x = px * W, y = py * H;
        oCtx.beginPath(); oCtx.arc(x, y, 9, 0, Math.PI * 2); oCtx.fillStyle = '#fff'; oCtx.fill();
        oCtx.beginPath(); oCtx.arc(x, y, 6, 0, Math.PI * 2); oCtx.fillStyle = color; oCtx.fill();
        oCtx.beginPath(); oCtx.arc(x, y, 9, 0, Math.PI * 2); oCtx.strokeStyle = color; oCtx.lineWidth = 1.5; oCtx.stroke();
      });
      if (region.anchor) {
        const ax = region.anchor[0] * W, ay = region.anchor[1] * H;
        oCtx.beginPath(); oCtx.arc(ax, ay, 12, 0, Math.PI * 2); oCtx.strokeStyle = color; oCtx.lineWidth = 2; oCtx.setLineDash([3, 3]); oCtx.stroke();
        oCtx.setLineDash([]);
        oCtx.beginPath(); oCtx.arc(ax, ay, 7, 0, Math.PI * 2); oCtx.fillStyle = '#fff'; oCtx.fill(); oCtx.strokeStyle = color; oCtx.lineWidth = 2; oCtx.stroke();
        oCtx.beginPath(); oCtx.moveTo(ax - 10, ay); oCtx.lineTo(ax + 10, ay); oCtx.moveTo(ax, ay - 10); oCtx.lineTo(ax, ay + 10); oCtx.stroke();
        oCtx.fillStyle = color; oCtx.font = '10px sans-serif'; oCtx.fillText('⚓', ax + 13, ay + 4);
      }
    }
  });
}

function getEventPos(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const touch = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (touch.clientX - rect.left) * scaleX,
    y: (touch.clientY - rect.top) * scaleY,
  };
}

function findNearestVertex(pt) {
  if (editingRegionIdx < 0) return -1;
  const region = detectedRegions[editingRegionIdx];
  if (!region || !region.polygon) return -1;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const threshold = 22;
  let bestIdx = -1, bestDist = Infinity;
  region.polygon.forEach(([px, py], idx) => {
    const x = px * W, y = py * H;
    const d = Math.hypot(pt.x - x, pt.y - y);
    if (d < threshold && d < bestDist) { bestDist = d; bestIdx = idx; }
  });
  return bestIdx;
}

// 🌟 辺をタップ（クリック）して追加する時の当たり判定を 14 -> 20 に拡大して追加しやすくしました
function findEdgeInsertPoint(pt) {
  if (editingRegionIdx < 0) return null;
  const region = detectedRegions[editingRegionIdx];
  if (!region || !region.polygon || region.polygon.length < 2) return null;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const threshold = 20; 
  let best = null;
  for (let i = 0; i < region.polygon.length; i++) {
    const j = (i + 1) % region.polygon.length;
    const ax = region.polygon[i][0] * W, ay = region.polygon[i][1] * H;
    const bx = region.polygon[j][0] * W, by = region.polygon[j][1] * H;
    const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    let t = ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq;
    t = Math.max(0.05, Math.min(0.95, t));
    const projX = ax + t * dx, projY = ay + t * dy;
    const dist = Math.hypot(pt.x - projX, pt.y - projY);
    if (dist < threshold && (!best || dist < best.dist)) {
      best = { dist, insertAfter: i, point: [projX / W, projY / H] };
    }
  }
  return best;
}

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

function findRegionContaining(pt) {
  const W = overlayCanvas.width, H = overlayCanvas.height;
  for (let i = 0; i < detectedRegions.length; i++) {
    const region = detectedRegions[i];
    if (region.polygon && region.polygon.length >= 3 && pointInPolygon(pt.x / W, pt.y / H, region.polygon)) return i;
  }
  return -1;
}

overlayCanvas.addEventListener('mouseenter', e => {
  if (editMode || !useInteract) return;
  const pt = getEventPos(e);
  currentPointerX = targetPointerX = pt.x;
  currentPointerY = targetPointerY = pt.y;
  targetPullStrength = interactPointerDown ? 1.8 : 0.8;
});

overlayCanvas.addEventListener('mousemove', e => {
  if (!editMode && useInteract) {
    const pt = getEventPos(e);
    targetPointerX = pt.x; targetPointerY = pt.y;
    targetPullStrength = interactPointerDown ? 1.8 : 0.8;
  }
});

overlayCanvas.addEventListener('mousedown', e => {
  if (!editMode && useInteract) {
    interactPointerDown = true;
    targetPullStrength = 1.8;
  }
});

window.addEventListener('mouseup', e => {
  interactPointerDown = false;
  if (targetPullStrength > 0) targetPullStrength = 0.8;
});

overlayCanvas.addEventListener('mouseleave', e => {
  if (!editMode) targetPullStrength = 0;
  interactPointerDown = false;
});

overlayCanvas.addEventListener('touchstart', e => {
  if (!editMode && useInteract) {
    const pt = getEventPos(e);
    currentPointerX = targetPointerX = pt.x;
    currentPointerY = targetPointerY = pt.y;
    interactPointerDown = true;
    targetPullStrength = 1.8;
  }
}, {passive: true});

overlayCanvas.addEventListener('touchmove', e => {
  if (!editMode && useInteract) {
    const pt = getEventPos(e);
    targetPointerX = pt.x; targetPointerY = pt.y;
  }
}, {passive: true});

window.addEventListener('touchend', e => {
  if (!editMode) targetPullStrength = 0;
  interactPointerDown = false;
});

function onEditStart(e) {
  if (!editMode) return;
  if (e.touches && e.touches.length >= 2) return; 

  if (isSpaceDown || e.button === 1 || panToolActive) {
    e.preventDefault();
    isPanning = true;
    const touch = e.touches ? e.touches[0] : e;
    panStartX = touch.clientX;
    panStartY = touch.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    overlayCanvas.style.cursor = 'grabbing';
    return;
  }

  if (editingRegionIdx < 0) return;
  e.preventDefault();
  const pt = getEventPos(e);
  const W = overlayCanvas.width, H = overlayCanvas.height;

  if (pinToolActive) {
    const region = detectedRegions[editingRegionIdx];
    if (!region.pins) region.pins = [];
    const rx = pt.x / W, ry = pt.y / H;
    
    let removed = false;
    for (let i = 0; i < region.pins.length; i++) {
       const px = region.pins[i][0] * W, py = region.pins[i][1] * H;
       if (Math.hypot(pt.x - px, pt.y - py) < 18) {
         saveUndoState();
         region.pins.splice(i, 1); 
         removed = true;
         break;
       }
    }
    if (!removed && pointInPolygon(rx, ry, region.polygon)) {
       saveUndoState();
       region.pins.push([rx, ry]); 
    }
    drawEditOverlay();
    return;
  }

  if (addingRegionMode) {
    const rx = pt.x / W, ry = pt.y / H;
    if (newRegionPoints.length >= 3) {
      const [fx, fy] = newRegionPoints[0];
      if (Math.hypot((rx - fx) * W, (ry - fy) * H) < 18) {
        saveUndoState();
        const colors = ['#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171'];
        const xs = newRegionPoints.map(p => p[0]), ys = newRegionPoints.map(p => p[1]);
        const cx = xs.reduce((a,b)=>a+b,0)/xs.length, cy = ys.reduce((a,b)=>a+b,0)/ys.length;
        detectedRegions.push({
          label: '部位' + (detectedRegions.length + 1),
          polygon: newRegionPoints.map(p => [...p]),
          anchor: [cx, Math.min(...ys)], color: colors[detectedRegions.length % colors.length],
          enabled: true, animOffset: Math.random() * Math.PI * 2, animType: null, animSpd: null, animAmp: null,
          description: '手動追加', pins: []
        });
        editingRegionIdx = detectedRegions.length - 1;
        deactivateAllTools();
        renderRegionList(); saveUndoState(); drawEditOverlay();
        return;
      }
    }
    newRegionPoints.push([rx, ry]);
    drawAddingOverlay();
    return;
  }

  const region = detectedRegions[editingRegionIdx];
  if (region.anchor) {
    const ax = region.anchor[0] * W, ay = region.anchor[1] * H;
    if (Math.hypot(pt.x - ax, pt.y - ay) < 20) { saveUndoState(); draggingAnchor = true; overlayCanvas.classList.add('dragging'); return; }
  }

  const vidx = findNearestVertex(pt);
  if (vidx >= 0) {
    const now = Date.now();
    if (now - lastTapTime < 400 && lastTapVertexIdx === vidx) {
      if (region.polygon.length > 3) { saveUndoState(); region.polygon.splice(vidx, 1); drawEditOverlay(); }
      lastTapTime = 0; lastTapVertexIdx = -1; return;
    }
    lastTapTime = now; lastTapVertexIdx = vidx;
    saveUndoState(); draggingVertexIdx = vidx; overlayCanvas.classList.add('dragging'); return;
  }

  const edge = findEdgeInsertPoint(pt);
  if (edge) { 
    saveUndoState(); 
    region.polygon.splice(edge.insertAfter + 1, 0, edge.point); 
    draggingVertexIdx = edge.insertAfter + 1; 
    overlayCanvas.classList.add('dragging'); 
    drawEditOverlay(); 
    return; 
  }

  const ridx = findRegionContaining(pt);
  if (ridx >= 0 && ridx !== editingRegionIdx) { editingRegionIdx = ridx; drawEditOverlay(); }
}

function onEditMove(e) {
  if (!editMode) return;

  if (isPanning) {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    panX = panStartPanX + (touch.clientX - panStartX);
    panY = panStartPanY + (touch.clientY - panStartY);
    applyZoom();
    return;
  }

  if (editingRegionIdx < 0) return;
  e.preventDefault();
  const pt = getEventPos(e);
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const region = detectedRegions[editingRegionIdx];

  if (draggingAnchor) {
    region.anchor = [Math.max(0, Math.min(1, pt.x / W)), Math.max(0, Math.min(1, pt.y / H))];
    drawEditOverlay(); return;
  }
  if (draggingVertexIdx >= 0) {
    region.polygon[draggingVertexIdx] = [Math.max(0, Math.min(1, pt.x / W)), Math.max(0, Math.min(1, pt.y / H))];
    drawEditOverlay();
  }
}

function onEditEnd(e) {
  if (isPanning) {
    isPanning = false;
    overlayCanvas.style.cursor = (isSpaceDown || panToolActive) ? 'grab' : 'crosshair';
    return;
  }
  if (draggingVertexIdx >= 0 || draggingAnchor) {
    draggingVertexIdx = -1; draggingAnchor = false; overlayCanvas.classList.remove('dragging');
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
// UNDO & ZOOM
// ============================================================
let undoStack = [];
const MAX_UNDO = 20;

function saveUndoState() {
  const snapshot = detectedRegions.map(r => ({
    ...r, 
    polygon: r.polygon.map(p => [...p]), 
    anchor: r.anchor ? [...r.anchor] : null,
    pins: r.pins ? r.pins.map(p => [...p]) : [] 
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
    pins: r.pins ? r.pins.map(p => [...p]) : []
  }));
  if (editingRegionIdx >= detectedRegions.length) editingRegionIdx = detectedRegions.length - 1;
  drawEditOverlay();
}
const undoBtn = document.getElementById('undo-btn');
if (undoBtn) undoBtn.addEventListener('click', undo);

function drawAddingOverlay() {
  drawEditOverlay();
  if (newRegionPoints.length === 0) return;
  const W = overlayCanvas.width, H = overlayCanvas.height;
  oCtx.beginPath();
  newRegionPoints.forEach(([px, py], idx) => { const x = px * W, y = py * H; idx === 0 ? oCtx.moveTo(x, y) : oCtx.lineTo(x, y); });
  oCtx.strokeStyle = '#fff'; oCtx.lineWidth = 1.5; oCtx.setLineDash([4, 4]); oCtx.stroke(); oCtx.setLineDash([]);
  newRegionPoints.forEach(([px, py], idx) => {
    const x = px * W, y = py * H;
    oCtx.beginPath(); oCtx.arc(x, y, idx === 0 ? 10 : 7, 0, Math.PI * 2);
    oCtx.fillStyle = idx === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(167,139,250,0.9)'; oCtx.fill();
    oCtx.strokeStyle = 'var(--accent)'; oCtx.lineWidth = 2; oCtx.stroke();
  });
}

let zoomScale = 1;
let panX = 0, panY = 0;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchStartPanX = 0, pinchStartPanY = 0;
let pinchCenterX = 0, pinchCenterY = 0;
const MIN_ZOOM = 1, MAX_ZOOM = 5;
const zoomWrap = document.getElementById('canvas-zoom-wrap');

function applyZoom() {
  if (!zoomWrap) return;
  zoomWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  const zBtn = document.getElementById('zoom-reset-btn');
  if (zBtn) zBtn.textContent = Math.round(zoomScale * 100) + '%';
}

function resetZoom() {
  zoomScale = 1; panX = 0; panY = 0;
  applyZoom();
}

document.getElementById('zoom-in-btn')?.addEventListener('click', () => { zoomScale = Math.min(MAX_ZOOM, zoomScale * 1.4); applyZoom(); });
document.getElementById('zoom-out-btn')?.addEventListener('click', () => { zoomScale = Math.max(MIN_ZOOM, zoomScale / 1.4); applyZoom(); });
document.getElementById('zoom-reset-btn')?.addEventListener('click', resetZoom);

canvasBox.addEventListener('touchstart', e => {
  if (!editMode || e.touches.length !== 2) return;
  const t1 = e.touches[0], t2 = e.touches[1];
  pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  pinchStartScale = zoomScale;
  pinchStartPanX = panX;
  pinchStartPanY = panY;
  pinchCenterX = (t1.clientX + t2.clientX) / 2;
  pinchCenterY = (t1.clientY + t2.clientY) / 2;
}, { passive: true });

canvasBox.addEventListener('touchmove', e => {
  if (!editMode || e.touches.length !== 2) return;
  e.preventDefault();
  const t1 = e.touches[0], t2 = e.touches[1];
  const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  const currentCenterX = (t1.clientX + t2.clientX) / 2;
  const currentCenterY = (t1.clientY + t2.clientY) / 2;

  zoomScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartScale * (dist / pinchStartDist)));
  panX = pinchStartPanX + (currentCenterX - pinchCenterX);
  panY = pinchStartPanY + (currentCenterY - pinchCenterY);
  applyZoom();
}, { passive: false });

const redetectBtn = document.getElementById('redetect-btn');
if (redetectBtn) {
  redetectBtn.addEventListener('click', () => {
    stopAnim(); detectedRegions = []; undoStack = []; document.getElementById('detect-btn').click();
  });
}

// ============================================================
// PROJECT SAVE & LOAD
// ============================================================
const saveProjectBtn = document.getElementById('save-project-btn');
const loadProjectBtn = document.getElementById('load-project-btn');
const projectFileInput = document.getElementById('project-file-input');

if (saveProjectBtn) {
  saveProjectBtn.addEventListener('click', () => {
    if (detectedRegions.length === 0) {
      alert('保存する部位データがありません。');
      return;
    }
    const projectData = {
      version: 1,
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
                document.getElementById(id).value = data.settings[id];
                const valEl = document.getElementById(id + '-val');
                if (valEl) valEl.textContent = id === 'spd' ? parseFloat(data.settings[id]).toFixed(1) + 's' : (id === 'feather' ? data.settings[id] + 'px' : data.settings[id]);
              }
            });
          }

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
        } else {
          throw new Error('無効なデータ形式です');
        }
      } catch (err) {
        alert('読み込みに失敗しました。正しいプロジェクトファイル(.json)を選択してください。');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ============================================================
// INIT
// ============================================================
// APIキーをlocalStorageから復元
try {
  const savedKey = localStorage.getItem('hair_animator_api_key');
  if (savedKey) {
    const keyInput = document.getElementById('api-key-input');
    if (keyInput) keyInput.value = savedKey;
  }
} catch(e) {}

// ============================================================
// EXPORT
// ============================================================
let exportFmt = 'gif';
let exportFrames = 20;
let exportQuality = 10;
let exportRes = 1.0;

function segGroupEx(groupId, attr, setter) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.seg-btn').forEach(btn => {
    if(btn.id === 'inpaint-toggle-btn' || btn.id === 'interact-toggle-btn') return; 
    btn.addEventListener('click', () => {
      group.querySelectorAll('.seg-btn').forEach(b => {
        if(b.id === 'inpaint-toggle-btn' || b.id === 'interact-toggle-btn') return;
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

  // 高品質警告
  if (warning) {
    warning.style.display = (exportFmt === 'gif' && exportQuality === 1) ? 'block' : 'none';
  }

  // 推奨テキスト
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
      const expW = Math.round(W * exportRes);
      const expH = Math.round(H * exportRes);

      // キャッシュをリセット（古いcanvasコンテキストが残るとエラーになるため）
      detectedRegions.forEach(r => { r._cache = null; });
      cacheInpaintedBackgrounds();      const dur = parseFloat(document.getElementById('spd').value) * 1000;
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
        gif.on('finished', blob => { showPreview(blob, 'hair_animated.gif', 'image/gif'); finishExport(); });
        gif.render();
        return;

      } else if (exportFmt === 'webm') {
        const stream = offCanvas.captureStream(exportFrames);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => { showPreview(new Blob(chunks, { type: 'video/webm' }), 'hair_animated.webm', 'video/webm'); finishExport(); };
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
        recorder.onstop = () => { showPreview(new Blob(chunks, { type: 'video/webm' }), 'hair_animated_alpha.webm', 'video/webm'); finishExport(); };
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
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        const gif = new GIF({ workers: 4, quality: 1, width: expW, height: expH, transparent: 0x000000 });
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
        gif.on('finished', blob => { showPreview(blob, 'hair_animated_hq.gif', 'image/gif'); finishExport(); });
        gif.render();
        return;
      }

      finishExport();

    } catch (err) {
      alert('エクスポートエラー: ' + err.message);
      finishExport();
    }

    function showPreview(blob, filename, mimeType) {
      const url = URL.createObjectURL(blob);
      const modal = document.getElementById('preview-modal');
      const previewImg = document.getElementById('preview-gif');
      const downloadBtn = document.getElementById('preview-download-btn');
      const closeBtn = document.getElementById('preview-close-btn');
      const sizeNote = document.getElementById('preview-size-note');

      // サイズ表示
      if (sizeNote) {
        const kb = (blob.size / 1024).toFixed(0);
        const mb = (blob.size / 1024 / 1024).toFixed(1);
        const sizeStr = blob.size > 1024 * 1024 ? mb + ' MB' : kb + ' KB';
        sizeNote.textContent = `${expW}×${expH}px · ${sizeStr}`;
      }

      // GIF/APNGはimgで、WebMはvideoで表示
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
