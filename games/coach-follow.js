// ============================================================
// Coach Follow — up to 4 players mirror an uploaded coach video.
// Score per frame from limb-direction similarity. When the coach
// is barely moving (talking/posing still), scoring is PAUSED so
// players aren't misled with false PERFECT/BAD grades.
// ============================================================

import { startCamera, createPoseTracker, drawPoseStick } from "../shared/tracking.js";
import { sfx } from "../shared/audio.js";
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ---------- DOM ----------
const camVideo     = document.getElementById("cam");
const coachVideo   = document.getElementById("coach");        // hidden, used for analysis
const coachStage   = document.getElementById("coach-stage");  // visible big-screen video
const coachOverlay = document.getElementById("coach-overlay");
const coachOverlayCtx = coachOverlay.getContext("2d");
const coachBadge   = document.getElementById("coach-badge");
const coachTime    = document.getElementById("coach-time");
const stage        = document.getElementById("stage");
const tilesEl      = document.getElementById("tiles");
const startOverlay = document.getElementById("start");
const endOverlay   = document.getElementById("end");
const winnerEl     = document.getElementById("winner");
const endStats     = document.getElementById("end-stats");
const startBtn     = document.getElementById("start-btn");
const restartBtn   = document.getElementById("restart-btn");
const picker       = document.getElementById("picker");
const fileInput    = document.getElementById("coach-file");
const coachMeta    = document.getElementById("coach-meta");
const analyzeBar   = document.getElementById("analyze-bar");
const analyzeFill  = document.getElementById("analyze-fill");
const analyzeMeta  = document.getElementById("analyze-meta");
const analyzeBanner    = document.getElementById("analyze-banner");
const analyzeBannerFill = document.getElementById("analyze-banner-fill");
const analyzeBannerMeta = document.getElementById("analyze-banner-meta");
const barRow       = document.getElementById("bar-row");

// ---------- Tunables ----------
const ANALYSIS_FPS = 12;                 // sampled coach pose frames per second
const SCORE_INTERVAL_MS = 250;            // grade flash cadence (legacy default; overridden by CFG.windowMs)
const TIME_TOLERANCE_S = 0.18;            // ±window for coach-frame lookup
const SIMILARITY_EMA = 0.45;              // smoothing
const GRADE_THRESHOLDS = {                // ↑ = stricter (legacy default; overridden by gradeThresholds())
  perfect:   0.95,
  excellent: 0.87,
  good:      0.75,
};

// ---------- User-configurable settings (sliders in the gear modal) ----------
const CFG_DEFAULTS = { sensitivity: 50, windowMs: 600, coachScale: 100 };
let CFG = { ...CFG_DEFAULTS };
try {
  const raw = localStorage.getItem("coachFollowCfg");
  if (raw) CFG = { ...CFG_DEFAULTS, ...JSON.parse(raw) };
} catch (_) {}
function saveCfg() { try { localStorage.setItem("coachFollowCfg", JSON.stringify(CFG)); } catch (_) {} }
function applyCoachScale() {
  const s = Math.max(50, Math.min(150, CFG.coachScale || 100)) / 100;
  document.body.style.setProperty("--coach-scale", String(s));
}
// sens 0 → very forgiving, 50 → defaults-ish, 100 → very strict
function gradeThresholds() {
  const s = Math.max(0, Math.min(100, CFG.sensitivity)) / 100;
  const easy   = { perfect: 0.80, excellent: 0.65, good: 0.50 };
  const strict = { perfect: 0.99, excellent: 0.95, good: 0.88 };
  return {
    perfect:   easy.perfect   + (strict.perfect   - easy.perfect)   * s,
    excellent: easy.excellent + (strict.excellent - easy.excellent) * s,
    good:      easy.good      + (strict.good      - easy.good)      * s,
  };
}
const GRADE_POINTS = { perfect: 100, excellent: 60, good: 25, bad: 0 };
// Coach-motion gating: if coach's recent body motion is below this, scoring pauses.
// Uses MAX joint speed (normalized / torso / sec) over a ±0.25s window — so a single
// moving limb (e.g. arms-only choreography) is enough to keep scoring active.
const COACH_MOTION_FLOOR = 0.15;          // any one limb moving ≈ above this
const MIN_VISIBLE_LIMBS_USER = 5;         // require enough of the user's body in frame

// Limb segments we compare (MediaPipe pose indices)
const LIMBS = [
  [11, 13], [13, 15],  // L shoulder→elbow, elbow→wrist
  [12, 14], [14, 16],  // R shoulder→elbow, elbow→wrist
  [23, 25], [25, 27],  // L hip→knee, knee→ankle
  [24, 26], [26, 28],  // R hip→knee, knee→ankle
  [11, 23], [12, 24],  // shoulders→hips (torso sides)
];

// Per-player visuals
const TILES = [
  { color: "#ffd23f", outline: "#3a2a00", label: "P1" },
  { color: "#5ce1ff", outline: "#003a4a", label: "P2" },
  { color: "#ff77c8", outline: "#3a0024", label: "P3" },
  { color: "#9cff6a", outline: "#1a3a00", label: "P4" },
];

let numPlayers = 4;
let coachFrames = []; // [{ tSec, landmarks: [{x,y,v}], energy }]
let coachAnalyzed = false;
let tracker = null;
let coachOnePosed = null; // lazy single-person analyzer for the coach video

const STATE = {
  running: false,
  N: 4,
  score:      [0,0,0,0],
  combo:      [0,0,0,0],
  maxCombo:   [0,0,0,0],
  graded:     [0,0,0,0],
  gradeCounts: [
    { perfect:0, excellent:0, good:0, bad:0 },
    { perfect:0, excellent:0, good:0, bad:0 },
    { perfect:0, excellent:0, good:0, bad:0 },
    { perfect:0, excellent:0, good:0, bad:0 },
  ],
  similarity: [0,0,0,0], // smoothed
  lastGradeAt: [0,0,0,0],
  pipPoseEls: [],        // {tileVideo, poseCanvas, poseCtx, scoreEl, comboEl, gradeEl, tileEl}
};

// ---------- Player picker ----------
picker.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-n]");
  if (!btn) return;
  numPlayers = parseInt(btn.dataset.n, 10);
  picker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
});

// ---------- View mode (Live / Skeleton / Silhouette / Bar / Design1) ----------
const VIEW_MODES = ["live", "skeleton", "silhouette", "bar", "design1"];
let viewMode = localStorage.getItem("coachFollowViewMode");
if (!VIEW_MODES.includes(viewMode)) viewMode = "skeleton";
const arenaEl = document.getElementById("arena");
function applyViewMode(mode) {
  viewMode = mode;
  localStorage.setItem("coachFollowViewMode", mode);
  tilesEl.classList.remove("view-live", "view-skeleton", "view-silhouette", "view-bar", "view-design1");
  tilesEl.classList.add(`view-${mode}`);
  barRow?.classList.toggle("show", mode === "bar");
  document.body.classList.toggle("mode-design1", mode === "design1");
  arenaEl?.classList.toggle("show", mode === "design1");
  const vp = document.getElementById("view-picker");
  vp?.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
}
applyViewMode(viewMode);
document.getElementById("view-picker")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  applyViewMode(btn.dataset.view);
});

// ---------- Silhouette mask rendering ----------
// MediaPipe gives one MPMask per detected person when outputSegmentationMasks is on.
// We composite it as a flat-colored fill (alpha = mask) into the tile canvas, mirrored
// to match the selfie-mirrored camera.
const _maskCanvas = document.createElement("canvas");
const _maskCtx = _maskCanvas.getContext("2d", { willReadFrequently: true });
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}
function drawSilhouetteMask(destCtx, mask, color, destW, destH) {
  let u8 = null;
  try { u8 = mask.getAsUint8Array(); } catch (e) { return; }
  const mw = mask.width, mh = mask.height;
  if (!u8 || !mw || !mh) return;
  if (_maskCanvas.width !== mw) _maskCanvas.width = mw;
  if (_maskCanvas.height !== mh) _maskCanvas.height = mh;
  const img = _maskCtx.createImageData(mw, mh);
  const [r, g, b] = hexToRgb(color);
  const data = img.data;
  for (let p = 0, q = 0; p < u8.length; p++, q += 4) {
    data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = u8[p];
  }
  _maskCtx.putImageData(img, 0, 0);
  destCtx.save();
  destCtx.translate(destW, 0);
  destCtx.scale(-1, 1);
  destCtx.imageSmoothingEnabled = true;
  destCtx.drawImage(_maskCanvas, 0, 0, destW, destH);
  destCtx.restore();
}

// ---------- Coach upload + pose analysis ----------
const dlPosesBtn = document.getElementById("dl-poses-btn");
let lastLoadedSourceName = null; // for download filename
let lastLoadedDurationS = 0;
let activeLibCard = null; // currently-loading library card (for inline progress)

function setAnalyzeProgress(pct, text) {
  const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  if (analyzeFill) analyzeFill.style.width = w;
  if (analyzeMeta && text != null) analyzeMeta.textContent = text;
  if (analyzeBannerFill) analyzeBannerFill.style.width = w;
  if (analyzeBannerMeta && text != null) analyzeBannerMeta.textContent = text;
  if (activeLibCard) {
    const f = activeLibCard.querySelector(".lib-progress-fill");
    const t = activeLibCard.querySelector(".lib-progress-text");
    const badge = activeLibCard.querySelector(".lib-badge");
    if (f) f.style.width = w;
    if (t && text != null) t.textContent = text;
    if (badge) { badge.textContent = `${Math.round(pct)}%`; badge.classList.remove("live"); badge.classList.add("working"); }
  }
}
function showAnalyzeUi(on) {
  if (analyzeBar) analyzeBar.style.display = on ? "block" : "none";
  analyzeBanner?.classList.toggle("show", on);
  if (activeLibCard) {
    activeLibCard.querySelector(".lib-progress")?.classList.toggle("show", on);
    activeLibCard.classList.toggle("busy", on);
  }
}

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  document.querySelectorAll(".lib-card").forEach((c) => c.classList.remove("active"));
  activeLibCard = null;
  const url = URL.createObjectURL(file);
  await loadCoachSource({ url, label: `${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`, sourceName: file.name.replace(/\.[^.]+$/, ""), posesUrl: null });
});

// In-memory cache so a 2nd click is instant.
const _posesMemCache = new Map(); // url -> json
async function loadCoachSource({ url, label, sourceName, posesUrl }) {
  coachMeta.textContent = label;
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";
  coachAnalyzed = false;
  dlPosesBtn?.classList.remove("show");
  lastLoadedSourceName = sourceName;

  // Kick poses fetch IN PARALLEL with video metadata load. They're independent.
  let posesFetchPromise = null;
  if (posesUrl) {
    showAnalyzeUi(true);
    setAnalyzeProgress(5, "Fetching cached poses…");
    if (_posesMemCache.has(posesUrl)) {
      posesFetchPromise = Promise.resolve(_posesMemCache.get(posesUrl));
    } else {
      posesFetchPromise = (async () => {
        const r = await fetch(posesUrl, { cache: "force-cache" });
        if (!r.ok) throw new Error(`poses HTTP ${r.status}`);
        // Stream + show progress while downloading
        const total = +r.headers.get("Content-Length") || 0;
        if (total && r.body) {
          const reader = r.body.getReader();
          const chunks = []; let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); received += value.byteLength;
            const pct = 5 + (received / total) * 70; // 5%..75%
            setAnalyzeProgress(pct, `Downloading cached poses ${(received/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB`);
          }
          const buf = new Uint8Array(received); let off = 0;
          for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
          setAnalyzeProgress(80, "Parsing pose data…");
          const json = JSON.parse(new TextDecoder().decode(buf));
          _posesMemCache.set(posesUrl, json);
          return json;
        }
        setAnalyzeProgress(50, "Parsing pose data…");
        const json = await r.json();
        _posesMemCache.set(posesUrl, json);
        return json;
      })();
    }
  }

  // Wait for video metadata. Attach listener BEFORE assigning src so the event
  // can't fire before we listen; add a hard timeout so UI never hangs.
  const metadataReady = new Promise((res) => {
    let done = false;
    const finish = (why) => { if (done) return; done = true; if (why) console.warn("[loadCoachSource]", why); res(); };
    coachVideo.addEventListener("loadedmetadata", () => finish(), { once: true });
    coachVideo.addEventListener("error", () => finish("video error"), { once: true });
    setTimeout(() => finish("timeout"), 12000);
  });
  coachVideo.src = url;
  coachStage.src = url;
  try { coachVideo.load(); coachStage.load(); } catch (_) {}
  await metadataReady;
  lastLoadedDurationS = Number.isFinite(coachVideo.duration) ? coachVideo.duration : 0;

  // Now await the parallel poses fetch (likely already done).
  if (posesFetchPromise) {
    try {
      const json = await posesFetchPromise;
      if (json?.frames?.length) {
        coachFrames = json.frames;
        computeCoachEnergy();
        setAnalyzeProgress(100, `⚡ Loaded ${coachFrames.length} cached pose samples (${lastLoadedDurationS.toFixed(1)}s)`);
        coachAnalyzed = true;
        startBtn.disabled = false;
        startBtn.textContent = "Start Session";
        if (activeLibCard) {
          const badge = activeLibCard.querySelector(".lib-badge");
          if (badge) { badge.textContent = "⚡ CACHED"; badge.classList.remove("working", "live"); }
        }
        setTimeout(() => { analyzeBanner?.classList.remove("show"); activeLibCard?.querySelector(".lib-progress")?.classList.remove("show"); activeLibCard?.classList.remove("busy"); }, 800);
        return;
      }
    } catch (err) { console.warn("[library] cache fetch failed, will analyze live:", err); }
  }

  // Fallback: live analysis
  startBtn.textContent = "Analyzing coach…";
  showAnalyzeUi(true);
  await analyzeCoachVideo();
  coachAnalyzed = true;
  startBtn.disabled = false;
  startBtn.textContent = "Start Session";
  // Offer to download for caching
  dlPosesBtn?.classList.add("show");
  if (activeLibCard) {
    const badge = activeLibCard.querySelector(".lib-badge");
    if (badge) { badge.textContent = "✓ READY"; badge.classList.remove("working", "live"); }
  }
  setTimeout(() => { analyzeBanner?.classList.remove("show"); activeLibCard?.querySelector(".lib-progress")?.classList.remove("show"); activeLibCard?.classList.remove("busy"); }, 800);
}

dlPosesBtn?.addEventListener("click", () => {
  if (!coachFrames?.length) return;
  const payload = {
    fps: ANALYSIS_FPS,
    durationS: lastLoadedDurationS,
    generatedAt: new Date().toISOString(),
    frames: coachFrames,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${lastLoadedSourceName || "coach"}.poses.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Library ----------
async function loadLibrary() {
  const grid = document.getElementById("lib-grid");
  if (!grid) return;
  try {
    const r = await fetch("library/library.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lib = await r.json();
    if (!lib?.videos?.length) { grid.innerHTML = '<div style="opacity:0.6;font-size:12px;text-align:center;grid-column:1/-1;">No library videos yet</div>'; return; }
    grid.innerHTML = "";
    for (const item of lib.videos) {
      const card = document.createElement("div");
      card.className = "lib-card";
      card.dataset.id = item.id;
      // Probe poses cache existence
      const posesRel = item.poses?.replace(/^games\//, "") || null;
      let cached = false;
      if (posesRel) {
        try { const h = await fetch(posesRel, { method: "HEAD" }); cached = h.ok; } catch (_) {}
      }
      // Warm the browser HTTP cache (and our in-memory cache) in the background
      // so the click-to-start is instant even on first visit.
      if (cached && posesRel && !_posesMemCache.has(posesRel)) {
        (async () => {
          try {
            const r = await fetch(posesRel, { cache: "force-cache" });
            if (r.ok) _posesMemCache.set(posesRel, await r.json());
          } catch (_) {}
        })();
      }
      card.innerHTML = `
        <div class="lib-badge ${cached ? "" : "live"}">${cached ? "⚡ CACHED" : "ANALYZE"}</div>
        <div class="lib-title">${item.title}</div>
        ${item.subtitle ? `<div class="lib-sub">${item.subtitle}</div>` : ""}
        <div class="lib-progress"><div class="lib-progress-fill"></div></div>
        <div class="lib-progress-text"></div>
      `;
      card.addEventListener("click", async () => {
        if (card.classList.contains("busy")) return;
        document.querySelectorAll(".lib-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        activeLibCard = card;
        fileInput.value = "";
        const videoRel = item.video.replace(/^games\//, "");
        await loadCoachSource({
          url: videoRel,
          label: `📚 ${item.title}`,
          sourceName: item.id,
          posesUrl: cached ? posesRel : null,
        });
      });
      grid.appendChild(card);
    }
  } catch (err) {
    console.warn("[library] failed to load:", err);
    grid.innerHTML = `<div style="opacity:0.6;font-size:12px;text-align:center;grid-column:1/-1;">Library unavailable (${err.message})</div>`;
  }
}
loadLibrary();

async function ensureCoachPosed() {
  if (coachOnePosed) return coachOnePosed;
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  coachOnePosed = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return coachOnePosed;
}

async function analyzeCoachVideo() {
  showAnalyzeUi(true);
  setAnalyzeProgress(0, "Loading pose model…");
  const posed = await ensureCoachPosed();
  const duration = coachVideo.duration;
  const step = 1 / ANALYSIS_FPS;
  coachFrames = [];
  coachVideo.muted = true;

  // We sample the coach video by setting currentTime then waiting for "seeked".
  let t = 0;
  const totalSteps = Math.max(1, Math.floor(duration / step));
  let stepIdx = 0;
  while (t < duration) {
    await seekTo(coachVideo, t);
    const ts = Math.floor(performance.now()); // monotonic, must be increasing
    const res = posed.detectForVideo(coachVideo, ts + stepIdx);
    let landmarks = null;
    if (res?.landmarks?.length) {
      landmarks = res.landmarks[0].map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 1 }));
    }
    coachFrames.push({ tSec: t, landmarks, energy: 0 });
    stepIdx++;
    if (stepIdx % 4 === 0) {
      const pct = Math.min(100, (stepIdx / totalSteps) * 100);
      setAnalyzeProgress(pct, `Analyzing pose ${stepIdx}/${totalSteps} (${pct.toFixed(0)}%)`);
      // Yield so UI repaints
      await new Promise((r) => setTimeout(r, 0));
    }
    t += step;
  }

  // Compute per-frame coach motion energy (normalized px/torso/sec across key joints).
  computeCoachEnergy();

  setAnalyzeProgress(100, `Done · ${coachFrames.length} pose samples (${duration.toFixed(1)}s)`);
}

function seekTo(video, t) {
  return new Promise((resolve) => {
    const onSeek = () => { video.removeEventListener("seeked", onSeek); resolve(); };
    video.addEventListener("seeked", onSeek);
    try { video.currentTime = Math.min(video.duration - 0.001, Math.max(0, t)); }
    catch (_) { resolve(); }
  });
}

function computeCoachEnergy() {
  const ENERGY_LMS = [13, 14, 15, 16, 25, 26, 27, 28]; // elbows, wrists, knees, ankles
  for (let i = 1; i < coachFrames.length; i++) {
    const a = coachFrames[i], b = coachFrames[i - 1];
    if (!a.landmarks || !b.landmarks) { a.energy = 0; continue; }
    const torso = torsoSize(a.landmarks);
    if (!torso) { a.energy = 0; continue; }
    const dt = Math.max(0.001, a.tSec - b.tSec);

    // Use MAX speed across joints — if ANY one limb is moving meaningfully,
    // the coach is considered "moving". Averaging would dilute arms-only
    // moves (legs still) and falsely flag "still".
    let maxSpeed = 0;
    for (const idx of ENERGY_LMS) {
      const pa = a.landmarks[idx], pb = b.landmarks[idx];
      if (!pa || !pb) continue;
      // Relaxed visibility (was 0.4 → 0.15): don't drop a real-but-occluded limb.
      if ((pa.v ?? 1) < 0.15 || (pb.v ?? 1) < 0.15) continue;
      const speed = (Math.hypot(pa.x - pb.x, pa.y - pb.y) / torso) / dt;
      if (speed > maxSpeed) maxSpeed = speed;
    }
    a.energy = maxSpeed;
  }

  // Temporal window: take MAX over ±3 samples (~±0.25s @ 12 fps). A brief
  // pause between strokes won't accidentally pause scoring.
  const out = new Array(coachFrames.length).fill(0);
  for (let i = 0; i < coachFrames.length; i++) {
    let m = 0;
    for (let k = -3; k <= 3; k++) {
      const j = i + k;
      if (j < 0 || j >= coachFrames.length) continue;
      if (coachFrames[j].energy > m) m = coachFrames[j].energy;
    }
    out[i] = m;
  }
  for (let i = 0; i < coachFrames.length; i++) coachFrames[i].energy = out[i];
}

function torsoSize(lm) {
  const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
  if (!ls || !rs || !lh || !rh) return 0;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2;
  const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
  return Math.max(0.05, Math.hypot(sx - hx, sy - hy));
}

// ---------- Similarity ----------

/** Compute pose similarity between two landmark arrays.
 * Both inputs use the same coordinate space (we only need direction
 * vectors, which are translation/scale invariant after normalization).
 * Returns { score: 0..1, visibleLimbs: number }. */
function poseSimilarity(userLm, coachLm) {
  if (!userLm || !coachLm) return { score: 0, visibleLimbs: 0 };
  let sumSim = 0, sumW = 0, visible = 0;
  for (const [a, b] of LIMBS) {
    const ua = userLm[a], ub = userLm[b];
    const ca = coachLm[a], cb = coachLm[b];
    if (!ua || !ub || !ca || !cb) continue;
    const uv = Math.min(ua.v ?? 1, ub.v ?? 1);
    const cv = Math.min(ca.v ?? 1, cb.v ?? 1);
    if (uv < 0.4 || cv < 0.4) continue;
    const udx = ub.x - ua.x, udy = ub.y - ua.y;
    const cdx = cb.x - ca.x, cdy = cb.y - ca.y;
    const um = Math.hypot(udx, udy), cm = Math.hypot(cdx, cdy);
    if (um < 1e-4 || cm < 1e-4) continue;
    // cosine similarity in [-1, 1] → remap to [0, 1]
    const cos = (udx * cdx + udy * cdy) / (um * cm);
    const sim = (cos + 1) / 2;
    const w = uv * cv;
    sumSim += sim * w;
    sumW += w;
    visible++;
  }
  return { score: sumW > 0 ? sumSim / sumW : 0, visibleLimbs: visible };
}

function gradeFor(score) {
  const t = gradeThresholds();
  if (score >= t.perfect)   return "perfect";
  if (score >= t.excellent) return "excellent";
  if (score >= t.good)      return "good";
  return "bad";
}
const GRADE_LABEL = {
  perfect:   "✨ PERFECT",
  excellent: "💚 EXCELLENT",
  good:      "👍 GOOD",
  bad:       "❌ BAD",
};
const GRADE_COLOR = { perfect:"#ffd23f", excellent:"#6cff6c", good:"#5ce1ff", bad:"#ff5a5a" };

function comboMultiplier(combo) {
  if (combo >= 50) return 2.0;
  if (combo >= 25) return 1.5;
  if (combo >= 10) return 1.2;
  return 1.0;
}

// ---------- Tile DOM ----------
function buildTiles(n) {
  tilesEl.innerHTML = "";
  STATE.pipPoseEls = [];
  const useArena = viewMode === "design1";
  // Clear any previous arena slot hosts before re-parenting
  if (useArena) {
    for (let i = 0; i < 4; i++) {
      const host = document.querySelector(`#arena .arena-slot[data-lane="${i}"] .arena-host`);
      host?.querySelectorAll(".tile").forEach((t) => t.remove());
    }
  }
  for (let i = 0; i < n; i++) {
    const t = TILES[i];
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.lane = String(i);
    tile.style.borderColor = "rgba(255,255,255,0.08)";
    tile.innerHTML = `
      <video autoplay playsinline muted></video>
      <canvas class="pose"></canvas>
      <div class="tile-name" style="border-left:3px solid ${t.color};padding-left:6px;">${t.label}</div>
      <div class="tile-score">0</div>
      <div class="tile-combo" style="color:${t.color};display:none;">×1</div>
      <div class="tile-grade"></div>
    `;
    if (useArena) {
      const slot = document.querySelector(`#arena .arena-slot[data-lane="${i}"] .arena-host`);
      (slot || tilesEl).appendChild(tile);
    } else {
      tilesEl.appendChild(tile);
    }
    const tileVideo = tile.querySelector("video");
    const poseCanvas = tile.querySelector("canvas.pose");
    // All tiles share the single user-cam stream — assign srcObject after camera starts.
    STATE.pipPoseEls.push({
      tileEl: tile,
      tileVideo,
      poseCanvas,
      poseCtx: poseCanvas.getContext("2d"),
      scoreEl: tile.querySelector(".tile-score"),
      comboEl: tile.querySelector(".tile-combo"),
      gradeEl: tile.querySelector(".tile-grade"),
    });
  }
  tilesEl.style.display = useArena ? "none" : "flex";
  buildBarRow(n);
  // Reset arena live numbers
  if (useArena) {
    for (let i = 0; i < 4; i++) {
      const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setT(`arena-score-${i}`, "0"); setT(`arena-acc-${i}`, "0%");
      setT(`arena-csc-${i}`, "0");   setT(`arena-mul-${i}`, "×1");
      const cbar = document.getElementById(`arena-cbar-${i}`); if (cbar) cbar.style.width = "0%";
      const wb   = document.getElementById(`arena-win-${i}`);  if (wb)   wb.style.width   = "0%";
      document.querySelectorAll(`#arena-stars-${i} .s`).forEach((s) => s.classList.remove("on"));
      const ico = document.getElementById(`arena-ico-${i}`); if (ico) ico.textContent = "★";
      document.querySelector(`.arena-combo-card[data-lane="${i}"]`)?.classList.remove("leader");
    }
  }
  // Re-assert current view mode class (innerHTML reset above wipes nothing on tilesEl itself,
  // but be safe in case future code toggles classes elsewhere).
  applyViewMode(viewMode);
}

// ---------- Just-Dance Bar scoreboard ----------
function buildBarRow(n) {
  if (!barRow) return;
  barRow.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const t = TILES[i];
    const slot = document.createElement("div");
    slot.className = "bar-slot";
    slot.dataset.lane = String(i);
    slot.style.borderLeftColor = t.color;
    slot.innerHTML = `
      <div class="bar-grade grade-none">—</div>
      <div class="bar-body">
        <div class="bar-name" style="color:${t.color}">${t.label}</div>
        <div class="bar-stars"><span class="s">★</span><span class="s">★</span><span class="s">★</span><span class="s">★</span></div>
        <div class="bar-meta"><span class="score">0 pts</span><span class="combo">×1</span><span class="fire">🔥 ON FIRE</span></div>
      </div>
    `;
    barRow.appendChild(slot);
  }
}
function starsForCombo(combo) {
  if (combo >= 21) return 4;
  if (combo >= 11) return 3;
  if (combo >= 6)  return 2;
  if (combo >= 3)  return 1;
  return 0;
}
function updateBarSlot(lane, grade) {
  const slot = barRow?.children?.[lane];
  if (!slot) return;
  const badge = slot.querySelector(".bar-grade");
  const stars = slot.querySelectorAll(".bar-stars .s");
  const scoreEl = slot.querySelector(".bar-meta .score");
  const comboEl = slot.querySelector(".bar-meta .combo");
  if (badge && grade) {
    badge.textContent = grade.toUpperCase();
    badge.className = `bar-grade grade-${grade}`;
  }
  const combo = STATE.combo[lane] || 0;
  const filled = starsForCombo(combo);
  stars.forEach((s, idx) => s.classList.toggle("on", idx < filled));
  if (scoreEl) scoreEl.textContent = `${Math.round(STATE.score[lane] || 0)} pts`;
  if (comboEl) comboEl.textContent = `×${comboMultiplier(combo).toFixed(combo >= 10 ? 1 : 0)}`;
  const onFire = filled >= 4 && (grade === "perfect" || grade === "excellent");
  slot.classList.toggle("on-fire", onFire);
}

function assignCameraToTiles(stream) {
  for (const t of STATE.pipPoseEls) {
    t.tileVideo.srcObject = stream;
  }
}

function resizeTileCanvases() {
  for (const t of STATE.pipPoseEls) {
    const r = t.poseCanvas.getBoundingClientRect();
    t.poseCanvas.width = Math.max(1, Math.round(r.width));
    t.poseCanvas.height = Math.max(1, Math.round(r.height));
  }
  // Coach overlay canvas
  const cr = coachOverlay.getBoundingClientRect();
  coachOverlay.width = Math.max(1, Math.round(cr.width));
  coachOverlay.height = Math.max(1, Math.round(cr.height));
}

function showGrade(lane, grade) {
  const el = STATE.pipPoseEls[lane]?.gradeEl;
  if (!el) return;
  el.textContent = GRADE_LABEL[grade];
  el.style.color = GRADE_COLOR[grade];
  el.classList.add("show");
  const tile = STATE.pipPoseEls[lane].tileEl;
  tile.classList.remove("flash-perfect","flash-excellent","flash-good","flash-bad","flash-pause");
  tile.classList.add(`flash-${grade}`);
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 450);
  updateBarSlot(lane, grade);
  if (viewMode === "design1") updateArenaSlot(lane, grade);
}

function updateArenaSlot(lane, grade) {
  const score = STATE.score[lane] || 0;
  const correct = STATE.gradeCounts[lane].perfect + STATE.gradeCounts[lane].excellent + STATE.gradeCounts[lane].good;
  const acc = STATE.graded[lane] ? Math.round((correct / STATE.graded[lane]) * 100) : 0;
  const combo = STATE.combo[lane] || 0;
  const mul = comboMultiplier(combo);
  const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setT(`arena-score-${lane}`, score.toLocaleString());
  setT(`arena-acc-${lane}`, acc + "%");
  setT(`arena-csc-${lane}`, score.toLocaleString());
  setT(`arena-mul-${lane}`, `\u00d7${mul.toFixed(combo >= 10 ? 1 : 0)}`);
  const cbar = document.getElementById(`arena-cbar-${lane}`);
  if (cbar) cbar.style.width = Math.min(100, (combo / 50) * 100) + "%";
  const stars = document.querySelectorAll(`#arena-stars-${lane} .s`);
  const filled = combo >= 40 ? 5 : combo >= 25 ? 4 : combo >= 12 ? 3 : combo >= 6 ? 2 : combo >= 2 ? 1 : 0;
  stars.forEach((s, idx) => s.classList.toggle("on", idx < filled));
  // Reset winbar after a grade fires (visual cue that one window finished)
  const wb = document.getElementById(`arena-win-${lane}`); if (wb) wb.style.width = "0%";
  // Crown rotates to current leader
  let leader = 0, max = -1;
  for (let i = 0; i < STATE.N; i++) if ((STATE.score[i] || 0) > max) { max = STATE.score[i] || 0; leader = i; }
  for (let i = 0; i < 4; i++) {
    const ico = document.getElementById(`arena-ico-${i}`);
    if (ico) ico.textContent = i === leader ? "\u{1F451}" : "\u2605";
    document.querySelector(`.arena-combo-card[data-lane="${i}"]`)?.classList.toggle("leader", i === leader);
  }
}

function showPause(lane) {
  const tile = STATE.pipPoseEls[lane]?.tileEl;
  if (!tile) return;
  tile.classList.remove("flash-perfect","flash-excellent","flash-good","flash-bad");
  tile.classList.add("flash-pause");
}

// ---------- Coach pose lookup ----------
function coachFrameAt(tSec) {
  if (!coachFrames.length) return null;
  // Binary search
  let lo = 0, hi = coachFrames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (coachFrames[mid].tSec < tSec) lo = mid + 1;
    else hi = mid;
  }
  // Pick the closest of [lo-1, lo]
  const a = coachFrames[Math.max(0, lo - 1)];
  const b = coachFrames[lo];
  return Math.abs(a.tSec - tSec) <= Math.abs(b.tSec - tSec) ? a : b;
}

function bestCoachFrame(tSec) {
  // Look at center and ±TIME_TOLERANCE; return the one with landmarks present.
  const candidates = [
    coachFrameAt(tSec),
    coachFrameAt(tSec - TIME_TOLERANCE_S),
    coachFrameAt(tSec + TIME_TOLERANCE_S),
  ];
  for (const c of candidates) if (c?.landmarks) return c;
  return candidates[0];
}

// ---------- Game loop ----------
let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.06, (t - lastT) / 1000);
  lastT = t;

  // Coach timing
  const ct = coachStage.currentTime;
  const cdur = coachStage.duration || 0;
  coachTime.textContent = `${fmtTime(ct)} / ${fmtTime(cdur)}`;
  const cf = bestCoachFrame(ct);
  const coachMoving = cf && cf.energy >= COACH_MOTION_FLOOR;

  // --- Design 1 header (timer + calorie estimate) ---
  if (viewMode === "design1") {
    const remain = Math.max(0, cdur - ct);
    const tEl = document.getElementById("arena-timer");
    if (tEl) tEl.textContent = fmtTime(remain);
    if (coachMoving && STATE.calLastTick) {
      const ds = (t - STATE.calLastTick) / 1000;
      STATE.calBurn = (STATE.calBurn || 0) + ds * (6 / 60) * STATE.N;
    }
    STATE.calLastTick = t;
    const cEl = document.getElementById("arena-cal");
    if (cEl) cEl.textContent = String(Math.round(STATE.calBurn || 0));
  }

  // Draw coach pose dots on coach overlay
  drawCoachOverlay(cf);

  // Update badge
  if (coachMoving) {
    coachBadge.textContent = "👨‍🏫 COACH · FOLLOW";
    coachBadge.classList.remove("warn");
  } else {
    coachBadge.textContent = "🛑 COACH STILL · scoring paused";
    coachBadge.classList.add("warn");
  }

  // Detect user poses (sorted left→right by hip x). Wrapper ignores the
  // passed canvas and uses the camera's intrinsic frame size for landmark
  // → pixel mapping (returned as det._W / det._H).
  const det = tracker.detect(camVideo, null, t);

  // For each lane, look up the matching user
  const perLane = new Array(STATE.N).fill(null);
  for (const p of det.poses) if (p.lane < STATE.N) perLane[p.lane] = p;

  resizeTileCanvases();

  // Per-tile updates
  for (let lane = 0; lane < STATE.N; lane++) {
    const tile = STATE.pipPoseEls[lane];
    const user = perLane[lane];

    // Draw skeleton on tile
    tile.poseCtx.clearRect(0, 0, tile.poseCanvas.width, tile.poseCanvas.height);
    if (user) {
      // Mirror inside the tile (video is also scaleX(-1)). Our tracker already mirrors
      // landmarks against the capture canvas; we need to map them into tile pixel space.
      const sx = tile.poseCanvas.width  / det._W;
      const sy = tile.poseCanvas.height / det._H;
      if (viewMode === "silhouette" && user.mask) {
        drawSilhouetteMask(tile.poseCtx, user.mask, TILES[lane].color, tile.poseCanvas.width, tile.poseCanvas.height);
      }
      tile.poseCtx.save();
      tile.poseCtx.scale(sx, sy);
      drawPoseStick(tile.poseCtx, user, {
        color: viewMode === "silhouette" ? TILES[lane].outline : TILES[lane].color,
        outline: viewMode === "silhouette" ? "rgba(0,0,0,0.55)" : TILES[lane].outline,
        lineW: (viewMode === "silhouette" ? 3 : 6) / Math.max(sx, sy),
      });
      tile.poseCtx.restore();
    }

    // Scoring tick
    if (!coachMoving) {
      showPause(lane);
      // Combo decays slowly during pauses (don't punish — just don't reward)
      // Keep combo as-is.
      continue;
    }
    if (!user || !cf?.landmarks) {
      // No user / no coach landmarks → can't score this frame
      continue;
    }

    const { score, visibleLimbs } = poseSimilarity(user.landmarks, denormalize(cf.landmarks, det._W, det._H));
    if (visibleLimbs < MIN_VISIBLE_LIMBS_USER) continue;

    STATE.similarity[lane] = STATE.similarity[lane] * (1 - SIMILARITY_EMA) + score * SIMILARITY_EMA;

    const now = performance.now();
    // Design 1: animate the per-tile scoring-window fill bar 0..100%
    if (viewMode === "design1") {
      const fill = Math.min(100, ((now - STATE.lastGradeAt[lane]) / Math.max(50, CFG.windowMs)) * 100);
      const w = document.getElementById(`arena-win-${lane}`);
      if (w) w.style.width = fill.toFixed(1) + "%";
    }
    if (now - STATE.lastGradeAt[lane] >= CFG.windowMs) {
      STATE.lastGradeAt[lane] = now;
      const g = gradeFor(STATE.similarity[lane]);
      STATE.gradeCounts[lane][g]++;
      STATE.graded[lane]++;
      if (g === "bad") STATE.combo[lane] = 0;
      else STATE.combo[lane]++;
      if (STATE.combo[lane] > STATE.maxCombo[lane]) STATE.maxCombo[lane] = STATE.combo[lane];
      const mult = comboMultiplier(STATE.combo[lane]);
      STATE.score[lane] += Math.round(GRADE_POINTS[g] * mult);

      tile.scoreEl.textContent = STATE.score[lane].toLocaleString();
      tile.comboEl.style.display = STATE.combo[lane] >= 5 ? "block" : "none";
      tile.comboEl.textContent = `×${mult.toFixed(1)} · ${STATE.combo[lane]} combo`;
      showGrade(lane, g);
      if (g === "perfect") sfx.catch();
      else if (g === "excellent") sfx.pop();
      else if (g === "good") sfx.tick();
      else sfx.miss();
    }
  }

  if (coachStage.ended || coachStage.paused && coachStage.currentTime >= (coachStage.duration - 0.05)) {
    endMatch();
    return;
  }

  requestAnimationFrame(loop);
}

function denormalize(lm, W, H) {
  // Coach landmarks were stored normalized (0..1); user landmarks are already in pixel
  // space and mirrored. We mirror coach too so left/right matches across the mirror.
  return lm.map((p) => ({ x: (1 - p.x) * W, y: p.y * H, v: p.v }));
}

function drawCoachOverlay(cf) {
  coachOverlayCtx.clearRect(0, 0, coachOverlay.width, coachOverlay.height);
  if (!cf?.landmarks) return;
  // Coach video is NOT mirrored on stage. Draw landmarks in source space (no mirror).
  const W = coachOverlay.width, H = coachOverlay.height;
  const COLOR = "#ffd23f", OUT = "rgba(0,0,0,0.85)";
  const CONN = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
  coachOverlayCtx.lineWidth = 4;
  coachOverlayCtx.strokeStyle = OUT;
  for (const [a, b] of CONN) {
    const pa = cf.landmarks[a], pb = cf.landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.v ?? 1) < 0.4 || (pb.v ?? 1) < 0.4) continue;
    coachOverlayCtx.beginPath();
    coachOverlayCtx.moveTo(pa.x * W, pa.y * H);
    coachOverlayCtx.lineTo(pb.x * W, pb.y * H);
    coachOverlayCtx.stroke();
  }
  coachOverlayCtx.lineWidth = 2;
  coachOverlayCtx.strokeStyle = COLOR;
  for (const [a, b] of CONN) {
    const pa = cf.landmarks[a], pb = cf.landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.v ?? 1) < 0.4 || (pb.v ?? 1) < 0.4) continue;
    coachOverlayCtx.beginPath();
    coachOverlayCtx.moveTo(pa.x * W, pa.y * H);
    coachOverlayCtx.lineTo(pb.x * W, pb.y * H);
    coachOverlayCtx.stroke();
  }
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2,"0")}`;
}

// ---------- End / restart ----------
function endMatch() {
  STATE.running = false;
  coachStage.pause();
  sfx.bgmStop();
  stage.style.opacity = "0.6";

  // Rank by score
  const order = [];
  for (let i = 0; i < STATE.N; i++) order.push(i);
  order.sort((a, b) => STATE.score[b] - STATE.score[a]);
  const winnerLane = order[0];

  setTimeout(() => {
    winnerEl.textContent = STATE.N === 1
      ? `🏁 Session complete!`
      : `🏆 ${TILES[winnerLane].label} Wins!`;
    winnerEl.style.color = TILES[winnerLane].color;

    endStats.innerHTML = "";
    for (let rank = 0; rank < order.length; rank++) {
      const lane = order[rank];
      const T = TILES[lane];
      const gc = STATE.gradeCounts[lane];
      const total = STATE.graded[lane] || 1;
      const pct = (n) => Math.round((n / total) * 100);
      const place = STATE.N === 1 ? "RESULT" : ["🥇 1ST","🥈 2ND","🥉 3RD","4TH"][rank];
      const card = document.createElement("div");
      card.className = "stat-card";
      card.style.borderLeft = `4px solid ${T.color}`;
      card.innerHTML = `
        <div class="lbl">${place} · ${T.label}</div>
        <div class="val">${STATE.score[lane].toLocaleString()} <span style="font-size:13px;opacity:0.7;">pts</span></div>
        <div class="lbl" style="margin-top:6px;">
          ✨ ${pct(gc.perfect)}% · 💚 ${pct(gc.excellent)}% · 👍 ${pct(gc.good)}% · ❌ ${pct(gc.bad)}%
        </div>
        <div class="lbl" style="margin-top:2px;">peak combo · ${STATE.maxCombo[lane]}</div>
      `;
      endStats.appendChild(card);
    }
    endOverlay.classList.remove("hidden");
    sfx.win();
  }, 350);
}

// Patch tracker.detect to remember the canvas size we used (we use camVideo's intrinsic dimensions).
function wrapTracker(t) {
  const origDetect = t.detect.bind(t);
  const tmp = document.createElement("canvas");
  return {
    ...t,
    detect(video, _canvasIgnored, ts) {
      // Use the camera's intrinsic frame size so landmark→pixel mapping is consistent.
      const W = video.videoWidth || 1280;
      const H = video.videoHeight || 720;
      if (tmp.width !== W) tmp.width = W;
      if (tmp.height !== H) tmp.height = H;
      const out = origDetect(video, tmp, ts);
      out._W = W;
      out._H = H;
      return out;
    },
  };
}

// ---------- Boot ----------
async function startSession() {
  if (!coachAnalyzed) return;
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  stage.style.display = "block";
  stage.style.opacity = "1";
  buildTiles(numPlayers);
  STATE.N = numPlayers;
  STATE.score = new Array(numPlayers).fill(0);
  STATE.combo = new Array(numPlayers).fill(0);
  STATE.maxCombo = new Array(numPlayers).fill(0);
  STATE.graded = new Array(numPlayers).fill(0);
  STATE.gradeCounts = Array.from({length: numPlayers}, () => ({perfect:0,excellent:0,good:0,bad:0}));
  STATE.similarity = new Array(numPlayers).fill(0);
  STATE.lastGradeAt = new Array(numPlayers).fill(0);
  STATE.calBurn = 0;
  STATE.calLastTick = 0;

  // Wire user cam stream into each tile's <video>
  if (camVideo.srcObject) assignCameraToTiles(camVideo.srcObject);

  resizeTileCanvases();

  // Sync coach stage with hidden analyzer video — easier: just replay from 0.
  coachStage.currentTime = 0;
  await coachStage.play().catch(() => {});

  STATE.running = true;
  lastT = performance.now();
  sfx.bgmStart();
  requestAnimationFrame(loop);
}

async function boot() {
  startBtn.disabled = true;
  startBtn.textContent = "Loading camera…";
  try {
    await startCamera(camVideo);
    const needSeg = viewMode === "silhouette";
    if (!tracker || tracker._n !== numPlayers || tracker._seg !== needSeg) {
      const t = await createPoseTracker({ numPoses: numPlayers, enableSegmentation: needSeg });
      tracker = wrapTracker(t);
      tracker._n = numPlayers;
      tracker._seg = needSeg;
    }
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Camera blocked — retry";
    alert("Could not start camera / pose model.\n\n" + err.message);
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = "Start Session";
  await startSession();
}

window.addEventListener("resize", resizeTileCanvases);
startBtn.addEventListener("click", boot);
restartBtn.addEventListener("click", async () => {
  const needSeg = viewMode === "silhouette";
  if (!tracker || tracker._n !== numPlayers || tracker._seg !== needSeg) {
    const t = await createPoseTracker({ numPoses: numPlayers, enableSegmentation: needSeg });
    tracker = wrapTracker(t);
    tracker._n = numPlayers;
    tracker._seg = needSeg;
  }
  startSession();
});

// ---------- Settings modal ----------
const cfgBtn   = document.getElementById("open-cfg-btn");
const cfgModal = document.getElementById("cfg-modal");
const cfgSens  = document.getElementById("cfg-sens");
const cfgWin   = document.getElementById("cfg-win");
const cfgCoach = document.getElementById("cfg-coach");
const cfgSensV = document.getElementById("cfg-sens-val");
const cfgWinV  = document.getElementById("cfg-win-val");
const cfgCoachV = document.getElementById("cfg-coach-val");
applyCoachScale(); // apply saved scale on first paint
function openCfg() {
  if (!cfgModal) return;
  cfgSens.value = CFG.sensitivity;
  cfgWin.value  = CFG.windowMs;
  if (cfgCoach) cfgCoach.value = CFG.coachScale;
  cfgSensV.textContent = String(CFG.sensitivity);
  cfgWinV.textContent  = `${CFG.windowMs} ms`;
  if (cfgCoachV) cfgCoachV.textContent = `${CFG.coachScale}%`;
  cfgModal.classList.add("show");
}
function closeCfg(save) {
  if (save) {
    CFG.sensitivity = parseInt(cfgSens.value, 10);
    CFG.windowMs    = parseInt(cfgWin.value, 10);
    if (cfgCoach) CFG.coachScale = parseInt(cfgCoach.value, 10);
    saveCfg();
    applyCoachScale();
  }
  cfgModal?.classList.remove("show");
}
cfgBtn ?.addEventListener("click", openCfg);
cfgSens?.addEventListener("input", () => cfgSensV.textContent = cfgSens.value);
cfgWin ?.addEventListener("input", () => cfgWinV .textContent = cfgWin.value + " ms");
cfgCoach?.addEventListener("input", () => {
  cfgCoachV.textContent = cfgCoach.value + "%";
  // Live preview while dragging — without saving until user confirms
  document.body.style.setProperty("--coach-scale", String(cfgCoach.value / 100));
});
document.getElementById("cfg-cancel")?.addEventListener("click", () => { closeCfg(false); applyCoachScale(); });
document.getElementById("cfg-save")  ?.addEventListener("click", () => closeCfg(true));
cfgModal?.addEventListener("click", (e) => { if (e.target === cfgModal) closeCfg(false); });
