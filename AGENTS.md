# Project Guardrails (Applies to every new thread)

## Live Source of Truth
- Production UI must be edited in: `webapp/index.html`
- Service worker for production: `webapp/sw.js`
- Prototype/design files under `design/` are **not** live website code.

## Required Deploy Flow After Any Website Change
1. Confirm repo and branch:
   - `git rev-parse --show-toplevel`
   - `git branch --show-current` (must be `main`)
2. Stage only intended files.
3. Commit with a clear message.
4. Push to GitHub:
   - `git push origin main`
5. Report pushed commit hash in response.

## Verification Rules
- If change is for live website, do **not** edit only prototype files.
- If no push happened, clearly say it is local only.
- If push fails, report exact error and retry steps.

## Vercel Notes
- GitHub Actions deploys on `main` push.
- If user still sees old UI, advise hard refresh (`Ctrl+F5` / `Cmd+Shift+R`).
