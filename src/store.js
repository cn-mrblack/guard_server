import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (process.env.VERCEL ? path.join('/tmp', 'anti-loss-data') : path.resolve('data'));
const devicesFile = path.join(dataDir, "devices.json");
const locationsFile = path.join(dataDir, "locations.ndjson");
const heartbeatsFile = path.join(dataDir, "heartbeats.ndjson");
const eventsFile = path.join(dataDir, "events.ndjson");

function ensureFile(filePath, initialContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, initialContent, "utf8");
  }
}

export function initStore() {
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
  const raw = fs.readFileSync(devicesFile, "utf8");
  return JSON.parse(raw);
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

export function upsertDevice(deviceId, secret) {
  const devices = readDevices();
  const now = new Date().toISOString();
  const secretHash = hashSecret(secret);

  const index = devices.findIndex((d) => d.deviceId === deviceId);
  if (index === -1) {
    devices.push({ deviceId, secretHash, createdAt: now, updatedAt: now });
  } else {
    devices[index] = { ...devices[index], secretHash, updatedAt: now };
  }

  writeDevices(devices);
}

export function findDevice(deviceId) {
  return readDevices().find((d) => d.deviceId === deviceId) || null;
}

export function listDevices() {
  return readDevices();
}

export function verifyDeviceSecret(deviceId, secret) {
  const device = findDevice(deviceId);
  if (!device) {
    return false;
  }
  return device.secretHash === hashSecret(secret);
}

function appendLine(filePath, payload) {
  fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf8");
}

export function saveHeartbeat(entry) {
  appendLine(heartbeatsFile, entry);
}

export function saveLocation(entry) {
  appendLine(locationsFile, entry);
}

export function saveEvent(entry) {
  appendLine(eventsFile, entry);
}

export function listRecentHeartbeats(limit = 50) {
  return readNdjsonRecent(heartbeatsFile, limit);
}

export function listRecentLocations(limit = 50) {
  return readNdjsonRecent(locationsFile, limit);
}

export function listRecentEvents(limit = 50) {
  return readNdjsonRecent(eventsFile, limit);
}

export function hasSeenNonce(deviceId, nonce, timestampMs) {
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


