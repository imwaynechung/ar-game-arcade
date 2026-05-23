// ===========================================================
// Fruit Catch — Single Player · Basket Mode
// Hold both hands together to form a basket. Catch any fruit
// (+1). Avoid bombs (-1 life). Reach 30 to win.
// ===========================================================

import { startCamera, createHandTracker, drawHand } from "../shared/tracking.js";
import { setupVirtualBackground } from "../shared/segmenter.js";
import { sfx } from "../shared/audio.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const startOverlay = document.getElementById("start");
const endOverlay = document.getElementById("end");
const endTitle = document.getElementById("end-title");
const endScore = document.getElementById("end-score");
const livesEl = document.getElementById("lives");
const progressEl = document.getElementById("progress");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");

const FRUITS = {
  banana:     "../assets/fruits/banana.png",
  lemon:      "../assets/fruits/lemon.png",
  orange:     "../assets/fruits/orange.png",
  apple:      "../assets/fruits/apple.png",
  strawberry: "../assets/fruits/strawberry.png",
  watermelon: "../assets/fruits/watermelon.png",
};
const UI = { heart: "../assets/ui/heart.png" };
const FRUIT_KEYS = Object.keys(FRUITS);

const imageCache = {};
function loadImage(src) {
  if (imageCache[src]) return imageCache[src];
  const img = new Image();
  img.src = src;
  imageCache[src] = img;
  return img;
}
Object.values(FRUITS).forEach(loadImage);
loadImage(UI.heart);

const STATE = {
  running: false,
  lives: 3,
  maxLives: 3,
  score: 0,
  target: 30,
  fruits: [],
  hands: [],
  basket: null,
  lastSpawn: 0,
  spawnEveryMs: 900,
};

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resize);
resize();

let tracker = null;
let vbg = null;

function drawBombSprite() {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#1c1c22";
  g.beginPath(); g.arc(48, 56, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.beginPath(); g.arc(38, 46, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#3a2a1a"; g.fillRect(42, 14, 12, 14);
  g.strokeStyle = "#9a6b35"; g.lineWidth = 3; g.lineCap = "round";
  g.beginPath(); g.moveTo(48, 14); g.quadraticCurveTo(64, 4, 72, 14); g.stroke();
  g.fillStyle = "#ffd23f";
  g.beginPath(); g.arc(72, 12, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ff6b35";
  g.beginPath(); g.arc(72, 12, 2.5, 0, Math.PI * 2); g.fill();
  return c;
}
const SPRITES = { bomb: drawBombSprite() };

function spawnDrop() {
  const isBomb = Math.random() < 0.18;
  const size = isBomb ? 70 : 60 + Math.random() * 30;
  STATE.fruits.push({
    bomb: isBomb,
    img: isBomb ? SPRITES.bomb : loadImage(FRUITS[FRUIT_KEYS[Math.floor(Math.random() * FRUIT_KEYS.length)]]),
    x: 60 + Math.random() * (canvas.width - 120),
    y: -size,
    vx: (Math.random() - 0.5) * 40,
    vy: 110 + Math.random() * 110 + Math.min(STATE.score * 3, 160),
    size,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 2.4,
    prevY: -size,
    caught: false,
    dead: false,
  });
  sfx.spawn();
}

let toastEl = null;
function toast(text, kind = "good", ms = 600) {
  if (toastEl) toastEl.remove();
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = text;
  document.body.appendChild(t);
  toastEl = t;
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, ms);
}

function renderHud() {
  livesEl.innerHTML = "";
  for (let i = 0; i < STATE.maxLives; i++) {
    const img = document.createElement("img");
    img.src = UI.heart;
    if (i >= STATE.lives) img.classList.add("lost");
    livesEl.appendChild(img);
  }
  progressEl.textContent = `${STATE.score}/${STATE.target}`;
}

function computeBasket(palms) {
  if (palms.length < 2) return null;
  let best = null;
  for (let i = 0; i < palms.length; i++) {
    for (let j = i + 1; j < palms.length; j++) {
      const d = Math.hypot(palms[i].x - palms[j].x, palms[i].y - palms[j].y);
      if (!best || d < best.d) best = { a: palms[i], b: palms[j], d };
    }
  }
  if (!best) return null;
  const span = (best.a.palmSpan + best.b.palmSpan) / 2 || 80;
  if (best.d > Math.max(280, span * 4)) return null;
  const x1 = Math.min(best.a.x, best.b.x);
  const x2 = Math.max(best.a.x, best.b.x);
  const yMid = (best.a.y + best.b.y) / 2;
  return {
    a: best.a, b: best.b,
    x1: x1 - span * 0.5,
    x2: x2 + span * 0.5,
    midX: (best.a.x + best.b.x) / 2,
    midY: yMid,
    rimY: yMid,
    w: (x2 - x1) + span * 1.8,
    depth: span * 1.1 + 30,
  };
}

function drawBasket(b) {
  const cx = b.midX;
  const top = b.rimY;
  const bottom = b.rimY + b.depth;
  const halfW = b.w / 2;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, bottom + 14, halfW * 0.9, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "#a86a3a");
  grad.addColorStop(1, "#6e3f1f");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(b.x1, top);
  ctx.lineTo(b.x2, top);
  ctx.quadraticCurveTo(cx + halfW, bottom, cx, bottom);
  ctx.quadraticCurveTo(cx - halfW, bottom, b.x1, top);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const y = top + b.depth * t;
    const w = halfW * (1 - t * 0.55);
    ctx.beginPath();
    ctx.moveTo(cx - w, y);
    ctx.quadraticCurveTo(cx, y + 6, cx + w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#4a2510";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(b.x1, top);
  ctx.lineTo(b.x2, top);
  ctx.stroke();
  ctx.strokeStyle = "#d49a5e";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(b.x1, top);
  ctx.lineTo(b.x2, top);
  ctx.stroke();
}

const particles = [];
function burst(x, y, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 220;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, age: 0, color });
  }
}

function caughtByBasket(f, b) {
  if (!b) return false;
  if (f.x < b.x1 || f.x > b.x2) return false;
  return f.prevY < b.rimY && f.y >= b.rimY;
}

let lastT = 0;
function loop(t) {
  if (!STATE.running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (vbg) vbg.tick(t);
  const det = tracker.detect(video, canvas, t);
  STATE.hands = det.points;
  const palms = det.points.filter((p) => p.kind === "palm");
  STATE.basket = computeBasket(palms);

  if (t - STATE.lastSpawn > STATE.spawnEveryMs) {
    spawnDrop();
    STATE.lastSpawn = t;
    STATE.spawnEveryMs = Math.max(450, 900 - STATE.score * 12);
  }

  for (const f of STATE.fruits) {
    if (f.dead) continue;
    f.prevY = f.y;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;

    if (!f.caught && caughtByBasket(f, STATE.basket)) {
      f.caught = true;
      f.dead = true;
      if (f.bomb) {
        STATE.lives -= 1;
        burst(f.x, f.y, "#ff4444", 22);
        sfx.bomb();
        toast("💣 Bomb!", "bad", 600);
        renderHud();
        if (STATE.lives <= 0) return endGame(false);
      } else {
        STATE.score += 1;
        burst(f.x, f.y, "#ffd23f", 18);
        sfx.catch();
        toast("+1", "good", 400);
        renderHud();
        if (STATE.score >= STATE.target) return endGame(true);
      }
    }

    if (f.y > canvas.height + 80) f.dead = true;
  }
  STATE.fruits = STATE.fruits.filter((f) => !f.dead);

  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 400 * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].age >= particles[i].life) particles.splice(i, 1);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const f of STATE.fruits) {
    if (!f.img.complete && f.img.width === 0) continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    if (f.bomb) {
      ctx.shadowColor = "rgba(255,80,80,0.7)";
      ctx.shadowBlur = 20;
    }
    ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
    ctx.restore();
  }

  for (const p of particles) {
    const a = 1 - p.age / p.life;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * a + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (STATE.basket) drawBasket(STATE.basket);

  for (const h of palms) {
    drawHand(ctx, h, { color: "#ffd23f", outline: "#3a2a00" });
  }

  if (!STATE.basket) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(canvas.width / 2 - 240, canvas.height - 90, 480, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🧺 Bring both hands together to form a basket", canvas.width / 2, canvas.height - 58);
  }

  requestAnimationFrame(loop);
}

async function startGame() {
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  STATE.running = true;
  STATE.lives = STATE.maxLives;
  STATE.score = 0;
  STATE.fruits = [];
  STATE.lastSpawn = performance.now();
  STATE.spawnEveryMs = 900;
  renderHud();
  hud.classList.remove("hidden");
  lastT = performance.now();
  sfx.bgmStart();
  requestAnimationFrame(loop);
}

function endGame(won) {
  STATE.running = false;
  hud.classList.add("hidden");
  endTitle.textContent = won ? "🏆 Level 1 Cleared!" : "💔 Game Over";
  endScore.textContent = won
    ? `You caught ${STATE.score} fruits with your basket!`
    : `Final score: ${STATE.score}/${STATE.target}. Try again!`;
  endOverlay.classList.remove("hidden");
  sfx.bgmStop();
  (won ? sfx.win : sfx.lose)();
}

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

