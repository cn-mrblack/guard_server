import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { authJwt, authSignature, issueToken, verifyLogin } from "./auth.js";
import { openapi } from "./openapi.js";
import {
  findDevice,
  initStore,
  listDevices,
  listRecentEvents,
  listRecentHeartbeats,
  listRecentLocations,
  saveEvent,
  saveHeartbeat,
  saveLocation,
  upsertDevice
} from "./store.js";

initStore();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
        connectSrc: ["'self'"]
      }
    }
  })
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function requireAdmin(req, res, next) {
  const adminKey = req.header("x-admin-key");
  if (adminKey !== config.adminKey) {
    return res.status(401).json({ error: "invalid_admin_key" });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/openapi.json", (_req, res) => {
  res.json(openapi);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { explorer: true }));

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.post("/api/v1/auth/register", (req, res) => {
  const adminKey = req.header("x-admin-key");
  if (adminKey !== config.adminKey) {
    return res.status(401).json({ error: "invalid_admin_key" });
  }

  const { deviceId, secret } = req.body || {};
  if (!deviceId || !secret) {
    return res.status(400).json({ error: "deviceId_and_secret_required" });
  }

  upsertDevice(deviceId, secret);
  res.status(201).json({ ok: true, deviceId });
});

app.post("/api/v1/auth/device-login", (req, res) => {
  const { deviceId, secret } = req.body || {};
  if (!deviceId || !secret) {
    return res.status(400).json({ error: "deviceId_and_secret_required" });
  }

  const existing = findDevice(deviceId);
  if (!existing) {
    upsertDevice(deviceId, secret);
    const token = issueToken(deviceId);
    return res.status(201).json({
      token,
      expiresIn: 7 * 24 * 60 * 60,
      autoRegistered: true
    });
  }

  if (!verifyLogin(deviceId, secret)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = issueToken(deviceId);
  res.json({ token, expiresIn: 7 * 24 * 60 * 60 });
});

app.post("/api/v1/heartbeat", authJwt, authSignature, (req, res) => {
  const entry = {
    deviceId: req.deviceId,
    ...req.body,
    serverReceivedAt: new Date().toISOString()
  };
  saveHeartbeat(entry);
  res.status(201).json({ ok: true });
});

app.post("/api/v1/location", authJwt, authSignature, (req, res) => {
  const entry = {
    deviceId: req.deviceId,
    ...req.body,
    serverReceivedAt: new Date().toISOString()
  };
  saveLocation(entry);
  res.status(201).json({ ok: true });
});

app.post("/api/v1/events", authJwt, authSignature, (req, res) => {
  const entry = {
    deviceId: req.deviceId,
    ...req.body,
    serverReceivedAt: new Date().toISOString()
  };
  saveEvent(entry);
  res.status(201).json({ ok: true });
});

app.get("/api/v1/admin/devices", requireAdmin, (_req, res) => {
  const devices = listDevices();
  res.json({ items: devices, count: devices.length });
});

app.get("/api/v1/admin/records/:kind", requireAdmin, (req, res) => {
  const limit = Number(req.query.limit || 50);
  const kind = req.params.kind;
  const deviceId = (req.query.deviceId || "").toString().trim();
  const order = (req.query.order || "desc").toString().toLowerCase();
  const sortDir = order === "asc" ? 1 : -1;

  function byTime(a, b) {
    const ta = Date.parse(a.collectedAt || a.serverReceivedAt || 0);
    const tb = Date.parse(b.collectedAt || b.serverReceivedAt || 0);
    return (ta - tb) * sortDir;
  }

  function refine(items) {
    const filtered = deviceId ? items.filter((x) => x.deviceId === deviceId) : items;
    return filtered.sort(byTime);
  }

  if (kind === "heartbeats") {
    const items = refine(listRecentHeartbeats(limit));
    return res.json({ kind, items, count: items.length });
  }

  if (kind === "locations") {
    const items = refine(listRecentLocations(limit));
    return res.json({ kind, items, count: items.length });
  }

  if (kind === "events") {
    const items = refine(listRecentEvents(limit));
    return res.json({ kind, items, count: items.length });
  }

  return res.status(400).json({ error: "invalid_kind" });
});

app.get("/api/v1/admin/overview", requireAdmin, (req, res) => {
  const limit = Number(req.query.limit || 20);
  const devices = listDevices();
  const heartbeats = listRecentHeartbeats(limit);
  const locations = listRecentLocations(limit);
  const events = listRecentEvents(limit);

  res.json({
    totals: {
      devices: devices.length,
      heartbeats: heartbeats.length,
      locations: locations.length,
      events: events.length
    },
    latest: {
      heartbeats,
      locations,
      events
    }
  });
});

app.listen(config.port, () => {
  console.log(`Server listening on http://0.0.0.0:${config.port}`);
});
