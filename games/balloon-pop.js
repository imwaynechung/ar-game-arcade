// ============================================================
// Balloon Pop — VS Mode A (Zone-Based, 2 Players)
// Balloons rise from below; players SWING their hands fast
// through balloons in their zone to pop them.
// ============================================================

import { startCamera, createHandTracker, segmentHitsCircle, drawHand } from "../shared/tracking.js";
import { setupVirtualBackground } from "../shared/segmenter.js";
import { sfx } from "../shared/audio.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const endScore = document.getElementById("end-score");
const winnerEl = document.getElementById("winner");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const s1El = document.getElementById("s1");
const s2El = document.getElementById("s2");
const timerEl = document.getElementById("timer");

const BALLOON_IMG = new Image();
BALLOON_IMG.src = "../assets/balloons/red.png";

// Player palette tints (applied via overlay color since we have 1 PNG)
const ZONES = [
  { id: 1, color: "#ffd23f", tint: "rgba(255,210,63,0.65)" },
  { id: 2, color: "#5ce1ff", tint: "rgba(92,225,255,0.65)" },
];

const STATE = {
  running: false,
  balloons: [],
  scores: [0, 0],
  startTime: 0,
  duration: 60_000,
  spawnEveryMs: 700,
  lastSpawn: 0,
};

const SWING_SPEED = 700; // px/sec required to pop

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);
resize();

let tracker = null;
let vbg = null;

function spawnBalloon() {
  const zone = Math.random() < 0.5 ? 0 : 1;
  const half = canvas.width / 2;
  const xMin = zone === 0 ? 60 : half + 60;
  const xMax = zone === 0 ? half - 60 : canvas.width - 60;
  const size = 64 + Math.random() * 28;
  STATE.balloons.push({
    zone,
    color: ZONES[zone].tint,
    x: xMin + Math.random() * Math.max(40, xMax - xMin),
    y: canvas.height + size,
    vx: (Math.random() - 0.5) * 30,
    vy: -(90 + Math.random() * 70),
    size,
    sway: Math.random() * Math.PI * 2,
    swayAmp: 0.6 + Math.random() * 1.2,
    dead: false,
  });
  sfx.spawn();
}

let toastEl = null;
function toast(text, kind, ms = 500) {
  if (toastEl) toastEl.remove();
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = text;
  document.body.appendChild(t);
  toastEl = t;
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, ms);
}

const particles = [];
function burst(x, y, color, n = 16) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 100 + Math.random() * 260;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.55, age: 0, color });
  }
}

function tryPop(b, points) {
  const half = canvas.width / 2;
  for (const p of points) {
    // zone gate: hand center must be on the balloon's side
    const pZone = p.x < half ? 0 : 1;
    if (pZone !== b.zone) continue;
    if (p.speed < SWING_SPEED) continue;
    // Use segment from prev pos -> current pos to avoid tunneling
    if (segmentHitsCircle(p.prevX, p.prevY, p.x, p.y, b.x, b.y, b.size * 0.5 + 10)) return true;
  }
  return false;
}

function renderHud() {
  s1El.textContent = STATE.scores[0];
  s2El.textContent = STATE.scores[1];
  const elapsed = performance.now() - STATE.startTime;
  const remain = Math.max(0, STATE.duration - elapsed);
  timerEl.textContent = Math.ceil(remain / 1000);
}

// Hand swing trail per player
const trails = [[], []];
function pushTrail(pt, zone) {
  trails[zone].push({ x: pt.x, y: pt.y, t: performance.now(), speed: pt.speed });
  if (trails[zone].length > 14) trails[zone].shift();
}

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (vbg) vbg.tick(t);
  const { points } = tracker.detect(video, canvas, t);
  const half = canvas.width / 2;

  // Update trails for palm points (visual feedback)
  trails[0].length = 0; trails[1].length = 0;
  for (const p of points) {
    if (p.kind !== "palm") continue;
    const zone = p.x < half ? 0 : 1;
    pushTrail(p, zone);
  }

  // Spawn
  if (t - STATE.lastSpawn > STATE.spawnEveryMs) {
    spawnBalloon();
    STATE.lastSpawn = t;
    STATE.spawnEveryMs = Math.max(360, 700 - Math.max(STATE.scores[0], STATE.scores[1]) * 8);
  }

  // Update balloons
  for (const b of STATE.balloons) {
    if (b.dead) continue;
    b.sway += dt * 2;
    b.x += b.vx * dt + Math.sin(b.sway) * b.swayAmp;
    b.y += b.vy * dt;
    b.vy -= 8 * dt; // gentle rising acceleration

    if (!b.dead && tryPop(b, points)) {
      b.dead = true;
      STATE.scores[b.zone] += 1;
      burst(b.x, b.y, ZONES[b.zone].color, 18);
      sfx.pop();
      toast("POP!", b.zone === 0 ? "p1" : "p2", 350);
    }

    if (b.y < -b.size) b.dead = true;
  }
  STATE.balloons = STATE.balloons.filter((b) => !b.dead);

  // Particles
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 380 * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].age >= particles[i].life) particles.splice(i, 1);
  }

  // Draw
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Balloons
  for (const b of STATE.balloons) {
    ctx.save();
    ctx.translate(b.x, b.y);
    // String
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, b.size * 0.45);
    ctx.bezierCurveTo(6, b.size * 0.7, -6, b.size * 0.85, 0, b.size);
    ctx.stroke();
    // Tinted halo
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 22;
    if (BALLOON_IMG.complete) {
      ctx.drawImage(BALLOON_IMG, -b.size / 2, -b.size / 2, b.size, b.size);
    }
    ctx.restore();
  }

  // Particles
  for (const p of particles) {
    const a = 1 - p.age / p.life;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * a + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Hand trails
  for (let z = 0; z < 2; z++) {
    const color = ZONES[z].color;
    const trail = trails[z];
    if (trail.length < 2) continue;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      ctx.globalAlpha = a;
      ctx.lineWidth = 6 * a;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Cartoon hands per zone
  for (const p of points) {
    if (p.kind !== "palm") continue;
    const zone = p.x < half ? 0 : 1;
    drawHand(ctx, p, {
      color:   ZONES[zone].color,
      outline: zone === 0 ? "#3a2a00" : "#003a4a",
    });
  }

  renderHud();

  // Timer end
  if (performance.now() - STATE.startTime >= STATE.duration) return endGame();

  requestAnimationFrame(loop);
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  STATE.running = true;
  STATE.balloons = [];
  STATE.scores = [0, 0];
  STATE.startTime = performance.now();
  STATE.lastSpawn = performance.now();
  STATE.spawnEveryMs = 700;
  hud.style.display = "flex";
  renderHud();
  lastT = performance.now();
  sfx.bgmStart();
  requestAnimationFrame(loop);
}

function endGame() {
  STATE.running = false;
  hud.style.display = "none";
  sfx.bgmStop();
  const [a, b] = STATE.scores;
  let winText, cls;
  if (a > b)      { winText = "🏆 Player 1 Wins!"; cls = "winner p1"; }
  else if (b > a) { winText = "🏆 Player 2 Wins!"; cls = "winner p2"; }
  else            { winText = "🤝 Draw!";          cls = "winner"; }
  winnerEl.className = cls;
  winnerEl.textContent = winText;
  endScore.textContent = `Player 1: ${a} pops  ·  Player 2: ${b} pops`;
  endOverlay.classList.remove("hidden");
  (a === b ? sfx.tick : sfx.win)();
}

async function boot() {
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";
  try {
    await startCamera(video);
    tracker = await createHandTracker({ numHands: 4 });
    vbg = await setupVirtualBackground({
      video,
      bgCanvas: document.getElementById("bg-canvas"),
      defaultBg: "arcade",
    });
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Camera blocked — retry";
    alert("Could not start camera or pose model. Allow camera and serve via localhost/https.\n\n" + err.message);
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = "Start Match";
  await startGame();
}

startBtn.addEventListener("click", boot);
restartBtn.addEventListener("click", startGame);
