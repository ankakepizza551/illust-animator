// ============================================================
// ha-edit.js — ポリゴン編集・Undo・ズーム
// ロード順: 4番目
// ============================================================

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
// UNDO
// ============================================================
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

// ============================================================
// ズーム・ピンチ
// ============================================================
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

if (redetectBtn) {
  redetectBtn.addEventListener('click', () => {
    stopAnim(); detectedRegions = []; undoStack = []; document.getElementById('detect-btn').click();
  });
}
