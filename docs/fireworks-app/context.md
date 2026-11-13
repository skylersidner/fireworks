# Fireworks Sandbox — Project Context

Context handoff for a Claude Code session. Pair it with `prototypes/fireworks-prototype.html`, the working single-file prototype described below.

## Project summary

- **What:** A web sandbox/playground for designing digital fireworks: craft individual shells, string them into shows, and share shows by link. It's a toy or game, not a real pyrotechnics tool. The crafting UI should still reflect how real shells are built (breaks, stars, effects).
- **Stack:** .NET backend + Angular frontend. The backend only persists settings and creations (shells, shows) and serves share links.
- **Rendering decision:** **PixiJS v8** (2D, WebGL/WebGPU) with a **hand-written simulation**. 3D (Three.js/Babylon) was ruled out. The goal is 2D glowing particle effects, not pixel art and not 3D scenes.
- **Libraries considered and rejected:**
  - **tsParticles / fireworks-js:** preset-driven, too limiting for deep crafting.
  - **Raw Canvas 2D:** CPU-bound and has no cheap glow. It's fine for a throwaway prototype but not the product.

## Requirements (from the user)

1. 2D only. Lots of small glowing particles.
2. Crafting with realistic structure: start with an MVP, then keep adding detail (multi-break shells, color changes, crossettes, glitter, and so on).
3. Full shows. Craft single shells first, then put them on a timeline to make a show.
4. Shareable links that drop a visitor straight into a playing show.
5. Desktop first. Mobile support is nice-to-have and secondary.

## Target architecture

### 1. Data model (persisted JSON)
- **Shell:** `name`, `burstHeight` (0.3–0.85, a fraction of the ground height, 760 units; the v1 contract is `docs/fireworks-app/schema.md`), `angleJitter` (degrees), and `breaks[]` (one or more, which makes multi-break shells possible). Includes a `version` field so the schema can change later.
- **Break:** `pattern` (peony | ring | palm | heart), `stars`, `speed`, `color1` (or `rainbow`), `color2` (or `none`), `changeAt`, `burn`, `drag`, `size`, `trail` (none | tail | glitter), `effect` (none | crackle | crossette | strobe), and `delay` (seconds after the previous break; used for every break except the first).
- **Show (next step):** a timeline of cues. Each cue has `{ shellRef or embedded shell, launchTime, x position, burst point/angle }`, with music offsets possible later. Shared shows should **embed copies** of their shells so edits or deletes don't break old links.

Adding a feature should mean a new field or a new enum value, never a rewrite.

### 2. Simulation (framework-agnostic TypeScript library)
- **Fixed timestep (120 Hz) plus seeded random numbers:** the same JSON and seed produce the same playback on every machine. Share links and future video export depend on this.
- **Particle storage:** structure-of-arrays (`Float32Array`/`Uint32Array`, etc.) with swap-remove, capped at around 40k particles. No per-particle objects, so no garbage-collection pauses.
- Should become its own library in the Angular workspace with **no Angular or Pixi imports**.

### 3. Renderer (thin Pixi layer)
- Reads the simulation arrays each frame and writes them into a Pixi `ParticleContainer`.
- Can be replaced without touching the simulation.

### 4. Angular app
- **Shell Designer:** form controls plus a live preview canvas that loops the shell.
- **Show Builder:** a timeline with draggable cues and a shell library sidebar.
- **Player route** (e.g. `/s/:shareCode`): full-screen, read-only, with a "remix" button.
- Run the render loop **outside Angular change detection**, either zoneless or via `NgZone.runOutsideAngular`.

### 5. .NET backend
- A minimal API with Shells and Shows stored as JSON documents (EF Core JSON column, or Postgres `jsonb`).
- Short share codes, not raw database IDs.
- Schema `version` on every document.

### MVP roadmap
1. ✅ Single-shell simulation and look (done in the prototype).
2. Shell Designer UI in Angular, bound to the JSON model, with save/load through the API.
3. Show timeline, the Player route and share links.
4. More effects: richer multi-break shells, more patterns, color effects.
5. Extras: sound (Howler.js / Web Audio), a mobile quality setting and touch controls, music sync, video export.

## The prototype (`prototypes/fireworks-prototype.html`)

A single HTML file that loads PixiJS **8.23.0** from jsDelivr as an ES module. Its sections, in order:

### Data model
- `COLORS`: named colors mapped to hex values. `PATTERNS`, `TRAILS` and `EFFECTS` are the enums.
- `newBreak()` / `newShell()`: factory functions that fill in defaults.
- `PRESETS`: 10 shells (Peony, Chrysanthemum, Willow, Palm, Ring, Crossette, Crackling Heart, Strobe, Rainbow, Triple Break). They show how the parameters combine into recognizable shell types.
- `world`: global gravity, wind, motion-blur persistence and a star budget (a multiplier on star counts, intended for a mobile quality setting).

### Deterministic random numbers
- `mulberry32(seed)`: a per-shell random number generator.
- `prand(i)`: a per-particle random stream, stored in `P.seed[i]`. Effects that happen later (crackle, crossette, trail sparks) stay deterministic without referring back to the parent shell.
- A launch is fully determined by `(shell def, target x/y, seed)`. The "Replay last" button proves it.

### Simulation (no Pixi or DOM)
- **World units:** fixed height of 800, with the ground at y=760. The width follows the screen's aspect ratio. Rendering scales the world to the screen, so physics doesn't depend on resolution.
- **`P` object:** structure-of-arrays particle store (`x, y, vx, vy, age, life, drag, grav, size, emit, change, alpha, c1, c2, seed, kind, trail, effect, gen`).
  - `spawn()` appends a particle.
  - `kill()` swap-removes one.
  - The update loop iterates **downward** so swap-remove is safe while iterating.
- **Particle kinds:**
  - `STAR`: a burst star.
  - `EMBER`: a tail spark or the rising shell's comet trail.
  - `GLITTER`: a flickering spark.
  - `POP`: a crackle flash.
  - `FLASH`: the bright bloom at the moment of burst.
  - `HEAD`: the rising shell's bright tip.
- **Shells:** plain objects in a small `shells[]` array.
  - `launch()` works out the launch velocity needed to reach the target point exactly at the apex: `v = sqrt(2gh)`, fuse = `v/g`. The launch point is jittered by `angleJitter`.
  - When a fuse expires, `burst()` fires the current break. If there are more breaks, the shell keeps drifting and the next fuse is set from that break's `delay`.
- **Patterns (`directions()`):**
  - **peony:** a Fibonacci sphere, randomly rotated, then projected to 2D. Stars bunch toward the edge like a real spherical burst.
  - **ring:** a circle tilted and rolled in 3D, which projects to an ellipse.
  - **palm:** a few big comets, evenly spaced with some jitter.
  - **heart:** the standard parametric heart curve.
- **Physics:** exponential drag `v *= exp(-drag*dt)`, plus gravity scaled per kind and wind. Burst radius is roughly `speed / drag`.
- **Effects:**
  - **Color change:** `starColor()` switches from `c1` to `c2` at the `changeAt` fraction of the star's life.
  - **Crackle:** when a star dies, it spawns 3–7 `POP` particles with a **negative age**. The negative age staggers when each one appears.
  - **Crossette:** when a first-generation star dies, it splits into 4 stars at 90° apart (`gen = 1` stops further splitting).
  - **Strobe:** handled in the renderer. Alpha flickers after 30% of the star's life.
  - **Trails:** each star accumulates an `emit` counter and spawns `EMBER` (tail) or `GLITTER` particles each tick.

### Renderer (Pixi v8)
- **`Application`:** created with `resizeTo` set to the stage element and `preference: 'webgl'`. Resolution is capped at a device pixel ratio of 2.
- **Glow texture:** made once on a canvas with a radial gradient: a hot white core and a soft halo. Every particle uses this one `Texture` (a `ParticleContainer` requires all particles to share one texture). Colors come from `tint`.
- **`ParticleContainer`:**
  - `blendMode = 'add'`, so overlapping sparks add up to brighter light.
  - All `dynamicProperties` are set to true, **including `uvs` and `rotation`**. The prototype changes `particleChildren` directly, and making every property dynamic avoids stale static data in the GPU buffer when the particle count grows.
- **`sync()`:**
  - Grows or shrinks a `live[]` array of `Particle` objects (reusing them from a pool) to match `P.n`.
  - Copies position, scale, tint and alpha from the arrays. Tint is only reassigned when it changes.
  - Assigns `pc.particleChildren = live` and calls `pc.update()`.
  - `Particle` objects are interchangeable because every visible property is rewritten each frame. They never need to be swapped when particles die.
- **Motion-blur trails:**
  - A persistent `RenderTexture` (`trailRT`) is drawn onto the screen through a `Sprite`.
  - Each frame, a full-screen dark rectangle with alpha `1 - persistence` is drawn into it (`clear: false`), then the particle layer is drawn on top (`clear: false`).
  - **The trail buffer is `format: 'rgba16float'`** (with a fallback to the default format). An 8-bit buffer leaves faint grey "ghost" streaks that never fully fade, because of rounding.
- **Draw order:** `worldRoot` and `fadeRoot` are wrapper containers that are not on the stage. They are drawn into the trail texture manually. `app.stage` holds only the trail sprite and a `Graphics` city skyline.
- **Resize:** each tick compares `app.screen` with the last size. If it changed, it resizes the render texture, redraws the fade rectangle and skyline, and resets the world scale (`h / 800`).

### Main loop and modes
- `tick()` gathers frame time into fixed 1/120 s steps. It runs at most 24 steps per frame, so a slow frame can't spiral into ever more catch-up work.
- **Modes:**
  - **Preview loop:** re-fires the current shell after `shellDuration()`.
  - **Manual:** click the sky or press Space.
  - **Auto show:** random presets at random times and positions.
- `fire()` hands out seeds (`baseSeed + n*7919`) and records `lastLaunch` for Replay.
- Clicking the sky converts screen coordinates to world coordinates and bursts the current shell at that point.

### Editor UI
- Plain DOM controls built by helper functions (`rangeRow`, `selectRow`), standing in for future Angular reactive forms.
- The break tabs support adding and removing up to 4 breaks.
- The JSON panel shows the live shell document (Copy / Apply).

## Notes for porting to Angular

- Split the code into `sim/` (model, random numbers, simulation, patterns) as a pure TS library, `render/` (Pixi adapter), and the Angular components.
- Create the Pixi `Application` in a component's `afterNextRender` (or `ngAfterViewInit`) inside `runOutsideAngular`. Destroy it in `ngOnDestroy` (`app.destroy(true)`).
- The shell model maps directly onto typed reactive forms. Also define a C# record for the API DTO, and generate TypeScript types from it or keep the two in sync.
- Random numbers in the "Auto show" mode use `Math.random`. Real shows should take cue timing from saved data, not random numbers, so playback stays reproducible.
- Pixi v8 tips:
  - Import everything from `'pixi.js'` (a single package). Never import from `@pixi/*` (that's v7).
  - `app.init()` is async.
  - The `Graphics` API is `g.rect(...).fill(...)`.
  - The `ParticleContainer` / `Particle` API is marked stable but experimental.
- Bloom is a possible upgrade via `pixi-filters` (`AdvancedBloomFilter`). The prototype fakes glow with the gradient texture and additive blending, which looks good and costs less.
