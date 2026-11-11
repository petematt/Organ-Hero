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
