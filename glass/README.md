# Tutor Booking Glass

A standalone **React + Vite** renovation of the public booking page. It is intentionally isolated from the existing `tutornew` service so the working production site, Google Sheets, Telegram bot, admin panel, and student cabinet remain untouched.

## What stays exactly where it is

- Booking, availability, rescheduling, notifications, Sheets, and Telegram logic stay in the existing Tutor Booking server.
- `/admin.html`, `/cabinet.html`, and `/telegram.html` remain on that existing service and are linked from this new UI.
- This frontend only proxies the public endpoints it needs: config, slots, booking, lookup, and rescheduling. It does **not** duplicate secrets or expose admin endpoints.

## Local preview

In one terminal, start the existing project:

```bash
cd ..
npm ci
ADMIN_KEY=admin123 npm start
```

In another terminal, run the React UI:

```bash
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:4173`. Vite forwards relative `/api` calls to `API_ORIGIN` (by default `http://localhost:3000`).

To test the production-style proxy instead:

```bash
npm run build
API_ORIGIN=http://localhost:3000 LEGACY_SITE_URL=http://localhost:3000 PORT=4173 npm start
```

## Separate GitHub repository + Render service

This directory is self-contained by design. Copy **the contents of `glass/`** into a new repository (for example `tutor-booking-glass`) and use its included `render.yaml` as the Render Blueprint.

In the new Render service set these two non-secret environment variables:

| Variable | Value |
| --- | --- |
| `API_ORIGIN` | Public URL of the existing working Tutor Booking Render service, e.g. `https://current-tutor.onrender.com` |
| `LEGACY_SITE_URL` | Usually the same URL; this is where Cabinet, Telegram Mini App, and Admin links should open. |

Render builds the React application, then starts `server.js`. That tiny server serves the static files and forwards only the public booking API calls to `API_ORIGIN`; therefore the browser always uses relative `/api/...` URLs and no API key, Sheet URL, bot token, or admin password is copied into the new service.

Health endpoint: `/healthz`.

### Deploy directly from this repository instead

`../render.glass.yaml` is an optional Blueprint configured with `rootDir: glass`. Use it only when you explicitly want Render to deploy this subdirectory from the existing repository. It creates a second service and does not modify the original `tutor-booking` service.

## Before switching links or Telegram

Leave the original service's `PUBLIC_URL` unchanged while you review the Glass site. This guarantees current bot webhooks and old links keep working. Once the new UI is approved, you can decide separately whether public links should point at the new Render URL.
