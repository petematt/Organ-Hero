# AGENTS.md

## Mandatory Workflow for All Code Changes

For all coding agents and conversations working on this repository:

**After all code changes going forward, always execute the following sequence:**

1. **Verify**:
   - Run tests: `npm test`
   - Run type-check & build: `npm run build`
   - Ensure all tests pass and there are no TypeScript or build errors.

2. **Commit and Push to GitHub**:
   - Stage modified files (`git add ...`)
   - Commit with a descriptive message (`git commit -m "..."`)
   - Push to `main` branch (`git push origin main`)

3. **Deploy to GitHub Pages via Subagent**:
   - Launch a subagent to manage / verify the GitHub Pages deployment.
   - Pushing to `main` automatically triggers the GitHub Actions workflow `.github/workflows/deploy.yml` (`Build & Deploy to GitHub Pages`), which builds and publishes the production bundle to the `gh-pages` branch.
   - The subagent should monitor the workflow execution (`gh run list`, `gh run watch`) until both the build and GitHub Pages deployment complete successfully.

---
Shared knowledge for any agent working in this repo. Read before starting.

## Project basics
- Vite + TypeScript canvas game. Sim in `src/sim`, rendering in `src/ui/rinkRenderer.ts`, modals in `src/ui/screens.ts`, audio in `src/audio/organSynth.ts`, campaign in `src/campaign`.
- Verify: `npm test && npm run build` (tests are vitest; build runs `tsc --noEmit`).
- Deploy: see the mandatory workflow above.

## Visual verification (do this, don't improvise)
- Use `scripts/screenshot.mjs` (run `npm run build` first):
  `node scripts/screenshot.mjs "?screen=tipnote" /tmp/tip.png 1920 1080 .tip-note-card`
  Args: query string, output path, width, height, optional wait-selector. It serves `dist`, bypasses the sandbox proxy, waits for the selector, then captures. Check desktop (1920×1080) and mobile (844×390).
- Debug URL params (see `parseUrlParams` in `src/main.ts`): `autostart=1`, `seed=N`, `steps=N` (fast-forward sim), `penalty=1`, `brawl=1`, `debug=1`, `screen=clipboard|tipnote`. When a UI state is hard to reach, **add a debug param** instead of fast-forwarding the sim repeatedly.
- Headless Chrome needs `--no-proxy-server` for `127.0.0.1`; `vite preview` serves at `/`, not `/Organ-Hero/`.
- Always wait for a selector; never trust a screenshot file that may be stale (delete old ones first).

## Efficiency rules
- Grep before guessing module paths/export names (`grep -n "export" src/...`) instead of trial-running scripts.
- Use `grep -n` for line numbers in summaries rather than re-opening files.
- Checking for `(s)` plurals: `grep -rnE '[A-Za-z]\(s\)' src/ index.html` (plain `(s)` matches arrow functions).
- Batch independent tool calls in parallel.
- Chain checks in one command: grep → test → build.

## Conventions
- Never write `(s)` in user-visible text; use proper singular/plural (`plural()` helpers in `src/game/stats.ts`).
- Write unit tests alongside sim/stat changes (`src/sim/__tests__`).
- Commit per feature/request item (not one large batch) so regressions are bisectable.
- Don't consume `this.rng` in cosmetic-only sim code (keeps seeds deterministic).
- Audio balance: organ is the star; goal horn and period buzzer match organ loudness; crowd is ambiance beneath it.
- Penalty-box travel is cosmetic only: `mode === 'PENALTY_BOX'` and the timer start immediately.
- UI should scale with viewport (`clamp(..., vmin, ...)`) on desktop and stay compact on mobile.
