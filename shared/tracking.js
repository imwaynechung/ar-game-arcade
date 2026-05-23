// ============================================================
// shared/tracking.js — Camera + MediaPipe HandLandmarker with
// per-point velocity tracking (used by all AR games).
// ============================================================

import {
  HandLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((res) => (videoEl.onloadedmetadata = res));
  await videoEl.play();
}

/**
 * Create a hand tracker. Returns { detect(video, canvas, t) }.
 * detect() returns { hands, points } in pixel coordinates of `canvas`.
 *
 *  - hands:  one entry per detected hand (palm centroid + landmarks)
 *  - points: all catch points = palm + 5 fingertips per hand
 *
 * Hit-radius is normalized to the hand's apparent size (palmSpan =
 * wrist→middle-MCP distance) so the catch area stays consistent
 * whether the player is close to or far from the camera.
 *
 * NOTE: coordinates are MIRRORED (matches selfie-mirrored video).
 */
export async function createHandTracker({
  numHands = 4,
  palmRadiusFactor = 1.15,
  tipRadiusFactor  = 0.55,
  minPalmRadius    = 36,
  maxPalmRadius    = 140,
  minTipRadius     = 20,
  maxTipRadius     = 70,
} = {}) {
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  const handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands,
  });

  let lastVideoTime = -1;
  let prevPoints = [];
  let prevT = 0;
  let cached = { hands: [], points: [] };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const PALM_LMS = [0, 5, 9, 13, 17]; // wrist + 4 MCPs → true palm centroid

  function detect(video, canvas, timestamp) {
    if (video.readyState < 2) return cached;
    if (video.currentTime === lastVideoTime) return cached;
    lastVideoTime = video.currentTime;

    const result = handLandmarker.detectForVideo(video, timestamp);
    const W = canvas.width;
    const H = canvas.height;
    const hands = [];
    const points = [];

    if (result?.landmarks) {
      result.landmarks.forEach((landmarks, handIdx) => {
        // Mirror all 21 landmarks to canvas pixel coords
        const lm = landmarks.map((p) => ({ x: (1 - p.x) * W, y: p.y * H }));

        // True palm centroid (wrist + 4 MCPs)
        let cx = 0, cy = 0;
        for (const i of PALM_LMS) { cx += lm[i].x; cy += lm[i].y; }
        cx /= PALM_LMS.length;
        cy /= PALM_LMS.length;

        // Hand-size metric scaled to a hit-radius that matches the hand
        const palmSpan = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
        const palmR = clamp(palmSpan * palmRadiusFactor, minPalmRadius, maxPalmRadius);
        const tipR  = clamp(palmSpan * tipRadiusFactor,  minTipRadius,  maxTipRadius);

        const palmPt = {
          x: cx, y: cy,
          r: palmR,
          kind: "palm",
          handIdx,
          palmSpan,
          landmarks: lm,
        };
        hands.push(palmPt);
        points.push(palmPt);

        for (const idx of [4, 8, 12, 16, 20]) {
          points.push({
            x: lm[idx].x,
            y: lm[idx].y,
            r: tipR,
            kind: "tip",
            handIdx,
            landmarkIdx: idx,
            palmSpan,
          });
        }
      });
    }

    // Velocity by nearest-neighbor match against previous frame
    const dt = Math.max(0.001, (timestamp - prevT) / 1000);
    for (const pt of points) {
      let nearest = null;
      let minD = Infinity;
      // Prefer same handIdx + same landmark
      for (const p of prevPoints) {
        if (p.handIdx !== pt.handIdx) continue;
        if (p.kind !== pt.kind) continue;
        if (p.landmarkIdx !== pt.landmarkIdx) continue;
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < minD) {
          minD = d;
          nearest = p;
        }
      }
      if (!nearest) {
        // fallback: any nearest
        for (const p of prevPoints) {
          const d = Math.hypot(pt.x - p.x, pt.y - p.y);
          if (d < minD) {
            minD = d;
            nearest = p;
          }
        }
      }
      if (nearest && minD < 250) {
        pt.vx = (pt.x - nearest.x) / dt;
        pt.vy = (pt.y - nearest.y) / dt;
        pt.speed = Math.hypot(pt.vx, pt.vy);
        pt.prevX = nearest.x;
        pt.prevY = nearest.y;
      } else {
        pt.vx = 0;
        pt.vy = 0;
        pt.speed = 0;
        pt.prevX = pt.x;
        pt.prevY = pt.y;
      }
    }

    prevPoints = points;
    prevT = timestamp;
    cached = { hands, points };
    return cached;
  }

  return { detect };
}

/**
 * Test whether a segment from (x1,y1)->(x2,y2) intersects a circle (cx,cy,r).
 * Used for high-speed "slice / swipe" hit detection so fast hands don't tunnel.
 */
export function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x1 - cx, y1 - cy) <= r;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) <= r;
}

// ============================================================
// Cartoon hand renderer
// ============================================================
const FINGER_CHAINS = [
  [1, 2, 3, 4],     // thumb
  [5, 6, 7, 8],     // index
  [9, 10, 11, 12],  // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20], // pinky
];

/**
 * Draw a chunky cartoon glove for one detected hand.
 *   ctx     – the game canvas context
 *   hand    – an entry from `tracker.detect().hands` (must have .landmarks)
 *   options – { color, outline, alpha, showNails }
 */
export function drawHand(ctx, hand, {
  color = "#ffd23f",
  outline = "#1a0a0a",
  alpha = 0.95,
  showNails = true,
} = {}) {
  const lm = hand.landmarks;
  if (!lm) return;

  const span     = hand.palmSpan || 80;
  const fingerW  = Math.max(16, span * 0.52);   // chunkier for seniors/kids
  const palmR    = Math.max(28, span * 1.1);
  const outlineW = 8;

  // Palm orientation: wrist (0) -> middle MCP (9)
  const wrist  = lm[0];
  const midMcp = lm[9];
  const axisDx = midMcp.x - wrist.x;
  const axisDy = midMcp.y - wrist.y;
  const angle  = Math.atan2(axisDy, axisDx);
  // Centered between wrist and a bit past the MCPs so the oval covers the palm
  const palmCx = (wrist.x + midMcp.x) / 2 + axisDx * 0.15;
  const palmCy = (wrist.y + midMcp.y) / 2 + axisDy * 0.15;
  const palmLen = Math.max(60, span * 1.7);  // along finger axis
  const palmWid = Math.max(50, span * 1.25); // across the palm

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1) Rotation-locked palm OVAL (outline + fill) — always visible regardless
  //    of how the user rotates their hand. Drawn BEHIND fingers.
  ctx.save();
  ctx.translate(palmCx, palmCy);
  ctx.rotate(angle - Math.PI / 2); // long axis = finger direction
  // outline
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, palmWid / 2 + outlineW / 2, palmLen / 2 + outlineW / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // colored fill
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, palmWid / 2, palmLen / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight (catches the light from the upper-left of the palm, rotated)
  const grad = ctx.createRadialGradient(-palmWid * 0.18, -palmLen * 0.22, 2, 0, 0, palmLen * 0.55);
  grad.addColorStop(0, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, palmWid / 2, palmLen / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2) Fingers — outline pass
  ctx.strokeStyle = outline;
  ctx.fillStyle   = outline;
  ctx.lineWidth   = fingerW + outlineW;
  for (const ids of FINGER_CHAINS) strokeChain(ctx, lm, ids);

  // 3) Fingers — colored fill pass
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = fingerW;
  for (const ids of FINGER_CHAINS) strokeChain(ctx, lm, ids);

  // 4) Small extra centroid circle so the hand still reads even if landmarks
  //    are partially occluded.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, palmR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // 5) Fingertip nail highlights
  if (showNails) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (const idx of [4, 8, 12, 16, 20]) {
      ctx.beginPath();
      ctx.arc(lm[idx].x, lm[idx].y, fingerW * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function strokeChain(ctx, lm, ids) {
  ctx.beginPath();
  ctx.moveTo(lm[ids[0]].x, lm[ids[0]].y);
  for (let i = 1; i < ids.length; i++) {
    ctx.lineTo(lm[ids[i]].x, lm[ids[i]].y);
  }
  ctx.stroke();
}

// ============================================================
// PoseLandmarker — full-body, multi-person
// ============================================================
/**
 * Create a multi-person pose tracker.
 *  detect(video, canvas, t) → { poses: [ { landmarks, hipCenter:{x,y}, torso, energy } ] }
 * Coordinates are MIRRORED to match selfie-mirrored video.
 * `energy` is a normalized per-frame motion magnitude (0..~3) computed from
 * wrist/elbow/knee/ankle velocities scaled by torso size — great for "running
 * in place" detection.
 */
export async function createPoseTracker({ numPoses = 2, enableSegmentation = false } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses,
    outputSegmentationMasks: !!enableSegmentation,
  });

  // Indices on the body that contribute to "running" energy
  const ENERGY_LMS = [13, 14, 15, 16, 25, 26, 27, 28]; // elbows, wrists, knees, ankles

  let lastVideoTime = -1;
  let prevPosesByLane = new Array(numPoses).fill(null); // index = lane (0..N-1, sorted left→right by hip x)
  let prevT = 0;
  let cached = { poses: [] };

  function detect(video, canvas, timestamp) {
    if (video.readyState < 2) return cached;
    if (video.currentTime === lastVideoTime) return cached;
    lastVideoTime = video.currentTime;

    const result = poseLandmarker.detectForVideo(video, timestamp);
    const W = canvas.width;
    const H = canvas.height;
    const dt = Math.max(0.001, (timestamp - prevT) / 1000);
    const poses = [];

    if (result?.landmarks?.length) {
      for (let i = 0; i < result.landmarks.length; i++) {
        const landmarks = result.landmarks[i];
        const mask = result.segmentationMasks?.[i] ?? null;
        const lm = landmarks.map((p) => ({ x: (1 - p.x) * W, y: p.y * H, v: p.visibility ?? 1 }));
        const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
        const hipCx = (lh.x + rh.x) / 2;
        const hipCy = (lh.y + rh.y) / 2;
        const shoulderCx = (ls.x + rs.x) / 2;
        const shoulderCy = (ls.y + rs.y) / 2;
        const torso = Math.max(40, Math.hypot(shoulderCx - hipCx, shoulderCy - hipCy));
        poses.push({ landmarks: lm, hipCenter: { x: hipCx, y: hipCy }, torso, energy: 0, mask });
      }
      // Assign to lanes by hip x (smallest x = lane 0 / leftmost)
      poses.sort((a, b) => a.hipCenter.x - b.hipCenter.x);
    }

    // Compute energy per pose, matched to previous-frame pose by lane index.
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const lane = Math.min(numPoses - 1, i);
      p.lane = lane;
      const prev = prevPosesByLane[lane];
      if (prev && prev.landmarks) {
        let sum = 0;
        let count = 0;
        for (const idx of ENERGY_LMS) {
          const a = p.landmarks[idx], b = prev.landmarks[idx];
          if (!a || !b) continue;
          if ((a.v ?? 1) < 0.4 || (b.v ?? 1) < 0.4) continue;
          sum += Math.hypot(a.x - b.x, a.y - b.y);
          count++;
        }
        if (count) {
          const avgPx = sum / count;
          // Normalize by torso size and per-second — bigger torsos move further in pixels.
          p.energy = (avgPx / p.torso) / dt;
        }
      }
      prevPosesByLane[lane] = p;
    }

    prevT = timestamp;
    cached = { poses };
    return cached;
  }

  return { detect };
}

/**
 * Draw a simple stick figure for a detected pose (debug / visualization).
 */
const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
];
export function drawPoseStick(ctx, pose, { color = "#ffd23f", outline = "#1a0a0a", lineW = 8 } = {}) {
  const lm = pose.landmarks;
  if (!lm) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineW + 4;
  for (const [a, b] of POSE_CONNECTIONS) {
    if ((lm[a].v ?? 1) < 0.3 || (lm[b].v ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  for (const [a, b] of POSE_CONNECTIONS) {
    if ((lm[a].v ?? 1) < 0.3 || (lm[b].v ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
    ctx.stroke();
  }
  // joints
  ctx.fillStyle = outline;
  for (const idx of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if ((lm[idx].v ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm[idx].x, lm[idx].y, lineW * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  for (const idx of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if ((lm[idx].v ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm[idx].x, lm[idx].y, lineW * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

