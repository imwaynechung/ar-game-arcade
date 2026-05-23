// ============================================================
// Number Rush — VS · Zone · 2 Players
// Each player must touch the numbers 1→9 in order in their zone.
// First to 9 wins. 60-second timer; if it expires, highest # wins.
// ============================================================

import { startCamera, createHandTracker, drawHand } from "../shared/tracking.js";
import { setupVirtualBackground } from "../shared/segmenter.js";
import { sfx } from "../shared/audio.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const s1 = document.getElementById("s1");
const s2 = document.getElementById("s2");
const timerEl = document.getElementById("timer");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const winnerEl = document.getElementById("winner");
const endScore = document.getElementById("end-score");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");

const TOTAL = 9;
const MATCH_S = 60;
const BUBBLE_R = 78;
const SLOTS = ["left", "center", "right"]; // all 3 on the top row
const ZONES = [
  { color: "#ffd23f", outline: "#3a2a00", label: "P1" },
  { color: "#5ce1ff", outline: "#003a4a", label: "P2" },
];

const STATE = {
  running: false,
  next: [1, 1],
  bubbles: [[], []],
  particles: [],
  timeLeft: MATCH_S,
  startedAt: 0,
  wrongFlash: [0, 0],
};

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);

let tracker = null;
let vbg = null;

function slotPosition(zone, slot) {
  const half = canvas.width / 2;
  const x0 = zone === 0 ? 0 : half;
  const y = Math.max(BUBBLE_R + 40, canvas.height * 0.12);
  if (slot === "left")   return { x: x0 + half * 0.22, y, slot };
  if (slot === "center") return { x: x0 + half * 0.5,  y, slot };
  /* right */             return { x: x0 + half * 0.78, y, slot };
}

function generateBubbles(zone) {
  // Always 3 bubbles in fixed slots: TOP (head), LEFT (left hand), RIGHT (right hand).
  // One is the next target number; the other two are random decoys (different numbers, 1..TOTAL).
  const target = STATE.next[zone];
  if (target > TOTAL) return [];

  const pool = [];
  for (let i = 1; i <= TOTAL; i++) if (i !== target) pool.push(i);
  // pick 2 unique decoys
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const numbers = [target, pool[0], pool[1]];
  // shuffle which slot gets which number
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  return SLOTS.map((slot, i) => {
    const pos = slotPosition(zone, slot);
    return { n: numbers[i], x: pos.x, y: pos.y, slot, hit: false, pulse: Math.random() * Math.PI * 2, born: performance.now() };
  });
}

function regenerateBubblesIfStale(zone) {
  // Refresh positions on resize
  STATE.bubbles[zone] = STATE.bubbles[zone].map((b) => {
    const pos = slotPosition(zone, b.slot);
    return { ...b, x: pos.x, y: pos.y };
  });
}
window.addEventListener("resize", () => { regenerateBubblesIfStale(0); regenerateBubblesIfStale(1); });

function spawnConfetti(cx, cy, color, n = 24) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 200 + Math.random() * 400;
    STATE.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 120,
      life: 0.7 + Math.random() * 0.4,
      age: 0,
      color: Math.random() < 0.6 ? color : ["#fff", "#ff6ec7", "#ffd23f"][Math.floor(Math.random() * 3)],
      size: 3 + Math.random() * 6,
    });
  }
}

function drawBubble(b, zone, t) {
  // All 3 bubbles are choices — show them all in full color with a gentle bob.
  const bob = 1 + Math.sin(t / 280 + b.pulse) * 0.05;
  const r = BUBBLE_R * bob;
  const z = ZONES[zone];

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + r * 0.85, r * 0.85, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  // outline
  ctx.fillStyle = z.outline;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r + 6, 0, Math.PI * 2);
  ctx.fill();

  // fill
  ctx.fillStyle = b.hit ? "rgba(120,120,120,0.5)" : z.color;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();

  // highlight
  const grad = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, 2, b.x, b.y, r);
  grad.addColorStop(0, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();

  // slot icon (small hint above the bubble)
  const icon = b.slot === "center" ? "👆" : b.slot === "left" ? "🫲" : "🫱";
  ctx.font = `${Math.floor(r * 0.45)}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(icon, b.x, b.y - r - 18);

  // number
  ctx.fillStyle = b.hit ? "rgba(255,255,255,0.55)" : z.outline;
  ctx.font = `bold ${Math.floor(r * 1.1)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(b.n, b.x, b.y + 2);
}

function checkHit(zone, palms) {
  if (STATE.next[zone] > TOTAL) return;
  const half = canvas.width / 2;
  const inZone = palms.filter((p) => (zone === 0 ? p.x < half : p.x >= half));
  if (inZone.length < 2) return; // require BOTH hands of this player
  const now = performance.now();

  for (const b of STATE.bubbles[zone]) {
    if (b.hit) continue;
    if (now - b.born < 250) continue;
    // Count how many of this player's palms are touching this bubble
    let touching = 0;
    for (const p of inZone) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < BUBBLE_R + (p.r || 36) * 0.4) touching++;
      if (touching >= 2) break;
    }
    if (touching < 2) continue;

    if (b.n === STATE.next[zone]) {
      b.hit = true;
      STATE.next[zone] = b.n + 1;
      (zone === 0 ? s1 : s2).textContent = Math.min(TOTAL, STATE.next[zone]);
      spawnConfetti(b.x, b.y, ZONES[zone].color);
      sfx.catch();
      if (STATE.next[zone] > TOTAL) {
        sfx.win();
        endMatch(zone);
        return;
      }
      // Regenerate fresh 3 choices for the next number
      STATE.bubbles[zone] = generateBubbles(zone);
    } else {
      STATE.wrongFlash[zone] = now;
      sfx.wrong();
    }
    return;
  }
}

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  // timer
  STATE.timeLeft = Math.max(0, MATCH_S - (t - STATE.startedAt) / 1000);
  timerEl.textContent = Math.ceil(STATE.timeLeft);
  if (STATE.timeLeft <= 0) {
    const a = Math.min(TOTAL, STATE.next[0] - 1);
    const b = Math.min(TOTAL, STATE.next[1] - 1);
    const winner = a === b ? -1 : (a > b ? 0 : 1);
    endMatch(winner);
    return;
  }

  if (vbg) vbg.tick(t);
  const det = tracker.detect(video, canvas, t);
  const palms = det.points.filter((p) => p.kind === "palm");

  checkHit(0, palms);
  if (STATE.running) checkHit(1, palms);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // wrong flash per zone
  const half = canvas.width / 2;
  for (let z = 0; z < 2; z++) {
    const since = t - STATE.wrongFlash[z];
    if (since < 250) {
      ctx.fillStyle = `rgba(255,60,60,${0.25 * (1 - since / 250)})`;
      ctx.fillRect(z === 0 ? 0 : half, 0, half, canvas.height);
    }
  }

  // bubbles per zone
  for (let z = 0; z < 2; z++) {
    for (const b of STATE.bubbles[z]) {
      drawBubble(b, z, t);
    }
  }

  // target prompt per zone — big "FIND: N" banner at the BOTTOM (top row holds bubbles)
  for (let z = 0; z < 2; z++) {
    const n = STATE.next[z];
    if (n > TOTAL) continue;
    const zx = z === 0 ? half * 0.5 : half + half * 0.5;
    const by = canvas.height - 110;
    const zc = ZONES[z];
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(zx - 150, by - 40, 300, 80);
    ctx.font = "bold 30px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText("FIND", zx - 70, by);
    ctx.font = "bold 64px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = zc.color;
    ctx.strokeStyle = zc.outline;
    ctx.lineWidth = 6;
    ctx.strokeText(n, zx + 50, by);
    ctx.fillText(n, zx + 50, by);
    ctx.restore();
  }

  // particles
  STATE.particles = STATE.particles.filter((p) => p.age < p.life);
  for (const p of STATE.particles) {
    p.age += dt;
    p.vy += 700 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const a = 1 - p.age / p.life;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // cartoon hands
  for (const p of palms) {
    const zone = p.x < half ? 0 : 1;
    drawHand(ctx, p, { color: ZONES[zone].color, outline: ZONES[zone].outline });
  }

  requestAnimationFrame(loop);
}

function endMatch(winnerZone) {
  STATE.running = false;
  hud.style.display = "none";
  sfx.bgmStop();
  setTimeout(() => {
    if (winnerZone === -1) {
      winnerEl.textContent = "🤝 Tie!";
      winnerEl.style.color = "#fff";
    } else {
      winnerEl.textContent = `${ZONES[winnerZone].label} Wins!`;
      winnerEl.style.color = ZONES[winnerZone].color;
    }
    const a = Math.min(TOTAL, STATE.next[0] - 1);
    const b = Math.min(TOTAL, STATE.next[1] - 1);
    endScore.textContent = `Player 1 reached ${a}/${TOTAL}  ·  Player 2 reached ${b}/${TOTAL}`;
    endOverlay.classList.remove("hidden");
  }, 400);
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  hud.style.display = "flex";
  resize();
  STATE.next = [1, 1];
  STATE.bubbles = [generateBubbles(0), generateBubbles(1)];
  STATE.particles = [];
  STATE.wrongFlash = [0, 0];
  STATE.timeLeft = MATCH_S;
  s1.textContent = "1";
  s2.textContent = "1";
  timerEl.textContent = MATCH_S;
  STATE.running = true;
  STATE.startedAt = performance.now();
  lastT = STATE.startedAt;
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
