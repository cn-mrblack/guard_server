import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const kvEnabled = Boolean(kvUrl && kvToken);

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (process.env.VERCEL ? path.join("/tmp", "anti-loss-data") : path.resolve("data"));
const devicesFile = path.join(dataDir, "devices.json");
const locationsFile = path.join(dataDir, "locations.ndjson");
const heartbeatsFile = path.join(dataDir, "heartbeats.ndjson");
const eventsFile = path.join(dataDir, "events.ndjson");

function ensureFile(filePath, initialContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, initialContent, "utf8");
  }
}

async function kvCommand(...parts) {
  const base = kvUrl.replace(/\/+$/, "");
  const url = `${base}/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV command failed (${res.status}): ${body}`);
  }

  const payload = await res.json();
  if (payload.error) {
    throw new Error(`KV error: ${payload.error}`);
  }

  return payload.result;
}

export function initStore() {
  if (kvEnabled) {
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  ensureFile(devicesFile, "[]\n");
  ensureFile(locationsFile, "");
  ensureFile(heartbeatsFile, "");
  ensureFile(eventsFile, "");
}

export function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function readDevices() {
  try {
    const raw = fs.readFileSync(devicesFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readNdjsonRecent(filePath, limit = 50) {
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const lines = raw.split("\n").filter(Boolean);
  return lines
    .slice(Math.max(0, lines.length - max))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeDevices(devices) {
  fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2) + "\n", "utf8");
}

export async function upsertDevice(deviceId, secret) {
  const now = new Date().toISOString();
  const secretHash = hashSecret(secret);

  if (kvEnabled) {
    const existingRaw = await kvCommand("HGET", "devices", deviceId);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    const record = existing
      ? { ...existing, secretHash, updatedAt: now }
      : { deviceId, secretHash, createdAt: now, updatedAt: now };

    await kvCommand("HSET", "devices", deviceId, JSON.stringify(record));
    return;
  }

  const devices = readDevices();
  const index = devices.findIndex((d) => d.deviceId === deviceId);
  if (index === -1) {
    devices.push({ deviceId, secretHash, createdAt: now, updatedAt: now });
  } else {
    devices[index] = { ...devices[index], secretHash, updatedAt: now };
  }

  writeDevices(devices);
}

export async function findDevice(deviceId) {
  if (kvEnabled) {
    const raw = await kvCommand("HGET", "devices", deviceId);
    return raw ? JSON.parse(raw) : null;
  }

  return readDevices().find((d) => d.deviceId === deviceId) || null;
}

export async function listDevices() {
  if (kvEnabled) {
    const raw = await kvCommand("HGETALL", "devices");
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const out = [];
    for (let i = 0; i < raw.length; i += 2) {
      const value = raw[i + 1];
      if (!value) {
        continue;
      }
      try {
        out.push(JSON.parse(value));
      } catch {
        continue;
      }
    }
    return out;
  }

  return readDevices();
}

export async function verifyDeviceSecret(deviceId, secret) {
  const device = await findDevice(deviceId);
  if (!device) {
    return false;
  }
  return device.secretHash === hashSecret(secret);
}

function appendLine(filePath, payload) {
  fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf8");
}

async function saveRecord(kind, entry) {
  if (kvEnabled) {
    const key = `records:${kind}`;
    await kvCommand("LPUSH", key, JSON.stringify(entry));
    await kvCommand("LTRIM", key, 0, 4999);
    return;
  }

  if (kind === "heartbeats") {
    appendLine(heartbeatsFile, entry);
  } else if (kind === "locations") {
    appendLine(locationsFile, entry);
  } else {
    appendLine(eventsFile, entry);
  }
}

export async function saveHeartbeat(entry) {
  await saveRecord("heartbeats", entry);
}

export async function saveLocation(entry) {
  await saveRecord("locations", entry);
}

export async function saveEvent(entry) {
  await saveRecord("events", entry);
}

async function listRecent(kind, filePath, limit = 50) {
  if (kvEnabled) {
    const max = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
    const key = `records:${kind}`;
    const lines = await kvCommand("LRANGE", key, 0, max - 1);
    if (!Array.isArray(lines) || lines.length === 0) {
      return [];
    }

    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  return readNdjsonRecent(filePath, limit);
}

export async function listRecentHeartbeats(limit = 50) {
  return listRecent("heartbeats", heartbeatsFile, limit);
}

export async function listRecentLocations(limit = 50) {
  return listRecent("locations", locationsFile, limit);
}

export async function listRecentEvents(limit = 50) {
  return listRecent("events", eventsFile, limit);
}

export async function hasSeenNonce(deviceId, nonce, timestampMs) {
  if (kvEnabled) {
    const key = `nonce:${deviceId}:${nonce}`;
    const result = await kvCommand("SET", key, timestampMs, "EX", 900, "NX");
    return result === null;
  }

  const nonceCacheFile = path.join(dataDir, `nonce-${deviceId}.json`);
  const now = Date.now();
  let nonces = [];

  if (fs.existsSync(nonceCacheFile)) {
    try {
      nonces = JSON.parse(fs.readFileSync(nonceCacheFile, "utf8"));
    } catch {
      nonces = [];
    }
  }

  nonces = nonces.filter((n) => now - Number(n.ts) < 15 * 60 * 1000);
  if (nonces.some((n) => n.nonce === nonce)) {
    return true;
  }

  nonces.push({ nonce, ts: timestampMs });
  fs.writeFileSync(nonceCacheFile, JSON.stringify(nonces), "utf8");
  return false;
}


