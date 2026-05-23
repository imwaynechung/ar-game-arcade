// ============================================================
// Horse Race — Full-body multiplayer (1–4 players)
// Camera is a small PiP top-right. Race track sits centered on
// the main canvas. Players are auto-assigned to lanes by their
// horizontal position in the camera frame (left → right).
// ============================================================

import { startCamera, createPoseTracker, drawPoseStick } from "../shared/tracking.js";
import { sfx } from "../shared/audio.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const pipCanvas = document.getElementById("pip-pose");
const pipCtx = pipCanvas.getContext("2d");
const hudHost = document.getElementById("hud-host");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const winnerEl = document.getElementById("winner");
const endStats = document.getElementById("end-stats");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const picker = document.getElementById("picker");

// ----- Tunables -----
const MATCH_S = 90;
const FINISH = 1.0;
const ENERGY_TO_SPEED = 0.0035;
const ENERGY_FLOOR = 0.6;
const SPEED_DECAY = 0.92;
const MAX_SPEED = 0.18; // progress/sec cap

// Visual identity per lane (up to 4)
const LANES = [
  { color: "#ffd23f", outline: "#3a2a00", label: "P1", emoji: "🐎", grass: ["#3aa64a", "#2e7a36"] },
  { color: "#5ce1ff", outline: "#003a4a", label: "P2", emoji: "🦄", grass: ["#c98b4a", "#8a5a2d"] },
  { color: "#ff77c8", outline: "#3a0024", label: "P3", emoji: "🐴", grass: ["#7a5cff", "#4a2fbf"] },
  { color: "#9cff6a", outline: "#1a3a00", label: "P4", emoji: "🦓", grass: ["#ff7a3d", "#b04a14"] },
];

let numPlayers = 2;
let tracker = null;

const STATE = {
  running: false,
  phase: "idle", // idle | countdown | race | finished
  N: 2,
  progress: [],
  speed: [],
  energy: [],
  maxSpeed: [],       // peak speed achieved
  totalDistance: [],  // cumulative progress used for avg-speed
  finishTime: [],     // seconds since race start, or null
  particles: [],
  timeLeft: MATCH_S,
  startedAt: 0,
  countdownStartedAt: 0,
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Match PiP canvas to CSS box for crisp 1:1 drawing
  const rect = pipCanvas.getBoundingClientRect();
  pipCanvas.width = Math.max(1, Math.round(rect.width));
  pipCanvas.height = Math.max(1, Math.round(rect.height));
}
window.addEventListener("resize", resize);

/** Draw all detected poses onto the PiP overlay, scaled from main-canvas
 * coordinate space down to the PiP box. */
function drawPipPoses(perLane) {
  pipCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
  const sx = pipCanvas.width / canvas.width;
  const sy = pipCanvas.height / canvas.height;
  pipCtx.save();
  pipCtx.scale(sx, sy);
  for (let lane = 0; lane < STATE.N; lane++) {
    const p = perLane[lane];
    if (!p) continue;
    drawPoseStick(pipCtx, p, {
      color: LANES[lane].color,
      outline: LANES[lane].outline,
      lineW: 8 / Math.max(sx, sy), // keep stroke visually consistent in PiP
    });
  }
  pipCtx.restore();
}

// ---------- Player picker ----------
picker.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-n]");
  if (!btn) return;
  numPlayers = parseInt(btn.dataset.n, 10);
  picker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
});

// ---------- HUD (built per match) ----------
function buildHud(n) {
  hudHost.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "vs-hud";
  wrap.id = "hud";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "8px";
  wrap.style.justifyContent = "center";
  wrap.innerHTML = `<div class="vs-timer" id="timer">${MATCH_S}</div>`;
  const scoreRow = document.createElement("div");
  scoreRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;";
  for (let i = 0; i < n; i++) {
    const sc = document.createElement("div");
    sc.className = "vs-score";
    sc.style.cssText = `border-left:4px solid ${LANES[i].color};`;
    sc.innerHTML = `<span class="lbl">${LANES[i].label}</span><span id="s${i}">0%</span>`;
    scoreRow.appendChild(sc);
  }
  wrap.appendChild(scoreRow);
  hudHost.appendChild(wrap);
}

// ---------- Geometry ----------

/** Race track occupies the centered middle band. Camera is PiP overlay so the
 * track gets the full canvas. We use the middle ~60% of the canvas height. */
function trackBounds() {
  const N = STATE.N;
  const targetH = Math.min(canvas.height * 0.62, Math.max(220, N * 110));
  const top = (canvas.height - targetH) / 2 + 30;
  const bot = top + targetH;
  return { top, bot };
}

function laneRect(lane) {
  const { top, bot } = trackBounds();
  const laneH = (bot - top) / STATE.N;
  return {
    x0: 80,
    x1: canvas.width - 80,
    y0: top + lane * laneH,
    y1: top + (lane + 1) * laneH,
    cy: top + lane * laneH + laneH / 2,
    h: laneH,
  };
}

// ---------- Drawing ----------

function drawTrack(t) {
  const { top, bot } = trackBounds();

  // dark frame behind lanes
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, top - 24, canvas.width, bot - top + 48);

  // crowd-row gradient strip
  const crowd = ctx.createLinearGradient(0, top - 24, 0, top);
  crowd.addColorStop(0, "#202440");
  crowd.addColorStop(1, "#0c0e1a");
  ctx.fillStyle = crowd;
  ctx.fillRect(0, top - 24, canvas.width, 18);

  for (let lane = 0; lane < STATE.N; lane++) {
    const r = laneRect(lane);
    const L = LANES[lane];
    const g = ctx.createLinearGradient(0, r.y0, 0, r.y1);
    g.addColorStop(0, L.grass[0]);
    g.addColorStop(1, L.grass[1]);
    ctx.fillStyle = g;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.h);

    // Scrolling stripes for parallax
    const stripe = 36;
    const offset = (t * 0.04 * (0.4 + STATE.speed[lane] * 6)) % stripe;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = r.x0 - offset; x < r.x1; x += stripe) {
      ctx.fillRect(x, r.cy - 3, 16, 6);
    }

    // Lane border
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.h);

    // Label
    ctx.fillStyle = L.outline;
    ctx.fillRect(r.x0 - 56, r.cy - 18, 50, 36);
    ctx.fillStyle = L.color;
    ctx.font = "bold 20px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(L.label, r.x0 - 31, r.cy);
  }

  // Start line
  ctx.fillStyle = "#fff";
  ctx.fillRect(80, top, 6, bot - top);

  // Finish line — checkered
  const fx = canvas.width - 80 - 18;
  const cells = STATE.N * 3;
  const ch = (bot - top) / cells;
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#fff" : "#111";
    ctx.fillRect(fx, top + i * ch, 9, ch);
    ctx.fillStyle = i % 2 === 0 ? "#111" : "#fff";
    ctx.fillRect(fx + 9, top + i * ch, 9, ch);
  }
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 18px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🏁 FINISH", canvas.width - 80, top - 6);
}

function drawHorse(lane, t) {
  const r = laneRect(lane);
  const L = LANES[lane];
  const progress = Math.min(1, STATE.progress[lane]);
  const x = r.x0 + 20 + (r.x1 - r.x0 - 80) * progress;
  const bob = Math.sin(t / 90 + lane * 2) * (4 + STATE.speed[lane] * 30);
  const y = r.cy + bob;

  // dust puff
  if (STATE.speed[lane] > 0.01) {
    for (let i = 0; i < 2; i++) {
      STATE.particles.push({
        x: x - 26 - Math.random() * 6,
        y: y + 18 + Math.random() * 6,
        r: 6 + Math.random() * 6,
        life: 0.4,
        age: 0,
        color: lane === 0 ? "rgba(255,255,255,0.6)" : "rgba(255,240,200,0.6)",
      });
    }
  }

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, r.y1 - 8, 36, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // halo
  ctx.fillStyle = L.color + "55";
  ctx.beginPath();
  ctx.arc(x, y, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = L.outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 44, 0, Math.PI * 2);
  ctx.stroke();

  // emoji (mirrored so it faces right)
  ctx.font = `${Math.min(70, r.h * 0.85)}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(L.emoji, 0, 4);
  ctx.restore();
}

function drawSpeedBars() {
  const barW = Math.min(220, (canvas.width - 80) / STATE.N - 16);
  const totalW = STATE.N * (barW + 12) - 12;
  const startX = (canvas.width - totalW) / 2;
  const y = 24;
  for (let lane = 0; lane < STATE.N; lane++) {
    const L = LANES[lane];
    const x = startX + lane * (barW + 12);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, y, barW, 22);
    const w = Math.min(1, STATE.speed[lane] / MAX_SPEED) * (barW - 4);
    ctx.fillStyle = L.color;
    ctx.fillRect(x + 2, y + 2, w, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${L.label}`, x + 8, y + 11);
  }
}

function drawCountdown(t) {
  const elapsed = (t - STATE.countdownStartedAt) / 1000;
  let label, scale;
  if (elapsed < 1) { label = "3"; scale = 1 - elapsed; }
  else if (elapsed < 2) { label = "2"; scale = 2 - elapsed; }
  else if (elapsed < 3) { label = "1"; scale = 3 - elapsed; }
  else if (elapsed < 4) { label = "GO!"; scale = 4 - elapsed; }
  else { return false; }
  const s = 1 + (1 - scale) * 0.6;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(s, s);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 220px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#000";
  ctx.fillText(label, 6, 8);
  ctx.fillStyle = label === "GO!" ? "#6cff6c" : "#ffd23f";
  ctx.fillText(label, 0, 0);
  ctx.restore();
  return true;
}

// ---------- Game loop ----------

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  const det = tracker.detect(video, canvas, t);
  const poses = det.poses;

  // Map poses to lanes
  const perLane = new Array(STATE.N).fill(null);
  for (const p of poses) if (p.lane < STATE.N) perLane[p.lane] = p;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawTrack(t);

  // Pose stick figures render on the PiP overlay only — not on the race track.
  drawPipPoses(perLane);

  if (STATE.phase === "countdown") {
    for (let lane = 0; lane < STATE.N; lane++) drawHorse(lane, t);
    drawSpeedBars();
    const active = drawCountdown(t);
    if (!active) {
      STATE.phase = "race";
      STATE.startedAt = t;
      lastT = t;
      sfx.win();
    }
    requestAnimationFrame(loop);
    return;
  }

  if (STATE.phase === "race") {
    const elapsedRace = (t - STATE.startedAt) / 1000;
    for (let lane = 0; lane < STATE.N; lane++) {
      if (STATE.finishTime[lane] != null) continue; // already crossed
      const p = perLane[lane];
      const raw = p ? Math.max(0, p.energy - ENERGY_FLOOR) : 0;
      STATE.energy[lane] = STATE.energy[lane] * 0.6 + raw * 0.4;
      STATE.speed[lane] = STATE.speed[lane] * SPEED_DECAY + STATE.energy[lane] * ENERGY_TO_SPEED;
      STATE.speed[lane] = Math.min(MAX_SPEED, STATE.speed[lane]);
      if (STATE.speed[lane] > STATE.maxSpeed[lane]) STATE.maxSpeed[lane] = STATE.speed[lane];
      const advance = STATE.speed[lane] * dt;
      STATE.progress[lane] += advance;
      STATE.totalDistance[lane] += advance;
      if (STATE.progress[lane] >= FINISH) {
        STATE.progress[lane] = FINISH;
        STATE.finishTime[lane] = elapsedRace;
      }
      const el = document.getElementById(`s${lane}`);
      if (el) el.textContent = `${Math.floor(Math.min(1, STATE.progress[lane]) * 100)}%`;
    }

    STATE.timeLeft = Math.max(0, MATCH_S - elapsedRace);
    const tEl = document.getElementById("timer");
    if (tEl) tEl.textContent = Math.ceil(STATE.timeLeft);

    // End conditions: all players finished, OR any player finished (winner found) when solo, OR timer out
    const finished = STATE.finishTime.filter((x) => x != null).length;
    if (finished > 0 && (STATE.N === 1 || finished >= STATE.N)) {
      endMatch();
      return;
    }
    // For multiplayer: end as soon as first horse crosses (winner declared); others get DNF stats
    if (STATE.N > 1 && finished >= 1) {
      endMatch();
      return;
    }
    if (STATE.timeLeft <= 0) {
      endMatch();
      return;
    }

    drawSpeedBars();
    for (let lane = 0; lane < STATE.N; lane++) drawHorse(lane, t);

    // bursts when fast
    for (let lane = 0; lane < STATE.N; lane++) {
      if (STATE.speed[lane] > MAX_SPEED * 0.6 && Math.random() < 0.06) {
        const r = laneRect(lane);
        STATE.particles.push({
          x: r.x0 + 20 + (r.x1 - r.x0 - 80) * Math.min(1, STATE.progress[lane]),
          y: r.cy - 24,
          r: 7 + Math.random() * 5,
          life: 0.6,
          age: 0,
          color: LANES[lane].color,
          burst: true,
        });
      }
    }
  }

  // Particles
  STATE.particles = STATE.particles.filter((p) => p.age < p.life);
  for (const p of STATE.particles) {
    p.age += dt;
    const a = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = p.color;
    if (p.burst) p.y -= 90 * dt;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  requestAnimationFrame(loop);
}

// ---------- End-of-match stats ----------

/** Track length is FINISH (=1.0 progress units). We treat that as 100m for
 * a friendly km/h-style display. avg speed = distance / racetime. */
const TRACK_METERS = 100;

function computeAvgSpeed(lane) {
  const finishT = STATE.finishTime[lane];
  const elapsed = finishT != null ? finishT : (performance.now() - STATE.startedAt) / 1000;
  if (elapsed <= 0.01) return 0;
  const meters = STATE.totalDistance[lane] * TRACK_METERS;
  const mps = meters / elapsed;
  return mps * 3.6; // km/h
}

function endMatch() {
  STATE.running = false;
  STATE.phase = "finished";
  sfx.bgmStop();
  hudHost.innerHTML = "";

  // Rank by: finished first → earliest finishTime, then by progress.
  const order = [];
  for (let lane = 0; lane < STATE.N; lane++) order.push(lane);
  order.sort((a, b) => {
    const ta = STATE.finishTime[a], tb = STATE.finishTime[b];
    if (ta != null && tb != null) return ta - tb;
    if (ta != null) return -1;
    if (tb != null) return 1;
    return STATE.progress[b] - STATE.progress[a];
  });
  const winnerLane = order[0];
  const winnerL = LANES[winnerLane];

  setTimeout(() => {
    if (STATE.N === 1) {
      winnerEl.textContent = STATE.finishTime[0] != null
        ? `🏁 Finished in ${STATE.finishTime[0].toFixed(1)}s!`
        : `⏱ Time's up — ${Math.floor(STATE.progress[0] * 100)}%`;
      winnerEl.style.color = winnerL.color;
    } else {
      winnerEl.textContent = `🏆 ${winnerL.label} Wins!`;
      winnerEl.style.color = winnerL.color;
    }

    endStats.innerHTML = "";
    for (let rank = 0; rank < order.length; rank++) {
      const lane = order[rank];
      const L = LANES[lane];
      const avg = computeAvgSpeed(lane);
      const peakKmh = (STATE.maxSpeed[lane] / MAX_SPEED) * 22; // ~22 km/h at cap, just for display flavor
      const place = STATE.N === 1 ? "RESULT" : ["🥇 1ST", "🥈 2ND", "🥉 3RD", "4TH"][rank];
      const fin = STATE.finishTime[lane] != null ? `${STATE.finishTime[lane].toFixed(1)}s` : `${Math.floor(STATE.progress[lane] * 100)}%`;
      const card = document.createElement("div");
      card.className = "stat-card";
      card.style.borderLeft = `4px solid ${L.color}`;
      card.innerHTML = `
        <div class="lbl">${place} · ${L.label}</div>
        <div class="val">${avg.toFixed(1)} <span style="font-size:13px;opacity:0.7;">km/h avg</span></div>
        <div class="lbl" style="margin-top:4px;">${fin} · peak ${peakKmh.toFixed(1)} km/h</div>
      `;
      endStats.appendChild(card);
    }
    endOverlay.classList.remove("hidden");
    sfx.win();
  }, 350);
}

// ---------- Start / restart ----------

function resetState(n) {
  STATE.N = n;
  STATE.progress = new Array(n).fill(0);
  STATE.speed = new Array(n).fill(0);
  STATE.energy = new Array(n).fill(0);
  STATE.maxSpeed = new Array(n).fill(0);
  STATE.totalDistance = new Array(n).fill(0);
  STATE.finishTime = new Array(n).fill(null);
  STATE.particles = [];
  STATE.timeLeft = MATCH_S;
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  resize();
  resetState(numPlayers);
  buildHud(numPlayers);
  STATE.phase = "countdown";
  STATE.countdownStartedAt = performance.now();
  STATE.running = true;
  lastT = performance.now();
  sfx.bgmStart();
  requestAnimationFrame(loop);
}

async function boot() {
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";
  try {
    await startCamera(video);
    // (Re)create tracker only if numPoses changed
    if (!tracker || tracker._n !== numPlayers) {
      tracker = await createPoseTracker({ numPoses: numPlayers });
      tracker._n = numPlayers;
    }
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Camera blocked — retry";
    alert("Could not start camera or pose model. Allow camera and serve via localhost/https.\n\n" + err.message);
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = "Start Race";
  await startGame();
}

startBtn.addEventListener("click", boot);
restartBtn.addEventListener("click", async () => {
  // If player count changed at end screen via picker (we re-show start), reboot tracker.
  if (tracker && tracker._n !== numPlayers) {
    tracker = await createPoseTracker({ numPoses: numPlayers });
    tracker._n = numPlayers;
  }
  startGame();
});
