// =============================================================
// Color-Match Catcher · 配對快手
// Single player. Catch only the target-coloured ball with either
// hand. Adaptive tempo: ball fall speed scales with the player's
// recent catch rate, and points scale with tempo × combo.
// Hits 4 of our 6 domains: cognitive (selective attention),
// hand-eye, visual-spatial, dual-task.
// =============================================================

import { startCamera, createHandTracker, drawHand } from "../shared/tracking.js";
import { setupVirtualBackground } from "../shared/segmenter.js";
import { sfx } from "../shared/audio.js";

// ---- DOM ----
const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const endTitle = document.getElementById("end-title");
const endScore = document.getElementById("end-score");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const elTime = document.getElementById("cm-time");
const elScore = document.getElementById("cm-score");
const elLives = document.getElementById("cm-lives");
const elSwatch = document.getElementById("cm-swatch");
const elColorName = document.getElementById("cm-color-name");
const elTempoLabel = document.getElementById("cm-tempo-label");
const elTempoFill = document.getElementById("cm-tempo-fill");
const elCombo = document.getElementById("cm-combo");

// ---- Colours ----
const COLORS = [
  { id: "red",    label: "RED",    hex: "#ff4d4d", glow: "#ff8080" },
  { id: "yellow", label: "YELLOW", hex: "#ffd23f", glow: "#ffe680" },
  { id: "blue",   label: "BLUE",   hex: "#3aa6ff", glow: "#80c8ff" },
  { id: "green",  label: "GREEN",  hex: "#3cd06a", glow: "#80e8a0" },
];
const colorById = Object.fromEntries(COLORS.map((c) => [c.id, c]));

// ---- Tuning ----
const ROUND_MS = 60000;
const SPAWN_BASE_MS = 750;     // base interval at tempo 1.0
const SPAWN_MIN_MS = 220;      // floor at tempo 1.8
const FALL_BASE_PXPS = 260;    // base fall speed at tempo 1.0
const TARGET_HOLD_MS = 4500;   // how long each target stays before swap
const TARGET_SWAP_JITTER = 2500;
const TEMPO_WINDOW = 5;        // rolling average size
const TEMPO_MIN = 0.5;
const TEMPO_MAX = 1.8;
const CATCH_RADIUS = 56;       // pixels around hand point that catches a ball
const TARGET_DENSITY = 0.55;   // ~55% of spawned balls are the target colour

// ---- State ----
const STATE = {
  running: false,
  startMs: 0,
  endsAt: 0,
  score: 0,
  lives: 3,
  maxLives: 3,
  combo: 0,
  bestCombo: 0,
  balls: [],
  particles: [],
  hands: [],
  points: [],
  lastSpawn: 0,
  nextTargetSwapAt: 0,
  target: COLORS[0],
  outcomes: [],   // last N: 1 = correct catch, 0 = miss/wrong (for tempo)
  // metrics
  totalSpawned: 0,
  correctCatches: 0,
  wrongCatches: 0,
  missed: 0,
  reactionTimes: [],
  comboShownAt: 0,
};

let tracker = null;
let vbg = null;

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);
resize();

// ---- Tempo (rolling average → 0.5×–1.8×) ----
function tempo() {
  if (!STATE.outcomes.length) return 1.0;
  const sum = STATE.outcomes.reduce((a, b) => a + b, 0);
  const avg = sum / STATE.outcomes.length; // 0..1
  return TEMPO_MIN + (TEMPO_MAX - TEMPO_MIN) * avg;
}
function pushOutcome(v) {
  STATE.outcomes.push(v);
  if (STATE.outcomes.length > TEMPO_WINDOW) STATE.outcomes.shift();
}
function spawnInterval() {
  // higher tempo → shorter interval
  const t = tempo();
  const k = (t - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN); // 0..1
  return SPAWN_BASE_MS - (SPAWN_BASE_MS - SPAWN_MIN_MS) * k;
}
function fallSpeed() {
  return FALL_BASE_PXPS * tempo();
}

// ---- Target colour cycle ----
function pickNewTarget() {
  const others = COLORS.filter((c) => c.id !== STATE.target.id);
  STATE.target = others[Math.floor(Math.random() * others.length)];
  elSwatch.style.background = STATE.target.hex;
  elSwatch.style.color = STATE.target.glow;
  elColorName.textContent = STATE.target.label;
  STATE.nextTargetSwapAt = performance.now() + TARGET_HOLD_MS + Math.random() * TARGET_SWAP_JITTER;
}

// ---- Spawn ----
function spawnBall() {
  const isTarget = Math.random() < TARGET_DENSITY;
  const colour = isTarget
    ? STATE.target
    : COLORS[Math.floor(Math.random() * COLORS.length)];
  const r = 30 + Math.random() * 16;
  const x = r + Math.random() * (canvas.width - r * 2);
  STATE.balls.push({
    x, y: -r, prevY: -r,
    vx: (Math.random() - 0.5) * 30,
    vy: fallSpeed() * (0.85 + Math.random() * 0.4),
    r,
    colour,
    spawnTs: performance.now(),
    dead: false,
  });
  STATE.totalSpawned += 1;
}

// ---- Particles ----
function burst(x, y, hex, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 220;
    STATE.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.55, age: 0, hex,
    });
  }
}

// ---- HUD ----
function renderHud() {
  elScore.textContent = String(STATE.score);
  elLives.textContent = "❤".repeat(Math.max(0, STATE.lives)) || "—";
  const t = tempo();
  const k = (t - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN);
  elTempoFill.style.width = `${Math.round(k * 100)}%`;
  elTempoLabel.textContent = `TEMPO ${t.toFixed(1)}×`;
}
function showCombo(text) {
  elCombo.textContent = text;
  elCombo.classList.add("show");
  STATE.comboShownAt = performance.now();
}

// ---- Catch detection ----
function ballCaughtBy(b, points) {
  for (const p of points) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const r = (p.r || CATCH_RADIUS) * 0.85 + b.r;
    if (dx * dx + dy * dy <= r * r) {
      // require ball to be falling onto/through the hand region
      if (b.prevY <= p.y + (p.r || CATCH_RADIUS) * 0.4) return p;
    }
  }
  return null;
}

// ---- Game loop ----
let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (vbg) vbg.tick(t);

  // pose + hands
  const det = tracker.detect(video, canvas, t);
  STATE.hands = det.hands || [];
  STATE.points = det.points || [];

  // timer
  const remaining = Math.max(0, STATE.endsAt - t);
  elTime.textContent = String(Math.ceil(remaining / 1000));
  if (remaining <= 0) return endGame();

  // target swap
  if (t >= STATE.nextTargetSwapAt) pickNewTarget();

  // spawn
  if (t - STATE.lastSpawn >= spawnInterval()) {
    spawnBall();
    STATE.lastSpawn = t;
  }

  // physics + catch
  for (const b of STATE.balls) {
    if (b.dead) continue;
    b.prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // sideways bounce off walls
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
    if (b.x > canvas.width - b.r) { b.x = canvas.width - b.r; b.vx = -Math.abs(b.vx); }

    const hit = ballCaughtBy(b, STATE.points);
    if (hit) {
      b.dead = true;
      const isTarget = b.colour.id === STATE.target.id;
      const reaction = t - b.spawnTs;
      if (isTarget) {
        STATE.combo += 1;
        STATE.bestCombo = Math.max(STATE.bestCombo, STATE.combo);
        const tp = tempo();
        const comboMult = 1 + Math.min(0.6, (STATE.combo - 1) * 0.15);
        const pts = Math.round(10 * tp * comboMult);
        STATE.score += pts;
        STATE.correctCatches += 1;
        STATE.reactionTimes.push(reaction);
        pushOutcome(1);
        burst(b.x, b.y, b.colour.hex, 18);
        sfx.catch();
        if (STATE.combo >= 3) showCombo(`×${STATE.combo} COMBO  +${pts}`);
        else showCombo(`+${pts}`);
      } else {
        STATE.combo = 0;
        STATE.lives -= 1;
        STATE.wrongCatches += 1;
        pushOutcome(0);
        burst(b.x, b.y, "#ff4444", 22);
        sfx.wrong();
        showCombo("WRONG COLOUR ✗");
        if (STATE.lives <= 0) return endGame();
      }
      renderHud();
    } else if (b.y > canvas.height + b.r) {
      b.dead = true;
      if (b.colour.id === STATE.target.id) {
        // missed a target ball → tempo penalty (no life loss, low-frustration)
        STATE.missed += 1;
        STATE.combo = 0;
        pushOutcome(0);
      }
    }
  }
  STATE.balls = STATE.balls.filter((b) => !b.dead);

  // particle update
  for (const p of STATE.particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
  }
  for (let i = STATE.particles.length - 1; i >= 0; i--) {
    if (STATE.particles[i].age >= STATE.particles[i].life) STATE.particles.splice(i, 1);
  }

  // hide combo flash after 700ms
  if (STATE.comboShownAt && t - STATE.comboShownAt > 700) {
    elCombo.classList.remove("show");
    STATE.comboShownAt = 0;
  }

  // ---- draw ----
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // balls
  for (const b of STATE.balls) {
    ctx.save();
    ctx.shadowColor = b.colour.glow;
    ctx.shadowBlur = 18;
    const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.2, b.x, b.y, b.r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.35, b.colour.glow);
    grad.addColorStop(1, b.colour.hex);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.stroke();
    ctx.restore();
  }

  // particles
  for (const p of STATE.particles) {
    const a = 1 - p.age / p.life;
    ctx.fillStyle = p.hex;
    ctx.globalAlpha = Math.max(0, a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * a + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // hand markers (only palm points carry landmarks)
  for (const h of STATE.hands) {
    drawHand(ctx, h, { color: STATE.target.hex, outline: "#0a1530" });
  }

  requestAnimationFrame(loop);
}

// ---- Lifecycle ----
function resetState() {
  STATE.running = false;
  STATE.score = 0;
  STATE.lives = STATE.maxLives;
  STATE.combo = 0;
  STATE.bestCombo = 0;
  STATE.balls.length = 0;
  STATE.particles.length = 0;
  STATE.outcomes.length = 0;
  STATE.totalSpawned = 0;
  STATE.correctCatches = 0;
  STATE.wrongCatches = 0;
  STATE.missed = 0;
  STATE.reactionTimes.length = 0;
  STATE.lastSpawn = 0;
  STATE.target = COLORS[Math.floor(Math.random() * COLORS.length)];
  elSwatch.style.background = STATE.target.hex;
  elColorName.textContent = STATE.target.label;
  STATE.nextTargetSwapAt = performance.now() + TARGET_HOLD_MS;
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  resetState();
  STATE.running = true;
  STATE.startMs = performance.now();
  STATE.endsAt = STATE.startMs + ROUND_MS;
  STATE.lastSpawn = performance.now() - SPAWN_BASE_MS;
  renderHud();
  hud.classList.remove("hidden");
  lastT = performance.now();
  sfx.bgmStart && sfx.bgmStart();
  requestAnimationFrame(loop);
}

function endGame() {
  STATE.running = false;
  hud.classList.add("hidden");
  const acc = STATE.correctCatches + STATE.wrongCatches > 0
    ? Math.round((STATE.correctCatches / (STATE.correctCatches + STATE.wrongCatches)) * 100)
    : 0;
  const avgRt = STATE.reactionTimes.length
    ? Math.round(STATE.reactionTimes.reduce((a, b) => a + b, 0) / STATE.reactionTimes.length)
    : 0;
  endTitle.textContent = STATE.lives > 0 ? "🏁 Time's up!" : "💔 Out of lives";
  endScore.innerHTML = `
    Score: <b>${STATE.score}</b>
    &nbsp;·&nbsp; Best combo: <b>×${STATE.bestCombo}</b>
    <br/>
    Accuracy: <b>${acc}%</b>
    &nbsp;·&nbsp; Avg reaction: <b>${avgRt} ms</b>
    <br/>
    Caught: <b>${STATE.correctCatches}</b>
    &nbsp;·&nbsp; Wrong: <b>${STATE.wrongCatches}</b>
    &nbsp;·&nbsp; Missed: <b>${STATE.missed}</b>
  `;
  endOverlay.classList.remove("hidden");
  sfx.bgmStop && sfx.bgmStop();
  (STATE.lives > 0 ? sfx.win : sfx.lose)();
}

// ---- Boot ----
async function boot() {
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";
  try {
    await startCamera(video);
    tracker = await createHandTracker({ numHands: 2 });
    vbg = await setupVirtualBackground({
      video,
      bgCanvas: document.getElementById("bg-canvas"),
      defaultBg: "orchard",
    });
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Camera blocked — retry";
    alert("Could not start camera or hand model. Allow camera and serve via localhost/https.\n\n" + err.message);
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = "Start Game";
  await startGame();
}

startBtn.addEventListener("click", boot);
restartBtn.addEventListener("click", startGame);
