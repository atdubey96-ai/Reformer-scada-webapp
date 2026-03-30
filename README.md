# Webpage App

This folder contains your webpage app.

## Run locally

From this folder:

```bash
cd "/Users/ashutoshdubey/Documents/New project/webapp"
python3 -m http.server 5500
```

Then open:

`http://localhost:5500`

## Auto-open the SCADA workbook

- macOS: run [`start_scada_app.command`](/Users/ashutoshdubey/Documents/New%20project/start_scada_app.command)
- Windows: run [`start_scada_app.cmd`](/Users/ashutoshdubey/Documents/New%20project/start_scada_app.cmd) or [`start_scada_app.ps1`](/Users/ashutoshdubey/Documents/New%20project/start_scada_app.ps1)

These launchers:

- start the local site on `http://localhost:5500`
- open the browser
- open the workbook `webapp/Data_website2.xlsm`

This is local-launch behavior, not browser-only behavior. A normal website cannot directly launch Excel by itself on page load across macOS and Windows.

## Main file

- `index.html` - your full SCADA dashboard webpage

## Stable Vercel Deployment (Recommended)

To avoid Vercel "Cloning failed" issues, this repo includes:

- `.github/workflows/vercel-production-deploy.yml`

It deploys using Vercel CLI from GitHub Actions, which does not depend on Vercel's Git clone step.

Set these repository secrets once in GitHub (`Settings > Secrets and variables > Actions`):

1. `VERCEL_TOKEN`
2. `VERCEL_ORG_ID`
3. `VERCEL_PROJECT_ID`

After this, every push to `main` triggers a production deploy reliably.
