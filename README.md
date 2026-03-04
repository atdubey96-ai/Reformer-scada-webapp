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
