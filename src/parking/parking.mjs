import {
  appData,
  haversineMiles,
  MODES_PAGE_EMPTY_MAP_CENTER,
} from "../shared/data-loader.mjs";

/**
 * Parking map category ids — same strings as `#/parking?location=` (not `appData.parking` JSON keys).
 */
const PARKING_MAP_ITEM_KEYS = [
  "public-garage",
  "public-lot",
  "private-garage",
  "private-lot",
];

/** Map category id → `appData.parking` / JSON merge key. */
const PARKING_CATEGORY_DATA_KEY = {
  "public-garage": "garages",
  "public-lot": "lots",
  "private-garage": "osmGarages",
  "private-lot": "osmLots",
};

function parkingCategoryDataKey(categoryId) {
  return PARKING_CATEGORY_DATA_KEY[categoryId];
}

/** Legacy `cats` tokens → canonical category id. */
const PARKING_LEGACY_CAT_TOKEN = {
  garages: "public-garage",
  lots: "public-lot",
  osmGarages: "private-garage",
  osmLots: "private-lot",
};

function parkingCategoryIdFromUrlToken(token) {
  const t = String(token).trim();
  if (!t) return null;
  if (PARKING_MAP_ITEM_KEYS.includes(t)) return t;
  if (PARKING_LEGACY_CAT_TOKEN[t]) return PARKING_LEGACY_CAT_TOKEN[t];
  return null;
}

const PARKING_DESTINATION_PLACEHOLDER = "Where are you going?";

/** ArcGIS public garages */
const PARKING_SPOT_STYLE_PUBLIC_GARAGE = {
  color: "#4338ca",
  fillColor: "#818cf8",
  fillOpacity: 0.76,
};
/** ArcGIS public lots */
const PARKING_SPOT_STYLE_PUBLIC_LOT = {
  color: "#1e40af",
  fillColor: "#60a5fa",
  fillOpacity: 0.75,
};
/** OSM private garages — deeper orange (paired with private lots). */
const PARKING_SPOT_STYLE_PRIVATE_GARAGE = {
  color: "#b45309",
  fillColor: "#f59e0b",
  fillOpacity: 0.78,
};
/** OSM private lots — lighter yellow-amber (same warm family). */
const PARKING_SPOT_STYLE_PRIVATE_LOT = {
  color: "#ca8a04",
  fillColor: "#fde047",
  fillOpacity: 0.78,
};

function circleStyleForParkingCategoryKey(key) {
  if (key === "public-garage") return PARKING_SPOT_STYLE_PUBLIC_GARAGE;
  if (key === "public-lot") return PARKING_SPOT_STYLE_PUBLIC_LOT;
  if (key === "private-garage") return PARKING_SPOT_STYLE_PRIVATE_GARAGE;
  if (key === "private-lot") return PARKING_SPOT_STYLE_PRIVATE_LOT;
  return PARKING_SPOT_STYLE_PUBLIC_GARAGE;
}

/** `#/parking` — DASH routes + drive parking locations (garages/lots only). */
export function isParkingRoute() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  return pathPart === "/parking" || pathPart === "/parking/";
}

/** Same downtown filter as `src/visit/planner.mjs` / `#/data/routes`. */
const DATA_ROUTES_CITY_CENTER_LAT = 42.96333;
const DATA_ROUTES_CITY_CENTER_LON = -85.66806;
const DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER = 1.5;

/** `#/parking` — hide parking pins farther than this from any shown DASH stop. */
const PARKING_MAX_MILES_FROM_DASH_STOP = 0.75;

/**
 * Symmetric fitBounds padding in px. Leaflet combines TL+BR into one point for
 * getBoundsZoom, so max-zoom uses 2× each axis.
 */
const PARKING_MAP_FIT_PADDING = [36, 36];

let parkingMap = null;
let parkingDashLayerGroup = null;
let parkingSpotsLayerGroup = null;
let parkingDestinationLayerGroup = null;
let parkingFilterBarDelegated = false;
let parkingDestinationSelectDelegated = false;
let parkingResetDelegated = false;

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Darken a `#RRGGBB` hex for circle stroke (GTFS colors have no stroke field). */
function darkenCssHex(hex, factor) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#4a1c28";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const d = (c) =>
    Math.max(0, Math.min(255, Math.round(c * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${d(r)}${d(g)}${d(b)}`;
}

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatParkingPrice(pricing, categoryKey) {
  const privateOsm =
    categoryKey === "private-garage" || categoryKey === "private-lot";
  if (!pricing || typeof pricing !== "object") {
    return privateOsm ? "Unknown" : "Free";
  }
  if (pricing.rate) return pricing.rate;
  if (pricing.evening) return pricing.evening;
  if (pricing.daytime) return pricing.daytime;
  if (pricing.events) return pricing.events;
  return privateOsm ? "Unknown" : "Free";
}

/**
 * Query string for `#/parking?…` (empty when no `?` in hash).
 */
function getParkingRouteSearchParams() {
  const hash = window.location.hash.slice(1);
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

/**
 * `null` = no `location` (or legacy `cats`) param → show all categories.
 * `Set` (possibly empty) = explicit filter from `#/parking?location=public-garage,private-lot`.
 */
function parseParkingCatsFromHash() {
  const params = getParkingRouteSearchParams();
  const key = params.has("location")
    ? "location"
    : params.has("cats")
      ? "cats"
      : null;
  if (key === null) return null;
  const raw = params.get(key);
  if (raw === null || String(raw).trim() === "") return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => parkingCategoryIdFromUrlToken(s))
      .filter((k) => k != null),
  );
}

/** Destination slug from `#/parking?destination=…` (or legacy `dest`), or "" if absent / invalid. */
function parseParkingDestSlugFromHash() {
  const params = getParkingRouteSearchParams();
  let raw = null;
  if (params.has("destination")) raw = params.get("destination");
  else if (params.has("dest")) raw = params.get("dest");
  if (raw == null || String(raw).trim() === "") return "";
  const slug = String(raw).trim();
  const ok =
    Array.isArray(appData?.destinations) &&
    appData.destinations.some((d) => d.slug === slug);
  return ok ? slug : "";
}

function buildParkingHashFromState(enabledKeys, destSlug) {
  const allKeys = new Set(PARKING_MAP_ITEM_KEYS);
  const enabled =
    enabledKeys instanceof Set ? enabledKeys : new Set(enabledKeys);
  const isAll =
    enabled.size === allKeys.size && [...allKeys].every((k) => enabled.has(k));

  /** Literal commas in `location` (avoid URLSearchParams encoding them as %2C). */
  const parts = [];
  if (!isAll) {
    parts.push(`location=${[...enabled].sort().join(",")}`);
  }
  const d = typeof destSlug === "string" ? destSlug.trim() : "";
  if (
    d &&
    Array.isArray(appData?.destinations) &&
    appData.destinations.some((x) => x.slug === d)
  ) {
    parts.push(`destination=${encodeURIComponent(d)}`);
  }
  const q = parts.join("&");
  return q ? `#/parking?${q}` : "#/parking";
}

function getParkingDestinationSlugFromSelect() {
  return (
    document.getElementById("parkingDestinationSelect")?.value?.trim() || ""
  );
}

function getEnabledParkingKeys() {
  const wanted = parseParkingCatsFromHash();
  if (wanted === null) return [...PARKING_MAP_ITEM_KEYS];
  return PARKING_MAP_ITEM_KEYS.filter((k) => wanted.has(k));
}

function toggleParkingCategoryFilter(key) {
  if (!PARKING_MAP_ITEM_KEYS.includes(key)) return;
  const current = new Set(getEnabledParkingKeys());
  if (current.has(key)) current.delete(key);
  else current.add(key);
  const dest = getParkingDestinationSlugFromSelect();
  window.location.hash = buildParkingHashFromState(current, dest);
  if (parkingMap) {
    parkingMap.invalidateSize();
    syncParkingMapOverlays(parkingMap);
  }
}

/** All parking categories on, no destination — `#/parking` with no query. */
function resetParkingMapChromeToDefaults() {
  const nextHash = buildParkingHashFromState(
    new Set(PARKING_MAP_ITEM_KEYS),
    "",
  );
  if (window.location.hash === nextHash) {
    const sel = document.getElementById("parkingDestinationSelect");
    if (sel && sel.value !== "") {
      sel.value = "";
      syncParkingDestinationSelectAppearance();
    }
    buildParkingFilterBar();
    if (parkingMap) {
      parkingMap.invalidateSize();
      syncParkingMapOverlays(parkingMap);
    }
    return;
  }
  window.location.hash = nextHash;
}

function ensureParkingResetDelegation() {
  if (parkingResetDelegated) return;
  const btn = document.getElementById("parkingResetBtn");
  if (!btn) return;
  parkingResetDelegated = true;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    resetParkingMapChromeToDefaults();
  });
}

function ensureParkingFilterBarDelegation() {
  if (parkingFilterBarDelegated) return;
  const bar = document.getElementById("parkingFilterBar");
  if (!bar) return;
  parkingFilterBarDelegated = true;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-parking-category]");
    if (!btn) return;
    e.preventDefault();
    toggleParkingCategoryFilter(btn.dataset.parkingCategory);
  });
}

function ensureParkingDestinationSelectDelegation() {
  if (parkingDestinationSelectDelegated) return;
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  parkingDestinationSelectDelegated = true;
  sel.addEventListener("change", () => {
    syncParkingDestinationSelectAppearance();
    window.location.hash = buildParkingHashFromState(
      new Set(getEnabledParkingKeys()),
      sel.value,
    );
    if (parkingMap) syncParkingMapOverlays(parkingMap);
  });
}

function syncParkingDestinationSelectAppearance() {
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  const empty = sel.value === "";
  if (empty) {
    sel.classList.remove("text-slate-900");
    sel.classList.add("text-slate-400");
  } else {
    sel.classList.remove("text-slate-400");
    sel.classList.add("text-slate-900");
  }
  const chevron = document.getElementById("parkingDestChevron");
  const resetBtn = document.getElementById("parkingResetBtn");
  if (chevron) chevron.classList.toggle("hidden", !empty);
  if (resetBtn) resetBtn.classList.toggle("hidden", empty);
}

function buildParkingDestinationSelect() {
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  ensureParkingDestinationSelectDelegation();
  const urlDest = parseParkingDestSlugFromHash();
  const destinations = Array.isArray(appData?.destinations)
    ? [...appData.destinations].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        }),
      )
    : [];
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = PARKING_DESTINATION_PLACEHOLDER;
  sel.appendChild(none);
  for (const d of destinations) {
    const lat = d.latitude ?? d.location?.latitude;
    const lng = d.longitude ?? d.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const opt = document.createElement("option");
    opt.value = d.slug;
    opt.textContent = d.name || d.slug;
    sel.appendChild(opt);
  }
  if (urlDest && [...sel.options].some((o) => o.value === urlDest)) {
    sel.value = urlDest;
  } else {
    sel.value = "";
  }
  syncParkingDestinationSelectAppearance();
}

/** @returns {[number, number]|null} lat, lng for selected destination */
function getParkingDestinationLatLng() {
  const sel = document.getElementById("parkingDestinationSelect");
  const slug = sel?.value;
  if (!slug) return null;
  const dest = appData?.destinations?.find((d) => d.slug === slug);
  if (!dest) return null;
  const lat = dest.latitude ?? dest.location?.latitude;
  const lng = dest.longitude ?? dest.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return [lat, lng];
}

function buildParkingFilterBar() {
  const bar = document.getElementById("parkingFilterBar");
  if (!bar) return;
  ensureParkingFilterBarDelegation();
  const parking = appData?.parking;
  const enabled = new Set(getEnabledParkingKeys());
  bar.innerHTML = "";
  for (const categoryId of PARKING_MAP_ITEM_KEYS) {
    const dataKey = parkingCategoryDataKey(categoryId);
    const label = parking?.categoryNames?.[dataKey] || categoryId;
    const active = enabled.has(categoryId);
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.parkingCategory = categoryId;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.setAttribute("aria-label", `${active ? "Hide" : "Show"} ${label}`);
    b.textContent = label;
    const layout =
      "rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors";
    if (active) {
      const { color: stroke, fillColor: fill } =
        circleStyleForParkingCategoryKey(categoryId);
      b.className = `${layout} border-solid`;
      b.style.borderColor = stroke;
      b.style.backgroundColor = hexToRgba(fill, 0.28);
      b.style.color = stroke;
    } else {
      b.removeAttribute("style");
      b.className = `${layout} border-slate-200 bg-slate-100 text-slate-500 line-through decoration-slate-400`;
    }
    bar.appendChild(b);
  }
}

/**
 * @returns {Array<{ lat: number, lng: number, name: string, address: string, categoryKey: string, categoryName: string, price: string }>}
 */
function getAllParkingSpotMarkers(enabledKeys) {
  const keys =
    Array.isArray(enabledKeys) && enabledKeys.length > 0
      ? enabledKeys
      : getEnabledParkingKeys();
  const out = [];
  const parking = appData?.parking;
  if (!parking) return out;
  const dashStops = getDashStopLatLngsForParkingProximity();
  for (const categoryId of keys) {
    const dataKey = parkingCategoryDataKey(categoryId);
    const items = dataKey ? parking[dataKey] : null;
    if (!Array.isArray(items)) continue;
    const categoryName = parking.categoryNames?.[dataKey] || categoryId;
    for (const item of items) {
      const loc = item?.location;
      const lat = loc?.latitude ?? item?.latitude;
      const lng = loc?.longitude ?? item?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!isParkingWithinDashStopRadius(lat, lng, dashStops)) continue;
      out.push({
        lat,
        lng,
        name: item.name || "—",
        address:
          typeof item.address === "string" && item.address.trim() !== ""
            ? item.address.trim()
            : "",
        categoryKey: categoryId,
        categoryName,
        price: formatParkingPrice(item.pricing, categoryId),
      });
    }
  }
  return out;
}

/**
 * DASH polylines + stops (same source as modes page shuttle map).
 * @returns {{ points: Array<{lat:number,lng:number,label:string,address:string}>, polylines: Array<{latLngs:number[][], color:string, weight?:number}> }}
 */
function getParkingDashMapData() {
  const empty = { points: [], polylines: [] };
  const bus = appData?.busRoutes;
  const dashList = Array.isArray(bus?.dash_routes) ? bus.dash_routes : [];
  const legacyList = Array.isArray(bus?.routes) ? bus.routes : [];
  const routes = dashList.length > 0 ? dashList : legacyList;
  if (routes.length === 0) return empty;

  const defaultLineColor = "#933145";
  const colorForRoute = (hex, fallbackHex) => {
    if (typeof hex === "string" && hex.trim() !== "") {
      const h = hex.trim();
      if (h.startsWith("#")) return h;
      if (/^[0-9A-Fa-f]{6}$/.test(h)) return `#${h}`;
    }
    return fallbackHex;
  };

  const points = [];
  const polylines = [];
  const groupLabel = "DASH";

  for (const r of routes) {
    const lineLabel = [r.route_short_name, r.route_long_name]
      .filter((x) => typeof x === "string" && x.trim() !== "")
      .join(" · ");
    const rlabel = [groupLabel, lineLabel]
      .filter((x) => typeof x === "string" && x.trim() !== "")
      .join(" · ");
    const col = colorForRoute(r.route_color, defaultLineColor);
    for (const sh of r.shapes || []) {
      const coords = sh.coordinates || [];
      const latLngs = [];
      for (const c of coords) {
        const la = c.latitude;
        const lo = c.longitude;
        if (typeof la === "number" && typeof lo === "number")
          latLngs.push([la, lo]);
      }
      if (latLngs.length >= 2)
        polylines.push({ latLngs, color: col, weight: 4 });
    }
    for (const s of r.stops || []) {
      if (typeof s.latitude !== "number" || typeof s.longitude !== "number")
        continue;
      if (
        haversineMiles(
          DATA_ROUTES_CITY_CENTER_LAT,
          DATA_ROUTES_CITY_CENTER_LON,
          s.latitude,
          s.longitude,
        ) > DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER
      )
        continue;
      points.push({
        lat: s.latitude,
        lng: s.longitude,
        label: typeof s.name === "string" ? s.name : s.stop_id || "Stop",
        address: rlabel,
        color: col,
      });
    }
  }
  return { points, polylines };
}

/**
 * DASH stop coordinates used for parking proximity (same points as the map layer).
 * @returns {Array<{ lat: number, lng: number }>}
 */
function getDashStopLatLngsForParkingProximity() {
  return getParkingDashMapData().points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
  }));
}

/** If there are no DASH stops (missing data), keep all parking so the map still loads. */
function isParkingWithinDashStopRadius(lat, lng, dashStops) {
  if (dashStops.length === 0) return true;
  const maxMi = PARKING_MAX_MILES_FROM_DASH_STOP;
  for (const s of dashStops) {
    if (haversineMiles(lat, lng, s.lat, s.lng) <= maxMi) return true;
  }
  return false;
}

function syncParkingDashRoutes(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  if (parkingDashLayerGroup) {
    try {
      map.removeLayer(parkingDashLayerGroup);
    } catch {
      /* ignore */
    }
    parkingDashLayerGroup = null;
  }

  const { points, polylines } = getParkingDashMapData();
  if (points.length === 0 && polylines.length === 0) return;

  parkingDashLayerGroup = L.layerGroup().addTo(map);
  const g = parkingDashLayerGroup;

  for (const pl of polylines) {
    const latLngs = pl.latLngs;
    if (!Array.isArray(latLngs) || latLngs.length < 2) continue;
    let color = pl.color;
    if (
      typeof color === "string" &&
      color.length === 6 &&
      /^[0-9A-Fa-f]+$/.test(color)
    )
      color = `#${color}`;
    if (typeof color !== "string" || !color.startsWith("#")) color = "#933145";
    L.polyline(latLngs, {
      color,
      weight: typeof pl.weight === "number" ? pl.weight : 4,
      opacity: 0.88,
    }).addTo(g);
  }

  for (const p of points) {
    const fill =
      typeof p.color === "string" && p.color.startsWith("#")
        ? p.color
        : "#933145";
    const m = L.circleMarker([p.lat, p.lng], {
      radius: 6,
      weight: 2,
      color: darkenCssHex(fill, 0.72),
      fillColor: fill,
      fillOpacity: 0.92,
    });
    let html = `<div style="font-size:12px"><strong>${escapeHtml(p.label)}</strong>`;
    if (p.address) html += `<br>${escapeHtml(p.address)}`;
    html += "</div>";
    m.bindPopup(html);
    m.addTo(g);
  }
}

function syncParkingSpots(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  if (parkingSpotsLayerGroup) {
    try {
      map.removeLayer(parkingSpotsLayerGroup);
    } catch {
      /* ignore */
    }
    parkingSpotsLayerGroup = null;
  }

  const spots = getAllParkingSpotMarkers();
  if (spots.length === 0) return;

  parkingSpotsLayerGroup = L.layerGroup().addTo(map);
  const g = parkingSpotsLayerGroup;

  for (const s of spots) {
    const style = circleStyleForParkingCategoryKey(s.categoryKey);
    const m = L.circleMarker([s.lat, s.lng], {
      radius: 5,
      weight: 1,
      ...style,
    });
    let html = `<div style="font-size:12px"><strong>${escapeHtml(s.name)}</strong><br><span style="color:#64748b">${escapeHtml(s.categoryName)}</span>`;
    if (s.price) html += `<br>${escapeHtml(s.price)}`;
    if (s.address) html += `<br>${escapeHtml(s.address)}`;
    html += "</div>";
    m.bindPopup(html);
    m.addTo(g);
  }
}

/** Dark gray map-pin icon for the selected destination (SVG, no asset fetch). */
function parkingDestinationMarkerIcon(L) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#27272a" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2zm0 16a5 5 0 110-10 5 5 0 010 10z"/></svg>';
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

function syncParkingDestinationMarker(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  if (parkingDestinationLayerGroup) {
    try {
      map.removeLayer(parkingDestinationLayerGroup);
    } catch {
      /* ignore */
    }
    parkingDestinationLayerGroup = null;
  }

  const ll = getParkingDestinationLatLng();
  if (!ll) return;

  const sel = document.getElementById("parkingDestinationSelect");
  const slug = sel?.value;
  const dest = appData?.destinations?.find((d) => d.slug === slug);
  const name = dest?.name || slug || "Destination";

  parkingDestinationLayerGroup = L.layerGroup().addTo(map);
  const g = parkingDestinationLayerGroup;
  const m = L.marker(ll, { icon: parkingDestinationMarkerIcon(L) });
  m.bindPopup(
    `<div style="font-size:12px"><strong>${escapeHtml(name)}</strong></div>`,
  );
  m.addTo(g);
}

/** Every destination venue + DASH stops/polylines — geographic extent we keep in frame. */
function collectParkingMapContextLatLngs() {
  const out = [];
  for (const d of appData?.destinations || []) {
    const loc = d?.location;
    if (
      typeof loc?.latitude === "number" &&
      Number.isFinite(loc.latitude) &&
      typeof loc?.longitude === "number" &&
      Number.isFinite(loc.longitude)
    ) {
      out.push([loc.latitude, loc.longitude]);
    }
  }
  const { points, polylines } = getParkingDashMapData();
  for (const p of points) {
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng))
      out.push([p.lat, p.lng]);
  }
  for (const pl of polylines) {
    for (const pair of pl.latLngs || []) {
      if (
        Array.isArray(pair) &&
        pair.length >= 2 &&
        Number.isFinite(pair[0]) &&
        Number.isFinite(pair[1])
      ) {
        out.push([pair[0], pair[1]]);
      }
    }
  }
  return out;
}

/**
 * Highest zoom that still fits all destinations and DASH in the map view (with
 * the same padding convention as fitBounds). Used to cap parking spot fits.
 */
function getParkingMapContextFitMaxZoom(map, L) {
  const pad = PARKING_MAP_FIT_PADDING;
  const padSum = L.point(pad[0] * 2, pad[1] * 2);
  const maxZ = typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19;

  const latlngs = collectParkingMapContextLatLngs();
  if (latlngs.length < 2) return Math.min(16, maxZ);

  const bounds = L.latLngBounds(latlngs);
  if (!bounds.isValid()) return Math.min(16, maxZ);

  try {
    return map.getBoundsZoom(bounds, false, padSum);
  } catch {
    return Math.min(16, maxZ);
  }
}

function fitParkingMapToAllContent(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  map.invalidateSize();

  const spots = getAllParkingSpotMarkers();
  const spotLatLngs = spots.map((s) => [s.lat, s.lng]);
  const destLl = getParkingDestinationLatLng();

  const contextMaxZoom = getParkingMapContextFitMaxZoom(map, L);
  const fitOpts = {
    padding: PARKING_MAP_FIT_PADDING,
    maxZoom: contextMaxZoom,
  };
  const cappedSetZoom = (latlng, z) =>
    map.setView(latlng, Math.min(z, contextMaxZoom));

  // Fit to parking pins only. Including the venue in `fitBounds` stretches the bbox
  // so much that turning categories off often leaves zoom unchanged.
  if (spotLatLngs.length > 1) {
    map.fitBounds(L.latLngBounds(spotLatLngs), fitOpts);
    return;
  }
  if (spotLatLngs.length === 1) {
    cappedSetZoom(spotLatLngs[0], 15);
    return;
  }
  if (destLl) {
    cappedSetZoom(destLl, 15);
    return;
  }

  const { points: dashPoints, polylines } = getParkingDashMapData();
  const dashBounds = [];
  for (const p of dashPoints) dashBounds.push([p.lat, p.lng]);
  for (const pl of polylines) {
    for (const pair of pl.latLngs || []) {
      if (Array.isArray(pair) && pair.length >= 2)
        dashBounds.push([pair[0], pair[1]]);
    }
  }
  if (dashBounds.length > 1) {
    map.fitBounds(L.latLngBounds(dashBounds), fitOpts);
  } else if (dashBounds.length === 1) {
    cappedSetZoom(dashBounds[0], 15);
  } else {
    cappedSetZoom(MODES_PAGE_EMPTY_MAP_CENTER, 13);
  }
}

function syncParkingMapOverlays(map) {
  syncParkingDashRoutes(map);
  syncParkingSpots(map);
  syncParkingDestinationMarker(map);
  fitParkingMapToAllContent(map);
}

export function hideParkingView() {
  const parkingView = document.getElementById("parkingView");
  if (parkingView) parkingView.classList.add("hidden");
  document.getElementById("parkingMapChrome")?.classList.add("hidden");
  document.querySelector("main")?.classList.remove("parking-map-active");
}

function ensureParkingMap() {
  const L = globalThis.L;
  if (!L) return null;
  const el = document.getElementById("parkingAppMap");
  if (!el) return null;

  if (parkingMap) {
    parkingMap.invalidateSize();
    globalThis.__parkingMapForTest = parkingMap;
    return parkingMap;
  }

  const [lat, lng] = MODES_PAGE_EMPTY_MAP_CENTER;
  parkingMap = L.map(el, { zoomControl: true, maxZoom: 19 }).setView(
    [lat, lng],
    13,
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(parkingMap);
  globalThis.__parkingMapForTest = parkingMap;
  return parkingMap;
}

export function renderParkingView() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  const modesView = document.getElementById("modesView");
  const parkingView = document.getElementById("parkingView");

  if (!appView || !dataView || !modesView || !parkingView) return;

  buildParkingDestinationSelect();
  buildParkingFilterBar();
  ensureParkingResetDelegation();
  document.getElementById("parkingMapChrome")?.classList.remove("hidden");

  appView.classList.add("hidden");
  dataView.classList.add("hidden");
  modesView.classList.add("hidden");
  parkingView.classList.remove("hidden");
  const mainEl = document.querySelector("main");
  mainEl?.classList.remove("data-view-active");
  mainEl?.classList.add("parking-map-active");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const map = ensureParkingMap();
      if (map) {
        map.invalidateSize();
        syncParkingMapOverlays(map);
      }
    });
  });
}
