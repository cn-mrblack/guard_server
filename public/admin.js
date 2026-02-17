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

  const mapEl = document.getElementById("trackMap");
  let map = null;
  let trackLine = null;
  let pointMarkers = [];
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

  function ensureMap() {
    if (map) {
      return map;
    }

    map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true
    }).setView([39.9, 116.4], 10);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    return map;
  }

  function clearTrack() {
    if (trackLine) {
      trackLine.remove();
      trackLine = null;
    }

    pointMarkers.forEach(function (m) {
      m.remove();
    });
    pointMarkers = [];
  }

  function drawTrack(points) {
    ensureMap();
    clearTrack();

    if (!points || points.length < 1) {
      return;
    }

    const latLngs = points.map(function (p) {
      return [Number(p.lat), Number(p.lon)];
    });

    trackLine = L.polyline(latLngs, {
      color: "#174ea6",
      weight: 4,
      opacity: 0.9
    }).addTo(map);

    points.forEach(function (p, i) {
      const isStart = i === 0;
      const isEnd = i === points.length - 1;
      const marker = L.circleMarker([Number(p.lat), Number(p.lon)], {
        radius: isStart || isEnd ? 6 : 4,
        color: "#ffffff",
        weight: 1,
        fillColor: isStart ? "#0a7f5a" : (isEnd ? "#b3261e" : "#1f3e7c"),
        fillOpacity: 0.95
      }).addTo(map);

      const t = p.collectedAt || p.serverReceivedAt || "-";
      marker.bindPopup("<b>" + (p.deviceId || "-") + "</b><br/>" + t + "<br/>lat: " + p.lat + "<br/>lon: " + p.lon);
      pointMarkers.push(marker);
    });

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 16);
      return;
    }

    map.fitBounds(trackLine.getBounds(), { padding: [24, 24], maxZoom: 18 });
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
      drawTrack(points);
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
