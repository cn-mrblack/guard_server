import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { findDevice, hasSeenNonce, verifyDeviceSecret } from "./store.js";
import { hmacHex, sha256Hex, timingSafeEqualHex } from "./crypto.js";

export function issueToken(deviceId) {
  return jwt.sign({ sub: deviceId }, config.jwtSecret, { expiresIn: "7d" });
}

export function authJwt(req, res, next) {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_token" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.deviceId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

export function authSignature(req, res, next) {
  const deviceId = req.deviceId;
  const device = findDevice(deviceId);
  if (!device) {
    return res.status(401).json({ error: "unknown_device" });
  }

  const timestamp = Number(req.header("x-timestamp"));
  const nonce = req.header("x-nonce");
  const signature = (req.header("x-signature") || "").toLowerCase();

  if (!timestamp || !nonce || !signature) {
    return res.status(400).json({ error: "missing_signature_headers" });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return res.status(400).json({ error: "timestamp_out_of_range" });
  }

  if (hasSeenNonce(deviceId, nonce, timestamp)) {
    return res.status(409).json({ error: "replayed_nonce" });
  }

  const bodyRaw = JSON.stringify(req.body || {});
  const bodyHash = sha256Hex(bodyRaw);
  const base = `${req.method}\n${req.path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const expected = hmacHex(device.secretHash, base);

  if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqualHex(signature, expected)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  next();
}

export function verifyLogin(deviceId, secret) {
  return verifyDeviceSecret(deviceId, secret);
}
