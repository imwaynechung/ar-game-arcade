// ============================================================
// Balloon Pump — VS · Zone-Based · 2 Players
// Each up/down wave of a player's arm = +1 pump. Balloon grows
// with every pump; first player to reach 100 pumps wins.
// ============================================================

import {
  startCamera,
  createHandTracker,
  drawHand,
} from "../shared/tracking.js";
import { setupVirtualBackground } from "../shared/segmenter.js";
import { sfx } from "../shared/audio.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const s1 = document.getElementById("s1");
const s2 = document.getElementById("s2");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const winnerEl = document.getElementById("winner");
const endScore = document.getElementById("end-score");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");

const ZONES = [
  { color: "#ffd23f", outline: "#3a2a00", label: "P1" },
  { color: "#5ce1ff", outline: "#003a4a", label: "P2" },
];

const TARGET = 100;
const WAVE_VY = 320;            // px/s vertical speed required
const WAVE_COOLDOWN_MS = 160;   // min gap between counted waves

const STATE = {
  running: false,
  counts: [0, 0],
  prevSign: [0, 0],
  lastWaveT: [0, 0],
  squash: [0, 0],
  popped: [false, false],
  particles: [],
  endedAt: 0,
  winner: -1,
};

let tracker = null;
let vbg = null;

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);

function spawnPopParticles(cx, cy, color) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 300 + Math.random() * 600;
    STATE.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 200,
      life: 0.9 + Math.random() * 0.5,
      age: 0,
      color: Math.random() < 0.6 ? color : ["#fff", "#ffd23f", "#ff6ec7"][Math.floor(Math.random() * 3)],
      size: 4 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 10,
    });
  }
}

function drawBalloon(cx, cy, rx, ry, color, outline) {
  // String
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + ry);
  ctx.quadraticCurveTo(cx + 22, cy + ry + 70, cx - 10, cy + ry + 140);
  ctx.stroke();

  // Outline
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + 5, ry + 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Knot
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy + ry);
  ctx.lineTo(cx + 9, cy + ry);
  ctx.lineTo(cx, cy + ry + 16);
  ctx.closePath();
  ctx.fill();

  // Highlight
  const hx = cx - rx * 0.35;
  const hy = cy - ry * 0.35;
  const grad = ctx.createRadialGradient(hx, hy, 2, hx, hy, rx * 0.9);
  grad.addColorStop(0, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function popBalloon(z) {
  if (STATE.popped[z]) return;
  STATE.popped[z] = true;
  const cx = z === 0 ? canvas.width * 0.25 : canvas.width * 0.75;
  const cy = canvas.height * 0.55;
  spawnPopParticles(cx, cy, ZONES[z].color);
  sfx.pop();
  sfx.bomb();
  if (STATE.winner === -1) STATE.winner = z;
  endMatch(z);
}

function endMatch(winnerZone) {
  if (STATE.endedAt) return;
  STATE.endedAt = performance.now();
  setTimeout(() => {
    STATE.running = false;
    sfx.bgmStop();
    winnerEl.textContent = `${ZONES[winnerZone].label} Wins!`;
    winnerEl.style.color = ZONES[winnerZone].color;
    endScore.textContent = `Player 1: ${STATE.counts[0]}  ·  Player 2: ${STATE.counts[1]}`;
    endOverlay.classList.remove("hidden");
    sfx.win();
  }, 1200);
}

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (vbg) vbg.tick(t);
  const det = tracker.detect(video, canvas, t);
  const { points } = det;
  const half = canvas.width / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Pick the palm with the largest |vy| per zone this frame
  const zVy = [0, 0];
  for (const p of points) {
    if (p.kind !== "palm") continue;
    const z = p.x < half ? 0 : 1;
    if (Math.abs(p.vy) > Math.abs(zVy[z])) zVy[z] = p.vy;
  }
  for (let z = 0; z < 2; z++) {
    if (STATE.popped[z]) continue;
    const vy = zVy[z];
    if (Math.abs(vy) < WAVE_VY) continue;
    const sign = Math.sign(vy);
    if (
      sign !== 0 &&
      sign !== STATE.prevSign[z] &&
      t - STATE.lastWaveT[z] > WAVE_COOLDOWN_MS
    ) {
      STATE.counts[z] = Math.min(TARGET, STATE.counts[z] + 1);
      STATE.lastWaveT[z] = t;
      STATE.squash[z] = 1;
      (z === 0 ? s1 : s2).textContent = STATE.counts[z];
      sfx.tick();
      if (STATE.counts[z] >= TARGET && !STATE.popped[z]) popBalloon(z);
    }
    if (sign !== 0) STATE.prevSign[z] = sign;
  }

  // Balloons + per-zone counter
  for (let z = 0; z < 2; z++) {
    if (STATE.popped[z]) continue;
    const cx = z === 0 ? canvas.width * 0.25 : canvas.width * 0.75;
    const cy = canvas.height * 0.55;
    const baseR = 40 + (STATE.counts[z] / TARGET) * 220;
    STATE.squash[z] = Math.max(0, STATE.squash[z] - dt * 5);
    const wobble = STATE.squash[z];
    const rx = baseR * (1 + wobble * 0.16);
    const ry = baseR * (1 - wobble * 0.1);
    drawBalloon(cx, cy, rx, ry, ZONES[z].color, ZONES[z].outline);

    const pct = STATE.counts[z] / TARGET;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy + baseR + 70, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ZONES[z].color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy + baseR + 70, 26, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${STATE.counts[z]}`, cx, cy + baseR + 70);
  }

  // Particles (pop confetti)
  STATE.particles = STATE.particles.filter((p) => p.age < p.life);
  for (const p of STATE.particles) {
    p.age += dt;
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const a = 1 - p.age / p.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Cartoon hands per zone
  for (const p of points) {
    if (p.kind !== "palm") continue;
    const zone = p.x < half ? 0 : 1;
    drawHand(ctx, p, {
      color: ZONES[zone].color,
      outline: ZONES[zone].outline,
    });
  }

  // Hint banner while idle
  if (STATE.counts[0] === 0 && STATE.counts[1] === 0) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(canvas.width / 2 - 210, 30, 420, 46);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Wave your arms up & down ↕", canvas.width / 2, 60);
  }

  requestAnimationFrame(loop);
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  hud.style.display = "flex";

  STATE.running = true;
  STATE.counts = [0, 0];
  STATE.prevSign = [0, 0];
  STATE.lastWaveT = [0, 0];
  STATE.squash = [0, 0];
  STATE.popped = [false, false];
  STATE.particles = [];
  STATE.endedAt = 0;
  STATE.winner = -1;
  s1.textContent = "0";
  s2.textContent = "0";

  resize();
  lastT = performance.now();
  sfx.bgmStart();
  requestAnimationFrame(loop);
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
    alert("Could not start camera or hand model. Allow camera and serve via localhost/https.\n\n" + err.message);
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = "Start Match";
  await startGame();
}

startBtn.addEventListener("click", boot);
restartBtn.addEventListener("click", startGame);
