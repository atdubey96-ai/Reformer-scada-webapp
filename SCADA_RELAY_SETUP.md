# SCADA Relay Setup (for Jio DNS block)

Use this when `*.supabase.co` is blocked on Jio Wi-Fi/mobile.  
Host a relay on your own domain and point the app to it.

## 1) Deploy relay
- Deploy `/Users/ashutoshdubey/Documents/New project/scada-relay-worker.js` as a Cloudflare Worker.
- Add Worker variables/secrets:
  - `SUPABASE_URL` = `https://xqkbrlcdbgykmatzwvct.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
  - `SUPABASE_TABLE` = `scada_reports`
  - `AUTH_TABLE` = `scada_auth`
  - `AUTH_ROW_ID` = `1`
  - `RELAY_KEY` = (optional but recommended shared secret)
  - `AZURE_DOCINTEL_ENDPOINT` = your Azure Document Intelligence endpoint
  - `AZURE_DOCINTEL_KEY` = your Azure Document Intelligence key
- Optional Worker vars for TST OCR:
  - `AZURE_DOCINTEL_MODEL_ID` = `prebuilt-layout`
  - `AZURE_DOCINTEL_API_VERSION` = `2024-11-30`
  - `AZURE_DOCINTEL_FEATURES` = `ocrHighResolution`
  - `AZURE_DOCINTEL_OUTPUT_CONTENT_FORMAT` = `text`
  - `AZURE_DOCINTEL_LOCALE` = optional locale like `en-IN`

## 2) Bind custom domain
- Attach a custom domain (example: `https://scada-sync.yourdomain.com`).
- This domain should not be `*.supabase.co`.

## 3) Connect app to relay
Open your app URL with:

`?relay=https://scada-sync.yourdomain.com&relay_key=YOUR_RELAY_KEY`

The app stores this automatically in localStorage and will use it as fallback for:
- auth fetch
- latest report import
- report save/export
- TST OCR from the `Temp. Data` tab `OCR File to TST` button

## 4) Verify
- Press `Save New Data` on Jio network.
- Wait 15-30 seconds.
- Press `Refresh Data`.
- If needed, reopen app once to clear old JS cache.

## 5) Verify Azure TST OCR
- Open the website with your relay URL and relay key.
- Go to `Temp. Data`.
- Click `OCR File to TST`.
- Upload a TST PDF/photo.
- The site will send the rendered page image to `/scada/tst/ocr` on your relay.
- The relay will call Azure AI Document Intelligence and return OCR text to the existing TST parser.
