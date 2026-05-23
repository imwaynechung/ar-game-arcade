// ============================================================
// shared/segmenter.js — MediaPipe ImageSegmenter (selfie) for
// virtual backgrounds. Drop-in module:
//
//   import { setupVirtualBackground } from "../shared/segmenter.js";
//   const vbg = await setupVirtualBackground({ video, bgCanvas });
//   // each frame inside your game loop:
//   vbg.tick(t);
//
// Also injects a BG selector chip in the top-right of the page.
// ============================================================

import {
  ImageSegmenter,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const BACKGROUNDS = [
  { id: "off",     name: "Off",     emoji: "📷", url: null },
  { id: "orchard", name: "Orchard", emoji: "🌳", url: "../assets/bg/orchard.svg" },
  { id: "arcade",  name: "Arcade",  emoji: "🌃", url: "../assets/bg/arcade.svg" },
  { id: "dojo",    name: "Dojo",    emoji: "⛩️", url: "../assets/bg/dojo.svg" },
];

const STORAGE_KEY = "ar-arcade.bg";

function loadBgImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function setupVirtualBackground({
  video,
  bgCanvas,
  defaultBg = "orchard",
}) {
  const bgCtx = bgCanvas.getContext("2d");

  // Pre-load all background images
  const bgImages = {};
  for (const b of BACKGROUNDS) {
    bgImages[b.id] = await loadBgImage(b.url);
  }

  // Create the segmenter
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });

  // Offscreen canvases for masking
  const personCanvas = document.createElement("canvas");
  const personCtx = personCanvas.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");

  let lastVideoTime = -1;
  let currentBgId = localStorage.getItem(STORAGE_KEY) || defaultBg;
  if (!BACKGROUNDS.find((b) => b.id === currentBgId)) currentBgId = defaultBg;

  function resize() {
    const W = bgCanvas.clientWidth;
    const H = bgCanvas.clientHeight;
    bgCanvas.width = W;
    bgCanvas.height = H;
    personCanvas.width = W;
    personCanvas.height = H;
  }
  resize();
  window.addEventListener("resize", resize);

  function drawRawMirrored() {
    const W = bgCanvas.width;
    const H = bgCanvas.height;
    bgCtx.clearRect(0, 0, W, H);
    bgCtx.save();
    bgCtx.scale(-1, 1);
    bgCtx.drawImage(video, -W, 0, W, H);
    bgCtx.restore();
  }

  function tick(t) {
    const W = bgCanvas.width;
    const H = bgCanvas.height;
    if (video.readyState < 2) return;

    // Background = OFF → just draw mirrored video
    if (currentBgId === "off" || !bgImages[currentBgId]) {
      drawRawMirrored();
      return;
    }

    // Avoid re-running segmenter on the same frame
    if (video.currentTime === lastVideoTime) {
      // still need to re-draw because canvas was cleared elsewhere? no — segmenter draws every frame.
      // Just bail; result remains from previous draw.
      return;
    }
    lastVideoTime = video.currentTime;

    const result = segmenter.segmentForVideo(video, t);
    const mask = result?.confidenceMasks?.[0];
    if (!mask) {
      drawRawMirrored();
      return;
    }

    const mw = mask.width;
    const mh = mask.height;
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw;
      maskCanvas.height = mh;
    }
    const arr = mask.getAsFloat32Array();
    const imgData = maskCtx.createImageData(mw, mh);
    const data = imgData.data;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      // selfie_segmenter confidence: ~1 = person, ~0 = background
      // Boost contrast slightly for cleaner edges
      const a = v > 0.5 ? 255 : Math.max(0, Math.min(255, Math.floor((v - 0.3) / 0.2 * 255)));
      data[i * 4]     = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = a;
    }
    maskCtx.putImageData(imgData, 0, 0);
    mask.close();

    // Build the person layer (full size, NOT mirrored — will mirror at compose)
    personCtx.clearRect(0, 0, W, H);
    personCtx.drawImage(video, 0, 0, W, H);
    personCtx.globalCompositeOperation = "destination-in";
    personCtx.imageSmoothingEnabled = true;
    personCtx.drawImage(maskCanvas, 0, 0, W, H);
    personCtx.globalCompositeOperation = "source-over";

    // Compose onto bgCanvas: background (cover), then mirrored person on top
    const bg = bgImages[currentBgId];
    bgCtx.clearRect(0, 0, W, H);
    drawCover(bgCtx, bg, W, H);
    bgCtx.save();
    bgCtx.scale(-1, 1);
    bgCtx.drawImage(personCanvas, -W, 0, W, H);
    bgCtx.restore();
  }

  function setBackground(id) {
    if (!BACKGROUNDS.find((b) => b.id === id)) return;
    currentBgId = id;
    localStorage.setItem(STORAGE_KEY, id);
    updateChip();
  }

  // --- UI: BG selector chip (top-right) ---
  const chip = document.createElement("div");
  chip.className = "bg-chip";
  chip.innerHTML = `
    <button class="bg-chip-btn" type="button" aria-label="Change background">
      <span class="bg-chip-emoji">🌆</span>
      <span class="bg-chip-label">BG</span>
    </button>
    <div class="bg-chip-menu" hidden></div>
  `;
  document.body.appendChild(chip);
  const chipBtn = chip.querySelector(".bg-chip-btn");
  const chipEmoji = chip.querySelector(".bg-chip-emoji");
  const chipLabel = chip.querySelector(".bg-chip-label");
  const chipMenu = chip.querySelector(".bg-chip-menu");

  for (const b of BACKGROUNDS) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "bg-chip-opt";
    opt.dataset.bg = b.id;
    opt.innerHTML = `<span>${b.emoji}</span><span>${b.name}</span>`;
    opt.addEventListener("click", () => {
      setBackground(b.id);
      chipMenu.hidden = true;
    });
    chipMenu.appendChild(opt);
  }

  chipBtn.addEventListener("click", () => {
    chipMenu.hidden = !chipMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!chip.contains(e.target)) chipMenu.hidden = true;
  });

  function updateChip() {
    const b = BACKGROUNDS.find((x) => x.id === currentBgId);
    chipEmoji.textContent = b.emoji;
    chipLabel.textContent = b.name;
    chip.querySelectorAll(".bg-chip-opt").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.bg === currentBgId);
    });
  }
  updateChip();

  return {
    tick,
    setBackground,
    get current() { return currentBgId; },
    list: BACKGROUNDS,
  };
}

function drawCover(ctx, img, W, H) {
  if (!img) return;
  const ir = img.width / img.height;
  const cr = W / H;
  let dw, dh, dx, dy;
  if (ir > cr) {
    dh = H;
    dw = H * ir;
    dx = (W - dw) / 2;
    dy = 0;
  } else {
    dw = W;
    dh = W / ir;
    dx = 0;
    dy = (H - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}
