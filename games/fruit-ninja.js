// ============================================================
// Fruit Ninja — VS Mode A (Zone-Based, 2 Players)
// Fruits arc into each zone; players must SLICE through them
// with a fast hand swipe. Slicing bombs costs 3 points.
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

const FRUIT_SRCS = [
  "../assets/fruits/apple.png",
  "../assets/fruits/orange.png",
  "../assets/fruits/lemon.png",
  "../assets/fruits/strawberry.png",
  "../assets/fruits/watermelon.png",
  "../assets/fruits/banana.png",
];
const BOMB_SRC = "../assets/effects/bomb.png";

const imageCache = {};
function loadImage(src) {
  if (imageCache[src]) return imageCache[src];
  const img = new Image();
  img.src = src;
  imageCache[src] = img;
  return img;
}
FRUIT_SRCS.forEach(loadImage);
loadImage(BOMB_SRC);

const ZONES = [
  { id: 1, color: "#ffd23f" },
  { id: 2, color: "#5ce1ff" },
];

const STATE = {
  running: false,
  items: [],
  scores: [0, 0],
  startTime: 0,
  duration: 60_000,
  spawnEveryMs: 650,
  lastSpawn: 0,
};

const SLICE_SPEED = 800; // px/sec required to slice
const GRAVITY = 700;

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);
resize();

let tracker = null;
let vbg = null;

function spawnItem() {
  const zone = Math.random() < 0.5 ? 0 : 1;
  const half = canvas.width / 2;
  const xMin = zone === 0 ? 80 : half + 80;
  const xMax = zone === 0 ? half - 80 : canvas.width - 80;
  const isBomb = Math.random() < 0.18;
  const src = isBomb ? BOMB_SRC : FRUIT_SRCS[Math.floor(Math.random() * FRUIT_SRCS.length)];
  const size = 70 + Math.random() * 22;

  const x = xMin + Math.random() * Math.max(40, xMax - xMin);
  const y = canvas.height + size;

  // launch arc — target apex around 30% of canvas height
  const targetY = canvas.height * (0.18 + Math.random() * 0.22);
  const vy = -Math.sqrt(2 * GRAVITY * (y - targetY));
  // slight horizontal toward zone center
  const center = zone === 0 ? half / 2 : half + half / 2;
  const vx = (center - x) * 0.6 + (Math.random() - 0.5) * 80;

  STATE.items.push({
    zone,
    isBomb,
    img: loadImage(src),
    x,
    y,
    vx,
    vy,
    size,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 4,
    dead: false,
    sliced: false,
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
function burst(x, y, color, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 100 + Math.random() * 280;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, age: 0, color });
  }
}

function trySlice(item, points) {
  const half = canvas.width / 2;
  for (const p of points) {
    const pZone = p.x < half ? 0 : 1;
    if (pZone !== item.zone) continue;
    if (p.speed < SLICE_SPEED) continue;
    if (segmentHitsCircle(p.prevX, p.prevY, p.x, p.y, item.x, item.y, item.size * 0.5 + 8)) {
      return p;
    }
  }
  return null;
}

function renderHud() {
  s1El.textContent = STATE.scores[0];
  s2El.textContent = STATE.scores[1];
  const elapsed = performance.now() - STATE.startTime;
  const remain = Math.max(0, STATE.duration - elapsed);
  timerEl.textContent = Math.ceil(remain / 1000);
}

const trails = [[], []];

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (vbg) vbg.tick(t);
  const { points } = tracker.detect(video, canvas, t);
  const half = canvas.width / 2;

  // Trails per zone, palm-only
  trails[0] = []; trails[1] = [];
  for (const p of points) {
    if (p.kind !== "palm") continue;
    const z = p.x < half ? 0 : 1;
    trails[z].push({ x: p.x, y: p.y, prevX: p.prevX, prevY: p.prevY, speed: p.speed });
  }

  // Spawn
  if (t - STATE.lastSpawn > STATE.spawnEveryMs) {
    spawnItem();
    STATE.lastSpawn = t;
    STATE.spawnEveryMs = Math.max(360, 650 - Math.max(STATE.scores[0], STATE.scores[1]) * 6);
  }

  // Update items
  for (const it of STATE.items) {
    if (it.dead) continue;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.vy += GRAVITY * dt;
    it.rot += it.vr * dt;

    if (!it.sliced) {
      const hit = trySlice(it, points);
      if (hit) {
        it.sliced = true;
        it.dead = true;
        if (it.isBomb) {
          STATE.scores[it.zone] = Math.max(0, STATE.scores[it.zone] - 3);
          burst(it.x, it.y, "#ff6b6b", 26);
          sfx.bomb();
          toast("💣 -3!", it.zone === 0 ? "p1" : "p2", 700);
        } else {
          STATE.scores[it.zone] += 1;
          burst(it.x, it.y, ZONES[it.zone].color, 22);
          sfx.slice();
        }
      }
    }

    if (it.y > canvas.height + 100) it.dead = true;
  }
  STATE.items = STATE.items.filter((i) => !i.dead);

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

  // Items
  for (const it of STATE.items) {
    if (!it.img.complete) continue;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    if (it.isBomb) {
      ctx.shadowColor = "rgba(255,80,80,0.95)";
      ctx.shadowBlur = 24;
    } else {
      ctx.shadowColor = ZONES[it.zone].color + "cc";
      ctx.shadowBlur = 16;
    }
    ctx.drawImage(it.img, -it.size / 2, -it.size / 2, it.size, it.size);
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

  // Slice trails (per zone palm)
  for (let z = 0; z < 2; z++) {
    const color = ZONES[z].color;
    for (const tr of trails[z]) {
      const fast = tr.speed > SLICE_SPEED;
      const lw = fast ? 8 : 3;
      ctx.strokeStyle = color;
      ctx.globalAlpha = fast ? 0.9 : 0.35;
      ctx.lineCap = "round";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(tr.prevX, tr.prevY);
      ctx.lineTo(tr.x, tr.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

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

  if (performance.now() - STATE.startTime >= STATE.duration) return endGame();

  requestAnimationFrame(loop);
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  STATE.running = true;
  STATE.items = [];
  STATE.scores = [0, 0];
  STATE.startTime = performance.now();
  STATE.lastSpawn = performance.now();
  STATE.spawnEveryMs = 650;
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
  endScore.textContent = `Player 1: ${a}  ·  Player 2: ${b}`;
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
      defaultBg: "dojo",
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
