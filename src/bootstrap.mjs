/**
 * App bootstrap: loads data, handles hash routing for #/visit, #/data, #/modes,
 * and legacy #/parking / #/planner redirects. Parking UI lives in `src/visit/visit.mjs`.
 */
import {
  appData,
  loadData,
  isDestinationHiddenFromPublicMaps,
  haversineMiles,
  roundCoord5,
  MODES_PAGE_EMPTY_MAP_CENTER,
  FALLBACK_DATA,
  PARKING_PRICE_NOT_LISTED_LABEL,
  getParkingDataViewOverrideSourceFields,
} from "./shared/data-loader.mjs";
import {
  compareParkingDataViewPointsForPaintOrder,
  hexToRgba,
  parkingDatasetSwatchHtml,
  styleForParkingDatasetKey,
} from "./shared/parking-map-marker-styles.mjs";
import {
  hideParkingView,
  isParkingRoute,
  parseTotalSpacesFromAvailability,
  prepareParkingShellVisibility,
  renderParkingView,
} from "./visit/visit.mjs";

// Convert time from HMM or HHMM (12-hour) to HH:MM (24-hour) from URL
// All times are PM since the dropdown only has 5pm-10pm
function timeFromUrl(urlTime) {
  // Handle formats like "830" (8:30 PM = 20:30) or "500" (5:00 PM = 17:00) or "1000" (10:00 PM = 22:00)
  if (urlTime.length === 3) {
    // Format: HMM (e.g., "830" = 8:30 PM = 20:30)
    const hour12 = parseInt(urlTime[0], 10);
    const minutes = urlTime.slice(1);
    // All times are PM (5pm-10pm range)
    const hour24 = hour12 + 12;
    return hour24.toString().padStart(2, "0") + ":" + minutes;
  } else if (urlTime.length === 4) {
    // Format: HHMM (e.g., "1000" = 10:00 PM = 22:00)
    // Handle both 12-hour format (10-12) and 24-hour format (17-22) for backwards compatibility
    const hourPart = parseInt(urlTime.slice(0, 2), 10);
    const minutes = urlTime.slice(2);
    let hour24;
    if (hourPart >= 17 && hourPart <= 22) {
      // Already in 24-hour format (for backwards compatibility)
      hour24 = hourPart;
    } else if (hourPart >= 10 && hourPart <= 12) {
      // 10pm-12pm in 12-hour format
      hour24 = hourPart === 12 ? 12 : hourPart + 12;
    } else {
      // 5-9 in 12-hour format (should use 3-digit format, but handle 2-digit here too)
      hour24 = hourPart + 12;
    }
    return hour24.toString().padStart(2, "0") + ":" + minutes;
  }
  return urlTime; // Fallback if already in HH:MM format
}

// Same symbols/labels as the visit page mode buttons (index.html)
const MODE_DISPLAY_LABELS = {
  drive: "🚗 Drive",
  rideshare: "🚕 Uber/Lyft",
  transit: "🚌 The Rapid",
  shuttle: "🚐 DASH",
  micromobility: "🛴 Lime",
  bike: "🚲 Bike",
};

/** Short explainer for #/modes (how the visit page uses each mode). */
const MODE_PAGE_DESCRIPTIONS = {
  drive:
    "You take your own car and park in a garage, surface lot, or at a meter. The visit page maps garages and lots near DASH stops and shows event-oriented pricing when venues publish it.",
  rideshare:
    "Uber or Lyft picks you up and drops you off near the venue. Enable this when you are open to paying for a direct ride—fares often run higher on event nights due to surge pricing.",
  transit:
    "The Rapid (bus) gets you to a stop near the destination; you walk the last part. On the visit page, links can open Google Maps to search for transit stops near the venue.",
  micromobility:
    "Shared Lime scooters and bikes for short trips downtown. Unlock with the Lime app. The map shows Lime parking areas from our data—use them to end a ride legally near where you are going.",
  shuttle:
    "The free DASH shuttle loops through downtown and connects many garages and streets to stops near venues. You usually walk from the nearest stop to the door.",
  bike: "You ride your own bicycle and park at a public rack. Pins are bike parking locations from OpenStreetMap near downtown Grand Rapids.",
};

/** Order of modes on #/modes (DASH before The Rapid). */
const MODES_PAGE_ORDER = [
  "drive",
  "rideshare",
  "shuttle",
  "transit",
  "micromobility",
  "bike",
];

const MODES_PAGE_EMPTY_MAP_ZOOM = 13;

/** Downtown Grand Rapids — matches scripts/fetch_bus_routes.py for #/data/routes stops. */
const DATA_ROUTES_CITY_CENTER_LAT = 42.96333;
const DATA_ROUTES_CITY_CENTER_LON = -85.66806;
const DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER = 1.5;

let validModes = null;

function modesPageOrderedList() {
  const base = Array.isArray(validModes)
    ? validModes
    : FALLBACK_DATA.validModes;
  return MODES_PAGE_ORDER.filter((m) => base.includes(m));
}

function migrateLegacyParkingRouteHash() {
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  const qIdx = raw.indexOf("?");
  const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  if (path !== "/parking" && path !== "/parking/") return;
  const query = qIdx >= 0 ? raw.slice(qIdx + 1) : "";
  const params = new URLSearchParams(query);
  const finish =
    params.get("finish") ||
    params.get("venue") ||
    params.get("destination") ||
    params.get("dest");
  for (const k of ["finish", "venue", "destination", "dest"]) params.delete(k);
  if (params.has("start") && !params.has("park")) {
    params.set("park", params.get("start"));
    params.delete("start");
  }
  const q = params.toString();
  const seg =
    finish && String(finish).trim() !== "" ? `/${String(finish).trim()}` : "";
  const next = q ? `/visit${seg}?${q}` : `/visit${seg}`;
  if (raw !== next) window.location.hash = next;
}

/** Rewrite `#/planner` and `#/planner/...` to `#/visit` (preserve slug and query). */
function migratePlannerRouteHash() {
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  const qIdx = raw.indexOf("?");
  const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const qs = qIdx >= 0 ? raw.slice(qIdx) : "";
  if (path === "/planner" || path === "/planner/") {
    const next = qs ? `/visit${qs}` : "/visit";
    if (raw !== next) window.location.hash = next;
    return;
  }
  if (path.startsWith("/planner/")) {
    const rest = path.slice("/planner".length);
    const next = "/visit" + rest + qs;
    if (raw !== next) window.location.hash = next;
  }
}

function isDataRoute() {
  const hash = window.location.hash.slice(1);
  return hash === "/data" || hash.startsWith("/data/");
}

function isModesRoute() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  return pathPart === "/modes" || pathPart === "/modes/";
}

function isKnownAppRoutePath(pathPart) {
  if (!pathPart || pathPart === "/") return false;
  return (
    pathPart === "/visit" ||
    pathPart === "/visit/" ||
    pathPart.startsWith("/visit/") ||
    pathPart === "/data" ||
    pathPart.startsWith("/data/") ||
    pathPart === "/modes" ||
    pathPart.startsWith("/modes/") ||
    pathPart === "/parking" ||
    pathPart === "/parking/"
  );
}

function normalizeUnknownHashRoute() {
  const raw = window.location.hash.slice(1);
  if (!raw) return;

  const qIdx = raw.indexOf("?");
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const query = qIdx >= 0 ? raw.slice(qIdx + 1) : "";

  if (isKnownAppRoutePath(pathPart)) return;

  if (!pathPart.startsWith("/") && raw.includes("=")) {
    window.location.hash = `#/visit?${raw}`;
    return;
  }

  const trimmedPath = pathPart.replace(/\/$/, "");
  if (/^\/[^/]+$/.test(trimmedPath)) {
    return;
  }

  window.location.hash = query ? `#/visit?${query}` : "#/visit";
}

/**
 * After `loadData()`, turn deferred `#/<destination-slug>` hashes into `#/visit/<slug>` (preserve query).
 * Unknown single-segment paths become `#/visit` (or `#/visit?<query>`).
 */
function rewriteDeferredDestinationHashIfNeeded() {
  if (
    !Array.isArray(appData?.destinations) ||
    appData.destinations.length === 0
  )
    return;
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  const qIdx = raw.indexOf("?");
  const pathPart = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).replace(/\/$/, "");
  const query = qIdx >= 0 ? raw.slice(qIdx) : "";
  if (!/^\/[^/]+$/.test(pathPart)) return;
  if (
    pathPart === "/visit" ||
    pathPart.startsWith("/visit/") ||
    pathPart === "/data" ||
    pathPart.startsWith("/data/") ||
    pathPart === "/modes" ||
    pathPart.startsWith("/modes/") ||
    pathPart === "/parking" ||
    pathPart.startsWith("/parking/")
  ) {
    return;
  }
  const slug = pathPart.slice(1);
  const list = Array.isArray(appData?.destinations) ? appData.destinations : [];
  const match = list.some((d) => d.slug === slug);
  const next =
    match && slug
      ? `#/visit/${slug}${query}`
      : query
        ? `#/visit${query}`
        : "#/visit";
  if (window.location.hash !== next) window.location.hash = next;
}

const MODES_PAGE_PARKING_KEYS = [
  "garages",
  "lots",
  "osmGarages",
  "osmLots",
  "meters",
  "racks",
  "micromobility",
];

let modesPageMaps = {};

/** Avoid Leaflet 1.9 throwing in `invalidateSize` when `_mapPane` is not ready yet. */
function safeInvalidateModesMapWhenReady(map) {
  if (!map || typeof map.whenReady !== "function") return;
  map.whenReady(() => {
    requestAnimationFrame(() => {
      try {
        const c = map.getContainer?.();
        if (c && !c.isConnected) return;
        map.invalidateSize();
      } catch {
        /* map removed or panes torn down */
      }
    });
  });
}

function disposeModesPageMapsMatching(predicate) {
  for (const id of Object.keys(modesPageMaps)) {
    if (!predicate(id)) continue;
    try {
      modesPageMaps[id].remove();
    } catch {
      /* ignore */
    }
    delete modesPageMaps[id];
  }
}

function disposeModesPageMaps() {
  disposeModesPageMapsMatching(() => true);
}

function parkingItemsToModesPagePoints(items, defaultLabel) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    const lat = item.location?.latitude;
    const lng = item.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    out.push({
      lat,
      lng,
      label: item.name || defaultLabel,
      address:
        typeof item.address === "string" && item.address.trim() !== ""
          ? item.address.trim()
          : "",
    });
  }
  return out;
}

function getParkingCategoryKeysForPlannerMode(mode) {
  const parking = appData?.parking;
  if (!parking?.modes) return [];
  return MODES_PAGE_PARKING_KEYS.filter((key) =>
    (parking.modes[key] || []).includes(mode),
  );
}

function destinationsToModesPagePoints() {
  const destinations = Array.isArray(appData?.destinations)
    ? appData.destinations
    : [];
  const out = [];
  for (const d of destinations) {
    if (isDestinationHiddenFromPublicMaps(d)) continue;
    const lat = d.latitude;
    const lng = d.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const name =
      typeof d.name === "string" && d.name.trim() !== ""
        ? d.name.trim()
        : "Venue";
    out.push({
      lat,
      lng,
      label: name,
      address: "",
    });
  }
  return out;
}

function getModesPageMapPoints(mode) {
  if (!appData) return [];
  if (mode === "rideshare") {
    return destinationsToModesPagePoints();
  }
  if (mode === "drive" || mode === "bike" || mode === "micromobility") {
    const keys = getParkingCategoryKeysForPlannerMode(mode);
    const points = [];
    for (const key of keys) {
      const catName = appData.parking?.categoryNames?.[key] || key;
      points.push(
        ...parkingItemsToModesPagePoints(appData.parking?.[key], catName),
      );
    }
    return points;
  }
  return [];
}

/**
 * Stops + polylines for modes-page maps (shuttle = DASH, transit = The Rapid).
 * Rapid/transit maps are stops-only (no route polylines); DASH shows lines + stops.
 * @returns {{ points: Array<{lat:number,lng:number,label:string,address:string}>, polylines: Array<{latLngs:number[][], color:string, weight?:number}> }}
 */
function getModesPageTransitMapData(mode) {
  const empty = { points: [], polylines: [] };
  if (mode !== "shuttle" && mode !== "transit") return empty;
  const bus = appData?.busRoutes;
  const dashList = Array.isArray(bus?.dash_routes) ? bus.dash_routes : [];
  const rapidList = Array.isArray(bus?.rapid_routes) ? bus.rapid_routes : [];
  const legacyList = Array.isArray(bus?.routes) ? bus.routes : [];
  let routes;
  let defaultLineColor;
  if (mode === "shuttle") {
    routes = dashList.length > 0 ? dashList : legacyList;
    defaultLineColor = "#933145";
  } else {
    routes = rapidList;
    defaultLineColor = "#2563eb";
  }
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
  const groupLabel = mode === "shuttle" ? "DASH" : "The Rapid";
  for (const r of routes) {
    const lineLabel = [r.route_short_name, r.route_long_name]
      .filter((x) => typeof x === "string" && x.trim() !== "")
      .join(" · ");
    const rlabel = [groupLabel, lineLabel]
      .filter((x) => typeof x === "string" && x.trim() !== "")
      .join(" · ");
    if (mode === "shuttle") {
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
      });
    }
  }
  return { points, polylines };
}

function renderModesPageMap(containerId, points, options) {
  const opts = options || {};
  const showEmptyViewport = opts.showEmptyViewport === true;
  const polylines = Array.isArray(opts.polylines) ? opts.polylines : [];
  const fitBoundsFromMarkersOnly = opts.fitBoundsFromMarkersOnly === true;
  const fitPad = Array.isArray(opts.fitBoundsPadding)
    ? opts.fitBoundsPadding
    : [20, 20];
  const fitMaxZ =
    typeof opts.fitMaxZoom === "number" && !Number.isNaN(opts.fitMaxZoom)
      ? opts.fitMaxZoom
      : 15;
  const pointList = Array.isArray(points) ? points : [];
  const container = document.getElementById(containerId);
  if (!container || typeof L === "undefined") return;
  if (!showEmptyViewport && pointList.length === 0 && polylines.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  if (modesPageMaps[containerId]) {
    try {
      modesPageMaps[containerId].remove();
    } catch {
      /* ignore */
    }
    delete modesPageMaps[containerId];
  }
  const map = L.map(containerId, {
    scrollWheelZoom: false,
    zoomControl: false,
    dragging: false,
  });
  modesPageMaps[containerId] = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  if (showEmptyViewport) {
    map.setView(MODES_PAGE_EMPTY_MAP_CENTER, MODES_PAGE_EMPTY_MAP_ZOOM);
    map._modesLastSetView = {
      center: MODES_PAGE_EMPTY_MAP_CENTER,
      zoom: MODES_PAGE_EMPTY_MAP_ZOOM,
    };
    delete map._modesLastFitLatLngs;
    delete map._modesLastFitOptions;
    safeInvalidateModesMapWhenReady(map);
    return;
  }
  const polyLayer = L.layerGroup().addTo(map);
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
    }).addTo(polyLayer);
  }
  const layer = L.layerGroup().addTo(map);
  for (const p of pointList) {
    const m = L.marker([p.lat, p.lng]);
    let html = `<div style="font-size:12px"><strong>${escapeHtml(p.label)}</strong>`;
    if (p.address) html += `<br>${escapeHtml(p.address)}`;
    html += "</div>";
    m.bindPopup(html);
    m.addTo(layer);
  }
  const boundsLatLngs = pointList.map((pt) => [pt.lat, pt.lng]);
  const useMarkersOnlyForFit =
    fitBoundsFromMarkersOnly === true && boundsLatLngs.length > 0;
  if (!useMarkersOnlyForFit) {
    for (const pl of polylines) {
      for (const pair of pl.latLngs || []) {
        if (Array.isArray(pair) && pair.length >= 2)
          boundsLatLngs.push([pair[0], pair[1]]);
      }
    }
  }
  const fitOpts = { padding: fitPad, maxZoom: fitMaxZ };
  if (boundsLatLngs.length === 1) {
    map.setView(boundsLatLngs[0], 15);
    map._modesLastSetView = { center: boundsLatLngs[0], zoom: 15 };
    delete map._modesLastFitLatLngs;
    delete map._modesLastFitOptions;
  } else if (boundsLatLngs.length > 1) {
    const latLngsCopy = boundsLatLngs.map((p) => [p[0], p[1]]);
    map.fitBounds(L.latLngBounds(latLngsCopy), fitOpts);
    map._modesLastFitLatLngs = latLngsCopy;
    map._modesLastFitOptions = fitOpts;
    delete map._modesLastSetView;
  } else if (polylines.length > 0) {
    const fb = [];
    for (const pl of polylines) {
      for (const pair of pl.latLngs || []) {
        if (Array.isArray(pair) && pair.length >= 2)
          fb.push([pair[0], pair[1]]);
      }
    }
    if (fb.length === 1) {
      map.setView(fb[0], 15);
      map._modesLastSetView = { center: fb[0], zoom: 15 };
      delete map._modesLastFitLatLngs;
      delete map._modesLastFitOptions;
    } else if (fb.length > 1) {
      const fbCopy = fb.map((p) => [p[0], p[1]]);
      map.fitBounds(L.latLngBounds(fbCopy), fitOpts);
      map._modesLastFitLatLngs = fbCopy;
      map._modesLastFitOptions = fitOpts;
      delete map._modesLastSetView;
    } else {
      map.setView(MODES_PAGE_EMPTY_MAP_CENTER, MODES_PAGE_EMPTY_MAP_ZOOM);
      map._modesLastSetView = {
        center: MODES_PAGE_EMPTY_MAP_CENTER,
        zoom: MODES_PAGE_EMPTY_MAP_ZOOM,
      };
      delete map._modesLastFitLatLngs;
      delete map._modesLastFitOptions;
    }
  } else {
    map.setView(MODES_PAGE_EMPTY_MAP_CENTER, MODES_PAGE_EMPTY_MAP_ZOOM);
    map._modesLastSetView = {
      center: MODES_PAGE_EMPTY_MAP_CENTER,
      zoom: MODES_PAGE_EMPTY_MAP_ZOOM,
    };
    delete map._modesLastFitLatLngs;
    delete map._modesLastFitOptions;
  }
  safeInvalidateModesMapWhenReady(map);
}

/** Re-apply view after layout (modal maps init while hidden had wrong size). */
function refitModesModalLeafletMaps() {
  for (const id of Object.keys(modesPageMaps)) {
    if (!id.startsWith("modes-modal-map-")) continue;
    const map = modesPageMaps[id];
    if (!map?.invalidateSize) continue;
    try {
      map.invalidateSize();
    } catch {
      continue;
    }
    if (map._modesLastFitLatLngs && map._modesLastFitLatLngs.length >= 2) {
      map.fitBounds(
        L.latLngBounds(map._modesLastFitLatLngs),
        map._modesLastFitOptions || { padding: [20, 20], maxZoom: 15 },
      );
    } else if (map._modesLastSetView) {
      const v = map._modesLastSetView;
      map.setView(v.center, v.zoom);
    }
  }
}

function hideModesView() {
  const modesView = document.getElementById("modesView");
  if (modesView) modesView.classList.add("hidden");
  disposeModesPageMaps();
}

/**
 * Renders mode explainers + maps into a container (#/modes or visit modal).
 * @param {HTMLElement} sectionsEl
 * @param {{ mapIdPrefix?: string, headingIdPrefix?: string, mapsFitAllBounds?: boolean }} [options]
 */
function renderModesPageInto(sectionsEl, options) {
  const mapIdPrefix = options?.mapIdPrefix ?? "modes-page-map-";
  const headingIdPrefix = options?.headingIdPrefix ?? "modes-section-";
  const mapsFitAllBounds = options?.mapsFitAllBounds === true;
  const sharedMapOpts = mapsFitAllBounds
    ? { fitBoundsPadding: [28, 28], fitMaxZoom: 14 }
    : {};
  if (!sectionsEl || !appData) return;

  const modes = modesPageOrderedList();
  const parts = [];
  for (const mode of modes) {
    const title = MODE_DISPLAY_LABELS[mode] || mode;
    const body =
      MODE_PAGE_DESCRIPTIONS[mode] ||
      "This option is available on the visit page when you select it in your travel modes.";
    const headingId = `${headingIdPrefix}${mode}-heading`;
    const mapId = `${mapIdPrefix}${mode}`;
    const transitMap =
      mode === "transit" || mode === "shuttle"
        ? getModesPageTransitMapData(mode)
        : null;
    const hasTransitMapData =
      transitMap &&
      (transitMap.points.length > 0 || transitMap.polylines.length > 0);
    const emptyDataNote =
      mode === "transit" || mode === "shuttle"
        ? hasTransitMapData
          ? ""
          : `<p class="text-xs text-slate-500 mt-2">Stop and route data are not loaded yet; map shows downtown Grand Rapids.</p>`
        : "";
    const mapBlock = `<div id="${mapId}" class="modes-page-map rounded-lg border border-slate-200 overflow-hidden z-0" role="img" aria-label="Map for ${escapeHtml(title)}"></div>${emptyDataNote}`;
    parts.push(
      `<section class="modes-page-section flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="${headingId}">` +
        `<h3 id="${headingId}" class="mb-2 font-medium text-base text-slate-900">${escapeHtml(title)}</h3>` +
        `<p class="mb-3 text-sm text-slate-600">${escapeHtml(body)}</p>` +
        mapBlock +
        `</section>`,
    );
  }
  sectionsEl.innerHTML = parts.join("");

  for (const mode of modes) {
    const mapId = `${mapIdPrefix}${mode}`;
    if (mode === "transit" || mode === "shuttle") {
      const td = getModesPageTransitMapData(mode);
      if (td.points.length > 0 || td.polylines.length > 0) {
        renderModesPageMap(mapId, td.points, {
          polylines: td.polylines,
          fitBoundsFromMarkersOnly: !mapsFitAllBounds,
          ...sharedMapOpts,
        });
      } else {
        renderModesPageMap(mapId, [], { showEmptyViewport: true });
      }
      continue;
    }
    const pts = getModesPageMapPoints(mode);
    renderModesPageMap(mapId, pts, sharedMapOpts);
  }
}

function openModesExplainModal() {
  const modal = document.getElementById("modesExplainModal");
  const sectionsEl = document.getElementById("modesExplainModalSections");
  if (!modal || !sectionsEl || !appData) return;

  disposeModesPageMapsMatching((id) => id.startsWith("modes-modal-map-"));

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modes-explain-modal-open");

  renderModesPageInto(sectionsEl, {
    mapIdPrefix: "modes-modal-map-",
    headingIdPrefix: "modes-modal-section-",
    mapsFitAllBounds: true,
  });

  requestAnimationFrame(() => {
    refitModesModalLeafletMaps();
    requestAnimationFrame(() => refitModesModalLeafletMaps());
  });

  document.getElementById("modesExplainModalClose")?.focus();
}

function closeModesExplainModal() {
  const modal = document.getElementById("modesExplainModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("modes-explain-modal-open");
  disposeModesPageMapsMatching((id) => id.startsWith("modes-modal-map-"));
  const sectionsEl = document.getElementById("modesExplainModalSections");
  if (sectionsEl) sectionsEl.innerHTML = "";
}

function renderModesView() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  const modesView = document.getElementById("modesView");
  const sectionsEl = document.getElementById("modesPageSections");
  const backLink = document.getElementById("modesPageBackLink");
  if (!appView || !dataView || !modesView || !sectionsEl || !appData) return;

  hideParkingView();
  disposeModesPageMaps();

  appView.classList.add("hidden");
  dataView.classList.add("hidden");
  modesView.classList.remove("hidden");
  document.querySelector("main")?.classList.add("data-view-active");

  if (backLink) {
    backLink.href = "#/visit";
  }

  renderModesPageInto(sectionsEl, {
    mapIdPrefix: "modes-page-map-",
    headingIdPrefix: "modes-section-",
  });
}

// Leaflet map for data view (parking with lat/long)
let dataMap = null;
let dataMapMarkersLayer = null;
let dataMapPolylinesLayer = null;

function openDataMapParkingPopupMatchingPin(pinRaw) {
  const pinId = pinRaw != null ? String(pinRaw).trim() : "";
  if (!pinId || !dataMap || !dataMapMarkersLayer) return;
  requestAnimationFrame(() => {
    let found = null;
    dataMapMarkersLayer.eachLayer((layer) => {
      if (layer._dataParkingPinId === pinId) found = layer;
    });
    if (found) {
      found.openPopup();
      try {
        dataMap.panTo(found.getLatLng());
      } catch {
        /* ignore */
      }
    }
  });
}

function getPointsFromData(data, path) {
  const points = [];
  if (!data) return points;
  if (path.startsWith("parking/") && Array.isArray(data)) {
    data.forEach((item) => {
      const lat = item.location?.latitude ?? item.latitude;
      const lng = item.location?.longitude ?? item.longitude;
      if (typeof lat === "number" && typeof lng === "number") {
        points.push({
          lat,
          lng,
          label: item.name || "Unnamed",
          address:
            typeof item.address === "string" && item.address.trim() !== ""
              ? item.address.trim()
              : "",
        });
      }
    });
  }
  return points;
}

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Eye icon — destinations shown on the visit map (`#/data/destinations` filter). */
function dataDestinationsVisibleIconSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>' +
    '<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>' +
    "</svg>"
  );
}

/** Eye-off — `hidden` destinations (visit map browse only when linked). */
function dataDestinationsHiddenOnlyIconSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path fill-rule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745A10.03 10.03 0 0019.542 10C17.857 5.865 14.183 3 10 3c-1.156 0-2.255.196-3.28.55L3.28 2.22zm2.602 2.602l1.977 1.977A3.998 3.998 0 006 10c0 2.21 1.79 4 4 4 1.37 0 2.58-.69 3.3-1.74l2.601 2.602A9.969 9.969 0 0110 17c-4.478 0-8.268-2.943-9.542-7a9.978 9.978 0 012.422-3.178zm4.118 4.118l2.002 2.002a2 2 0 01-2.002-2.002zM10 5.5c-.51 0-1 .09-1.45.25l3.2 3.2A2.5 2.5 0 0010 5.5z" clip-rule="evenodd"/>' +
    "</svg>"
  );
}

function setDataDestinationsViewButtonActive(btn, active) {
  if (!btn) return;
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  btn.classList.toggle("bg-sky-100", active);
  btn.classList.toggle("border-sky-500", active);
  btn.classList.toggle("border-slate-300", !active);
  if (!active) {
    btn.classList.add("bg-white", "text-slate-700", "hover:bg-slate-100");
    btn.classList.remove("text-slate-900", "hover:bg-sky-200");
  } else {
    btn.classList.remove("hover:bg-slate-100");
    btn.classList.add("text-slate-900", "hover:bg-sky-200");
  }
}

/** Display order for `#/data/parking` map popups — unknown keys sort after these. */
const DATA_VIEW_PARKING_PRICING_KEY_ORDER = [
  "events",
  "evening",
  "hourly",
  "daytime",
  "rate",
  "daily",
  "weekly",
  "monthly",
  "overnight",
  "weekend",
];

function dataViewParkingPricingKeyLabel(key) {
  if (typeof key !== "string" || !key.trim()) return "Price";
  const map = {
    events: "Events",
    evening: "Evening",
    hourly: "Hourly",
    daytime: "Daytime",
    rate: "Rate",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    overnight: "Overnight",
    weekend: "Weekend",
  };
  const k = key.trim();
  if (map[k]) return map[k];
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Rows for data-view parking popups: every non-empty `pricing` string (plus numeric
 * values coerced to string). Falls back to one "Cost" row (Free / Not listed).
 * @returns {{ label: string, value: string }[]}
 */
function getDataViewParkingPricingRows(pricing, categoryKey) {
  const privateOsm = categoryKey === "osmGarages" || categoryKey === "osmLots";
  const fallbackValue = privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return [{ label: "Cost", value: fallbackValue }];
  }
  /** @type {{ key: string, label: string, value: string }[]} */
  const entries = [];
  for (const [rawKey, rawVal] of Object.entries(pricing)) {
    if (rawKey == null) continue;
    const key = String(rawKey).trim();
    if (!key) continue;
    if (rawVal == null) continue;
    if (typeof rawVal === "object") continue;
    const value =
      typeof rawVal === "string"
        ? rawVal.trim()
        : typeof rawVal === "number" && Number.isFinite(rawVal)
          ? String(rawVal)
          : typeof rawVal === "boolean"
            ? rawVal
              ? "Yes"
              : "No"
            : "";
    if (!value) continue;
    entries.push({
      key,
      label: dataViewParkingPricingKeyLabel(key),
      value,
    });
  }
  if (entries.length === 0) {
    return [{ label: "Cost", value: fallbackValue }];
  }
  entries.sort((a, b) => {
    const ia = DATA_VIEW_PARKING_PRICING_KEY_ORDER.indexOf(a.key);
    const ib = DATA_VIEW_PARKING_PRICING_KEY_ORDER.indexOf(b.key);
    const aKnown = ia !== -1;
    const bKnown = ib !== -1;
    if (aKnown && bKnown) return ia - ib;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return a.key.localeCompare(b.key);
  });
  return entries.map(({ label, value }) => ({ label, value }));
}

function updateDataViewMap(points, options) {
  const opts = options || {};
  const extraPolylines = Array.isArray(opts.extraPolylines)
    ? opts.extraPolylines
    : [];
  let pointList = Array.isArray(points) ? points : [];
  const container = document.getElementById("dataViewMap");
  if (!container) return;
  if (pointList.length === 0 && extraPolylines.length === 0) {
    container.classList.add("hidden");
    if (dataMapPolylinesLayer) dataMapPolylinesLayer.clearLayers();
    if (dataMapMarkersLayer) dataMapMarkersLayer.clearLayers();
    return;
  }
  container.classList.remove("hidden");
  if (typeof L === "undefined") return;
  if (pointList.length > 0 && pointList.every((p) => p.parkingItem != null)) {
    pointList = [...pointList].sort(compareParkingDataViewPointsForPaintOrder);
  }
  let centerLat;
  let centerLng;
  if (pointList.length > 0) {
    centerLat = pointList[0].lat;
    centerLng = pointList[0].lng;
  } else {
    const first = extraPolylines[0]?.latLngs?.[0];
    if (Array.isArray(first) && first.length >= 2) {
      centerLat = first[0];
      centerLng = first[1];
    } else {
      centerLat = 42.96333;
      centerLng = -85.66806;
    }
  }
  if (!dataMap) {
    dataMap = L.map("dataViewMap").setView([centerLat, centerLng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(dataMap);
    dataMapPolylinesLayer = L.layerGroup().addTo(dataMap);
    dataMapMarkersLayer = L.layerGroup().addTo(dataMap);
  }
  dataMapPolylinesLayer.clearLayers();
  dataMapMarkersLayer.clearLayers();
  extraPolylines.forEach((pl) => {
    const latLngs = pl.latLngs;
    if (!Array.isArray(latLngs) || latLngs.length < 2) return;
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
      weight: typeof pl.weight === "number" ? pl.weight : 5,
      opacity: 0.88,
    }).addTo(dataMapPolylinesLayer);
  });
  const tableStyle =
    "border-collapse:collapse;font-size:12px;font-family:system-ui,sans-serif";
  const thStyle =
    "text-align:left;padding:4px 16px 4px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;vertical-align:top";
  const tdStyle =
    "padding:4px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top";
  pointList.forEach((p) => {
    const isStrategyStep =
      p.strategyTitle != null ||
      p.stepNumber != null ||
      p.stepMode != null ||
      (p.destinationName != null && p.slug == null);
    const isDestination = p.isDestination === true;
    const isParking = p.parkingItem != null;
    const parkingDotStyle =
      isParking && p.parkingDatasetKey
        ? styleForParkingDatasetKey(p.parkingDatasetKey)
        : null;
    const markerOptions = {
      draggable: isStrategyStep || isDestination || isParking,
    };
    if (parkingDotStyle) {
      const fill = hexToRgba(
        parkingDotStyle.fillColor,
        parkingDotStyle.fillOpacity,
      );
      markerOptions.icon = L.divIcon({
        className: "data-view-parking-dot-marker",
        html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:${fill};border:1px solid ${parkingDotStyle.color};box-sizing:border-box"></span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
    }
    const marker = L.marker([p.lat, p.lng], markerOptions);
    if (p.parkingDatasetKey) marker._parkingDatasetKey = p.parkingDatasetKey;
    if (isParking && p.parkingDatasetKey) {
      marker._dataParkingPinId =
        buildDataParkingVisitPinUrlId(p.parkingDatasetKey, p.lat, p.lng) || "";
    }
    if (isDestination) marker._originalLatLng = L.latLng(p.lat, p.lng);
    if (isStrategyStep || isParking)
      marker._originalLatLng = L.latLng(p.lat, p.lng);
    let popupContent = "";
    if (
      (p.categoryName != null || p.locationName != null || p.price != null) &&
      !isParking
    ) {
      const rows = [];
      if (p.categoryName != null && p.categoryName !== "")
        rows.push(
          `<tr><th style="${thStyle}">Category</th><td style="${tdStyle}">${escapeHtml(p.categoryName)}</td></tr>`,
        );
      if (p.locationName != null && p.locationName !== "")
        rows.push(
          `<tr><th style="${thStyle}">Name</th><td style="${tdStyle}">${escapeHtml(p.locationName)}</td></tr>`,
        );
      const tableAddress =
        (typeof p.address === "string" && p.address.trim()) ||
        (p.parkingItem &&
          typeof p.parkingItem.address === "string" &&
          p.parkingItem.address.trim()) ||
        "";
      if (tableAddress)
        rows.push(
          `<tr><th style="${thStyle}">Address</th><td style="${tdStyle}">${escapeHtml(tableAddress)}</td></tr>`,
        );
      if (p.price != null && p.price !== "")
        rows.push(
          `<tr><th style="${thStyle}">Price</th><td style="${tdStyle}">${escapeHtml(p.price)}</td></tr>`,
        );
      popupContent =
        rows.length > 0
          ? `<table style="${tableStyle}">${rows.join("")}</table>`
          : "";
    } else if (isParking) {
      const coordsJson = JSON.stringify(
        {
          latitude: roundCoord5(p.lat),
          longitude: roundCoord5(p.lng),
        },
        null,
        2,
      );
      const rows = [];
      const ovf = p.parkingOverrideFields;
      if (p.categoryName != null && p.categoryName !== "")
        rows.push(
          `<tr><th style="${thStyle}">Category</th><td style="${tdStyle}">${escapeHtml(p.categoryName)}</td></tr>`,
        );
      if (p.locationName != null && p.locationName !== "") {
        const nameTd =
          ovf?.name === true
            ? `<span style="color:#b91c1c">${escapeHtml(p.locationName)}</span>`
            : escapeHtml(p.locationName);
        rows.push(
          `<tr><th style="${thStyle}">Name</th><td style="${tdStyle}">${nameTd}</td></tr>`,
        );
      }
      const parkingAddress =
        p.parkingItem &&
        typeof p.parkingItem.address === "string" &&
        p.parkingItem.address.trim() !== ""
          ? p.parkingItem.address.trim()
          : "";
      if (parkingAddress)
        rows.push(
          `<tr><th style="${thStyle}">Address</th><td style="${tdStyle}">${escapeHtml(parkingAddress)}</td></tr>`,
        );
      const pricingRows = getDataViewParkingPricingRows(
        p.parkingItem?.pricing,
        p.parkingDatasetKey,
      );
      for (const pr of pricingRows) {
        const valueTd =
          ovf?.pricing === true
            ? `<span style="color:#b91c1c">${escapeHtml(pr.value)}</span>`
            : escapeHtml(pr.value);
        rows.push(
          `<tr><th style="${thStyle}">${escapeHtml(pr.label)}</th><td style="${tdStyle}">${valueTd}</td></tr>`,
        );
      }
      const totalSpaces = parseTotalSpacesFromAvailability(
        p.parkingItem?.availability,
      );
      const sizeText =
        typeof totalSpaces === "number" && Number.isFinite(totalSpaces)
          ? `${totalSpaces} total spaces`
          : "Not listed";
      rows.push(
        `<tr><th style="${thStyle}">Size</th><td style="${tdStyle}">${escapeHtml(sizeText)}</td></tr>`,
      );
      rows.push(
        `<tr><th style="${thStyle}">Coordinates</th><td style="${tdStyle}"><span class="data-view-popup-coords" style="font-family:ui-monospace,monospace;font-size:11px;white-space:pre;display:block;padding-top:4px">${escapeHtml(coordsJson)}</span><div class="mt-1 mb-1 text-right"><button type="button" class="data-view-copy-json hidden rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">Copy New JSON</button></div></td></tr>`,
      );
      const tableHtml = `<table style="${tableStyle}">${rows.join("")}</table>`;
      const div = document.createElement("div");
      div.innerHTML = tableHtml;
      const copyBtn = div.querySelector(".data-view-copy-json");
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          const ll = marker.getLatLng();
          const obj = {
            latitude: roundCoord5(ll.lat),
            longitude: roundCoord5(ll.lng),
          };
          const json = JSON.stringify(obj, null, 2);
          navigator.clipboard?.writeText(json).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy New JSON";
            }, 1500);
          });
        });
      }
      marker.on("dragend", function () {
        const ll = this.getLatLng();
        const content = this.getPopup().getContent();
        const coordsEl =
          content && content.querySelector
            ? content.querySelector(".data-view-popup-coords")
            : null;
        if (coordsEl) {
          coordsEl.textContent = JSON.stringify(
            {
              latitude: roundCoord5(ll.lat),
              longitude: roundCoord5(ll.lng),
            },
            null,
            2,
          );
        }
        const dsKey = this._parkingDatasetKey;
        const pop =
          typeof this.getPopup === "function" ? this.getPopup() : null;
        const popupOpen =
          pop && typeof pop.isOpen === "function" ? pop.isOpen() : false;
        if (dsKey && popupOpen) {
          const nextId = buildDataParkingVisitPinUrlId(dsKey, ll.lat, ll.lng);
          this._dataParkingPinId = nextId || "";
          if (nextId) replaceDataParkingHistoricalHash(nextId);
        }
        const orig = this._originalLatLng;
        if (orig && copyBtn) {
          const tol = 1e-6;
          const moved =
            Math.abs(ll.lat - orig.lat) > tol ||
            Math.abs(ll.lng - orig.lng) > tol;
          if (moved) {
            copyBtn.classList.remove("hidden");
            copyBtn.textContent = "Copy New JSON";
          } else {
            copyBtn.classList.add("hidden");
          }
        }
      });
      marker.on("popupopen", () => {
        const id = marker._dataParkingPinId;
        if (id) replaceDataParkingHistoricalHash(id);
      });
      marker.on("popupclose", () => {
        if (marker._dataParkingPinId) replaceDataParkingHistoricalHash(null);
      });
      marker.bindPopup(div);
    } else if (isStrategyStep) {
      const coordsJson = JSON.stringify(
        {
          latitude: roundCoord5(p.lat),
          longitude: roundCoord5(p.lng),
        },
        null,
        2,
      );
      const rows = [];
      if (p.stepNumber != null)
        rows.push(
          `<tr><th style="${thStyle}">Step</th><td style="${tdStyle}">${p.stepNumber}</td></tr>`,
        );
      if (p.strategyTitle != null && p.strategyTitle !== "")
        rows.push(
          `<tr><th style="${thStyle}">Strategy</th><td style="${tdStyle}">${escapeHtml(p.strategyTitle)}</td></tr>`,
        );
      if (p.stepMode != null && p.stepMode !== "") {
        const modeLabel = getModeLabel(p.stepMode);
        const displayMode =
          modeLabel && modeLabel.length > 0
            ? modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)
            : modeLabel;
        rows.push(
          `<tr><th style="${thStyle}">Mode</th><td style="${tdStyle}">${escapeHtml(displayMode)}</td></tr>`,
        );
      }
      if (p.cost != null && p.cost !== "")
        rows.push(
          `<tr><th style="${thStyle}">Cost</th><td style="${tdStyle}">${escapeHtml(p.cost)}</td></tr>`,
        );
      if (p.distance != null && p.distance !== "")
        rows.push(
          `<tr><th style="${thStyle}">Distance</th><td style="${tdStyle}">${escapeHtml(p.distance)}</td></tr>`,
        );
      rows.push(
        `<tr><th style="${thStyle}">Coordinates</th><td style="${tdStyle}"><span class="data-view-popup-coords" style="font-family:ui-monospace,monospace;font-size:11px;white-space:pre;display:block;padding-top:4px">${escapeHtml(coordsJson)}</span><div class="mt-1 mb-1 text-right"><button type="button" class="data-view-copy-json hidden rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">Copy New JSON</button></div></td></tr>`,
      );
      const tableHtml = `<table style="${tableStyle}">${rows.join("")}</table>`;
      const div = document.createElement("div");
      div.innerHTML = tableHtml;
      const copyBtn = div.querySelector(".data-view-copy-json");
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          const ll = marker.getLatLng();
          const json = JSON.stringify(
            {
              latitude: roundCoord5(ll.lat),
              longitude: roundCoord5(ll.lng),
            },
            null,
            2,
          );
          navigator.clipboard?.writeText(json).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy New JSON";
            }, 1500);
          });
        });
      }
      marker.on("dragend", function () {
        const ll = this.getLatLng();
        const content = this.getPopup().getContent();
        const coordsEl =
          content && content.querySelector
            ? content.querySelector(".data-view-popup-coords")
            : null;
        if (coordsEl) {
          coordsEl.textContent = JSON.stringify(
            {
              latitude: roundCoord5(ll.lat),
              longitude: roundCoord5(ll.lng),
            },
            null,
            2,
          );
        }
        const orig = this._originalLatLng;
        if (orig && copyBtn) {
          const tol = 1e-6;
          const moved =
            Math.abs(ll.lat - orig.lat) > tol ||
            Math.abs(ll.lng - orig.lng) > tol;
          if (moved) {
            copyBtn.classList.remove("hidden");
            copyBtn.textContent = "Copy New JSON";
          } else {
            copyBtn.classList.add("hidden");
          }
        }
      });
      marker.bindPopup(div);
    } else if (isDestination) {
      const coordsJson = JSON.stringify(
        {
          latitude: roundCoord5(p.lat),
          longitude: roundCoord5(p.lng),
        },
        null,
        2,
      );
      const rows = [];
      rows.push(
        `<tr><th style="${thStyle}">Name</th><td style="${tdStyle}">${escapeHtml(p.destinationName)}</td></tr>`,
      );
      if (p.slug != null && p.slug !== "")
        rows.push(
          `<tr><th style="${thStyle}">Slug</th><td style="${tdStyle}">${escapeHtml(p.slug)}</td></tr>`,
        );
      if (p.destinationHiddenFromPublicMaps === true)
        rows.push(
          `<tr><th style="${thStyle}">Visit map</th><td style="${tdStyle}">Hidden from the parking map browse UI until linked directly (e.g. <code class="text-xs">#/visit/${escapeHtml(String(p.slug))}</code>).</td></tr>`,
        );
      rows.push(
        `<tr><th style="${thStyle}">Coordinates</th><td style="${tdStyle}"><span class="data-view-popup-coords" style="font-family:ui-monospace,monospace;font-size:11px;white-space:pre;display:block;padding-top:4px">${escapeHtml(coordsJson)}</span><div class="mt-1 mb-1 text-right"><button type="button" class="data-view-copy-json hidden rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">Copy New JSON</button></div></td></tr>`,
      );
      const tableHtml = `<table style="${tableStyle}">${rows.join("")}</table>`;
      const div = document.createElement("div");
      div.innerHTML = tableHtml;
      const copyBtn = div.querySelector(".data-view-copy-json");
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          const ll = marker.getLatLng();
          const obj = {
            latitude: roundCoord5(ll.lat),
            longitude: roundCoord5(ll.lng),
          };
          const json = JSON.stringify(obj, null, 2);
          navigator.clipboard?.writeText(json).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy New JSON";
            }, 1500);
          });
        });
      }
      marker.on("dragend", function () {
        const ll = this.getLatLng();
        const content = this.getPopup().getContent();
        const coordsEl =
          content && content.querySelector
            ? content.querySelector(".data-view-popup-coords")
            : null;
        if (coordsEl) {
          coordsEl.textContent = JSON.stringify(
            {
              latitude: roundCoord5(ll.lat),
              longitude: roundCoord5(ll.lng),
            },
            null,
            2,
          );
        }
        const orig = this._originalLatLng;
        if (orig && copyBtn) {
          const tol = 1e-6;
          const moved =
            Math.abs(ll.lat - orig.lat) > tol ||
            Math.abs(ll.lng - orig.lng) > tol;
          if (moved) {
            copyBtn.classList.remove("hidden");
            copyBtn.textContent = "Copy New JSON";
          } else {
            copyBtn.classList.add("hidden");
          }
        }
      });
      marker.bindPopup(div);
    } else if (p.label) {
      const labelRows = [
        `<tr><th style="${thStyle}">Name</th><td style="${tdStyle}">${escapeHtml(p.label)}</td></tr>`,
      ];
      if (typeof p.address === "string" && p.address.trim() !== "") {
        labelRows.push(
          `<tr><th style="${thStyle}">Address</th><td style="${tdStyle}">${escapeHtml(p.address.trim())}</td></tr>`,
        );
      }
      popupContent = `<table style="${tableStyle}">${labelRows.join("")}</table>`;
    }
    if (popupContent && !isStrategyStep && !isDestination && !isParking)
      marker.bindPopup(popupContent);
    marker.addTo(dataMapMarkersLayer);
  });
  // Draw lines between consecutive strategy step points (same destination + strategy)
  const strategyGroups = [];
  let current = [];
  const groupKey = (p) =>
    `${p.destinationName ?? ""}\0${p.strategyTitle ?? ""}`;
  for (const p of pointList) {
    if (p.strategyTitle != null) {
      if (current.length > 0 && groupKey(current[0]) !== groupKey(p)) {
        strategyGroups.push(current);
        current = [];
      }
      current.push(p);
    } else {
      if (current.length > 0) {
        strategyGroups.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) strategyGroups.push(current);
  strategyGroups.forEach((group) => {
    if (group.length >= 2) {
      const latLngs = group.map((p) => [p.lat, p.lng]);
      L.polyline(latLngs, { color: "#2563eb", weight: 4 }).addTo(
        dataMapPolylinesLayer,
      );
    }
  });
  const boundsLatLngs = pointList.map((p) => [p.lat, p.lng]);
  const useMarkersOnlyForFit =
    opts.fitBoundsFromMarkersOnly === true && boundsLatLngs.length > 0;
  if (!useMarkersOnlyForFit) {
    extraPolylines.forEach((pl) => {
      (pl.latLngs || []).forEach((pair) => {
        if (Array.isArray(pair) && pair.length >= 2)
          boundsLatLngs.push([pair[0], pair[1]]);
      });
    });
  }
  if (boundsLatLngs.length === 1) {
    dataMap.setView(boundsLatLngs[0], 16);
  } else if (boundsLatLngs.length > 1) {
    const bounds = L.latLngBounds(boundsLatLngs);
    dataMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
  }
  try {
    dataMap.invalidateSize();
  } catch {
    /* ignore */
  }
}

// Path after /data/ (e.g. "parking", "parking/premium-ramps"). Returns "" for #/data. Strips query string.
function getDataRoutePath() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  if (pathPart === "/data") return "";
  if (!pathPart.startsWith("/data/")) return null;
  return pathPart.slice("/data/".length).replace(/\/$/, "");
}

function renderDataView() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  const dataViewIndex = document.getElementById("dataViewIndex");
  const dataViewDetail = document.getElementById("dataViewDetail");
  const dataViewDetailTitle = document.getElementById("dataViewDetailTitle");
  const dataViewContent = document.getElementById("dataViewContent");

  if (!appView || !dataView || !appData) return;

  const path = getDataRoutePath();
  if (path === null) return;

  if (path === "strategies" || path.startsWith("strategies/")) {
    window.location.hash = "#/data";
    return;
  }

  hideModesView();
  hideParkingView();

  appView.classList.add("hidden");
  dataView.classList.remove("hidden");
  document.querySelector("main")?.classList.add("data-view-active");

  const isIndex = path === "" || path === "parking";
  const hideDetail = isIndex || path === "destinations" || path === "routes";
  dataViewIndex.classList.toggle("hidden", !isIndex);
  dataViewDetail.classList.toggle("hidden", hideDetail);
  document.getElementById("dataViewParkingModes")?.classList.add("hidden");
  document.getElementById("dataViewDestinationsBar")?.classList.add("hidden");
  document.getElementById("dataViewRoutesModes")?.classList.add("hidden");
  document.getElementById("dataViewMap")?.classList.add("hidden");

  if (path === "") {
    // Index: list datasets with links
    const geoLinks = [
      { href: "#/data/destinations", label: "destinations" },
      { href: "#/data/parking", label: "parking" },
      { href: "#/data/routes", label: "routes" },
    ];
    dataViewIndex.innerHTML = geoLinks
      .map(
        (l) =>
          `<a href="${l.href}" class="block text-blue-600 hover:underline">${l.label}</a>`,
      )
      .join("");
    return;
  }

  if (path === "destinations") {
    const destinations = Array.isArray(appData.destinations)
      ? appData.destinations
      : [];
    const params = parseFragment();
    const viewRaw = params.view ? String(params.view).trim().toLowerCase() : "";
    const destViewMode =
      viewRaw === "hidden"
        ? "hidden"
        : viewRaw === "visible"
          ? "visible"
          : "all";

    function buildDataDestinationsHash(opts) {
      const q = [];
      if (opts.view === "visible") q.push("view=visible");
      if (opts.view === "hidden") q.push("view=hidden");
      return "#/data/destinations" + (q.length > 0 ? "?" + q.join("&") : "");
    }

    const dataViewDestinationsBar = document.getElementById(
      "dataViewDestinationsBar",
    );
    if (dataViewDestinationsBar) {
      dataViewDestinationsBar.classList.remove("hidden");
      const visiblePressed = destViewMode === "visible";
      const hiddenPressed = destViewMode === "hidden";
      dataViewDestinationsBar.innerHTML = `
        <a href="#/data" class="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Back to data" aria-label="Back to data">←</a>
        <div class="flex flex-1 flex-wrap items-center justify-center gap-2 min-w-0" role="group" aria-label="Destination visibility">
          <span class="text-sm font-medium text-slate-700">Destinations:</span>
          <button type="button" class="data-dest-view-btn inline-flex items-center gap-1.5 rounded-lg border py-2 px-3 text-sm font-medium transition-colors" data-dest-view="visible" aria-pressed="${visiblePressed ? "true" : "false"}" title="Show only venues on the visit map browse list (tap again for all)">${dataDestinationsVisibleIconSvg()}<span>Visible</span></button>
          <button type="button" class="data-dest-view-btn inline-flex items-center gap-1.5 rounded-lg border py-2 px-3 text-sm font-medium transition-colors" data-dest-view="hidden" aria-pressed="${hiddenPressed ? "true" : "false"}" title="Show only venues hidden from the visit map until linked (tap again for all)">${dataDestinationsHiddenOnlyIconSvg()}<span>Hidden</span></button>
        </div>
        <div class="flex items-center gap-2 shrink-0 md:min-w-[10.5rem]" aria-hidden="true"></div>`;
      const btnVisible = dataViewDestinationsBar.querySelector(
        '.data-dest-view-btn[data-dest-view="visible"]',
      );
      const btnHidden = dataViewDestinationsBar.querySelector(
        '.data-dest-view-btn[data-dest-view="hidden"]',
      );
      setDataDestinationsViewButtonActive(btnVisible, visiblePressed);
      setDataDestinationsViewButtonActive(btnHidden, hiddenPressed);
      btnVisible?.addEventListener("click", () => {
        const next = destViewMode === "visible" ? "all" : "visible";
        window.location.hash = buildDataDestinationsHash({ view: next });
      });
      btnHidden?.addEventListener("click", () => {
        const next = destViewMode === "hidden" ? "all" : "hidden";
        window.location.hash = buildDataDestinationsHash({ view: next });
      });
    }
    const destinationPoints = destinations
      .filter((d) => {
        if (destViewMode === "hidden")
          return isDestinationHiddenFromPublicMaps(d);
        if (destViewMode === "visible")
          return !isDestinationHiddenFromPublicMaps(d);
        return true;
      })
      .filter(
        (d) =>
          typeof d.latitude === "number" && typeof d.longitude === "number",
      )
      .map((d) => ({
        lat: d.latitude,
        lng: d.longitude,
        isDestination: true,
        destinationName: d.name || d.slug || "Destination",
        slug: d.slug,
        destinationHiddenFromPublicMaps: isDestinationHiddenFromPublicMaps(d),
      }));
    updateDataViewMap(destinationPoints);
    dataViewIndex.classList.add("hidden");
    dataViewDetail.classList.add("hidden");
    return;
  }

  if (path === "routes") {
    const ROUTES_DATA_MODES = ["shuttle", "transit"];
    const params = parseFragment();
    const modesParam = params.modes ? String(params.modes).trim() : "";
    const selectedModes =
      modesParam === ""
        ? []
        : modesParam
            .split(",")
            .map((m) => m.trim())
            .filter((m) => ROUTES_DATA_MODES.includes(m));

    function buildDataRoutesHash(opts) {
      const q = [];
      if (opts.modes && opts.modes.length > 0)
        q.push("modes=" + opts.modes.join(","));
      return "#/data/routes" + (q.length > 0 ? "?" + q.join("&") : "");
    }

    const dataViewRoutesModes = document.getElementById("dataViewRoutesModes");
    if (dataViewRoutesModes) {
      dataViewRoutesModes.classList.remove("hidden");
      const modeButtonsHtml = ROUTES_DATA_MODES.map(
        (mode) =>
          `<button type="button" class="data-routes-mode-btn rounded-lg border border-slate-300 py-2 px-3 text-sm font-medium transition-colors" data-mode="${escapeHtml(mode)}" title="${escapeHtml(MODE_DISPLAY_LABELS[mode] || mode)}">${MODE_DISPLAY_LABELS[mode] || mode}</button>`,
      ).join("");
      dataViewRoutesModes.innerHTML = `
        <a href="#/data" class="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Back to data" aria-label="Back to data">${"←"}</a>
        <div class="flex flex-1 flex-wrap items-center justify-center gap-2">
          <span class="text-sm font-medium text-slate-700">Route modes:</span>
          ${modeButtonsHtml}
        </div>
        <div class="flex items-center gap-2">
          <label for="data-routes-dataset" class="text-sm font-medium text-slate-700">Dataset:</label>
          <select id="data-routes-dataset" disabled class="data-routes-dataset-select cursor-default rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700" aria-label="Dataset (Public Bus Routes)"><option selected>Public Bus Routes</option></select>
        </div>`;
      ROUTES_DATA_MODES.forEach((mode) => {
        const btn = dataViewRoutesModes.querySelector(
          `.data-routes-mode-btn[data-mode="${mode}"]`,
        );
        if (btn) {
          const active = selectedModes.includes(mode);
          btn.classList.toggle("bg-sky-100", active);
          btn.classList.toggle("border-sky-500", active);
          btn.classList.toggle("border-slate-300", !active);
          if (!active) {
            btn.classList.add(
              "bg-white",
              "text-slate-700",
              "hover:bg-slate-100",
            );
          } else {
            btn.classList.remove("hover:bg-slate-100");
            btn.classList.add("text-slate-900", "hover:bg-sky-200");
          }
          btn.addEventListener("click", () => {
            const current = parseFragment();
            const currentModes =
              current.modes || ""
                ? String(current.modes)
                    .split(",")
                    .map((s) => s.trim())
                    .filter((m) => ROUTES_DATA_MODES.includes(m))
                : [];
            const idx = currentModes.indexOf(mode);
            const nextModes =
              idx >= 0
                ? currentModes.filter((_, i) => i !== idx)
                : [...currentModes, mode];
            window.location.hash = buildDataRoutesHash({ modes: nextModes });
          });
        }
      });
    }

    const bus = appData.busRoutes;
    const dashList = Array.isArray(bus?.dash_routes) ? bus.dash_routes : [];
    const rapidList = Array.isArray(bus?.rapid_routes) ? bus.rapid_routes : [];
    const legacyList = Array.isArray(bus?.routes) ? bus.routes : [];
    const showDash =
      selectedModes.length === 0 || selectedModes.includes("shuttle");
    const showRapid =
      selectedModes.length === 0 || selectedModes.includes("transit");
    const extraPolylines = [];
    const routePoints = [];
    const colorForRoute = (hex, fallbackHex) => {
      if (typeof hex === "string" && hex.trim() !== "") {
        const h = hex.trim();
        if (h.startsWith("#")) return h;
        if (/^[0-9A-Fa-f]{6}$/.test(h)) return `#${h}`;
      }
      return fallbackHex;
    };
    function addRoutesToMap(routes, groupLabel, defaultLineColor) {
      for (const r of routes) {
        const col = colorForRoute(r.route_color, defaultLineColor);
        const lineLabel = [r.route_short_name, r.route_long_name]
          .filter((x) => typeof x === "string" && x.trim() !== "")
          .join(" · ");
        const rlabel = [groupLabel, lineLabel]
          .filter((x) => typeof x === "string" && x.trim() !== "")
          .join(" · ");
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
            extraPolylines.push({ latLngs, color: col, weight: 4 });
        }
        for (const s of r.stops || []) {
          if (
            typeof s.latitude === "number" &&
            typeof s.longitude === "number"
          ) {
            if (
              haversineMiles(
                DATA_ROUTES_CITY_CENTER_LAT,
                DATA_ROUTES_CITY_CENTER_LON,
                s.latitude,
                s.longitude,
              ) > DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER
            )
              continue;
            routePoints.push({
              lat: s.latitude,
              lng: s.longitude,
              label: typeof s.name === "string" ? s.name : s.stop_id || "Stop",
              address: rlabel,
            });
          }
        }
      }
    }
    if (showDash) addRoutesToMap(dashList, "DASH", "#933145");
    if (showRapid) addRoutesToMap(rapidList, "The Rapid", "#2563eb");
    if (
      dashList.length === 0 &&
      rapidList.length === 0 &&
      legacyList.length > 0 &&
      showDash
    )
      addRoutesToMap(legacyList, "DASH", "#933145");
    updateDataViewMap(routePoints, {
      extraPolylines,
      fitBoundsFromMarkersOnly: true,
    });
    dataViewIndex.classList.add("hidden");
    dataViewDetail.classList.add("hidden");
    return;
  }

  if (path === "parking") {
    const parkingKeys = [
      { file: "garages", key: "garages" },
      { file: "lots", key: "lots" },
      { file: "osmGarages", key: "osmGarages" },
      { file: "osmLots", key: "osmLots" },
      { file: "meters", key: "meters" },
      { file: "racks", key: "racks" },
      { file: "micromobility", key: "micromobility" },
    ];
    const params = parseFragment();
    const datasetParam = params.dataset ? String(params.dataset).trim() : "";
    const categoryNames = appData.parking?.categoryNames || {};
    const selectedKey =
      datasetParam && parkingKeys.some((p) => p.key === datasetParam)
        ? datasetParam
        : "";

    // Modes that have parking data: drive, micromobility (Lime), bike. When none selected, show all.
    const PARKING_DATA_MODES = ["drive", "micromobility", "bike"];
    const modesParam = params.modes ? String(params.modes).trim() : "";
    const selectedModes =
      modesParam === ""
        ? []
        : modesParam
            .split(",")
            .map((m) => m.trim())
            .filter((m) => PARKING_DATA_MODES.includes(m));

    const qParamRaw = params.q != null ? String(params.q) : "";
    const qParamTrimmed = qParamRaw.trim();
    function dataParkingItemMatchesSearchQuery(item) {
      if (!qParamTrimmed) return true;
      const needle = qParamTrimmed.toLowerCase();
      const hay = [
        item?.name,
        item?.address,
        item?.dataOverrideNote,
        item?.note,
      ]
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => String(v).toLowerCase())
        .join(" ");
      return hay.includes(needle);
    }

    function buildDataParkingHash(opts) {
      const segments = [];
      if (opts.dataset)
        segments.push("dataset=" + encodeURIComponent(opts.dataset));
      if (opts.modes && opts.modes.length > 0)
        segments.push("modes=" + opts.modes.join(","));
      if (opts.q != null && String(opts.q).trim() !== "")
        segments.push("q=" + encodeURIComponent(String(opts.q).trim()));
      return (
        "#/data/parking" + (segments.length > 0 ? "?" + segments.join("&") : "")
      );
    }

    // Dataset dropdown options: when modes are selected, only show categories that match those modes.
    const keysForDropdown =
      selectedModes.length === 0
        ? parkingKeys
        : parkingKeys.filter((p) => {
            const categoryModes = appData.parking?.modes?.[p.key] || [];
            return categoryModes.some((m) => selectedModes.includes(m));
          });
    const effectiveKey = keysForDropdown.some((p) => p.key === selectedKey)
      ? selectedKey
      : "";

    const dataViewParkingModes = document.getElementById(
      "dataViewParkingModes",
    );
    if (dataViewParkingModes) {
      dataViewParkingModes.classList.remove("hidden");
      const allSwatchesMini = keysForDropdown
        .map((p) =>
          parkingDatasetSwatchHtml(
            styleForParkingDatasetKey(p.key),
            "h-2.5 w-2.5",
          ),
        )
        .join("");
      const triggerInner =
        effectiveKey === ""
          ? `<span class="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">${allSwatchesMini}</span><span class="min-w-0 truncate">All</span><span class="ml-1 shrink-0 text-slate-500" aria-hidden="true">▾</span>`
          : `${parkingDatasetSwatchHtml(styleForParkingDatasetKey(effectiveKey))}<span class="min-w-0 truncate">${escapeHtml(categoryNames[effectiveKey] || effectiveKey)}</span><span class="ml-1 shrink-0 text-slate-500" aria-hidden="true">▾</span>`;
      const menuRows = [
        `<button type="button" role="option" class="data-parking-dataset-option flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50${effectiveKey === "" ? " bg-slate-100" : ""}" data-dataset-value="" aria-selected="${effectiveKey === "" ? "true" : "false"}"><span class="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">${allSwatchesMini}</span><span>All</span></button>`,
        ...keysForDropdown.map((p) => {
          const label = categoryNames[p.key] || p.file;
          const sel = effectiveKey === p.key;
          return `<button type="button" role="option" class="data-parking-dataset-option flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50${sel ? " bg-slate-100" : ""}" data-dataset-value="${escapeHtml(p.key)}" aria-selected="${sel ? "true" : "false"}">${parkingDatasetSwatchHtml(styleForParkingDatasetKey(p.key))}<span class="min-w-0 truncate">${escapeHtml(label)}</span></button>`;
        }),
      ].join("");
      const modeButtonsHtml = PARKING_DATA_MODES.map(
        (mode) =>
          `<button type="button" class="data-parking-mode-btn rounded-lg border border-slate-300 py-2 px-3 text-sm font-medium transition-colors" data-mode="${escapeHtml(mode)}" title="${escapeHtml(MODE_DISPLAY_LABELS[mode] || mode)}">${MODE_DISPLAY_LABELS[mode] || mode}</button>`,
      ).join("");
      dataViewParkingModes.innerHTML = `
        <a href="#/data" class="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Back to data" aria-label="Back to data">${"←"}</a>
        <div class="flex-1 flex justify-center items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-slate-700">Parking Modes:</span>
          ${modeButtonsHtml}
        </div>
        <div class="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
          <label for="data-parking-dataset" class="text-sm font-medium text-slate-700 shrink-0">Dataset:</label>
          <div class="data-parking-dataset-dropdown relative min-w-[10rem] max-w-[min(100%,18rem)]">
            <button type="button" id="data-parking-dataset" class="data-parking-dataset-trigger flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50" aria-haspopup="listbox" aria-expanded="false">${triggerInner}</button>
            <div id="data-parking-dataset-panel" class="data-parking-dataset-panel absolute right-0 top-full z-[1000] mt-1 hidden max-h-[min(24rem,70vh)] w-max min-w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="listbox" aria-label="Parking dataset">${menuRows}</div>
          </div>
          <input type="search" id="data-parking-q-filter" class="min-w-[10rem] max-w-md flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:min-w-[12rem]" placeholder="Filter by name or address" autocomplete="off" aria-label="Filter parking by text" value="${escapeHtml(qParamTrimmed)}" />
        </div>`;
      PARKING_DATA_MODES.forEach((mode) => {
        const btn = dataViewParkingModes.querySelector(
          `.data-parking-mode-btn[data-mode="${mode}"]`,
        );
        if (btn) {
          const active = selectedModes.includes(mode);
          btn.classList.toggle("bg-sky-100", active);
          btn.classList.toggle("border-sky-500", active);
          btn.classList.toggle("border-slate-300", !active);
          if (!active) {
            btn.classList.add(
              "bg-white",
              "text-slate-700",
              "hover:bg-slate-100",
            );
          } else {
            btn.classList.remove("hover:bg-slate-100");
            btn.classList.add("text-slate-900", "hover:bg-sky-200");
          }
          btn.addEventListener("click", () => {
            const current = parseFragment();
            const modesStr =
              current.modes != null ? String(current.modes).trim() : "";
            const currentModes =
              modesStr === ""
                ? []
                : modesStr
                    .split(",")
                    .map((s) => s.trim())
                    .filter((m) => PARKING_DATA_MODES.includes(m));
            const idx = currentModes.indexOf(mode);
            const nextModes =
              idx >= 0
                ? currentModes.filter((_, i) => i !== idx)
                : [...currentModes, mode];
            const dsRaw =
              current.dataset != null ? String(current.dataset).trim() : "";
            window.location.hash = buildDataParkingHash({
              dataset: dsRaw !== "" ? dsRaw : undefined,
              modes: nextModes,
              q: current.q,
            });
          });
        }
      });
      const ddRoot = dataViewParkingModes.querySelector(
        ".data-parking-dataset-dropdown",
      );
      const dsTrigger = ddRoot?.querySelector("#data-parking-dataset");
      const dsPanel = ddRoot?.querySelector("#data-parking-dataset-panel");
      if (ddRoot && dsTrigger && dsPanel) {
        let outsideClose = null;
        const closeDatasetPanel = () => {
          dsPanel.classList.add("hidden");
          dsTrigger.setAttribute("aria-expanded", "false");
          if (outsideClose) {
            document.removeEventListener("click", outsideClose, true);
            outsideClose = null;
          }
        };
        const openDatasetPanel = () => {
          dsPanel.classList.remove("hidden");
          dsTrigger.setAttribute("aria-expanded", "true");
          requestAnimationFrame(() => {
            outsideClose = (ev) => {
              if (!ddRoot.contains(ev.target)) closeDatasetPanel();
            };
            document.addEventListener("click", outsideClose, true);
          });
        };
        dsTrigger.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (dsPanel.classList.contains("hidden")) openDatasetPanel();
          else closeDatasetPanel();
        });
        dsPanel
          .querySelectorAll(".data-parking-dataset-option")
          .forEach((btn) => {
            btn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              const raw = btn.getAttribute("data-dataset-value");
              const value = raw != null ? raw : "";
              closeDatasetPanel();
              const snap = parseFragment();
              const snapModesParam = snap.modes
                ? String(snap.modes).trim()
                : "";
              const snapModes =
                snapModesParam === ""
                  ? []
                  : snapModesParam
                      .split(",")
                      .map((s) => s.trim())
                      .filter((m) => PARKING_DATA_MODES.includes(m));
              window.location.hash = buildDataParkingHash({
                dataset: value || undefined,
                modes: snapModes,
                q: snap.q,
              });
            });
          });
      }
      const qInput = dataViewParkingModes.querySelector(
        "#data-parking-q-filter",
      );
      if (qInput) {
        qInput.addEventListener("change", () => {
          const snap = parseFragment();
          const snapModesParam = snap.modes ? String(snap.modes).trim() : "";
          const snapModes =
            snapModesParam === ""
              ? []
              : snapModesParam
                  .split(",")
                  .map((s) => s.trim())
                  .filter((m) => PARKING_DATA_MODES.includes(m));
          const ds =
            snap.dataset != null && String(snap.dataset).trim() !== ""
              ? String(snap.dataset).trim()
              : undefined;
          const v = qInput.value.trim();
          const next = buildDataParkingHash({
            dataset: ds,
            modes: snapModes,
            q: v || undefined,
          });
          if (window.location.hash !== next) window.location.hash = next;
        });
        qInput.addEventListener("input", () => {
          clearTimeout(qInput._dataParkingQDebounce);
          qInput._dataParkingQDebounce = setTimeout(() => {
            qInput.dispatchEvent(new Event("change", { bubbles: true }));
          }, 400);
        });
      }
    }

    const filteredKeys = effectiveKey
      ? keysForDropdown.filter((p) => p.key === effectiveKey)
      : keysForDropdown;

    const allParkingPoints = [];
    filteredKeys.forEach((p) => {
      const items = appData.parking?.[p.key];
      const categoryName = categoryNames[p.key] || p.file;
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (!dataParkingItemMatchesSearchQuery(item)) return;
          const lat = item.location?.latitude ?? item.latitude;
          const lng = item.location?.longitude ?? item.longitude;
          if (typeof lat === "number" && typeof lng === "number") {
            allParkingPoints.push({
              lat,
              lng,
              categoryName,
              locationName: item.name || "—",
              parkingItem: { ...item },
              parkingDatasetKey: p.key,
              parkingOverrideFields:
                getParkingDataViewOverrideSourceFields(item),
            });
          }
        });
      }
    });
    updateDataViewMap(allParkingPoints);
    openDataMapParkingPopupMatchingPin(params.pin);

    dataViewIndex.classList.add("hidden");
    dataViewDetail.classList.add("hidden");
    return;
  }

  // Detail: show one dataset
  let title = path;
  let data = null;

  if (path.startsWith("parking/")) {
    const fileKey = path.slice("parking/".length);
    const parkingKeys = {
      garages: "garages",
      lots: "lots",
      osmGarages: "osmGarages",
      osmLots: "osmLots",
      meters: "meters",
      racks: "racks",
      micromobility: "micromobility",
    };
    const categoryKey = parkingKeys[fileKey] || fileKey;
    const modeList =
      (appData.parking?.modes?.[categoryKey] || []).join(", ") || "—";
    title = `parking/${fileKey} (modes: ${modeList})`;
    data = appData.parking?.[categoryKey] ?? null;
  }

  dataViewDetailTitle.textContent = title;
  dataViewContent.textContent =
    data !== null ? JSON.stringify(data, null, 2) : "(empty or not found)";
  let points;
  if (path.startsWith("parking/") && Array.isArray(data)) {
    const fileKey = path.slice("parking/".length);
    const parkingKeys = {
      garages: "garages",
      lots: "lots",
      osmGarages: "osmGarages",
      osmLots: "osmLots",
      meters: "meters",
      racks: "racks",
      micromobility: "micromobility",
    };
    const categoryKey = parkingKeys[fileKey] || fileKey;
    const categoryName =
      appData.parking?.categoryNames?.[categoryKey] || fileKey;
    points = data
      .filter((item) => {
        const lat = item.location?.latitude ?? item.latitude;
        const lng = item.location?.longitude ?? item.longitude;
        return typeof lat === "number" && typeof lng === "number";
      })
      .map((item) => {
        const lat = item.location?.latitude ?? item.latitude;
        const lng = item.location?.longitude ?? item.longitude;
        return {
          lat,
          lng,
          categoryName,
          locationName: item.name || "—",
          parkingItem: { ...item },
          parkingDatasetKey: categoryKey,
          parkingOverrideFields: getParkingDataViewOverrideSourceFields(item),
        };
      });
  } else {
    points = getPointsFromData(data, path);
  }
  updateDataViewMap(points);
  if (path.startsWith("parking/")) {
    openDataMapParkingPopupMatchingPin(parseFragment().pin);
  }
}

function hideDataView() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  if (appView) appView.classList.remove("hidden");
  if (dataView) dataView.classList.add("hidden");
  document.querySelector("main")?.classList.remove("data-view-active");
}

// Parse URL fragment query (e.g. #/data/parking?modes=drive&dataset=garages)
function parseFragment() {
  const hash = window.location.hash.slice(1); // Remove the #
  if (!hash) return {};

  // Check if hash starts with a path (starts with /)
  let queryString = "";
  if (hash.startsWith("/")) {
    const questionMarkIndex = hash.indexOf("?");
    if (questionMarkIndex !== -1) {
      queryString = hash.slice(questionMarkIndex + 1);
    }
  } else {
    // Legacy format: just query params without path
    queryString = hash;
  }

  if (!queryString) return {};

  const params = {};
  queryString.split("&").forEach((param) => {
    const [key, ...valueParts] = param.split("=");
    const value = valueParts.length > 0 ? valueParts.join("=") : undefined;
    if (key && value !== undefined) {
      if (key === "time") {
        // Convert time from URL format (HHMM) to state format (HH:MM)
        params[key] = timeFromUrl(decodeURIComponent(value));
      } else if (key === "option") {
        // Comma-separated strategy indices (1-based): 1, 2, 3, ...
        params[key] = decodeURIComponent(value)
          .split(",")
          .map((s) => s.trim())
          .filter((id) => /^\d+$/.test(id));
      } else {
        params[key] = decodeURIComponent(value);
      }
    }
  });
  return params;
}

function replaceDataParkingHistoricalHash(nextPin) {
  const path = getDataRoutePath();
  if (path !== "parking" && !path.startsWith("parking/")) return;
  const f = parseFragment();
  const q = [];
  if (path === "parking") {
    if (f.dataset != null && String(f.dataset).trim() !== "")
      q.push(`dataset=${encodeURIComponent(String(f.dataset).trim())}`);
    if (f.modes != null && String(f.modes).trim() !== "")
      q.push(`modes=${encodeURIComponent(String(f.modes).trim())}`);
    if (f.q != null && String(f.q).trim() !== "")
      q.push(`q=${encodeURIComponent(String(f.q).trim())}`);
  } else if (f.modes != null && String(f.modes).trim() !== "") {
    q.push(`modes=${encodeURIComponent(String(f.modes).trim())}`);
  }
  const pinStr = nextPin != null ? String(nextPin).trim() : "";
  if (pinStr) q.push(`pin=${pinStr}`);
  const base = path === "parking" ? "#/data/parking" : "#/data/" + path;
  const next = base + (q.length ? "?" + q.join("&") : "");
  if (window.location.hash !== next) history.replaceState(null, "", next);
}

/** `appData.parking` key → `#/visit` `location=` / `park=` category id. */
const DATA_VIEW_PARKING_KEY_TO_VISIT_CATEGORY = {
  garages: "public-garage",
  lots: "public-lot",
  osmGarages: "private-garage",
  osmLots: "private-lot",
};

/** Same shape as `#/visit` `park=` / overrides: `private-garage:42.958306,-85.676288` (6 dp). */
function buildDataParkingVisitPinUrlId(datasetKey, lat, lng) {
  const visitCat =
    typeof datasetKey === "string"
      ? DATA_VIEW_PARKING_KEY_TO_VISIT_CATEGORY[datasetKey]
      : undefined;
  if (
    !visitCat ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return "";
  }
  return `${visitCat}:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function getModeLabel(mode) {
  return appData?.modeLabels[mode] || mode;
}

window.addEventListener("hashchange", () => {
  migrateLegacyParkingRouteHash();
  migratePlannerRouteHash();
  normalizeUnknownHashRoute();
  rewriteDeferredDestinationHashIfNeeded();
  if (isParkingRoute()) {
    hideModesView();
    hideDataView();
    renderParkingView();
    return;
  }
  hideParkingView();
  if (isDataRoute()) {
    renderDataView();
    return;
  }
  if (isModesRoute()) {
    renderModesView();
    return;
  }
  hideModesView();
  hideDataView();
});

async function init() {
  migrateLegacyParkingRouteHash();
  migratePlannerRouteHash();
  normalizeUnknownHashRoute();
  if (!window.location.hash.slice(1)) {
    window.location.hash = "#/visit";
  }
  if (isParkingRoute()) {
    prepareParkingShellVisibility();
  }
  await loadData();
  rewriteDeferredDestinationHashIfNeeded();
  if (isParkingRoute()) {
    prepareParkingShellVisibility();
  }
  validModes = appData.validModes;
  window.appData = appData;

  if (isDataRoute()) {
    renderDataView();
  } else if (isModesRoute()) {
    renderModesView();
  } else if (isParkingRoute()) {
    hideModesView();
    renderParkingView();
  } else {
    hideParkingView();
    hideModesView();
    hideDataView();
  }
}

const modesExplainModal = document.getElementById("modesExplainModal");
const openModesExplainModalBtn = document.getElementById(
  "openModesExplainModal",
);
if (openModesExplainModalBtn) {
  openModesExplainModalBtn.addEventListener("click", () => {
    openModesExplainModal();
  });
}
document
  .getElementById("modesExplainModalClose")
  ?.addEventListener("click", () => {
    closeModesExplainModal();
  });
if (modesExplainModal) {
  modesExplainModal.addEventListener("click", (e) => {
    if (e.target === modesExplainModal) closeModesExplainModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (modesExplainModal && !modesExplainModal.classList.contains("hidden")) {
    e.preventDefault();
    closeModesExplainModal();
  }
});

init();
