/*
 * Production host for the standalone React renovation.
 *
 * The UI deliberately calls only relative /api URLs. This server forwards the
 * public booking endpoints to the already-working Tutor Booking service, so the
 * new Render service has no copy of Sheets, Telegram, or admin secrets.
 */
const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 10000);
const host = "0.0.0.0";
const distDir = path.join(__dirname, "dist");

function cleanOrigin(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    console.error("Invalid API_ORIGIN:", error.message);
    return "";
  }
}

const apiOrigin = cleanOrigin(process.env.API_ORIGIN);
const legacySiteUrl = cleanOrigin(process.env.LEGACY_SITE_URL) || apiOrigin;

// Only the endpoints used by the redesigned public booking experience are
// exposed. The admin, Telegram webhook, and student-account endpoints stay on
// the original service.
const publicApi = new Map([
  ["/api/config", new Set(["GET"])],
  ["/api/slots", new Set(["GET"])],
  ["/api/my", new Set(["GET"])],
  ["/api/health", new Set(["GET"])],
  ["/api/book", new Set(["POST"])],
  ["/api/reschedule", new Set(["POST"])],
]);

function runtimeConfigScript() {
  const config = JSON.stringify({ legacySiteUrl }).replace(/</g, "\\u003c");
  return `window.__GLASS_CONFIG__ = ${config};\n`;
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "tutor-booking-glass", apiConfigured: Boolean(apiOrigin) });
});

app.get("/runtime-config.js", (_req, res) => {
  res
    .set("Cache-Control", "no-store, max-age=0")
    .type("application/javascript")
    .send(runtimeConfigScript());
});

app.use("/api", express.raw({ type: () => true, limit: "512kb" }));
app.use("/api", async (req, res) => {
  const requestUrl = new URL(req.originalUrl, "http://glass.local");
  const allowedMethods = publicApi.get(requestUrl.pathname);

  if (!allowedMethods || !allowedMethods.has(req.method)) {
    return res.status(404).json({ ok: false, error: "Unknown public API endpoint" });
  }
  if (!apiOrigin) {
    return res.status(503).json({ ok: false, error: "The new site is not connected to the booking service yet" });
  }

  const upstreamUrl = new URL(req.originalUrl, `${apiOrigin}/`);
  const headers = { ...req.headers };
  // The destination host and byte length belong to the new request.
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  delete headers["accept-encoding"];

  const hasBody = !["GET", "HEAD"].includes(req.method) && req.body && req.body.length;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    const body = Buffer.from(await upstream.arrayBuffer());

    // Let Express calculate compression/length correctly for the proxied body.
    const skippedHeaders = new Set([
      "connection", "content-encoding", "content-length", "keep-alive",
      "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
    ]);
    upstream.headers.forEach((value, key) => {
      if (!skippedHeaders.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.status(upstream.status).send(body);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "The booking service took too long to respond"
      : "The booking service is temporarily unavailable";
    console.error("API proxy error:", error.message);
    res.status(502).json({ ok: false, error: message });
  } finally {
    clearTimeout(timeout);
  }
});

app.use(express.static(distDir, {
  index: false,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

// Client-side routing remains safe if routes are added later. Using middleware
// rather than a wildcard route keeps this compatible with Express 5.
app.use((_req, res) => res.sendFile(path.join(distDir, "index.html")));

app.listen(port, host, () => {
  console.log(`Tutor Booking Glass on http://${host}:${port}`);
  console.log(apiOrigin ? `Public API proxy: ${apiOrigin}` : "Public API proxy: not configured");
});
