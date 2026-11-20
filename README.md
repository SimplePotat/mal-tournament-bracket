# Tournament Bracket

A whiteboard-ready tournament bracket UI designed for manual show-of-hands voting, with character images and name autocomplete drawn from MyAnimeList (MAL) and a fullscreen split-screen VS overlay with a real-time WebGL flame shader.

Runs entirely in the browser with **no installation and no administrator permissions required**.

## Features

- **4, 8, 16, or 32-slot brackets** with switchable **Linear** and **Split** layouts and automatic Fit-to-Screen scaling.
- **MyAnimeList character autocomplete** directly inside Round 1 slots (with portraits, series subtitles, and keyboard navigation). Supports custom entries and local image uploads when offline.
- **Fullscreen VS matchup view** triggered by the `VS` button between any two characters:
  - Both character images fill either side of the screen with a dividing line, `VS` display text, and a real-time WebGL GLSL flame shader (with automatic Canvas 2D fallback).
  - Click either side (or press `←`/`1` or `→`/`2`) to advance the winner to the next round.
  - Press `Esc` or click `Close` to return without deciding.
- **Live operation controls**: Undo (`Ctrl+Z`), Shuffle Round 1, Reset Results, Clear All, Export/Import JSON, Light/Dark theme toggle, and browser Fullscreen mode.

## Running on a University PC (No Admin Required)

Choose whichever option is easiest on the machine:

### Option 1: Open `index.html` directly (zero dependencies)
1. Download the repository ZIP (or clone it) into any user folder (e.g., `Downloads` or Desktop).
2. Double-click `index.html` to open it in Chrome, Edge, or Firefox.

### Option 2: Use the zero-dependency local launcher (direct MAL search)
Double-click **`launch.bat`** (Windows) or run **`./launch.sh`** (Linux/macOS).

- If Python 3 or Node.js is available, this starts a lightweight local server bound strictly to `127.0.0.1` (no firewall/admin prompt, no `pip` or `npm` packages needed) that proxies MyAnimeList's character autocomplete directly.
- If neither Python nor Node is installed, the launcher automatically opens `index.html` directly in the browser (which queries MyAnimeList via the Jikan v4 API, with an automatic fallback directory if Jikan is temporarily unavailable).

### Option 3: GitHub Pages
Open the hosted GitHub Pages URL directly in any browser without downloading any files.

## Controls

| Action | Input |
|---|---|
| Search & select character | Type in any Round 1 slot, use `↑` / `↓` and `Enter` |
| Open VS screen | Click the `VS` button between two characters |
| Select matchup winner | Click left or right half (or `←`/`1`, `→`/`2`) |
| Cancel matchup | Click `Close` or press `Esc` |
| Undo last change | `Ctrl+Z` (or `Undo` button) |
| Pan / Zoom bracket | Drag background / `Ctrl + Scroll` / toolbar zoom controls |
| Replace character image | Click the character thumbnail in Round 1 |
