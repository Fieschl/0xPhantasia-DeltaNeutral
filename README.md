# 0xPhantasia - Delta Neutral

React + Vite app for a delta-neutral concentrated liquidity simulator.

## Local development

Install deps and run dev server:

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000` by default.

## Build

```bash
npm run build
npm run preview
```

## Vercel deployment

1. Create a new project on Vercel and import this GitHub repository (`Fieschl/0xPhantasia-DeltaNeutral`).
2. Set the Build Command to `npm run build` and Output Directory to `dist` (Vercel usually detects this automatically).
3. Add Environment Variables (Project Settings → Environment Variables):
   - `VITE_FIREBASE_CONFIG` — JSON string of your Firebase config, e.g. `{"apiKey":"...","authDomain":"...",...}`
   - (optional) `VITE_INITIAL_AUTH_TOKEN` — initial custom auth token if you use custom sign-in.
   - (optional) `VITE_APP_ID` — app id (defaults to `equilibrium-engine-v8`).
4. Deploy — Vercel will run `npm run build` and publish the `dist` output.

Notes:
- The app reads Firebase config from `import.meta.env.VITE_FIREBASE_CONFIG`.
- If you prefer to use Vercel Environment Secrets, add the JSON there and reference it as the project env var above.
# 0xPhantasia-DeltaNeutral