(function () {
  const keyInput = document.getElementById("adminKey");
  const statusEl = document.getElementById("status");
  const registerStatusEl = document.getElementById("registerStatus");
  const limitEl = document.getElementById("limit");
  const trackDeviceEl = document.getElementById("trackDevice");
  const trackInfoEl = document.getElementById("trackInfo");
  const autoRefreshEnabledEl = document.getElementById("autoRefreshEnabled");
  const autoRefreshSecEl = document.getElementById("autoRefreshSec");

  const cDevices = document.getElementById("cDevices");
  const cHeartbeats = document.getElementById("cHeartbeats");
  const cLocations = document.getElementById("cLocations");
  const cEvents = document.getElementById("cEvents");

  const devicesData = document.getElementById("devicesData");
  const heartbeatsData = document.getElementById("heartbeatsData");
  const locationsData = document.getElementById("locationsData");
  const eventsData = document.getElementById("eventsData");

  const canvas = document.getElementById("trackCanvas");
  const ctx = canvas.getContext("2d");
  const TILE_SIZE = 256;
  const OSM_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

  let renderToken = 0;
  let refreshTimer = null;
  let refreshing = false;

  keyInput.value = localStorage.getItem("admin_key") || "";
  autoRefreshEnabledEl.checked = (localStorage.getItem("admin_auto_enabled") || "1") === "1";
  autoRefreshSecEl.value = localStorage.getItem("admin_auto_sec") || "15";

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle("err", Boolean(isError));
  }

  function pretty(x) {
    return JSON.stringify(x, null, 2);
  }

  async function requestJson(url, adminKey, options) {
    const opt = options || {};
    const headers = Object.assign({}, opt.headers || {}, { "x-admin-key": adminKey });
    const rsp = await fetch(url, Object.assign({}, opt, { headers }));
    const data = await rsp.json().catch(function () {
      return {};
    });
    if (!rsp.ok) {
      throw new Error(data.error || ("HTTP_" + rsp.status));
    }
    return data;
  }

  function getAdminKey() {
    return keyInput.value.trim();
  }

  function lonToWorldX(lon, zoom) {
    const n = Math.pow(2, zoom) * TILE_SIZE;
    return ((Number(lon) + 180) / 360) * n;
  }

  function latToWorldY(lat, zoom) {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const rad = (clamped * Math.PI) / 180;
    const n = Math.pow(2, zoom) * TILE_SIZE;
    const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    return (n / 2) - (n * merc) / (2 * Math.PI);
  }

  function chooseZoom(points, width, height, pad) {
    if (points.length < 2) {
      return 15;
    }

    const lons = points.map(function (p) { return Number(p.lon); });
    const lats = points.map(function (p) { return Number(p.lat); });
    const minLon = Math.min.apply(null, lons);
    const maxLon = Math.max.apply(null, lons);
    const minLat = Math.min.apply(null, lats);
    const maxLat = Math.max.apply(null, lats);

    for (let z = 18; z >= 2; z -= 1) {
      const x0 = lonToWorldX(minLon, z);
      const x1 = lonToWorldX(maxLon, z);
      const y0 = latToWorldY(maxLat, z);
      const y1 = latToWorldY(minLat, z);
      if ((x1 - x0) <= (width - pad * 2) && (y1 - y0) <= (height - pad * 2)) {
        return z;
      }
    }
    return 2;
  }

  function tileUrl(z, x, y) {
    return OSM_TILE.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  }

  function loadTile(url) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve({ ok: true, img: img }); };
      img.onerror = function () { resolve({ ok: false, img: null }); };
      img.src = url;
    });
  }

  async function drawTrack(points) {
    const token = ++renderToken;
    const w = canvas.width;
    const h = canvas.height;
    const pad = 24;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f7fbff";
    ctx.fillRect(0, 0, w, h);

    if (!points || points.length < 2) {
      ctx.fillStyle = "#60708f";
      ctx.font = "14px sans-serif";
      ctx.fillText("轨迹点不足（至少2个）", 20, 28);
      return;
    }

    const zoom = chooseZoom(points, w, h, pad);
    const nTiles = Math.pow(2, zoom);

    const lons = points.map(function (p) { return Number(p.lon); });
    const lats = points.map(function (p) { return Number(p.lat); });
    const minLon = Math.min.apply(null, lons);
    const maxLon = Math.max.apply(null, lons);
    const minLat = Math.min.apply(null, lats);
    const maxLat = Math.max.apply(null, lats);

    const minX = lonToWorldX(minLon, zoom);
    const maxX = lonToWorldX(maxLon, zoom);
    const minY = latToWorldY(maxLat, zoom);
    const maxY = latToWorldY(minLat, zoom);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const topLeftX = centerX - w / 2;
    const topLeftY = centerY - h / 2;

    const startTileX = Math.floor(topLeftX / TILE_SIZE);
    const endTileX = Math.floor((topLeftX + w) / TILE_SIZE);
    const startTileY = Math.floor(topLeftY / TILE_SIZE);
    const endTileY = Math.floor((topLeftY + h) / TILE_SIZE);

    const tileJobs = [];
    for (let tx = startTileX; tx <= endTileX; tx += 1) {
      for (let ty = startTileY; ty <= endTileY; ty += 1) {
        if (ty < 0 || ty >= nTiles) {
          continue;
        }
        const wrappedX = ((tx % nTiles) + nTiles) % nTiles;
        const url = tileUrl(zoom, wrappedX, ty);
        tileJobs.push({ tx: tx, ty: ty, promise: loadTile(url) });
      }
    }

    const tileResults = await Promise.all(tileJobs.map(function (t) { return t.promise; }));
    if (token !== renderToken) {
      return;
    }

    tileJobs.forEach(function (job, i) {
      const result = tileResults[i];
      const drawX = Math.round(job.tx * TILE_SIZE - topLeftX);
      const drawY = Math.round(job.ty * TILE_SIZE - topLeftY);
      if (result.ok) {
        ctx.drawImage(result.img, drawX, drawY, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = "#eef3fb";
        ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
      }
    });

    function px(lon) {
      return lonToWorldX(lon, zoom) - topLeftX;
    }

    function py(lat) {
      return latToWorldY(lat, zoom) - topLeftY;
    }

    ctx.strokeStyle = "#174ea6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach(function (p, i) {
      const x = px(p.lon);
      const y = py(p.lat);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    points.forEach(function (p, i) {
      const x = px(p.lon);
      const y = py(p.lat);
      ctx.fillStyle = i === 0 ? "#0a7f5a" : (i === points.length - 1 ? "#b3261e" : "#1f3e7c");
      ctx.beginPath();
      ctx.arc(x, y, i === 0 || i === points.length - 1 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(23,32,51,.8)";
    ctx.font = "12px sans-serif";
    ctx.fillText("Map data © OpenStreetMap contributors", 12, h - 12);
  }

  async function loadTrack() {
    const adminKey = getAdminKey();
    const deviceId = trackDeviceEl.value;
    const limit = Number(limitEl.value || 100);
    if (!adminKey) {
      setStatus(statusEl, "请先输入 ADMIN_KEY", true);
      return;
    }
    if (!deviceId) {
      trackInfoEl.textContent = "请先选择设备";
      return;
    }

    try {
      const q = "/api/v1/admin/records/locations?limit=" + limit + "&order=asc&deviceId=" + encodeURIComponent(deviceId);
      const data = await requestJson(q, adminKey);
      const points = (data.items || []).filter(function (x) {
        return Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon));
      });
      await drawTrack(points);
      if (points.length) {
        const startTime = points[0].collectedAt || points[0].serverReceivedAt || "-";
        const endTime = points[points.length - 1].collectedAt || points[points.length - 1].serverReceivedAt || "-";
        trackInfoEl.textContent = "设备 " + deviceId + "，轨迹点 " + points.length + "，起始 " + startTime + "，结束 " + endTime;
      } else {
        trackInfoEl.textContent = "该设备暂无位置数据";
      }
    } catch (e) {
      trackInfoEl.textContent = "轨迹加载失败: " + e.message;
    }
  }

  async function refreshAll() {
    if (refreshing) {
      return;
    }
    refreshing = true;

    const adminKey = getAdminKey();
    const limit = Number(limitEl.value || 100);
    if (!adminKey) {
      setStatus(statusEl, "请先输入 ADMIN_KEY", true);
      refreshing = false;
      return;
    }

    setStatus(statusEl, "加载中...", false);
    try {
      const results = await Promise.all([
        requestJson("/api/v1/admin/overview?limit=" + limit, adminKey),
        requestJson("/api/v1/admin/devices", adminKey),
        requestJson("/api/v1/admin/records/heartbeats?limit=20&order=desc", adminKey),
        requestJson("/api/v1/admin/records/locations?limit=20&order=desc", adminKey),
        requestJson("/api/v1/admin/records/events?limit=20&order=desc", adminKey)
      ]);

      const overview = results[0];
      const devices = results[1];
      const heartbeats = results[2];
      const locations = results[3];
      const events = results[4];

      cDevices.textContent = String(overview.totals.devices);
      cHeartbeats.textContent = String(overview.totals.heartbeats);
      cLocations.textContent = String(overview.totals.locations);
      cEvents.textContent = String(overview.totals.events);

      devicesData.textContent = pretty(devices.items);
      heartbeatsData.textContent = pretty(heartbeats.items);
      locationsData.textContent = pretty(locations.items);
      eventsData.textContent = pretty(events.items);

      const selected = trackDeviceEl.value;
      trackDeviceEl.innerHTML = "";
      (devices.items || []).forEach(function (d) {
        const op = document.createElement("option");
        op.value = d.deviceId;
        op.textContent = d.deviceId;
        trackDeviceEl.appendChild(op);
      });
      if (selected) {
        trackDeviceEl.value = selected;
      }
      if (!trackDeviceEl.value && trackDeviceEl.options.length) {
        trackDeviceEl.selectedIndex = 0;
      }

      await loadTrack();
      setStatus(statusEl, "刷新成功: " + new Date().toLocaleString(), false);
    } catch (e) {
      setStatus(statusEl, "刷新失败: " + e.message, true);
    } finally {
      refreshing = false;
    }
  }

  async function registerDevice() {
    const adminKey = getAdminKey();
    const deviceId = document.getElementById("newDeviceId").value.trim();
    const secret = document.getElementById("newDeviceSecret").value.trim();
    if (!adminKey) {
      setStatus(registerStatusEl, "请先输入 ADMIN_KEY", true);
      return;
    }
    if (!deviceId || !secret) {
      setStatus(registerStatusEl, "deviceId 和 secret 不能为空", true);
      return;
    }

    try {
      await requestJson("/api/v1/auth/register", adminKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: deviceId, secret: secret })
      });
      setStatus(registerStatusEl, "注册成功: " + deviceId, false);
      await refreshAll();
    } catch (e) {
      setStatus(registerStatusEl, "注册失败: " + e.message, true);
    }
  }

  function restartAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    localStorage.setItem("admin_auto_enabled", autoRefreshEnabledEl.checked ? "1" : "0");
    localStorage.setItem("admin_auto_sec", autoRefreshSecEl.value);

    if (!autoRefreshEnabledEl.checked) {
      return;
    }

    const ms = Math.max(3, Number(autoRefreshSecEl.value || "15")) * 1000;
    refreshTimer = setInterval(function () {
      if (document.visibilityState === "visible") {
        refreshAll();
      }
    }, ms);
  }

  document.getElementById("saveKey").addEventListener("click", function () {
    localStorage.setItem("admin_key", getAdminKey());
    setStatus(statusEl, "ADMIN_KEY 已保存到浏览器本地", false);
  });
  document.getElementById("refresh").addEventListener("click", refreshAll);
  document.getElementById("loadTrack").addEventListener("click", loadTrack);
  document.getElementById("registerBtn").addEventListener("click", registerDevice);
  limitEl.addEventListener("change", refreshAll);

  autoRefreshEnabledEl.addEventListener("change", restartAutoRefresh);
  autoRefreshSecEl.addEventListener("change", restartAutoRefresh);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && autoRefreshEnabledEl.checked) {
      refreshAll();
    }
  });

  restartAutoRefresh();
  refreshAll();
})();
