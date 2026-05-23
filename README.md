# AR Fruit Catch 🍌🍋

A browser-based AR mini-game. Your webcam feed is the background, and your hands are tracked in real time (MediaPipe HandLandmarker) to **catch falling yellow fruits**.

> Inspired by the reference design — score counters, lives, progress, and a target banner.

## Level 1 — Catch the Yellow Fruit

- 🟡 Catch **bananas & lemons** → +1 point
- 🍓 Touching the **wrong fruit** → lose a ❤️
- 🟡 Missing a **yellow fruit** off-screen → lose a ❤️
- 🎯 Reach **30 points** to clear the level
- 💀 Lose all 3 hearts → Game Over

## Run it

Camera + MediaPipe require **HTTPS or localhost**. From the project folder:

```bash
cd "3D game/AR-game"

# Option A — Python
python3 -m http.server 5173

# Option B — Node (any of these work)
npx http-server -p 5173
npx serve -p 5173
```

Then open <http://localhost:5173> in Chrome / Edge / Safari and allow camera access.

## Assets

- Fruit + UI PNGs are from **Twemoji** (CC-BY 4.0), downloaded into `assets/`.
- Sounds are synthesized live with the **Web Audio API** (no external files).

## Files

```
AR-game/
  index.html        # markup + HUD + overlays
  styles.css        # styling (coral / yellow palette like the reference)
  main.js           # game loop, MediaPipe hand tracking, physics, audio
  assets/
    fruits/         # banana, lemon, orange, apple, strawberry, watermelon
    ui/             # heart, sparkle, boom
    sounds/         # (synthesized at runtime, empty by default)
```

## Controls

No keyboard needed — just move your **hands** in front of the camera. The game tracks your palm + fingertips as catch points (yellow dots).

## Tips

- Stand back so your full upper body and arms are in frame.
- Bright, even lighting helps hand detection accuracy.
- Use a desktop/laptop with a real webcam for best framerate; the model runs on GPU via WebGL.
