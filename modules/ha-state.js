// ============================================================
// ha-state.js — 共有ステート・DOM参照（グローバル var）
// ロード順: 1番目（全スクリプトより先に読み込む）
// ============================================================

// --- 画像・アニメーション基本 ---
var imageFile = null;
var imageEl = null;
var imageLoaded = false;

var cachedSpd = 2.5;
var cachedAmp = 12;
var cachedSmooth = 0.6;
var cachedFeather = 8;

var detectedRegions = [];
var animType = 'sway';
var rafId = null;
var startTime = null;

var originalCanvas = null;
var inpaintBaseCanvas = null;
var useInpaint = false;

var useInteract = true;
var targetPointerX = -1000, targetPointerY = -1000;
var currentPointerX = -1000, currentPointerY = -1000;
var targetPullStrength = 0;
var currentPullStrength = 0;
var interactPointerDown = false;

var REGION_COLORS = ['#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171'];

// --- DOM 参照 ---
var dropzone     = document.getElementById('dropzone');
var canvasBox    = document.getElementById('canvas-box');
var mainCanvas   = document.getElementById('main-canvas');
var overlayCanvas= document.getElementById('overlay-canvas');
var mCtx = null;
var oCtx = null;
var fileInput    = document.getElementById('file-input');
var detectBtn    = document.getElementById('detect-btn');
var regionsPanel = document.getElementById('regions-panel');
var animPanel    = document.getElementById('anim-panel');
var regionList   = document.getElementById('region-list');
var statusDot    = document.getElementById('status-dot');
var statusText   = document.getElementById('status-text');
var changeBtn    = document.getElementById('change-btn');

// --- トースト ---
var _toastTimer = null;

// --- 編集ツール ---
var editMode = false;
var editingRegionIdx = -1;
var draggingVertexIdx = -1;
var draggingAnchor = false;
var lastTapTime = 0;
var lastTapVertexIdx = -1;
var addingRegionMode = false;
var isSpaceDown = false;
var isPanning = false;
var panToolActive = false;
var pinToolActive = false;
var panStartX = 0, panStartY = 0;
var panStartPanX = 0, panStartPanY = 0;
var newRegionPoints = [];
var editBtn     = document.getElementById('edit-btn');
var editBar     = document.getElementById('edit-bar');
var editDoneBtn = document.getElementById('edit-done-btn');
var panBtn      = document.getElementById('pan-btn');
var pinBtn      = document.getElementById('pin-btn');
var addRegionBtn= document.getElementById('add-region-btn');
var undoBtn     = document.getElementById('undo-btn');

// --- Undo ---
var undoStack = [];
var MAX_UNDO = 20;

// --- ズーム・パン ---
var zoomScale = 1;
var panX = 0, panY = 0;
var pinchStartDist = 0;
var pinchStartScale = 1;
var pinchStartPanX = 0, pinchStartPanY = 0;
var pinchCenterX = 0, pinchCenterY = 0;
var MIN_ZOOM = 1, MAX_ZOOM = 5;
var zoomWrap = document.getElementById('canvas-zoom-wrap');
var redetectBtn = document.getElementById('redetect-btn');

// --- プロジェクト保存/読込 ---
var saveProjectBtn   = document.getElementById('save-project-btn');
var loadProjectBtn   = document.getElementById('load-project-btn');
var projectFileInput = document.getElementById('project-file-input');

// --- エクスポート ---
var exportFmt = 'gif';
var exportFrames = 20;
var exportQuality = 10;
var exportRes = 1.0;
var exportBtn = document.getElementById('export-btn');
