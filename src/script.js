// Load data from data/ folder (config, strategies, data/builtins.json mode narratives, parking).
let appData = null;

// Same icons/labels as the visit page mode buttons (index.html)
const MODE_DISPLAY_LABELS = {
  drive: "🚗 Drive",
  rideshare: "🚕 Uber/Lyft",
  transit: "🚌 The Rapid",
  shuttle: "🚐 DASH",
  micromobility: "🛴 Lime",
  bike: "🚲 Bike",
};

/** Short explainer for #/modes (what the planner uses each mode for). */
const MODE_PAGE_DESCRIPTIONS = {
  drive:
    "You take your own car and park in a garage, surface lot, or at a meter. The planner shows hand-crafted parking options when they fit your budget and walk distance, then suggests other nearby parking from our Grand Rapids dataset.",
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

/** Downtown Grand Rapids — empty maps use this until route/stop data exists. */
const MODES_PAGE_EMPTY_MAP_CENTER = [42.96333, -85.66806];
const MODES_PAGE_EMPTY_MAP_ZOOM = 13;

/** Same 1.75 mi from MODES_PAGE_EMPTY_MAP_CENTER as fetch_bike_parking.py, fetch_car_parking_osm.py, fetch_car_parking_arcgis.py (surface lots), etc. */
const DOWNTOWN_PARKING_MAX_MILES_FROM_CENTER = 1.75;

/** Downtown Grand Rapids — matches scripts/fetch_bus_routes.py for #/data/routes stops. */
const DATA_ROUTES_CITY_CENTER_LAT = 42.96333;
const DATA_ROUTES_CITY_CENTER_LON = -85.66806;
const DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER = 1.5;

function modesPageOrderedList() {
  const base = Array.isArray(validModes)
    ? validModes
    : FALLBACK_DATA.validModes;
  return MODES_PAGE_ORDER.filter((m) => base.includes(m));
}

const FALLBACK_DATA = {
  validModes: [
    "drive",
    "rideshare",
    "transit",
    "micromobility",
    "shuttle",
    "bike",
  ],
  modeLabels: {
    drive: "driving",
    rideshare: "Uber/Lyft",
    transit: "The Rapid",
    bike: "biking",
    micromobility: "Lime",
    walk: "walking",
    shuttle: "DASH",
  },
  costLabels: {
    drive: "Willing to pay",
    rideshare: "Willing to pay",
    transit: "Willing to pay",
    bike: "Willing to pay",
    micromobility: "Willing to pay",
    walk: "Willing to pay",
    shuttle: "Willing to pay",
  },
  defaults: {
    flexibilityEarlyMins: 15,
    flexibilityLateMins: 0,
    people: 1,
    walkMiles: 1.5,
    parkingMins: 10,
    costDollars: 40,
  },
  parkingPrivateUnknown: {
    lotAssumedDollars: 20,
    garageAssumedDollars: 30,
    cardCopy:
      "Typical cost is a planning estimate when no rate is listed—confirm posted prices before you park.",
  },
  destinations: [],
  recommendations: {},
  handCraftedRecommendations: {},
  linkTexts: {},
  parking: {},
  busRoutes: null,
};

/** Official rider app flows (download / open app on mobile). */
const UBER_APP_PAGE_URL = "https://m.uber.com/go/download";
const LYFT_APP_PAGE_URL = "https://lyft.com/app";
/** Consumer site for the Transit app (The Rapid + real-time). */
const TRANSIT_APP_PAGE_URL = "https://transitapp.com/";

/** The Rapid standard adult cash fare (one way); round trip = 2× for budgeting. */
const TRANSIT_STANDARD_ONE_WAY_FARE = 1.75;

function attachRideshareAppLinksToBuiltInRecommendations(recs) {
  const step0 = recs?.rideshare?.default?.steps?.[0];
  if (!step0 || (Array.isArray(step0.links) && step0.links.length > 0)) return;
  step0.links = [
    { href: UBER_APP_PAGE_URL, label: "Uber app →" },
    { href: LYFT_APP_PAGE_URL, label: "Lyft app →" },
  ];
}

async function loadData() {
  try {
    const [configRes, destinationsRes] = await Promise.all([
      fetch("data/config.json"),
      fetch("data/destinations.json"),
    ]);
    if (!configRes.ok) throw new Error("Failed to load config");
    const config = await configRes.json();
    const destinationsData = destinationsRes.ok
      ? await destinationsRes.json()
      : { destinations: [] };
    const rawDestinations = Array.isArray(destinationsData.destinations)
      ? destinationsData.destinations
      : [];
    const destinations = rawDestinations.map((d) => {
      const loc = d.location;
      const lat =
        typeof loc?.latitude === "number"
          ? loc.latitude
          : typeof d.latitude === "number"
            ? d.latitude
            : null;
      const lng =
        typeof loc?.longitude === "number"
          ? loc.longitude
          : typeof d.longitude === "number"
            ? d.longitude
            : null;
      return {
        ...d,
        latitude: lat != null ? roundCoord5(lat) : null,
        longitude: lng != null ? roundCoord5(lng) : null,
      };
    });

    const parkingCategories = [
      { file: "public/garages.json", key: "garages" },
      { file: "public/lots.json", key: "lots" },
      { file: "private/garages.json", key: "osmGarages" },
      { file: "private/lots.json", key: "osmLots" },
      { file: "public/meters.json", key: "meters" },
      { file: "public/racks.json", key: "racks" },
      { file: "private/micromobility.json", key: "micromobility" },
    ];
    const parkingResolves = await Promise.all(
      parkingCategories.map(({ file }) =>
        fetch(`data/parking/${file}`).then((r) => (r.ok ? r.json() : null)),
      ),
    );
    const parking = {
      garages: [],
      lots: [],
      osmGarages: [],
      osmLots: [],
      meters: [],
      racks: [],
      micromobility: [],
      notes: {},
      modes: {},
      categoryNames: {},
    };
    parkingCategories.forEach(({ key }, i) => {
      const data = parkingResolves[i];
      if (data?.items) {
        parking[key] = data.items;
        if (data.note) parking.notes[key] = data.note;
        if (data.modes) parking.modes[key] = data.modes;
        if (data.name) parking.categoryNames[key] = data.name;
      }
    });

    for (const osmKey of ["osmGarages", "osmLots"]) {
      const arr = parking[osmKey];
      if (!Array.isArray(arr) || !arr.length) continue;
      const [cLat, cLon] = MODES_PAGE_EMPTY_MAP_CENTER;
      parking[osmKey] = arr.filter((item) => {
        const loc = item?.location;
        if (
          !loc ||
          typeof loc.latitude !== "number" ||
          typeof loc.longitude !== "number"
        ) {
          return false;
        }
        return (
          haversineMiles(loc.latitude, loc.longitude, cLat, cLon) <=
          DOWNTOWN_PARKING_MAX_MILES_FROM_CENTER + 1e-9
        );
      });
    }

    const strategyPromises = destinations.map((d) =>
      fetch(`data/strategies/${d.slug}.json`).then((r) =>
        r.ok ? r.json().then((data) => ({ slug: d.slug, data })) : null,
      ),
    );
    const strategyResults = await Promise.all(strategyPromises);
    const handCraftedRecommendations = {};
    for (const result of strategyResults) {
      if (result) handCraftedRecommendations[result.slug] = result.data;
    }

    let builtInModeRecommendations = {};
    const builtInRes = await fetch("data/builtins.json");
    if (builtInRes.ok) {
      try {
        builtInModeRecommendations = structuredClone(await builtInRes.json());
      } catch {
        builtInModeRecommendations = {};
      }
    }
    attachRideshareAppLinksToBuiltInRecommendations(builtInModeRecommendations);

    const recommendations = {};
    for (const d of destinations) {
      recommendations[d.slug] = builtInModeRecommendations;
    }

    let busRoutes = null;
    const busRes = await fetch("data/bus/routes.json");
    if (busRes.ok) {
      try {
        busRoutes = await busRes.json();
      } catch {
        busRoutes = null;
      }
    }

    appData = {
      ...config,
      destinations,
      handCraftedRecommendations,
      recommendations,
      linkTexts: config.linkTexts || {},
      parking,
      busRoutes,
    };
  } catch (error) {
    console.error("Failed to load data:", error);
    appData = { ...FALLBACK_DATA };
  }
  if (typeof window !== "undefined") {
    window.ParkDashLot = {
      pickParkDashExampleLot,
      lotListingIncludesDash,
      collectDashStopsFromDashRoutes,
      getProcessedDriveShuttleRecommendation,
    };
    window.RapidTransit = {
      findBestRapidRouteStopForDestination,
      formatRapidRouteLabel,
    };
  }
}

// Calculate default time: current time + 2 hours, rounded to nearest half hour
// Minimum time is 5pm (17:00), maximum is 10pm (22:00)
function getDefaultTime() {
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  let hour = twoHoursLater.getHours();
  let minutes = twoHoursLater.getMinutes();
  // Round to nearest half hour
  if (minutes < 15) {
    minutes = 0;
  } else if (minutes < 45) {
    minutes = 30;
  } else {
    minutes = 0;
    hour = (hour + 1) % 24;
  }
  // Ensure time is between 5pm and 10pm
  if (hour < 17) {
    hour = 17;
    minutes = 0;
  } else if (hour > 22 || (hour === 22 && minutes > 0)) {
    hour = 22;
    minutes = 0;
  }
  return String(hour).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

// Generate time options for dropdown (half-hour increments, starting at 5pm, ending at 10pm)
function generateTimeOptions() {
  const timeSelect = document.getElementById("timeSelect");
  const options = ['<option value="" disabled>---</option>']; // Add empty default option (disabled to show lighter color)
  // Start at 5pm (17:00) and go through 10pm (22:00)
  for (let hour = 17; hour <= 22; hour++) {
    for (let minute of [0, 30]) {
      // Skip 10:30pm, only go up to 10:00pm
      if (hour === 22 && minute === 30) break;
      const timeValue =
        String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
      const timeDisplay = new Date(
        `2000-01-01T${timeValue}`,
      ).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      options.push(`<option value="${timeValue}">${timeDisplay}</option>`);
    }
  }
  timeSelect.innerHTML = options.join("");
}

let state = null;
let validModes = null;

/** Modes preselected when the URL omits `modes` (explicit `modes=` clears selection). */
function defaultVisitModes() {
  const preferred = ["drive", "rideshare", "shuttle"];
  if (!Array.isArray(validModes)) return [...preferred];
  return preferred.filter((m) => validModes.includes(m));
}

// Track if day/time/people/walk/pay have been changed from defaults
let dayChanged = false;
let timeChanged = false;
let peopleChanged = false;
let walkChanged = false;
let costChanged = false;

// Track which strategy steps are expanded by index (1, 2, 3, ...) for URL fragment (param: option)
let expandedStrategies = new Set();

// Convert time from HH:MM (24-hour) to HMM or HHMM (12-hour without colon) for URL
// Times are 5pm-10pm, so we use 12-hour format: 17:00 -> "500", 20:30 -> "830", 22:00 -> "1000"
function timeToUrl(time) {
  const [hours, minutes] = time.split(":");
  const hour24 = parseInt(hours, 10);
  // Convert to 12-hour format (all times are PM since range is 5pm-10pm)
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  // Return without leading zero for single-digit hours (e.g., 8:30 PM -> "830", 5:00 PM -> "500")
  return hour12.toString() + minutes;
}

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

// Get destination slug from display name (e.g. "Van Andel Arena" -> "van-andel-arena")
function getDestinationSlug(destinationName) {
  if (!appData || !destinationName) return "van-andel-arena";
  const destinations = appData.destinations;
  if (Array.isArray(destinations)) {
    const found = destinations.find(
      (d) => d.name === destinationName || d.slug === destinationName,
    );
    if (found) return found.slug;
  }
  return destinationName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Base path for the current destination (hash-based); no slug when no destination selected
function getDestinationPath() {
  if (!state || !state.destination || state.destination.trim() === "") {
    return "/visit";
  }
  return "/visit/" + getDestinationSlug(state.destination);
}

// Get destination name from hash path (e.g. #/visit/acrisure-amphitheater -> "Acrisure Amphitheater")
function getDestinationFromHashPath() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("/visit/")) return null;
  const pathPart =
    hash.indexOf("?") !== -1 ? hash.slice(0, hash.indexOf("?")) : hash;
  const slug = pathPart.slice("/visit/".length).replace(/\/$/, "");
  if (!slug) return null;
  const destinations = appData?.destinations;
  if (Array.isArray(destinations)) {
    const found = destinations.find((d) => d.slug === slug);
    if (found) return found.name;
  }
  return null;
}

// Data routes: #/data or #/data/<path> (e.g. #/data/parking, #/data/parking/premium-ramps)
function isDataRoute() {
  const hash = window.location.hash.slice(1);
  return hash === "/data" || hash.startsWith("/data/");
}

// Modes explainer: #/modes
function isModesRoute() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  return pathPart === "/modes" || pathPart === "/modes/";
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
    requestAnimationFrame(() => map.invalidateSize());
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
  requestAnimationFrame(() => map.invalidateSize());
}

/** Re-apply view after layout (modal maps init while hidden had wrong size). */
function refitModesModalLeafletMaps() {
  for (const id of Object.keys(modesPageMaps)) {
    if (!id.startsWith("modes-modal-map-")) continue;
    const map = modesPageMaps[id];
    if (!map?.invalidateSize) continue;
    map.invalidateSize();
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

  disposeModesPageMaps();

  appView.classList.add("hidden");
  dataView.classList.add("hidden");
  modesView.classList.remove("hidden");
  document.querySelector("main")?.classList.add("data-view-active");

  if (backLink) {
    backLink.href = "#" + getDestinationPath();
  }

  renderModesPageInto(sectionsEl, {
    mapIdPrefix: "modes-page-map-",
    headingIdPrefix: "modes-section-",
  });
}

// Leaflet map for data view (parking/strategies with lat/long)
let dataMap = null;
let dataMapMarkersLayer = null;
let dataMapPolylinesLayer = null;

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
  } else if (path.startsWith("strategies/") && Array.isArray(data)) {
    const slug = path.slice("strategies/".length);
    const destination = appData?.destinations?.find((d) => d.slug === slug);
    const destLat =
      typeof destination?.latitude === "number" ? destination.latitude : null;
    const destLng =
      typeof destination?.longitude === "number" ? destination.longitude : null;
    data.forEach((strategy) => {
      const steps = strategy.steps || [];
      steps.forEach((step, stepIndex) => {
        const loc = step.location;
        let lat = null;
        let lng = null;
        if (
          loc &&
          typeof loc.latitude === "number" &&
          typeof loc.longitude === "number"
        ) {
          lat = loc.latitude;
          lng = loc.longitude;
        } else if (destLat != null && destLng != null) {
          lat = destLat;
          lng = destLng;
        }
        if (lat != null && lng != null) {
          const cost = typeof step.cost === "number" ? `$${step.cost}` : null;
          const distance =
            typeof step.distance === "number"
              ? `${step.distance} mi`
              : step.distance != null
                ? String(step.distance)
                : null;
          points.push({
            lat,
            lng,
            strategyTitle: strategy.title || null,
            stepNumber: stepIndex + 1,
            stepMode: step.mode || null,
            cost,
            distance,
          });
        }
      });
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

function roundCoord5(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return n;
  return Math.round(n * 1e5) / 1e5;
}

function formatParkingPrice(pricing, categoryKey) {
  const privateOsm = categoryKey === "osmGarages" || categoryKey === "osmLots";
  if (!pricing || typeof pricing !== "object") {
    return privateOsm ? "Unknown" : "Free";
  }
  if (pricing.rate) return pricing.rate;
  if (pricing.evening) return pricing.evening;
  if (pricing.daytime) return pricing.daytime;
  if (pricing.events) return pricing.events;
  return privateOsm ? "Unknown" : "Free";
}

function updateDataViewMap(points, options) {
  const opts = options || {};
  const extraPolylines = Array.isArray(opts.extraPolylines)
    ? opts.extraPolylines
    : [];
  const pointList = Array.isArray(points) ? points : [];
  const container = document.getElementById("dataViewMap");
  if (!container) return;
  if (pointList.length === 0 && extraPolylines.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  if (typeof L === "undefined") return;
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
    const marker = L.marker([p.lat, p.lng], {
      draggable: isStrategyStep || isDestination || isParking,
    });
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
      if (p.categoryName != null && p.categoryName !== "")
        rows.push(
          `<tr><th style="${thStyle}">Category</th><td style="${tdStyle}">${escapeHtml(p.categoryName)}</td></tr>`,
        );
      if (p.locationName != null && p.locationName !== "")
        rows.push(
          `<tr><th style="${thStyle}">Name</th><td style="${tdStyle}">${escapeHtml(p.locationName)}</td></tr>`,
        );
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
      if (p.price != null && p.price !== "")
        rows.push(
          `<tr><th style="${thStyle}">Price</th><td style="${tdStyle}">${escapeHtml(p.price)}</td></tr>`,
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
  dataMap.invalidateSize();
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

  hideModesView();

  appView.classList.add("hidden");
  dataView.classList.remove("hidden");
  document.querySelector("main")?.classList.add("data-view-active");

  const isIndex = path === "" || path === "parking";
  const hideDetail =
    isIndex ||
    path === "strategies" ||
    path.startsWith("strategies/") ||
    path === "destinations" ||
    path === "routes";
  dataViewIndex.classList.toggle("hidden", !isIndex);
  dataViewDetail.classList.toggle("hidden", hideDetail);
  document.getElementById("dataViewParkingModes")?.classList.add("hidden");
  document.getElementById("dataViewStrategiesFilters")?.classList.add("hidden");
  document.getElementById("dataViewDestinationsBar")?.classList.add("hidden");
  document.getElementById("dataViewRoutesModes")?.classList.add("hidden");
  document.getElementById("dataViewMap")?.classList.add("hidden");

  if (path === "") {
    // Index: list datasets with links (visual break before strategies)
    const geoLinks = [
      { href: "#/data/destinations", label: "destinations" },
      { href: "#/data/parking", label: "parking" },
      { href: "#/data/routes", label: "routes" },
    ];
    const strategiesLink = { href: "#/data/strategies", label: "strategies" };
    dataViewIndex.innerHTML =
      geoLinks
        .map(
          (l) =>
            `<a href="${l.href}" class="block text-blue-600 hover:underline">${l.label}</a>`,
        )
        .join("") +
      `<div class="my-4 h-px bg-slate-200" role="separator" aria-hidden="true"></div>` +
      `<a href="${strategiesLink.href}" class="block text-blue-600 hover:underline">${strategiesLink.label}</a>`;
    return;
  }

  if (path === "destinations") {
    const destinations = Array.isArray(appData.destinations)
      ? appData.destinations
      : [];
    const dataViewDestinationsBar = document.getElementById(
      "dataViewDestinationsBar",
    );
    if (dataViewDestinationsBar) {
      dataViewDestinationsBar.classList.remove("hidden");
      dataViewDestinationsBar.innerHTML = `
        <a href="#/data" class="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Back to data" aria-label="Back to data">←</a>
        <span class="ml-auto text-sm font-medium text-slate-700">Destinations</span>`;
    }
    const destinationPoints = destinations
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

    function buildDataParkingHash(opts) {
      const q = [];
      if (opts.dataset) q.push("dataset=" + encodeURIComponent(opts.dataset));
      if (opts.modes && opts.modes.length > 0)
        q.push("modes=" + opts.modes.join(","));
      return "#/data/parking" + (q.length > 0 ? "?" + q.join("&") : "");
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
      const optionsHtml = [
        '<option value="">All</option>',
        ...keysForDropdown.map(
          (p) =>
            `<option value="${escapeHtml(p.key)}"${effectiveKey === p.key ? " selected" : ""}>${escapeHtml(categoryNames[p.key] || p.file)}</option>`,
        ),
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
        <div class="flex items-center gap-2">
          <label for="data-parking-dataset" class="text-sm font-medium text-slate-700">Dataset:</label>
          <select id="data-parking-dataset" class="data-parking-dataset-select rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">${optionsHtml}</select>
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
            const currentModes =
              current.modes || ""
                ? String(current.modes)
                    .split(",")
                    .map((s) => s.trim())
                    .filter((m) => PARKING_DATA_MODES.includes(m))
                : [];
            const idx = currentModes.indexOf(mode);
            const nextModes =
              idx >= 0
                ? currentModes.filter((_, i) => i !== idx)
                : [...currentModes, mode];
            window.location.hash = buildDataParkingHash({
              dataset: current.dataset || effectiveKey || undefined,
              modes: nextModes,
            });
          });
        }
      });
      dataViewParkingModes
        .querySelector(".data-parking-dataset-select")
        .addEventListener("change", (e) => {
          const value = e.target.value;
          window.location.hash = buildDataParkingHash({
            dataset: value || undefined,
            modes: selectedModes,
          });
        });
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
          const lat = item.location?.latitude ?? item.latitude;
          const lng = item.location?.longitude ?? item.longitude;
          if (typeof lat === "number" && typeof lng === "number") {
            allParkingPoints.push({
              lat,
              lng,
              categoryName,
              locationName: item.name || "—",
              price: formatParkingPrice(item.pricing, p.key),
              parkingItem: { ...item },
            });
          }
        });
      }
    });
    updateDataViewMap(allParkingPoints);

    dataViewIndex.classList.add("hidden");
    dataViewDetail.classList.add("hidden");
    return;
  }

  if (path === "strategies") {
    const destinations = Array.isArray(appData.destinations)
      ? appData.destinations
      : [];
    const params = parseFragment();
    const selectedSlugs = params.destinations
      ? params.destinations
          .split(",")
          .map((s) => s.trim())
          .filter((s) => destinations.some((d) => d.slug === s))
      : [];
    const showAll = selectedSlugs.length === 0;

    const dataViewStrategiesFilters = document.getElementById(
      "dataViewStrategiesFilters",
    );
    if (dataViewStrategiesFilters) {
      dataViewStrategiesFilters.classList.remove("hidden");
      const selectedValue =
        showAll || selectedSlugs.length !== 1 ? "" : selectedSlugs[0];
      const sortedDestinations = [...destinations].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, {
          sensitivity: "base",
        }),
      );
      const options = [
        { value: "", label: "All" },
        ...sortedDestinations.map((d) => ({ value: d.slug, label: d.name })),
      ];
      dataViewStrategiesFilters.innerHTML = `
        <a href="#/data" class="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Back to data" aria-label="Back to data">${"←"}</a>
        <div class="ml-auto flex items-center gap-2">
          <label for="dataStrategiesDestination" class="text-sm font-medium text-slate-700">Destination Strategies:</label>
          <select
            id="dataStrategiesDestination"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700"
          >
            ${options
              .map(
                (o) =>
                  `<option value="${escapeHtml(o.value)}"${o.value === selectedValue ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
              )
              .join("")}
          </select>
        </div>`;
      dataViewStrategiesFilters
        .querySelector("#dataStrategiesDestination")
        ?.addEventListener("change", (e) => {
          const value = e.target.value;
          window.location.hash =
            value === ""
              ? "#/data/strategies"
              : `#/data/strategies?destinations=${value}`;
        });
    }

    const slugsToShow =
      showAll || selectedSlugs.length !== 1
        ? destinations.map((d) => d.slug)
        : selectedSlugs;
    const allStrategyPoints = [];
    slugsToShow.forEach((slug) => {
      const data = appData.handCraftedRecommendations?.[slug] ?? null;
      const pts = getPointsFromData(data, "strategies/" + slug);
      const destinationName =
        destinations.find((d) => d.slug === slug)?.name || slug;
      pts.forEach((p) => allStrategyPoints.push({ ...p, destinationName }));
    });
    updateDataViewMap(allStrategyPoints);

    dataViewIndex.classList.add("hidden");
    dataViewDetail.classList.add("hidden");
    return;
  }

  if (path.startsWith("recommendations/")) {
    window.location.hash = "#/data";
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
  } else if (path.startsWith("strategies/")) {
    const slug = path.slice("strategies/".length);
    title = `strategies/${slug}.json`;
    data = appData.handCraftedRecommendations?.[slug] ?? null;
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
          price: formatParkingPrice(item.pricing, categoryKey),
          parkingItem: { ...item },
        };
      });
  } else {
    points = getPointsFromData(data, path);
  }
  updateDataViewMap(points);
}

function hideDataView() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  if (appView) appView.classList.remove("hidden");
  if (dataView) dataView.classList.add("hidden");
  document.querySelector("main")?.classList.remove("data-view-active");
}

// Parse URL fragment (format: #/visit/van-andel-arena?modes=drive,transit&day=monday&time=1800&people=2)
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

// Update URL fragment with current state
function updateFragment() {
  const parts = [];
  // Only include day/people in fragment if they've been changed by user
  if (dayChanged && state.day) {
    parts.push(`day=${encodeURIComponent(state.day)}`);
  }
  // Always include time in fragment if it's been selected
  if (state.time) {
    // Convert time to URL format without colon
    parts.push(`time=${timeToUrl(state.time)}`);
  }
  if (state.modes.length > 0) {
    parts.push(`modes=${state.modes.join(",")}`);
  }
  if (peopleChanged && state.people) {
    parts.push(`people=${encodeURIComponent(state.people)}`);
  }
  if (walkChanged && state.walkMiles !== undefined) {
    parts.push(`walk=${encodeURIComponent(state.walkMiles)}`);
  }
  if (costChanged && state.costDollars !== undefined) {
    parts.push(`pay=${encodeURIComponent(state.costDollars)}`);
  }
  if (expandedStrategies.size > 0) {
    const numericOptions = [...expandedStrategies].filter((id) =>
      /^\d+$/.test(String(id)),
    );
    if (numericOptions.length > 0) {
      parts.push(
        `option=${numericOptions.sort((a, b) => Number(a) - Number(b)).join(",")}`,
      );
    }
  }

  // Build hash with destination path and query params
  const queryString = parts.length > 0 ? `?${parts.join("&")}` : "";
  window.location.hash = getDestinationPath() + queryString;
}

// Update results whenever state changes
function updateResults() {
  renderResults();
  updateDirectionsLink();
}

// Get mode display name
function getModeLabel(mode) {
  return appData?.modeLabels[mode] || mode;
}

// Get cost label based on mode
function getCostLabel(mode) {
  return appData?.costLabels[mode] || "Willing to pay";
}

// Update preferences visibility based on mode
function updateDirectionsLink() {
  const directionsLink = document.getElementById("directionsLink");
  const directionsLinkText = document.getElementById("directionsLinkText");
  if (!directionsLink || !directionsLinkText) return;

  const destination = encodeURIComponent(
    state.destination + ", Grand Rapids, MI",
  );
  let linkUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  let linkText = "Get directions on Google Maps";

  // Update link based on primary mode
  const primaryMode = state.modes.length > 0 ? state.modes[0] : "drive";
  switch (primaryMode) {
    case "drive":
      // Link to parking near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=parking+near+${destination}`;
      linkText = "Find parking near destination";
      break;
    case "transit":
      // Link to transit stops near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=transit+stop+near+${destination}`;
      linkText = "Find transit stop near destination";
      break;
    case "micromobility":
      // Link to destination (Lime scooters can be found via app)
      linkText = "Get directions to destination";
      break;
    case "rideshare":
      // Link to destination (rideshare drop-off)
      linkText = "Get directions to destination";
      break;
    case "shuttle":
      // Link to DASH stops near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=DASH+shuttle+stop+near+${destination}`;
      linkText = "Find DASH stop near destination";
      break;
    case "bike":
      // Link to bike racks near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=bike+rack+near+${destination}`;
      linkText = "Find bike rack near destination";
      break;
    default:
      linkText = "Get directions on Google Maps";
  }

  directionsLink.href = linkUrl;
  directionsLinkText.textContent = linkText;
}

// Update reset modes button visibility based on whether preferences are selected
function updateResetModesButtonVisibility() {
  const resetModesBtn = document.getElementById("resetModesButton");
  if (!resetModesBtn) return;

  // Show button if modes are selected, or walk/cost have been changed
  const hasPreferences =
    (state.modes && state.modes.length > 0) || walkChanged || costChanged;

  if (hasPreferences) {
    resetModesBtn.classList.remove("hidden");
  } else {
    resetModesBtn.classList.add("hidden");
  }
}

function updatePreferencesVisibility() {
  const walkSlider = document.getElementById("walkSlider");
  const costSlider = document.getElementById("costSlider");
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  const costLabel = document.getElementById("costLabel");

  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  walkValue.textContent = state.walkMiles.toFixed(1);
  walkUnit.textContent = " miles";
  const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
  if (walkTimeValue) walkTimeValue.textContent = walkMinutes;
  if (walkTime) walkTime.style.display = "inline";

  // For transit and micromobility, show total cost (per-person * people), otherwise show per-person cost
  const displayCost =
    state.modes.includes("transit") || state.modes.includes("micromobility")
      ? state.costDollars * state.people
      : state.costDollars;
  costValue.textContent = Math.round(displayCost);
  costPrefix.textContent = "$";

  // Update cost label based on primary mode
  const primaryMode = state.modes.length > 0 ? state.modes[0] : "drive";
  costLabel.textContent = getCostLabel(primaryMode);

  // Sliders use the same gate as mode buttons (where/when complete), not selected mode
  const prefsEnabled = checkRequiredFields();
  if (walkSlider) walkSlider.disabled = !prefsEnabled;
  if (costSlider) costSlider.disabled = !prefsEnabled;
}

// Toggle mode selection (multi-select)
function toggleMode(mode) {
  if (!validModes.includes(mode)) return;
  if (!checkRequiredFields()) return; // Don't allow mode selection if required fields aren't set

  const index = state.modes.indexOf(mode);
  if (index > -1) {
    // Remove mode if already selected
    state.modes.splice(index, 1);
  } else {
    // Add mode if not selected
    state.modes.push(mode);
  }

  highlightMode();
  updatePreferencesVisibility();
  updateResetModesButtonVisibility();
  expandedStrategies.clear(); // Strategies refreshed; clear option fragment
  updateResults();
  updateFragment();
}

// Handle browser back/forward navigation
window.addEventListener("hashchange", () => {
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

  // Don't process hashchange if state isn't initialized yet (e.g., during page load)
  if (!state) return;

  const destFromHash = getDestinationFromHashPath();
  if (destFromHash !== null && destFromHash !== state.destination) {
    state.destination = destFromHash;
    const destinationSelect = document.getElementById("destinationSelect");
    if (destinationSelect) {
      destinationSelect.value = state.destination;
      destinationSelect.classList.remove("placeholder");
    }
  }

  const params = parseFragment();
  if (params.option !== undefined) {
    expandedStrategies = new Set(
      Array.isArray(params.option) ? params.option : [params.option],
    );
  }
  if (params.modes !== undefined) {
    const modesArray = params.modes
      ? params.modes.split(",").filter((m) => validModes.includes(m))
      : [];
    state.modes = modesArray;
    highlightMode();
    updatePreferencesVisibility();
  }
  if (params.day !== undefined && params.day !== state.day) {
    state.day = params.day || "";
    daySelect.value = state.day;
    // Update placeholder styling
    if (state.day) {
      daySelect.classList.remove("placeholder");
    } else {
      daySelect.classList.add("placeholder");
    }
    dayChanged = true;
  }
  if (params.time !== undefined && params.time !== state.time) {
    state.time = params.time || "";
    timeSelect.value = state.time;
    // Update placeholder styling
    if (state.time) {
      timeSelect.classList.remove("placeholder");
    } else {
      timeSelect.classList.add("placeholder");
    }
    timeChanged = true;
  }
  if (params.people !== undefined && params.people !== state.people) {
    const peopleValue = Number(params.people);
    // Clamp to valid range (1-6)
    const clampedValue = Math.max(1, Math.min(6, peopleValue));
    if (clampedValue >= 1 && clampedValue <= 6) {
      state.people = clampedValue;
      document.getElementById("peopleCount").textContent = state.people;
      peopleChanged = true;
    }
  }
  if (params.walk !== undefined) {
    const walkValue = Number(params.walk);
    if (!isNaN(walkValue) && walkValue >= 0 && walkValue !== state.walkMiles) {
      state.walkMiles = walkValue;
      walkChanged = true;
      if (walkSlider) walkSlider.value = walkValue;
      updatePreferencesVisibility();
    }
  }
  if (params.pay !== undefined) {
    const payValue = Number(params.pay);
    if (!isNaN(payValue) && payValue >= 0 && payValue !== state.costDollars) {
      state.costDollars = payValue;
      costChanged = true;
      if (costSlider) costSlider.value = payValue;
      updatePreferencesVisibility();
    }
  }
  // Hash-only navigations skip init(); sync section + sliders after all params (day/time may follow modes).
  updateModesSectionState();
  updateResults();
  updateMinimizeButtonState();
  // Don't update fragment here to avoid loop
});

function highlightMode() {
  document.querySelectorAll(".modeBtn").forEach((btn) => {
    const active = state.modes.includes(btn.dataset.mode);
    btn.classList.toggle("bg-sky-100", active);
    btn.classList.toggle("border-sky-500", active);
    btn.classList.toggle("border-slate-300", !active);
    // Update hover state based on active state (only if not disabled)
    if (!btn.disabled) {
      if (active) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-sky-200");
      } else {
        btn.classList.remove("hover:bg-sky-200");
        btn.classList.add("hover:bg-slate-100");
      }
    }
  });
}

function adjustPeople(delta) {
  state.people = Math.max(1, Math.min(6, state.people + delta));
  document.getElementById("peopleCount").textContent = state.people;
  peopleChanged = true;
  // Always update preferences visibility to refresh cost display (shows total for transit/micromobility)
  updatePreferencesVisibility();
  expandedStrategies.clear(); // Strategies refreshed; clear option fragment
  updateFragment();
  updateResults();
}

// Sliders
const walkSlider = document.getElementById("walkSlider");
const costSlider = document.getElementById("costSlider");

walkSlider.addEventListener("input", (e) => {
  state.walkMiles = Number(e.target.value);
  walkChanged = true;
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (!walkSlider.disabled) {
    walkValue.textContent = state.walkMiles.toFixed(1);
    walkUnit.textContent = " miles";
    // Calculate walking time (assuming 3 mph average walking speed)
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    if (walkTimeValue) walkTimeValue.textContent = walkMinutes;
    if (walkTime) walkTime.style.display = "inline";
  }
  updateResetModesButtonVisibility();
  expandedStrategies.clear(); // Strategies refreshed; clear option fragment
  updateFragment();
  updateResults();
});

costSlider.addEventListener("input", (e) => {
  state.costDollars = Number(e.target.value);
  costChanged = true;
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  if (!costSlider.disabled) {
    // For transit and micromobility, show total cost (per-person * people), otherwise show per-person cost
    const displayCost =
      state.modes.includes("transit") || state.modes.includes("micromobility")
        ? state.costDollars * state.people
        : state.costDollars;
    // Show as whole dollar amount
    costValue.textContent = Math.round(displayCost);
    costPrefix.textContent = "$";
  }
  updateResetModesButtonVisibility();
  expandedStrategies.clear(); // Strategies refreshed; clear option fragment
  updateFragment();
  updateResults();
});

// Day and Time inputs
const daySelect = document.getElementById("daySelect");
const timeSelect = document.getElementById("timeSelect");
const earlySlider = document.getElementById("earlySlider");
const lateSlider = document.getElementById("lateSlider");

// Check if all required fields are set (destination, day, time)
function checkRequiredFields() {
  const hasDestination = state.destination && state.destination.trim() !== "";
  const hasDay = state.day && state.day.trim() !== "";
  const hasTime = state.time && state.time.trim() !== "";
  return hasDestination && hasDay && hasTime;
}

// Enable/disable modes section based on required fields
function updateModesSectionState() {
  const preferencesSectionControls = document.getElementById(
    "preferencesSectionControls",
  );
  const modeButtons = document.querySelectorAll(".modeBtn");
  const isEnabled = checkRequiredFields();

  if (preferencesSectionControls) {
    if (isEnabled) {
      preferencesSectionControls.classList.remove("disabled");
    } else {
      preferencesSectionControls.classList.add("disabled");
    }
  }

  const resetModesBtn = document.getElementById("resetModesButton");
  if (resetModesBtn) {
    resetModesBtn.disabled = !isEnabled;
    resetModesBtn.classList.toggle("pointer-events-none", !isEnabled);
    resetModesBtn.classList.toggle("opacity-40", !isEnabled);
  }

  // Disable/enable mode buttons
  modeButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
    if (!isEnabled) {
      btn.classList.add("opacity-50", "cursor-not-allowed");
      btn.classList.remove("hover:bg-slate-100", "hover:bg-sky-200");
    } else {
      btn.classList.remove("opacity-50", "cursor-not-allowed");
      // Add appropriate hover state based on active state
      const isActive = state.modes.includes(btn.dataset.mode);
      if (isActive) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-sky-200");
      } else {
        btn.classList.remove("hover:bg-sky-200");
        btn.classList.add("hover:bg-slate-100");
      }
    }
  });

  updatePreferencesVisibility();
}

// Update reset button visibility based on required fields
function updateMinimizeButtonState() {
  const resetBtn = document.getElementById("resetButton");
  const minimizedEl = document.getElementById("whereWhenMinimized");
  // Only update if the card is not collapsed (minimized view is hidden)
  const cardExpanded = minimizedEl && minimizedEl.classList.contains("hidden");
  if (cardExpanded && resetBtn) {
    // Show when there is something to clear: destination, day/time, or user changed day/time
    const hasSomethingToClear =
      (state && (state.destination || state.day || state.time)) ||
      dayChanged ||
      timeChanged;
    if (hasSomethingToClear) {
      resetBtn.classList.remove("hidden");
    } else {
      resetBtn.classList.add("hidden");
    }
  }
}

if (daySelect) {
  daySelect.addEventListener("change", (e) => {
    if (!state) return; // Don't process if state isn't initialized yet
    state.day = e.target.value;
    dayChanged = true;
    // Update placeholder styling
    if (state.day) {
      daySelect.classList.remove("placeholder");
    } else {
      daySelect.classList.add("placeholder");
    }
    updateModesSectionState();
    updateMinimizeButtonState(); // Update minimize button state
    updateMinimizedView(); // Update minimized view if visible
    updateSaveButtonState();
    expandedStrategies.clear(); // Strategies refreshed; clear option fragment
    updateFragment();
    updateResults();
  });
}

if (timeSelect) {
  timeSelect.addEventListener("change", (e) => {
    if (!state) return; // Don't process if state isn't initialized yet
    state.time = e.target.value;
    timeChanged = true;
    // Update placeholder styling
    if (state.time) {
      timeSelect.classList.remove("placeholder");
    } else {
      timeSelect.classList.add("placeholder");
    }
    updateModesSectionState();
    updateMinimizeButtonState(); // Update minimize button state
    updateMinimizedView(); // Update minimized view if visible
    updateSaveButtonState();
    expandedStrategies.clear(); // Strategies refreshed; clear option fragment
    // Always add time to fragment when user selects it
    updateFragment();
    updateResults();
  });
}

// Update save button state based on required fields
function updateSaveButtonState() {
  const saveButton = document.getElementById("saveButton");
  if (!saveButton) return;

  const allFieldsFilled = checkRequiredFields();
  saveButton.disabled = !allFieldsFilled;
}

// Save button click handler
const saveButton = document.getElementById("saveButton");
if (saveButton) {
  saveButton.addEventListener("click", () => {
    if (!checkRequiredFields()) return;

    expandedStrategies.clear(); // Strategies refreshed; clear option fragment
    // Update fragment and results
    updateFragment();
    updateResults();

    // Collapse the card after saving
    minimizeWhereWhen();
  });
}

// Where/When toggle (minimize button)
const whereWhenContent = document.getElementById("whereWhenContent");
const whereWhenMinimized = document.getElementById("whereWhenMinimized");
const whereWhenExpand = document.getElementById("whereWhenExpand");

function updateMinimizedView() {
  const minimizedDestination = document.getElementById("minimizedDestination");
  const minimizedDay = document.getElementById("minimizedDay");
  const minimizedTime = document.getElementById("minimizedTime");

  if (minimizedDestination && state) {
    minimizedDestination.textContent = state.destination || "---";
  }

  if (minimizedDay && state) {
    // Format day display
    const dayLabels = {
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
      sunday: "Sunday",
    };
    minimizedDay.textContent = dayLabels[state.day] || state.day || "";
  }

  const minimizedTimeSeparator = document.getElementById(
    "minimizedTimeSeparator",
  );
  if (minimizedTime && state) {
    if (state.time) {
      // Format time display (convert 24-hour to 12-hour)
      const [hours, minutes] = state.time.split(":");
      const hour24 = parseInt(hours, 10);
      const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
      const ampm = hour24 >= 12 ? "PM" : "AM";
      minimizedTime.textContent = `${hour12}:${minutes} ${ampm}`;
      // Show separator when time is present
      if (minimizedTimeSeparator) {
        minimizedTimeSeparator.classList.remove("hidden");
      }
    } else {
      minimizedTime.textContent = "";
      // Hide separator when time is not present
      if (minimizedTimeSeparator) {
        minimizedTimeSeparator.classList.add("hidden");
      }
    }
  }
}

function minimizeWhereWhen() {
  // Only allow collapsing if all required fields are filled
  if (!checkRequiredFields()) {
    return;
  }
  updateMinimizedView();
  whereWhenContent.classList.add("hidden");
  whereWhenMinimized.classList.remove("hidden");
  // Hide reset button when card is collapsed
  const resetBtn = document.getElementById("resetButton");
  if (resetBtn) {
    resetBtn.classList.add("hidden");
  }
}

function expandWhereWhen() {
  whereWhenContent.classList.remove("hidden");
  whereWhenMinimized.classList.add("hidden");
  // Update reset button visibility when expanded
  updateMinimizeButtonState();
}

whereWhenExpand.addEventListener("click", expandWhereWhen);

// Flexibility toggle
const flexibilityToggle = document.getElementById("flexibilityToggle");
const flexibilityContent = document.getElementById("flexibilityContent");
const flexibilityArrow = document.getElementById("flexibilityArrow");

flexibilityToggle.addEventListener("click", () => {
  const isHidden = flexibilityContent.classList.toggle("hidden");
  flexibilityArrow.textContent = isHidden ? "▼" : "▲";
  // Change text color: gray when collapsed, black when expanded
  if (isHidden) {
    flexibilityToggle.classList.remove("text-slate-900");
    flexibilityToggle.classList.add("text-slate-500");
  } else {
    flexibilityToggle.classList.remove("text-slate-500");
    flexibilityToggle.classList.add("text-slate-900");
  }
});

// People toggle
const peopleToggle = document.getElementById("peopleToggle");
const peopleContent = document.getElementById("peopleContent");
const peopleArrow = document.getElementById("peopleArrow");

peopleToggle.addEventListener("click", () => {
  const isHidden = peopleContent.classList.toggle("hidden");
  peopleArrow.textContent = isHidden ? "▼" : "▲";
  // Change text color: gray when collapsed, black when expanded
  if (isHidden) {
    peopleToggle.classList.remove("text-slate-900");
    peopleToggle.classList.add("text-slate-500");
  } else {
    peopleToggle.classList.remove("text-slate-500");
    peopleToggle.classList.add("text-slate-900");
  }
});

earlySlider.addEventListener("input", (e) => {
  state.flexibilityEarlyMins = Number(e.target.value);
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  updateResults();
});

lateSlider.addEventListener("input", (e) => {
  state.flexibilityLateMins = Number(e.target.value);
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;
  updateResults();
});

// True if a hand-crafted recommendation fits the user's preferences (modes, cost, walk distance)
function handCraftedRecFits(rec) {
  if (!rec.steps || rec.steps.length < 2) return false;
  const modes = state.modes || [];
  const costDollars = state.costDollars ?? 0;
  const walkMiles = state.walkMiles ?? 0;

  // Every non-walk mode in steps must be in the user's selected modes
  const stepModes = [
    ...new Set(rec.steps.map((s) => s.mode).filter((m) => m !== "walk")),
  ];
  if (stepModes.length > 0 && !stepModes.every((m) => modes.includes(m)))
    return false;

  // Total cost of steps must be within budget.
  // Rideshare cost is "both ways", so user must be willing to pay at least 2× the step cost.
  const totalCost = rec.steps.reduce((sum, s) => {
    const stepCost = typeof s.cost === "number" ? s.cost : 0;
    return sum + (s.mode === "rideshare" ? stepCost * 2 : stepCost);
  }, 0);
  if (totalCost > costDollars) return false;

  // If the last step is walk with a distance, user must be willing to walk at least that far
  const lastStep = rec.steps[rec.steps.length - 1];
  if (
    lastStep.mode === "walk" &&
    lastStep.distance != null &&
    typeof lastStep.distance === "number"
  ) {
    if (walkMiles < lastStep.distance) return false;
  }
  return true;
}

const STEP_LINK_BUTTON_CLASS =
  "inline-block px-2.5 py-1 rounded border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors";

function recommendationStepLinkEntries(step) {
  const out = [];
  if (Array.isArray(step.links) && step.links.length > 0) {
    for (const entry of step.links) {
      const href = entry.href ?? entry.url;
      if (typeof href !== "string" || href.length === 0) continue;
      out.push({
        href,
        label:
          entry.label != null && String(entry.label).length > 0
            ? String(entry.label)
            : "Open →",
      });
    }
    return out;
  }
  if (step.link) {
    out.push({
      href: step.link,
      label: step.linkLabel ? String(step.linkLabel) : "View in maps →",
    });
  }
  return out;
}

function renderRecommendationStepLinkRowFromEntries(entries) {
  if (!entries || entries.length === 0) return "";
  const anchors = entries
    .map((e) => {
      if (!e || typeof e.href !== "string" || e.href.length === 0) return "";
      const label = e.label != null ? String(e.label) : "Open →";
      return `<a href="${escapeHtml(e.href)}" target="_blank" rel="noopener noreferrer" class="${STEP_LINK_BUTTON_CLASS}">${escapeHtml(label)}</a>`;
    })
    .filter(Boolean)
    .join("");
  if (!anchors) return "";
  return `<div class="mt-1 flex flex-wrap gap-2">${anchors}</div>`;
}

function renderRecommendationStepLinks(step) {
  return renderRecommendationStepLinkRowFromEntries(
    recommendationStepLinkEntries(step),
  );
}

/** Strategy cards only after destination, day, time, and at least one mode are set. */
function isVisitContextCompleteForStrategies() {
  if (!state) return false;
  const dest =
    typeof state.destination === "string" && state.destination.trim() !== "";
  return Boolean(
    dest &&
    state.day &&
    state.time &&
    Array.isArray(state.modes) &&
    state.modes.length > 0,
  );
}

function renderResults() {
  const resultsEl = document.getElementById("results");
  if (!resultsEl) return;
  resultsEl.innerHTML = "";

  if (!isVisitContextCompleteForStrategies()) {
    return;
  }

  const {
    primary,
    alternate,
    emptyRecommendationPool = false,
  } = buildRecommendation();

  // Build array of strategies so we can number them and support more than 2 later
  let strategies = [primary, alternate].filter(Boolean);
  const slug = getDestinationSlug(state.destination);
  const handCraftedAll = appData?.handCraftedRecommendations?.[slug] || [];
  const handCrafted = handCraftedAll.filter(handCraftedRecFits);
  const handCraftedTotalCost = (rec) =>
    (rec.steps || []).reduce(
      (sum, step) => sum + (typeof step.cost === "number" ? step.cost : 0),
      0,
    );
  handCrafted.sort((a, b) => handCraftedTotalCost(a) - handCraftedTotalCost(b));
  if (emptyRecommendationPool && handCrafted.length > 0) {
    strategies = [];
  }
  if (strategies.length === 0 && handCrafted.length === 0) {
    const ph = buildRecommendationPlaceholders();
    const emergency = processRecommendationData(
      { ...GENERIC_NO_SUGGESTIONS_FALLBACK_REC },
      ph,
    );
    if (emergency) strategies = [emergency];
  }
  if (strategies.length === 0 && handCrafted.length === 0) return;

  // Render hand-crafted recommendations first when they fit preferences.
  // Use unified 1-based option ids: hand-crafted = 1..n, then strategies = n+1..
  handCrafted.forEach((rec, hIndex) => {
    const cardId = `handcrafted-${hIndex}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
    const strategyId = String(hIndex + 1);
    const stepsId = `steps-${cardId}`;
    const toggleId = `toggle-${cardId}`;
    const stepsExpanded = expandedStrategies.has(strategyId);

    const formatCost = (c) =>
      c === 0 ? "$0" : typeof c === "number" ? `$${c}` : c;
    const formatLocation = (loc) =>
      loc &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number"
        ? `${roundCoord5(loc.latitude)}, ${roundCoord5(loc.longitude)}`
        : "—";
    const formatDistance = (d) =>
      d != null && typeof d === "number" ? `${d} mi` : "—";
    // Convert distance (miles) to approximate time (minutes) for display; schema keeps distance only
    const distanceToMinutes = (distanceMi, mode) => {
      if (distanceMi == null || typeof distanceMi !== "number") return null;
      const minPerMile = mode === "walk" ? 20 : 3; // walk ~3 mph, other ~20 mph
      const mins = Math.max(1, Math.round(distanceMi * minPerMile));
      return mins;
    };
    const formatTime = (mins) => (mins != null ? `${mins} min` : "—");

    // Build placeholders from steps for templating title/body (no extra prose in data)
    const placeholders = {};
    let totalCost = 0;
    (rec.steps || []).forEach((step, idx) => {
      const prefix = `step${idx}`;
      placeholders[`${prefix}_cost`] =
        typeof step.cost === "number" ? String(step.cost) : "";
      placeholders[`${prefix}_cost_formatted`] = formatCost(step.cost);
      placeholders[`${prefix}_distance`] =
        step.distance != null && typeof step.distance === "number"
          ? String(step.distance)
          : "—";
      placeholders[`${prefix}_distance_formatted`] = formatDistance(
        step.distance,
      );
      placeholders[`${prefix}_location`] = formatLocation(step.location);
      placeholders[`${prefix}_mode`] =
        appData?.handCraftedModeLabels?.[step.mode] ||
        getModeLabel(step.mode) ||
        step.mode ||
        "";
      if (typeof step.location?.latitude === "number")
        placeholders[`${prefix}_latitude`] = String(step.location.latitude);
      if (typeof step.location?.longitude === "number")
        placeholders[`${prefix}_longitude`] = String(step.location.longitude);
      if (typeof step.cost === "number") totalCost += step.cost;
    });
    placeholders.total_cost = String(totalCost);
    placeholders.total_cost_formatted =
      totalCost === 0 ? "$0" : `$${totalCost}`;

    const titleText = replacePlaceholders(rec.title || "", placeholders);
    const bodyText = replacePlaceholders(
      rec.body || rec.title || "",
      placeholders,
    );

    const mapLinkForLocation = (loc) =>
      loc &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number"
        ? googleMapsPinUrl(loc.latitude, loc.longitude)
        : null;

    const venueName = state.destination || "the venue";
    const stepDescription = (step, index, isLastWalk) => {
      if (isLastWalk) {
        const mins =
          typeof step.distance === "number"
            ? distanceToMinutes(step.distance, "walk")
            : null;
        const distStr = mins != null ? "about " + formatTime(mins) + " " : "";
        return `Walk ${distStr}to ${venueName}.`;
      }
      switch (step.mode) {
        case "drive":
          return "Park at the location shown on the map.";
        case "rideshare":
          return "Book a ride to the venue.";
        case "transit":
          return "Take transit to a stop near the venue.";
        case "micromobility":
          return "Ride to the venue or a nearby dock.";
        case "shuttle":
          return "Take the shuttle to the venue.";
        case "bike":
          return "Cycle to the venue or a nearby rack.";
        default:
          return "Continue to the venue.";
      }
    };

    const stepsToShow =
      rec.steps && rec.steps.length >= 2
        ? rec.steps.filter(
            (step) => !(step.mode === "walk" && step.distance === 0),
          )
        : [];
    const stepsHtml =
      stepsToShow.length >= 1
        ? stepsToShow
            .map((step, index) => {
              const isLastWalk =
                index === stepsToShow.length - 1 && step.mode === "walk";
              const modeLabel = isLastWalk
                ? "Walk to Destination"
                : appData?.handCraftedModeLabels?.[step.mode] ||
                  getModeLabel(step.mode) ||
                  step.mode;
              const mapHref = mapLinkForLocation(step.location);
              let description = stepDescription(step, index, isLastWalk);
              if (typeof step.cost === "number" && step.cost > 0) {
                const costSuffix =
                  step.mode === "rideshare" ? " both ways." : ".";
                description +=
                  " Expect to pay about " + formatCost(step.cost) + costSuffix;
              }
              if (
                typeof step.distance === "number" &&
                !(index === stepsToShow.length - 1 && step.mode === "walk")
              ) {
                const mins = distanceToMinutes(step.distance, step.mode);
                if (mins != null)
                  description += " About " + formatTime(mins) + ".";
              }
              const linkEntries = [];
              if (!isLastWalk && step.mode === "rideshare") {
                linkEntries.push(
                  { href: UBER_APP_PAGE_URL, label: "Uber app →" },
                  { href: LYFT_APP_PAGE_URL, label: "Lyft app →" },
                );
              }
              if (mapHref)
                linkEntries.push({ href: mapHref, label: "View in maps →" });
              const stepLinksHtml =
                renderRecommendationStepLinkRowFromEntries(linkEntries);
              return `
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center">${
                  index + 1
                }</span>
                <div class="flex-1 pt-0.5">
                  <div class="font-semibold text-sm text-slate-900">${modeLabel}</div>
                  <div class="text-sm text-slate-600 mt-1 leading-relaxed">${description}</div>
                  ${stepLinksHtml}
                </div>
              </li>
            `;
            })
            .join("")
        : "";

    const card = document.createElement("div");
    card.className =
      "rounded-none bg-blue-50 border border-blue-200 p-3 relative" +
      (hIndex > 0 ? " mt-2" : "");
    card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyId}. Ideal Strategy</div>
          <div class="pr-24">
            <h3 class="font-semibold text-base">${titleText}</h3>
          </div>
          <button type="button" id="${toggleId}" class="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-medium transition-colors" aria-label="Toggle steps">
            <span class="inline-block mr-1">${
              stepsExpanded ? "▲" : "▼"
            }</span>${stepsExpanded ? "Hide" : "Show"} steps
          </button>
          <p class="text-sm text-slate-600 mt-1">${bodyText}</p>
        </div>
        <div id="${stepsId}" class="${
          stepsExpanded ? "" : "hidden"
        } space-y-2 mt-2">
          <ol class="space-y-2">${stepsHtml}</ol>
        </div>
      </div>
    `;

    const toggleBtn = card.querySelector(`#${toggleId}`);
    const stepsDiv = card.querySelector(`#${stepsId}`);
    if (toggleBtn && stepsDiv) {
      toggleBtn.addEventListener("click", () => {
        const isHidden = stepsDiv.classList.toggle("hidden");
        if (isHidden) {
          expandedStrategies.delete(strategyId);
        } else {
          expandedStrategies.add(strategyId);
        }
        updateFragment();
        toggleBtn.innerHTML = isHidden
          ? '<span class="inline-block mr-1">▼</span>Show steps'
          : '<span class="inline-block mr-1">▲</span>Hide steps';
      });
    }
    resultsEl.appendChild(card);
  });

  strategies.forEach((recommendation, i) => {
    const strategyNumber = handCrafted.length + i + 1; // 1-based after hand-crafted
    const strategyId = String(strategyNumber); // for fragment (option=1,2,...)
    const isNoOptions = recommendation.isNoOptions;
    const isDiscouraged = recommendation.isDiscouraged;
    const cardId = `card-${i}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
    // Restore original headings with unique number: first = Recommended/Alternative/Unknown, rest = Alternate Strategy
    const strategyLabelBase =
      i === 0
        ? isNoOptions
          ? "Unknown Strategy"
          : isDiscouraged
            ? "Alternative Strategy"
            : "Recommended Strategy"
        : "Alternate Strategy";
    const strategyLabel = `${strategyNumber}. ${strategyLabelBase}`;

    const card = document.createElement("div");
    // First card uses primary styling; rest use alternate (yellow)
    const marginTop = i > 0 || handCrafted.length > 0 ? " mt-2" : "";
    if (i === 0) {
      card.className =
        (isNoOptions
          ? "rounded-none bg-red-50 border border-red-200 p-3 relative"
          : isDiscouraged
            ? "rounded-none bg-yellow-50 border border-yellow-200 p-3 relative"
            : "rounded-none bg-green-50 border border-green-200 p-3 relative") +
        marginTop;
    } else {
      card.className =
        "rounded-none bg-yellow-50 border border-yellow-200 p-3 mt-2 relative";
    }

    if (isNoOptions) {
      card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyLabel}</div>
          <h3 class="font-semibold text-base">${recommendation.title}</h3>
          <p class="text-sm text-slate-600 mt-1">${
            recommendation.body || recommendation.title
          }</p>
        </div>
      </div>
    `;
    } else if (recommendation.steps && recommendation.steps.length > 0) {
      const stepsId = `steps-${cardId}`;
      const toggleId = `toggle-${cardId}`;
      const stepsExpanded = expandedStrategies.has(strategyId);
      card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyLabel}</div>
          <div class="pr-24">
            <h3 class="font-semibold text-base">${recommendation.title}</h3>
          </div>
          <button type="button" id="${toggleId}" class="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-medium transition-colors" aria-label="Toggle steps">
            <span class="inline-block mr-1">${
              stepsExpanded ? "▲" : "▼"
            }</span>${stepsExpanded ? "Hide" : "Show"} steps
          </button>
          <p class="text-sm text-slate-600 mt-1">${
            recommendation.body || recommendation.title
          }</p>
        </div>
        <div id="${stepsId}" class="${
          stepsExpanded ? "" : "hidden"
        } space-y-2 mt-2">
          <ol class="space-y-2">
            ${recommendation.steps
              .map(
                (step, index) => `
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center">${
                  index + 1
                }</span>
                <div class="flex-1 pt-0.5">
                  <div class="font-semibold text-sm text-slate-900">${
                    step.title
                  }</div>
                  ${
                    step.description
                      ? `<div class="text-sm text-slate-600 mt-1 leading-relaxed">${step.description}</div>`
                      : ""
                  }
                  ${renderRecommendationStepLinks(step)}
                </div>
              </li>
            `,
              )
              .join("")}
          </ol>
        </div>
      </div>
    `;

      const toggleBtn = card.querySelector(`#${toggleId}`);
      const stepsDiv = card.querySelector(`#${stepsId}`);
      if (toggleBtn && stepsDiv) {
        toggleBtn.addEventListener("click", () => {
          const isHidden = stepsDiv.classList.toggle("hidden");
          if (isHidden) {
            expandedStrategies.delete(strategyId);
          } else {
            expandedStrategies.add(strategyId);
          }
          updateFragment();
          toggleBtn.innerHTML = isHidden
            ? '<span class="inline-block mr-1">▼</span>Show steps'
            : '<span class="inline-block mr-1">▲</span>Hide steps';
        });
      }
    } else {
      card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyLabel}</div>
          <h3 class="font-semibold text-base">${recommendation.title}</h3>
        </div>
        <div class="space-y-2">
          <div class="flex gap-2">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div class="flex-1 pt-0.5">
              <div class="font-semibold text-sm text-slate-900">${
                recommendation.instruction || recommendation.title
              }</div>
              <div class="text-sm text-slate-600 mt-1 leading-relaxed">${
                recommendation.body || recommendation.title
              }</div>
            </div>
          </div>
        </div>
        ${
          recommendation.meta
            ? `<div class="pt-2 border-t border-slate-200 text-sm text-slate-500">${recommendation.meta}</div>`
            : ""
        }
      </div>
    `;
    }

    resultsEl.appendChild(card);
  });
}

// Check if parking meters are enforced based on day and time
// Grand Rapids parking meters are enforced Monday-Friday 8am-7pm
// Free after 7pm on weekdays and all day on weekends
function isParkingEnforced(day, time) {
  if (!day || !time) return true; // Default to enforced if day/time not set

  // Parse time (HH:MM format)
  const [hours, minutes] = time.split(":").map(Number);
  const hour24 = hours;

  // Check if it's a weekend
  const weekendDays = ["saturday", "sunday"];
  if (weekendDays.includes(day.toLowerCase())) {
    return false; // No enforcement on weekends
  }

  // Check if it's a weekday
  const weekdayDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (weekdayDays.includes(day.toLowerCase())) {
    // Enforcement is 8am-7pm on weekdays
    // If time is before 8am or at/after 7pm, no enforcement
    if (hour24 < 8 || hour24 >= 19) {
      return false;
    }
    return true;
  }

  // If day is not recognized, default to enforced
  return true;
}

// Calculate the minimum cost required for metered parking based on arrival time and enforcement
// Returns the minimum cost needed, or 0 if parking is not enforced
function calculateRequiredMeteredParkingCost(day, time) {
  if (!day || !time) return 0;

  const parkingEnforced = isParkingEnforced(day, time);
  if (!parkingEnforced) {
    return 0; // No cost if parking is not enforced
  }

  // Parse time (HH:MM format)
  const [hours, minutes] = time.split(":").map(Number);
  const hour24 = hours;
  const minute24 = minutes;

  // Check if it's a weekday
  const weekdayDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (weekdayDays.includes(day.toLowerCase())) {
    // Enforcement ends at 7pm (19:00)
    const enforcementEndHour = 19;
    const enforcementEndMinute = 0;

    // Calculate hours and minutes until enforcement ends
    let hoursUntilEnd = enforcementEndHour - hour24;
    let minutesUntilEnd = enforcementEndMinute - minute24;

    // Handle minute overflow
    if (minutesUntilEnd < 0) {
      minutesUntilEnd += 60;
      hoursUntilEnd -= 1;
    }

    // Calculate total minutes until enforcement ends
    const totalMinutesUntilEnd = hoursUntilEnd * 60 + minutesUntilEnd;

    // If already past enforcement end, no cost
    if (totalMinutesUntilEnd <= 0) {
      return 0;
    }

    // Metered parking costs $1.25-$2.00 per half hour in prime areas
    // Use the higher rate ($2.00 per half hour = $4.00 per hour) to ensure budget is sufficient
    const hourlyRate = 4.0; // $4.00 per hour (worst case)
    const halfHourRate = 2.0; // $2.00 per half hour

    // Calculate cost: round up to nearest half hour
    const halfHoursNeeded = Math.ceil(totalMinutesUntilEnd / 30);
    const requiredCost = halfHoursNeeded * halfHourRate;

    return requiredCost;
  }

  return 0;
}

// Helper function to replace placeholders in text
function replacePlaceholders(text, values) {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

// Helper function to process recommendation data and replace placeholders
function processRecommendationData(recData, values) {
  if (!recData) return null;

  const processed = { ...recData };

  // Replace placeholders in title and body
  if (processed.title) {
    processed.title = replacePlaceholders(processed.title, values);
  }
  if (processed.body) {
    processed.body = replacePlaceholders(processed.body, values);
  }

  // Process steps
  if (processed.steps) {
    processed.steps = processed.steps.map((step) => {
      const processedStep = { ...step };
      if (processedStep.title) {
        processedStep.title = replacePlaceholders(processedStep.title, values);
      }
      if (processedStep.description) {
        processedStep.description = replacePlaceholders(
          processedStep.description,
          values,
        );
      }
      if (processedStep.linkTemplate) {
        processedStep.link = replacePlaceholders(
          processedStep.linkTemplate,
          values,
        );
        delete processedStep.linkTemplate;
      }
      if (processedStep.linkLabel) {
        processedStep.linkLabel = replacePlaceholders(
          String(processedStep.linkLabel),
          values,
        );
      }
      if (Array.isArray(processedStep.links)) {
        processedStep.links = processedStep.links.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const hrefRaw = entry.href ?? entry.url;
          const href =
            hrefRaw != null && String(hrefRaw).length > 0
              ? replacePlaceholders(String(hrefRaw), values)
              : "";
          const label =
            entry.label != null && String(entry.label).length > 0
              ? replacePlaceholders(String(entry.label), values)
              : "Open →";
          return { href, label };
        });
      }
      return processedStep;
    });
  }

  // Process alternate
  if (processed.alternate) {
    processed.alternate = processRecommendationData(
      processed.alternate,
      values,
    );
  }

  return processed;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function googleMapsPinUrl(latitude, longitude) {
  if (typeof latitude !== "number" || typeof longitude !== "number")
    return null;
  const q = `${latitude},${longitude}`;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
}

/** From `data/config.json` `parkingPrivateUnknown` (drive planner for OSM without rates). */
function getPrivateParkingUnknownAssumptions() {
  const p = appData?.parkingPrivateUnknown;
  const lot =
    typeof p?.lotAssumedDollars === "number" &&
    Number.isFinite(p.lotAssumedDollars)
      ? Math.max(0, p.lotAssumedDollars)
      : 20;
  const garage =
    typeof p?.garageAssumedDollars === "number" &&
    Number.isFinite(p.garageAssumedDollars)
      ? Math.max(0, p.garageAssumedDollars)
      : 30;
  const cardCopy =
    typeof p?.cardCopy === "string" && p.cardCopy.trim()
      ? p.cardCopy.trim()
      : "Typical cost is a planning estimate when no rate is listed—confirm posted prices before you park.";
  return { lot, garage, cardCopy };
}

function estimateParkingCostRange(pricing, category) {
  const fallbacks = {
    meters: { min: 1, max: 7 },
    lots: { min: 8, max: 11 },
    garages: { min: 8, max: 30 },
  };

  const assumedPrivate = () => {
    const { lot, garage } = getPrivateParkingUnknownAssumptions();
    const n = category === "osmGarages" ? garage : lot;
    return { min: n, max: n };
  };

  if (category === "osmLots" || category === "osmGarages") {
    if (!pricing || typeof pricing !== "object") return assumedPrivate();
    const text = Object.values(pricing).join(" ");
    const nums = [];
    const re = /\$(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      nums.push(Number.parseFloat(m[1]));
    }
    if (nums.length === 0) return assumedPrivate();
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }

  const fb = fallbacks[category] || fallbacks.garages;
  if (!pricing || typeof pricing !== "object") return { ...fb };

  // Garages/lots list a low hourly "rate" alongside much higher event/daytime prices.
  // For venue visits, prefer the events tier so budgets match realistic structured parking cost.
  if (
    (category === "garages" || category === "lots") &&
    typeof pricing.events === "string" &&
    pricing.events.trim()
  ) {
    const nums = [];
    const re = /\$(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(pricing.events)) !== null) {
      nums.push(Number.parseFloat(m[1]));
    }
    if (nums.length > 0) {
      return { min: Math.min(...nums), max: Math.max(...nums) };
    }
  }

  const text = Object.values(pricing).join(" ");
  const nums = [];
  const re = /\$(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    nums.push(Number.parseFloat(m[1]));
  }
  if (nums.length === 0) return { ...fb };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Flatten DASH route stops from `data/bus/routes.json` (`dash_routes`). */
function collectDashStopsFromDashRoutes(dashRoutes) {
  const out = [];
  if (!Array.isArray(dashRoutes)) return out;
  for (const route of dashRoutes) {
    const stops = route?.stops;
    if (!Array.isArray(stops)) continue;
    for (const s of stops) {
      if (typeof s.latitude !== "number" || typeof s.longitude !== "number") {
        continue;
      }
      const name = typeof s.name === "string" ? s.name.trim() : "";
      out.push({
        latitude: s.latitude,
        longitude: s.longitude,
        name,
        stopId: s.stop_id,
      });
    }
  }
  return out;
}

/** True when city parking scrape lists a non-empty DASH line for the lot. */
function lotListingIncludesDash(lot) {
  const av = lot?.availability;
  if (typeof av !== "string") return false;
  const m = av.match(/DASH:\s*(.*)$/i);
  if (!m) return false;
  return m[1].trim().length > 0;
}

function nearestDashStopFromPool(lat, lng, pool) {
  let best = null;
  let bestD = Infinity;
  for (const s of pool) {
    const d = haversineMiles(lat, lng, s.latitude, s.longitude);
    if (d < bestD) {
      bestD = d;
      best = { ...s, milesFromPoint: d };
    }
  }
  return best;
}

/**
 * Picks a scraped surface lot that lists DASH service: lowest minimum posted
 * price tier (see estimateParkingCostRange), tie-broken by shortest walk to
 * any DASH stop in GTFS-derived dash_routes.
 */
function pickParkDashExampleLot(lots, dashRoutes) {
  const pool = collectDashStopsFromDashRoutes(dashRoutes);
  if (!pool.length || !Array.isArray(lots)) return null;
  const cands = [];
  for (const lot of lots) {
    if (!lotListingIncludesDash(lot)) continue;
    const lat = lot?.location?.latitude;
    const lng = lot?.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const range = estimateParkingCostRange(lot.pricing, "lots");
    const nearest = nearestDashStopFromPool(lat, lng, pool);
    if (!nearest) continue;
    cands.push({
      lot,
      costMin: range.min,
      costMax: range.max,
      nearestStop: nearest,
      walkMilesToDash: nearest.milesFromPoint,
    });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (a.costMin !== b.costMin) return a.costMin - b.costMin;
    return a.walkMilesToDash - b.walkMilesToDash;
  });
  return cands[0];
}

function buildParkDashPlaceholderMap(state) {
  const generic = {
    parkDashLotName: "a surface lot that lists DASH service",
    parkDashLotAddress: "Grand Rapids, MI",
    parkDashLotPricingNote:
      "Compare pricing on posted signs; our scrape may omit some tiers.",
    parkDashWalkToStopMi: "0.15",
    parkDashBoardStopName: "the nearest signed DASH stop",
    parkDashLotMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("DASH parking downtown Grand Rapids MI")}`,
    parkDashLotLinkLabel: "DASH parking area in Google Maps",
    parkDashVenueStopName: "the DASH stop closest to the venue",
    parkDashVenueStopWalkMi: "0.15",
    parkDashVenueStopMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("DASH shuttle stop Grand Rapids MI")}`,
    parkDashVenueStopLinkLabel: "DASH stops in Google Maps",
  };

  const dashRoutes = appData?.busRoutes?.dash_routes;
  const lots = appData?.parking?.lots;
  const pool =
    Array.isArray(dashRoutes) && dashRoutes.length > 0
      ? collectDashStopsFromDashRoutes(dashRoutes)
      : [];

  const dest = appData?.destinations?.find(
    (d) => d.name === state?.destination || d.slug === state?.destination,
  );
  const vLat = dest?.latitude;
  const vLng = dest?.longitude;

  let venueStop = null;
  if (pool.length > 0 && typeof vLat === "number" && typeof vLng === "number") {
    venueStop = nearestDashStopFromPool(vLat, vLng, pool);
  }

  let venueStopName = generic.parkDashVenueStopName;
  let venueWalkMi = generic.parkDashVenueStopWalkMi;
  let venueMapsUrl = generic.parkDashVenueStopMapsUrl;
  let venueLinkLabel = generic.parkDashVenueStopLinkLabel;
  if (venueStop && typeof vLat === "number" && typeof vLng === "number") {
    if (venueStop.name) venueStopName = venueStop.name;
    const w = haversineMiles(
      venueStop.latitude,
      venueStop.longitude,
      vLat,
      vLng,
    );
    venueWalkMi = w.toFixed(2);
    const pin = googleMapsPinUrl(venueStop.latitude, venueStop.longitude);
    if (pin) {
      venueMapsUrl = pin;
      venueLinkLabel = `${venueStopName} in Google Maps`;
    }
  }

  if (!Array.isArray(lots) || !dashRoutes || pool.length === 0) {
    return {
      ...generic,
      parkDashVenueStopName: venueStopName,
      parkDashVenueStopWalkMi: venueWalkMi,
      parkDashVenueStopMapsUrl: venueMapsUrl,
      parkDashVenueStopLinkLabel: venueLinkLabel,
    };
  }

  const pick = pickParkDashExampleLot(lots, dashRoutes);
  if (!pick) {
    return {
      ...generic,
      parkDashVenueStopName: venueStopName,
      parkDashVenueStopWalkMi: venueWalkMi,
      parkDashVenueStopMapsUrl: venueMapsUrl,
      parkDashVenueStopLinkLabel: venueLinkLabel,
    };
  }

  const lot = pick.lot;
  const addr = typeof lot.address === "string" ? lot.address.trim() : "";
  const lotLat = lot.location.latitude;
  const lotLng = lot.location.longitude;
  const lotMaps =
    googleMapsPinUrl(lotLat, lotLng) ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      (lot.name ? `${lot.name} ` : "") + (addr || "Grand Rapids MI"),
    )}`;

  const ns = pick.nearestStop;
  const boardName =
    ns?.name && ns.name.length > 0 ? ns.name : generic.parkDashBoardStopName;

  let pricingNote = generic.parkDashLotPricingNote;
  if (lot.pricing && typeof lot.pricing === "object") {
    const parts = [];
    for (const [k, v] of Object.entries(lot.pricing)) {
      if (typeof v === "string" && /\$/.test(v)) {
        parts.push(`${k}: ${v}`);
      }
    }
    if (parts.length > 0) {
      pricingNote = `Posted tiers in our scrape include ${parts.slice(0, 4).join("; ")}.`;
    }
  }

  return {
    parkDashLotName: lot.name || generic.parkDashLotName,
    parkDashLotAddress: addr || generic.parkDashLotAddress,
    parkDashLotPricingNote: pricingNote,
    parkDashWalkToStopMi: pick.walkMilesToDash.toFixed(2),
    parkDashBoardStopName: boardName,
    parkDashLotMapsUrl: lotMaps,
    parkDashLotLinkLabel: `${lot.name || "Lot"} in Google Maps`,
    parkDashVenueStopName: venueStopName,
    parkDashVenueStopWalkMi: venueWalkMi,
    parkDashVenueStopMapsUrl: venueMapsUrl,
    parkDashVenueStopLinkLabel: venueLinkLabel,
  };
}

// "No options" cards (formerly in data/recommendations per destination). Same rules for all venues.
const SYNTHETIC_NO_OPTIONS_RECIPES = [
  {
    modeKey: "drive+shuttle",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're driving and using DASH but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["drive", "shuttle"],
      minWalkMiles: 0.1,
      minCost: 0,
      priority: 100,
    },
  },
  {
    modeKey: "drive+transit",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're driving and taking transit but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["drive", "transit"],
      minWalkMiles: 0.1,
      minCost: 1.75,
      priority: 95,
    },
  },
  {
    modeKey: "drive+micromobility",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're driving and using micromobility but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["drive", "micromobility"],
      minWalkMiles: 0.1,
      minCost: 4,
      priority: 90,
    },
  },
  {
    modeKey: "drive",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're driving but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["drive"],
      minWalkMiles: 0.1,
      minCost: 0,
      priority: 50,
    },
  },
  {
    modeKey: "drive",
    variantKey: "noCost",
    title: "Adjust Your Filters",
    body: "Parking meters are enforced Monday-Friday 8am-7pm. Since you're not willing to pay for parking, there are no options available during enforcement hours.",
    metadata: {
      requiredModes: ["drive"],
      minCost: 0,
      priority: 0,
      conditions: { parkingEnforced: true },
    },
  },
  {
    modeKey: "transit+shuttle",
    variantKey: "noCost",
    title: "Adjust Your Filters",
    body: "The Rapid charges a fare each way. Raise your willing-to-pay to see recommendations, or add another mode.",
    metadata: {
      requiredModes: ["transit", "shuttle"],
      minCost: TRANSIT_STANDARD_ONE_WAY_FARE,
      priority: 80,
    },
  },
  {
    modeKey: "transit+shuttle",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're taking The Rapid and using DASH but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["transit", "shuttle"],
      minWalkMiles: 0.1,
      minCost: TRANSIT_STANDARD_ONE_WAY_FARE,
      priority: 80,
    },
  },
  {
    modeKey: "transit",
    variantKey: "noCost",
    title: "Adjust Your Filters",
    body: "The Rapid charges a fare each way. Raise your willing-to-pay to see recommendations, or add another mode.",
    metadata: {
      requiredModes: ["transit"],
      minCost: TRANSIT_STANDARD_ONE_WAY_FARE,
      priority: 70,
    },
  },
  {
    modeKey: "transit",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're taking The Rapid but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["transit"],
      minWalkMiles: 0.1,
      minCost: TRANSIT_STANDARD_ONE_WAY_FARE,
      priority: 70,
    },
  },
  {
    modeKey: "rideshare",
    variantKey: "noCost",
    title: "Adjust Your Filters",
    body: "Round-trip rideshare usually needs more budget than a single ride. Demand pricing can spike near events—raise willing-to-pay or add another mode.",
    metadata: {
      requiredModes: ["rideshare"],
      minCost: 10,
      priority: 85,
    },
  },
  {
    modeKey: "micromobility",
    variantKey: "noCost",
    title: "Adjust Your Filters",
    body: "Lime charges per ride in the app, and you should budget for both directions. Raise your willing-to-pay to see a map pin, or add another mode.",
    metadata: {
      requiredModes: ["micromobility"],
      minCost: 4,
      priority: 65,
    },
  },
  {
    modeKey: "shuttle",
    variantKey: "noWalk",
    title: "Adjust Your Filters",
    body: "You're using DASH but not willing to walk any distance. Consider adjusting your walk distance or add modes to see recommendations.",
    metadata: {
      requiredModes: ["shuttle"],
      minWalkMiles: 0.1,
      minCost: 0,
      priority: 60,
    },
  },
  {
    modeKey: "bike",
    variantKey: "noRackInWalkRange",
    title: "Adjust Your Filters",
    body: "No bike rack in our data sits within the walk you're willing to do from the venue. Try a longer walk allowance or another mode to see a map pin.",
    metadata: {
      requiredModes: ["bike"],
      minCost: 0,
      priority: 58,
    },
  },
];

/** Shown when every automated strategy is filtered out (no matching rows in the pool). */
const GENERIC_NO_SUGGESTIONS_FALLBACK_REC = {
  title: "Adjust Your Filters",
  body: "Nothing in our data matches these preferences. Try relaxing a setting or adding another mode.",
  isNoOptions: true,
  modeKey: "generic",
  variantKey: "noSuggestionsFallback",
  metadata: { priority: 1 },
  _metadata: { priority: 1 },
};

function buildSyntheticNoOptionsRecommendations() {
  return SYNTHETIC_NO_OPTIONS_RECIPES.map(
    ({ modeKey, variantKey, title, body, metadata }) => ({
      title,
      body,
      isNoOptions: true,
      modeKey,
      variantKey,
      _metadata: metadata,
      metadata,
    }),
  );
}

// Drive-only options derived from parking datasets (distance vs venue + parsed cost tiers).
function buildParkingBasedDriveRecommendations(state) {
  if (!state?.destination || !appData?.parking) return [];
  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  if (
    !dest ||
    typeof dest.latitude !== "number" ||
    typeof dest.longitude !== "number"
  ) {
    return [];
  }
  const vLat = dest.latitude;
  const vLng = dest.longitude;
  const destName = dest.name || state.destination;
  const walkBudget = state.walkMiles ?? 0;
  const out = [];

  const driveCategories = [
    { key: "garages", id: "garages" },
    { key: "lots", id: "lots" },
    { key: "meters", id: "meters" },
    {
      key: "osmLots",
      id: "lots",
      itemKeyPrefix: "osmLots",
      costCategory: "osmLots",
      title: "Park in a Private Lot",
      privateOsm: true,
    },
    {
      key: "osmGarages",
      id: "garages",
      itemKeyPrefix: "osmGarages",
      costCategory: "osmGarages",
      title: "Park in a Private Garage",
      privateOsm: true,
    },
  ];

  for (const cat of driveCategories) {
    const key = cat.key;
    const id = cat.id;
    const itemKeyPrefix = cat.itemKeyPrefix ?? id;
    const costCategory = cat.costCategory ?? id;
    const privateOsm = Boolean(cat.privateOsm);
    const titleOverride =
      typeof cat.title === "string" && cat.title.trim() ? cat.title.trim() : "";

    const modes = appData.parking.modes?.[key];
    if (Array.isArray(modes) && !modes.includes("drive")) continue;
    const items = appData.parking[key];
    if (!Array.isArray(items)) continue;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const loc = item.location;
      if (
        !loc ||
        typeof loc.latitude !== "number" ||
        typeof loc.longitude !== "number"
      ) {
        continue;
      }
      const distanceMi = haversineMiles(
        loc.latitude,
        loc.longitude,
        vLat,
        vLng,
      );
      if (distanceMi > walkBudget + 1e-9) continue;

      const costRange = estimateParkingCostRange(item.pricing, costCategory);
      let variantKey;
      let priority;
      let minWalkMiles = 0.1;
      if (id === "meters") {
        variantKey = "meteredParking";
        priority = 30;
      } else if (id === "lots") {
        variantKey = "affordableLot";
        priority = 40;
        minWalkMiles = 0.5;
      } else {
        variantKey = "parkingGarage";
        priority = 55;
      }
      if (walkBudget + 1e-9 < minWalkMiles) continue;

      const itemLabel = item.name || item.address || "Parking";
      const pricingNote = item.pricing
        ? Object.values(item.pricing).slice(0, 3).join(" · ")
        : "";
      const link = googleMapsPinUrl(loc.latitude, loc.longitude);

      let title;
      if (titleOverride) {
        title = titleOverride;
      } else if (id === "meters") {
        title = "Park at a Public Meter";
      } else if (id === "lots") {
        title = "Park in a Public Lot";
      } else {
        title = "Park in a Public Garage";
      }

      const walkLabel =
        distanceMi >= 0.095 ? `${distanceMi.toFixed(2)} mi` : "a short";
      const costLabel =
        costRange.min === costRange.max
          ? `about $${costRange.min}`
          : `$${costRange.min}–$${costRange.max}`;

      const { cardCopy: privateCardCopy } =
        getPrivateParkingUnknownAssumptions();
      const body = privateOsm
        ? "Nearby private parking from mapped listings. Open steps for the map pin, address, and details."
        : "We pick a garage, surface lot, or metered block from our data near this venue, then you walk in. Open steps for the map pin, address, and on-site details.";

      const parkingItemKey = `${itemKeyPrefix}-${i}-${slugifyParkingItemKey(itemLabel)}`;

      const meta = {
        requiredModes: ["drive"],
        minWalkMiles,
        minCost: costRange.min,
        maxCost: costRange.max,
        priority,
      };

      const parkingDetailLine = privateOsm
        ? `${itemLabel} is ~${walkLabel} from ${destName}. Estimated typical cost: ${costLabel}. ${privateCardCopy}`
        : `${itemLabel} is ~${walkLabel} from ${destName}. Typical cost: ${costLabel}.${pricingNote ? " " + pricingNote : ""}`;
      const step0Description = privateOsm
        ? item.address
          ? `${parkingDetailLine} ${item.address}`
          : parkingDetailLine
        : item.address
          ? `${parkingDetailLine} ${item.address}`
          : `${parkingDetailLine} Confirm rates and hours before you park.`;
      const steps = [
        {
          title: `Park at ${itemLabel}`,
          description: step0Description,
          link,
        },
        {
          title: "Walk to Destination",
          description: `Walk from your parking spot to ${destName} (~${walkLabel}).`,
        },
      ];

      let badge = "Budget-friendly";
      if (id === "meters") badge = "Affordable";

      out.push({
        title,
        body,
        badge,
        steps,
        _metadata: meta,
        metadata: meta,
        modeKey: "drive",
        variantKey,
        parkingWalkMiles: distanceMi,
        parkingItemKey,
        fromParkingData: true,
      });
    }
  }

  const parkingEnforced = isParkingEnforced(state.day, state.time);
  if (!parkingEnforced) {
    const weekend = ["saturday", "sunday"].includes(
      String(state.day || "").toLowerCase(),
    );
    const searchQ = `street parking near ${destName}, Grand Rapids, MI`;
    const freeMeta = {
      requiredModes: ["drive"],
      minWalkMiles: 0.1,
      minCost: 0,
      maxCost: 0,
      priority: 10,
      conditions: { parkingEnforced: false },
    };
    out.push({
      title: "Find Free Public Street Parking",
      body: weekend
        ? "Spend 20 minutes in traffic circling the area to find street parking. Meters are not enforced on the weekend."
        : "Spend 20 minutes in traffic circling the area to find street parking. Meters are not enforced outside weekday enforcement hours.",
      badge: "Free",
      isDiscouraged: true,
      steps: [
        {
          title: "Spend 20 Minutes in Traffic Looking for Free Street Parking",
          description:
            "Circle the blocks looking for free unmetered parking. Watch for odd-even winter restrictions. This often takes 20+ minutes.",
          link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQ)}`,
          linkText: "View area on Google Maps",
        },
        {
          title: "Park and Walk",
          description: `Once you find a spot, park and walk up to {walkMiles} miles to ${destName}.`,
        },
      ],
      _metadata: freeMeta,
      metadata: freeMeta,
      modeKey: "drive",
      variantKey: "freeStreet",
      parkingItemKey: "freeStreet-synthetic",
      fromParkingData: true,
    });
  }

  return out;
}

function slugifyParkingItemKey(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// Get all recommendations for a destination, flattened with metadata
function getAllRecommendationsForDestination(destination) {
  const allRecs = [];
  const slug = getDestinationSlug(destination);
  let recommendations = appData.recommendations?.[slug];
  // Support legacy flat format (recommendations keyed by mode, not by destination slug)
  if (!recommendations && appData.recommendations?.["drive+shuttle"]) {
    recommendations = appData.recommendations;
  }
  if (!recommendations) return allRecs;

  for (const [modeKey, variants] of Object.entries(recommendations)) {
    for (const [variantKey, recData] of Object.entries(variants)) {
      if (recData._metadata) {
        allRecs.push({
          ...recData,
          modeKey,
          variantKey,
          metadata: recData._metadata,
        });
      }
    }
  }

  return allRecs;
}

// Check if selected modes match required modes
function matchesModes(rec, selectedModes) {
  const requiredModes = rec.metadata?.requiredModes || [];
  // All required modes must be in selected modes
  return requiredModes.every((mode) => selectedModes.includes(mode));
}

// Check if walk distance matches constraints
function matchesWalkDistance(rec, walkMiles) {
  // Special handling for "noWalk" variant - only match when walkMiles is exactly 0
  if (rec.variantKey === "noWalk") {
    return walkMiles === 0;
  }

  const minWalk = rec.metadata?.minWalkMiles;
  if (minWalk !== undefined && walkMiles < minWalk) {
    return false;
  }
  return true;
}

// Check if cost matches constraints
function matchesCost(rec, costDollars, state) {
  const metadata = rec.metadata;
  if (!metadata) return true;

  const minCost = metadata.minCost;
  const maxCost = metadata.maxCost;
  const budget = costDollars ?? 0;

  // Synthetic red cards: pay-per-ride modes use minCost one-way; budget must cover both ways
  // for real recs, but noCost variants should appear only when budget is below that threshold.
  if (rec.isNoOptions && rec.variantKey === "noCost") {
    const bothWaysSingleMode = ["rideshare", "transit", "micromobility"];
    if (bothWaysSingleMode.includes(rec.modeKey) && minCost !== undefined) {
      const minBothWays = 2 * minCost;
      if (budget >= minBothWays) return false;
      if (rec.modeKey === "micromobility") {
        const modes = state.modes || [];
        if (modes.length !== 1 || modes[0] !== "micromobility") return false;
      }
      return true;
    }
  }

  if (
    rec.isNoOptions &&
    rec.modeKey === "bike" &&
    rec.variantKey === "noRackInWalkRange"
  ) {
    const modes = state.modes || [];
    if (modes.length !== 1 || modes[0] !== "bike") return false;
    const walkBudget = state.walkMiles ?? 0;
    const nearest = getNearestBikeRackDistanceMiles(state);
    if (nearest !== null && nearest <= walkBudget + 1e-9) return false;
    if (nearest === null && walkBudget > 1e-9) return false;
    return true;
  }

  // For drive mode, handle parking enforcement logic
  if (rec.modeKey === "drive") {
    const parkingEnforced = isParkingEnforced(state.day, state.time);
    const safeCostDollars = costDollars ?? 0;

    // Handle parking enforcement conditions
    if (metadata.conditions?.parkingEnforced === true && !parkingEnforced) {
      return false; // This recommendation requires parking to be enforced
    }
    if (metadata.conditions?.parkingEnforced === false && parkingEnforced) {
      return false; // This recommendation requires parking NOT to be enforced
    }

    // For drive mode, calculate effective cost
    const effectiveCostDollars =
      !parkingEnforced && state.walkMiles > 0 && safeCostDollars < 8
        ? 0
        : safeCostDollars;

    // Special handling for freeStreet variant - should be available when parking is not enforced
    if (rec.variantKey === "freeStreet") {
      // Free street parking is available when parking is not enforced
      // It should pass the filter (so it can compete), but scoring will prefer paid options
      if (parkingEnforced) {
        return false; // Only available when parking is not enforced
      }
      // Don't check cost constraints here - let it compete with paid options via scoring
      return true;
    }

    // Special handling for drive mode variants
    if (rec.variantKey === "noCost") {
      // Show noCost if:
      // 1. Parking is enforced AND
      // 2. (User won't pay OR user's budget is insufficient for required metered parking) AND
      // 3. No free parking is available
      if (!parkingEnforced) {
        return false;
      }

      const requiredMeteredCost = calculateRequiredMeteredParkingCost(
        state.day,
        state.time,
      );

      // Show noCost if user can't afford required metered parking
      if (requiredMeteredCost > 0 && safeCostDollars < requiredMeteredCost) {
        return true; // User's budget is insufficient
      }

      // Also show if user won't pay (costDollars === 0) and parking is enforced
      if (safeCostDollars === 0) {
        return true;
      }

      return false;
    }

    // For other drive variants (except noWalk, freeStreet, noCost), check constraints
    if (
      rec.variantKey !== "freeStreet" &&
      rec.variantKey !== "noWalk" &&
      rec.variantKey !== "noCost"
    ) {
      if (parkingEnforced) {
        // When parking is enforced, check if budget is sufficient for required metered parking
        const requiredMeteredCost = calculateRequiredMeteredParkingCost(
          state.day,
          state.time,
        );
        const hasFreeParkingAvailable = state.walkMiles > 0.5;

        // If no free parking available and required cost > 0, check if user can afford it
        if (!hasFreeParkingAvailable && requiredMeteredCost > 0) {
          if (safeCostDollars < requiredMeteredCost) {
            // User can't afford required metered parking - only show noCost variant
            return false;
          }
        }

        // Also check: if user won't pay (costDollars === 0) and parking is enforced, don't show paid options
        if (safeCostDollars === 0) {
          return false; // User won't pay, so don't show paid parking options
        }
      } else {
        // When parking is NOT enforced, filter out paid options if user has low budget (< $8) or won't pay
        // Free street parking should be preferred when parking is free and budget is low
        // But if user is willing to pay $8+, show paid options (they'll win via scoring)
        if (safeCostDollars === 0 || safeCostDollars < 8) {
          return false; // Don't show paid options when parking is free and user won't pay or has low budget
        }
      }
    }

    // Check cost constraints with effective cost (skip for freeStreet as it's handled above)
    if (rec.variantKey !== "freeStreet") {
      if (minCost !== undefined && effectiveCostDollars < minCost) {
        return false;
      }
      // Don't filter out options based on maxCost - users with higher budgets can still use cheaper options
      // maxCost is informational/used for scoring, not for filtering
    }

    if (rec.variantKey === "affordableLot") {
      // Surface lots require at least 0.5 miles walking
      if (state.walkMiles < 0.5) {
        return false;
      }
    }

    return true;
  }

  // Rideshare, transit (The Rapid), and micromobility (Lime) costs in data are one-way; user's "willing to pay" must cover both ways
  const bothWaysModes = ["rideshare", "transit", "micromobility"];
  if (bothWaysModes.includes(rec.modeKey)) {
    const minBothWays = minCost !== undefined ? 2 * minCost : undefined;
    const maxBothWays = maxCost !== undefined ? 2 * maxCost : undefined;
    // Synthetic noCost cards warn when budget is below round-trip minimum; they must stay in the pool then
    if (rec.isNoOptions && rec.variantKey === "noCost") {
      if (minBothWays !== undefined) {
        return costDollars < minBothWays;
      }
      return true;
    }
    if (minBothWays !== undefined && costDollars < minBothWays) {
      return false;
    }
    if (maxBothWays !== undefined && costDollars > maxBothWays) {
      return false;
    }
    return true;
  }

  // For other non-drive modes, simple cost check
  if (minCost !== undefined && costDollars < minCost) {
    return false;
  }
  if (maxCost !== undefined && costDollars > maxCost) {
    return false;
  }

  return true;
}

// Calculate score for a recommendation (higher = better)
function calculateScore(rec, state) {
  const metadata = rec.metadata;
  if (!metadata) return 0;

  let score = metadata.priority || 0;

  // Boost score for drive combinations
  if (rec.modeKey.includes("+")) {
    score += 50;
  }

  // When meters are enforced and the user budgets for structured parking, prefer a ramp over park-far + DASH
  if (rec.modeKey === "drive+shuttle") {
    const parkingEnforced = isParkingEnforced(state.day, state.time);
    const safeCostDollars = state.costDollars ?? 0;
    if (parkingEnforced && safeCostDollars >= 10) {
      score -= 75;
    }
  }

  // Boost score for rideshare
  if (rec.modeKey === "rideshare") {
    score += 30;
  }

  // Park-and-Ride style: user selected both drive and The Rapid — surface the
  // single Rapid line + stop recommendation alongside parking (see buildTransitAppRecommendation).
  if (
    rec.modeKey === "transit" &&
    rec.variantKey === "transitApp" &&
    state.modes.includes("drive") &&
    state.modes.includes("transit")
  ) {
    score += 220;
  }

  // Penalize discouraged recommendations
  if (rec.isDiscouraged) {
    score -= 20;
  }

  // Penalize no-options recommendations
  if (rec.isNoOptions) {
    score -= 100;
  }

  // For drive mode, adjust score based on cost tiers
  if (rec.modeKey === "drive") {
    const parkingEnforced = isParkingEnforced(state.day, state.time);
    const safeCostDollars = state.costDollars ?? 0;
    const effectiveCostDollars =
      !parkingEnforced && state.walkMiles > 0 && safeCostDollars < 8
        ? 0
        : safeCostDollars;

    // When parking is not enforced:
    // - If user is willing to pay $8+, prefer paid options (convenience over free)
    // - Otherwise, prefer free street parking
    if (!parkingEnforced) {
      if (rec.variantKey === "freeStreet") {
        if (effectiveCostDollars >= 8) {
          score -= 30; // Discourage free street when user is willing to pay $8+
        } else {
          score += 50; // Strongly prefer free street parking when parking is free and budget is low
        }
      } else {
        // Paid options when parking is free
        if (effectiveCostDollars >= 8) {
          score += 30; // Boost paid options when user is willing to pay $8+
        } else {
          score -= 30; // Lower priority for paid options when user has low budget and parking is free
        }
      }
    }

    // Garages: prefer higher listed prices (better chance of availability); data carries the amounts.
    if (rec.variantKey === "parkingGarage") {
      const maxC = rec.metadata?.maxCost;
      const minC = rec.metadata?.minCost;
      if (typeof maxC === "number" && Number.isFinite(maxC)) {
        score +=
          maxC * 2 +
          (typeof minC === "number" && Number.isFinite(minC) ? minC * 0.25 : 0);
      } else {
        score += 5;
      }
      if (
        state.walkMiles >= 0.5 &&
        effectiveCostDollars >= 8 &&
        effectiveCostDollars < 12
      ) {
        score -= 2; // Slight preference for surface lots in mid-budget + sufficient walk
      }
    } else if (rec.variantKey === "affordableLot") {
      score += 3;
      if (
        state.walkMiles >= 0.5 &&
        effectiveCostDollars >= 8 &&
        effectiveCostDollars < 12
      ) {
        score += 2;
      }
    } else if (rec.variantKey === "meteredParking") {
      score += 1;
    } else if (rec.variantKey === "freeStreet") {
      // Only apply penalty when parking is enforced (when parking is free, it's preferred)
      if (parkingEnforced) {
        score -= 5; // Base penalty for free street parking when parking is enforced
      }
    }

    if (typeof rec.parkingWalkMiles === "number") {
      score += Math.max(0, 0.4 - rec.parkingWalkMiles) * 6;
    }
  }

  return score;
}

/** Nearest bike rack pin to the selected destination, or null if none in data. */
function findNearestBikeRackToDestination(state) {
  if (!appData?.parking?.racks || !state?.destination) return null;
  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  const vLat = dest?.latitude;
  const vLng = dest?.longitude;
  if (typeof vLat !== "number" || typeof vLng !== "number") return null;
  const racks = appData.parking.racks;
  if (!Array.isArray(racks) || racks.length === 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const item of racks) {
    const loc = item?.location;
    if (
      !loc ||
      typeof loc.latitude !== "number" ||
      typeof loc.longitude !== "number"
    ) {
      continue;
    }
    const d = haversineMiles(loc.latitude, loc.longitude, vLat, vLng);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  if (!best || bestD === Infinity) return null;
  return { item: best, miles: bestD };
}

function getNearestBikeRackDistanceMiles(state) {
  const hit = findNearestBikeRackToDestination(state);
  return hit ? hit.miles : null;
}

function formatRapidRouteLabel(route) {
  if (!route || typeof route !== "object") return "The Rapid";
  const short =
    route.route_short_name != null ? String(route.route_short_name).trim() : "";
  const long =
    route.route_long_name != null ? String(route.route_long_name).trim() : "";
  if (short && long) return `Route ${short} (${long})`;
  if (long) return long;
  if (short) return `Route ${short}`;
  return "The Rapid";
}

function rapidRouteTieBreakKey(route) {
  if (!route || typeof route !== "object") return "";
  const id = route.route_id != null ? String(route.route_id) : "";
  const sn =
    route.route_short_name != null ? String(route.route_short_name) : "";
  return `${sn}\t${id}`;
}

/**
 * Best Rapid (non-DASH) line for the venue: the route whose closest stop is
 * nearest to the destination. Uses `rapid_routes` only from `data/bus/routes.json`.
 */
function findBestRapidRouteStopForDestination(state) {
  const br = appData?.busRoutes;
  if (!br || !state?.destination) return null;
  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  const vLat = dest?.latitude;
  const vLng = dest?.longitude;
  if (typeof vLat !== "number" || typeof vLng !== "number") return null;

  const routes = br.rapid_routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  let best = null;
  let bestD = Infinity;
  let bestKey = "";

  for (const route of routes) {
    const stops = route.stops;
    if (!Array.isArray(stops)) continue;
    for (const s of stops) {
      if (typeof s.latitude !== "number" || typeof s.longitude !== "number") {
        continue;
      }
      const d = haversineMiles(s.latitude, s.longitude, vLat, vLng);
      const rk = rapidRouteTieBreakKey(route);
      if (
        d < bestD - 1e-9 ||
        (Math.abs(d - bestD) <= 1e-9 && rk.localeCompare(bestKey) < 0)
      ) {
        bestD = d;
        best = { stop: s, miles: d, route };
        bestKey = rk;
      }
    }
  }
  if (!best || bestD === Infinity) return null;
  return best;
}

/**
 * The Rapid is selected, a Rapid-route stop in GTFS data lies within the user's walk budget,
 * and willing-to-pay covers a standard round-trip fare — recommend that line + Transit app.
 */
function buildTransitAppRecommendation(state) {
  if (!state?.modes?.includes("transit")) return [];

  const hit = findBestRapidRouteStopForDestination(state);
  const walkBudget = state.walkMiles ?? 0;
  if (!hit || hit.miles > walkBudget + 1e-9) return [];

  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  const destName = dest?.name || state.destination || "the venue";

  const stopToVenueMi = hit.miles;
  const pinUrl = googleMapsPinUrl(hit.stop.latitude, hit.stop.longitude);
  const routeLabel = formatRapidRouteLabel(hit.route);

  const meta = {
    requiredModes: ["transit"],
    minCost: TRANSIT_STANDARD_ONE_WAY_FARE,
    minWalkMiles: stopToVenueMi,
    priority: 72,
  };

  const walkPhrase =
    stopToVenueMi < 0.095
      ? "a very short walk from that stop to the door."
      : `about ${stopToVenueMi.toFixed(2)} mi on foot from that stop to the venue.`;

  const stopLabel =
    hit.stop.name && String(hit.stop.name).trim()
      ? String(hit.stop.name).trim()
      : "the nearest stop";

  return [
    {
      title: `Take ${routeLabel}`,
      body: `Our GTFS data places ${stopLabel} on ${routeLabel} within your walk range (~${stopToVenueMi.toFixed(2)} mi from ${destName}). Budget at least $${(TRANSIT_STANDARD_ONE_WAY_FARE * 2).toFixed(2)} for a round trip.`,
      badge: "Real-time",
      modeKey: "transit",
      variantKey: "transitApp",
      metadata: meta,
      _metadata: meta,
      steps: [
        {
          title: "Download the Transit App",
          description:
            "Get Transit on your phone for The Rapid routes, live departures, and trip planning in Grand Rapids.",
          link: TRANSIT_APP_PAGE_URL,
          linkLabel: "Download the Transit app →",
        },
        {
          title: `Plan ${routeLabel} to ${destName}`,
          description: `In Transit, choose ${routeLabel} and plan to exit at ${stopLabel} (closest stop on that line to the venue in our data). That leaves ${walkPhrase}`,
          ...(pinUrl
            ? { link: pinUrl, linkLabel: `${stopLabel} in Google Maps →` }
            : {}),
        },
      ],
    },
  ];
}

/** Bike strategy: nearest rack from parking data (or Maps search fallback) with a map link. */
function buildBikeRackRecommendation(state) {
  if (!state?.modes?.includes("bike") || !appData?.parking) return [];

  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  const destName = dest?.name || state.destination || "the venue";
  const walkBudget = state.walkMiles ?? 0;

  let link = null;
  let rackLabel = "the nearest bike rack";
  const nearestRack = findNearestBikeRackToDestination(state);
  const rackToVenueMi = nearestRack ? nearestRack.miles : null;

  if (rackToVenueMi !== null && rackToVenueMi > walkBudget + 1e-9) {
    return [];
  }

  if (rackToVenueMi === null && walkBudget <= 1e-9) {
    return [];
  }

  if (nearestRack?.item?.location) {
    const loc = nearestRack.item.location;
    link = googleMapsPinUrl(loc.latitude, loc.longitude);
    rackLabel =
      (nearestRack.item.name && String(nearestRack.item.name).trim()) ||
      "this bike rack";
  }

  if (!link) {
    const q = encodeURIComponent(
      `bike rack near ${destName}, Grand Rapids, MI`,
    );
    link = `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  const walkFromRackText =
    typeof rackToVenueMi === "number"
      ? rackToVenueMi < 0.095
        ? `a very short walk from the rack to ${destName}.`
        : `About ${rackToVenueMi.toFixed(2)} mi on foot from the rack to ${destName}.`
      : `Walk from your bike to ${destName}.`;

  const meta = {
    requiredModes: ["bike"],
    minCost: 0,
    priority: 70,
  };
  if (typeof rackToVenueMi === "number") {
    meta.minWalkMiles = rackToVenueMi;
  }

  const body =
    typeof rackToVenueMi === "number"
      ? "Rack at the pin from our data, then walk the rest of the way. Open steps for the map link and specifics."
      : "Find a public rack near the venue, ride in, and walk the last stretch. Open steps for the map search and specifics.";

  return [
    {
      title: "Bike to the Venue",
      body,
      badge: "Healthy",
      modeKey: "bike",
      variantKey: "nearestRack",
      metadata: meta,
      _metadata: meta,
      steps: [
        {
          title:
            typeof rackToVenueMi === "number"
              ? `Park at ${rackLabel}`
              : "Find Bike Parking Near the Venue",
          description:
            typeof rackToVenueMi === "number"
              ? `Closest rack in our data is ${rackToVenueMi.toFixed(2)} mi from the venue. Open the map for directions to that pin.`
              : `Use Google Maps to find a public bike rack near ${destName}.`,
          link,
        },
        {
          title: "Walk to the Venue",
          description: walkFromRackText,
        },
      ],
    },
  ];
}

/** Lime’s official app page (consumer site); links to App Store / Play. */
const LIME_APP_DOWNLOAD_URL = "https://www.li.me/the-app";

/** Max straight-line walk from a Lime pin to the venue we recommend (mi). */
const MICROMOBILITY_MAX_WALK_TO_VENUE_MI = 0.5;

function micromobilityHubLabelFromItem(item) {
  const rawName = (item?.name && String(item.name).trim()) || "";
  const rawAddress = (item?.address && String(item.address).trim()) || "";
  const omitGenericHubName =
    !rawName ||
    /^designated parking zone$/i.test(rawName) ||
    /^lime parking area \(approx\.\)$/i.test(rawName);
  if (!omitGenericHubName && rawName) return rawName;
  return rawAddress || "";
}

function sameMicromobilityPin(a, b) {
  if (!a?.location || !b?.location) return a === b;
  const la = a.location;
  const lb = b.location;
  return la.latitude === lb.latitude && la.longitude === lb.longitude;
}

function buildMicromobilityLimeHubSteps(
  destName,
  item,
  hubToVenueMi,
  intent,
  maxWalkRadiusMi,
  poolWasFallback,
) {
  const hubLabel = micromobilityHubLabelFromItem(item);
  const link = googleMapsPinUrl(
    item.location.latitude,
    item.location.longitude,
  );
  const radiusPhrase = `about ${maxWalkRadiusMi.toFixed(2)} mi walk of ${destName}`;
  const walkRestText =
    hubToVenueMi < 0.095
      ? `From that parking area to ${destName} is a very short walk.`
      : `About ${hubToVenueMi.toFixed(2)} mi on foot from that parking area to ${destName} (straight line).`;

  let step2Title;
  let step2Description;
  if (intent === "farthest") {
    step2Title = "Go to Parking at the Farther End of Your Range";
    if (poolWasFallback) {
      step2Description = hubLabel
        ? `${hubLabel} is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—no pin met the usual ${MICROMOBILITY_MAX_WALK_TO_VENUE_MI} mi walk cap; see the card note. Open the map for directions.`
        : `The map pin is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—see the card note about the walk-distance cap. Open the map for directions.`;
    } else {
      step2Description = hubLabel
        ? `${hubLabel} is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—the farthest Lime-related pin in our data within ${radiusPhrase} (your walk limit or ${MICROMOBILITY_MAX_WALK_TO_VENUE_MI} mi, whichever is less). Open the map for directions.`
        : `The map pin is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—the farthest in our data within ${radiusPhrase}. Open the map for directions.`;
    }
  } else {
    step2Title = "Go to the Closest Parking Pin";
    step2Description = hubLabel
      ? `${hubLabel} is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—the shortest walk among our Lime-related pins.`
      : `The map pin is about ${hubToVenueMi.toFixed(2)} mi from ${destName} (straight line)—the closest in our data.`;
  }

  return [
    {
      title: "Open the Lime App",
      description:
        "Find an available scooter or e-bike, see where you can start and end a ride, and unlock in the app. Pricing and ride rules are in the app.",
      link: LIME_APP_DOWNLOAD_URL,
      linkLabel: "Get the Lime app →",
    },
    {
      title: step2Title,
      description: `${step2Description} Check the Lime app for where you may park.`,
      link,
    },
    {
      title: "Walk the Rest of the Way",
      description: walkRestText,
    },
  ];
}

/**
 * Micromobility-only (no drive): recommend farthest Lime pin within walk budget as
 * primary (green); optional alternate (yellow) for closest pin with availability caveat.
 */
function buildMicromobilityLimeHubRecommendation(state) {
  if (
    !state?.modes?.includes("micromobility") ||
    state.modes.includes("drive") ||
    !appData?.parking
  ) {
    return [];
  }

  const dest = appData.destinations?.find(
    (d) => d.name === state.destination || d.slug === state.destination,
  );
  const destName = dest?.name || state.destination || "the venue";
  const vLat = dest?.latitude;
  const vLng = dest?.longitude;

  const hubs = appData.parking.micromobility;
  if (
    !Array.isArray(hubs) ||
    hubs.length === 0 ||
    typeof vLat !== "number" ||
    typeof vLng !== "number"
  ) {
    return [];
  }

  const walkBudget = state.walkMiles ?? 0;
  const maxWalkToVenue = Math.min(
    walkBudget,
    MICROMOBILITY_MAX_WALK_TO_VENUE_MI,
  );
  const itemsWithDist = [];
  for (const item of hubs) {
    const loc = item?.location;
    if (
      !loc ||
      typeof loc.latitude !== "number" ||
      typeof loc.longitude !== "number"
    ) {
      continue;
    }
    const d = haversineMiles(loc.latitude, loc.longitude, vLat, vLng);
    itemsWithDist.push({ item, d });
  }
  if (itemsWithDist.length === 0) return [];

  let pool = itemsWithDist.filter(({ d }) => d <= maxWalkToVenue + 1e-9);
  let poolWasFallback = false;
  if (pool.length === 0) {
    poolWasFallback = true;
    pool = itemsWithDist;
  }

  pool.sort((a, b) => a.d - b.d);
  const closest = pool[0];
  const farthest = pool[pool.length - 1];

  const meta = {
    requiredModes: ["micromobility"],
    minCost: 4,
    priority: 75,
  };

  const primary = {
    title: "Ride Lime, Then Walk",
    body: "Rent a Lime scooter or bike to speed up your travel time. Park it in a designated spot and walk a short distance.",
    badge: "On-demand",
    modeKey: "micromobility",
    variantKey: "farthestLimeHub",
    metadata: meta,
    _metadata: meta,
    limeHubToVenueMi: farthest.d,
    steps: buildMicromobilityLimeHubSteps(
      destName,
      farthest.item,
      farthest.d,
      "farthest",
      maxWalkToVenue,
      poolWasFallback,
    ),
  };

  const showClosestAlternate = !sameMicromobilityPin(
    closest.item,
    farthest.item,
  );
  if (showClosestAlternate) {
    primary.alternate = {
      title: "Ride Lime, Walk Less",
      body: "The closest pin in our data is your shortest walk, but it can be crowded. Open steps for the map pin and specifics.",
      badge: "Caution",
      modeKey: "micromobility",
      variantKey: "closestLimeHub",
      metadata: meta,
      _metadata: meta,
      isDiscouraged: true,
      limeHubToVenueMi: closest.d,
      steps: buildMicromobilityLimeHubSteps(
        destName,
        closest.item,
        closest.d,
        "closest",
        maxWalkToVenue,
        poolWasFallback,
      ),
    };
  }

  return [primary];
}

function buildRecommendationPlaceholders() {
  const walkMiles = state?.walkMiles ?? 0;
  const dest = appData?.destinations?.find(
    (d) => d.name === state?.destination || d.slug === state?.destination,
  );
  const destinationDisplay =
    dest?.name || state?.destination || "your destination";
  return {
    walkMiles: walkMiles.toFixed(1),
    destination: state?.destination ?? "",
    destinationDisplay,
    destinationEncoded: encodeURIComponent(
      `${destinationDisplay}, Grand Rapids, MI`,
    ),
    ...buildParkDashPlaceholderMap(state),
  };
}

/** Built-in Park & DASH card after placeholder substitution (for tests / previews). */
function getProcessedDriveShuttleRecommendation() {
  if (!state?.destination || !appData?.recommendations) return null;
  const slug = getDestinationSlug(state.destination);
  const raw = appData.recommendations[slug]?.["drive+shuttle"]?.default;
  if (!raw) return null;
  return processRecommendationData(
    {
      ...raw,
      modeKey: "drive+shuttle",
      variantKey: "default",
      metadata: raw._metadata,
    },
    buildRecommendationPlaceholders(),
  );
}

function buildRecommendation() {
  // Guard against state not being initialized
  if (!state) return { primary: null, alternate: null };

  const { modes, walkMiles, costDollars } = state;

  if (!modes || modes.length === 0) return { primary: null, alternate: null };

  const placeholders = buildRecommendationPlaceholders();

  const limeHubRecs = buildMicromobilityLimeHubRecommendation(state);
  const staticRecsRaw = getAllRecommendationsForDestination(state.destination);
  const staticRecs =
    limeHubRecs.length > 0
      ? staticRecsRaw.filter(
          (r) => !(r.modeKey === "micromobility" && r.variantKey === "default"),
        )
      : staticRecsRaw;
  const bikeRackRecs = buildBikeRackRecommendation(state);
  const transitAppRecs = buildTransitAppRecommendation(state);
  const syntheticNoOptions = buildSyntheticNoOptionsRecommendations();
  const parkingDriveRecs = buildParkingBasedDriveRecommendations(state);
  const allRecs = [
    ...staticRecs,
    ...bikeRackRecs,
    ...transitAppRecs,
    ...limeHubRecs,
    ...syntheticNoOptions,
    ...parkingDriveRecs,
  ];

  // Filter recommendations by basic constraints
  const filtered = allRecs.filter((rec) => {
    return (
      matchesModes(rec, modes) &&
      matchesWalkDistance(rec, walkMiles) &&
      matchesCost(rec, costDollars, state)
    );
  });

  if (filtered.length === 0) {
    const primary = processRecommendationData(
      { ...GENERIC_NO_SUGGESTIONS_FALLBACK_REC },
      placeholders,
    );
    return {
      primary,
      alternate: null,
      emptyRecommendationPool: true,
    };
  }

  // Calculate scores and sort
  const scored = filtered.map((rec) => ({
    rec,
    score: calculateScore(rec, state),
  }));

  // Sort by score (highest first), then pricier garages, then shorter walks for parking ties
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ag =
      a.rec.variantKey === "parkingGarage" ? a.rec.metadata?.maxCost : null;
    const bg =
      b.rec.variantKey === "parkingGarage" ? b.rec.metadata?.maxCost : null;
    if (
      typeof ag === "number" &&
      typeof bg === "number" &&
      Number.isFinite(ag) &&
      Number.isFinite(bg) &&
      ag !== bg
    ) {
      return bg - ag;
    }
    const aw =
      typeof a.rec.parkingWalkMiles === "number" ? a.rec.parkingWalkMiles : 99;
    const bw =
      typeof b.rec.parkingWalkMiles === "number" ? b.rec.parkingWalkMiles : 99;
    if (aw !== bw) return aw - bw;
    const alh =
      typeof a.rec.limeHubToVenueMi === "number" ? a.rec.limeHubToVenueMi : 99;
    const blh =
      typeof b.rec.limeHubToVenueMi === "number" ? b.rec.limeHubToVenueMi : 99;
    return alh - blh;
  });

  // Get primary recommendation; fall back to first real option if top is "no options"
  let primaryScored = scored[0];
  if (
    primaryScored?.rec.isNoOptions &&
    scored.some((s) => !s.rec.isNoOptions && s.score > 0)
  ) {
    primaryScored = scored.find((s) => !s.rec.isNoOptions && s.score > 0);
  }
  if (!primaryScored) {
    const primary = processRecommendationData(
      { ...GENERIC_NO_SUGGESTIONS_FALLBACK_REC },
      placeholders,
    );
    return {
      primary,
      alternate: null,
      emptyRecommendationPool: true,
    };
  }

  // Process primary recommendation
  let primary = processRecommendationData(primaryScored.rec, placeholders);
  if (!primary) {
    const fallbackPrimary = processRecommendationData(
      { ...GENERIC_NO_SUGGESTIONS_FALLBACK_REC },
      placeholders,
    );
    return {
      primary: fallbackPrimary,
      alternate: null,
      emptyRecommendationPool: true,
    };
  }

  // Handle alternate recommendation
  let alternate = null;
  let useExplicitAlternate = false;
  if (primary.alternate) {
    // Don't show surface lot alternate if user can't walk 0.5+ miles
    if (
      primaryScored.rec.modeKey === "drive" &&
      primaryScored.rec.variantKey === "parkingGarage" &&
      walkMiles < 0.5 &&
      primaryScored.rec.alternate &&
      primaryScored.rec.alternate.variantKey === "affordableLot"
    ) {
      // Explicit alternate filtered out, will fall through to check second-best option
      useExplicitAlternate = false;
    } else {
      alternate = primary.alternate;
      useExplicitAlternate = true;
    }
  }

  // If no explicit alternate (or it was filtered out), check if second-best option should be shown as alternate
  if (!useExplicitAlternate) {
    let secondScored = null;
    // When primary is Park & DASH, still surface a garage or surface lot from parking data when the user
    // can afford structured parking (already filtered by matchesCost). Prefer that over metered, which
    // otherwise wins as the first matching drive variant in the sorted list and hides walk-in ramps/lots.
    if (
      primaryScored.rec.modeKey === "drive+shuttle" &&
      modes.includes("drive")
    ) {
      secondScored = scored.find(
        (s) =>
          s !== primaryScored &&
          s.rec.modeKey === "drive" &&
          s.rec.fromParkingData === true &&
          (s.rec.variantKey === "parkingGarage" ||
            s.rec.variantKey === "affordableLot") &&
          s.score > 0 &&
          !s.rec.isNoOptions,
      );
      if (!secondScored && (state.costDollars ?? 0) < 12) {
        secondScored = scored.find(
          (s) =>
            s !== primaryScored &&
            s.rec.modeKey === "drive" &&
            s.rec.variantKey === "meteredParking" &&
            s.score > 0 &&
            !s.rec.isNoOptions,
        );
      }
    }
    if (!secondScored) {
      secondScored = scored.find(
        (s) => s !== primaryScored && s.score > 0 && !s.rec.isNoOptions,
      );
    }
    if (secondScored) {
      // For drive mode, show alternate if it's a different variant or has good score
      if (primaryScored.rec.modeKey === "drive") {
        const primaryKey = primaryScored.rec.parkingItemKey;
        const secondKey = secondScored.rec.parkingItemKey;
        const differentParkingSpot =
          primaryKey &&
          secondKey &&
          secondKey !== primaryKey &&
          secondScored.rec.modeKey === "drive";
        // Show alternate if it's a different variant, another parking pin, or another mode
        if (
          secondScored.rec.modeKey === "drive" &&
          (secondScored.rec.variantKey !== primaryScored.rec.variantKey ||
            differentParkingSpot)
        ) {
          alternate = processRecommendationData(secondScored.rec, placeholders);
        } else if (secondScored.rec.modeKey !== primaryScored.rec.modeKey) {
          // Or if it's a different mode
          alternate = processRecommendationData(secondScored.rec, placeholders);
        }
      } else if (secondScored.rec.modeKey !== primaryScored.rec.modeKey) {
        // Non-drive primary: show alternate if different mode
        alternate = processRecommendationData(secondScored.rec, placeholders);
      }
    }
  }

  return { primary, alternate, emptyRecommendationPool: false };
}

// Initialize application
async function init() {
  // Migrate old hash format to new format with destination path (don't overwrite yet if no hash - read params first)
  const initialHash = window.location.hash.slice(1); // Remove the #
  const defaultPath = "/visit";
  if (
    initialHash &&
    !initialHash.startsWith("/visit") &&
    !initialHash.startsWith("/data") &&
    !initialHash.startsWith("/modes")
  ) {
    // If hash exists but doesn't start with /visit or /data, migrate it
    if (initialHash.includes("=")) {
      window.location.hash = defaultPath + "?" + initialHash;
    } else {
      window.location.hash = defaultPath;
    }
  }
  // If no hash, set default after we've read params (see end of init) so we don't overwrite a hash that appears later

  // Load data first
  await loadData();

  // Initialize state from loaded data
  state = {
    destination: getDestinationFromHashPath() || "",
    day: "", // Don't prefill day
    time: "", // Don't prefill time
    flexibilityEarlyMins: appData.defaults.flexibilityEarlyMins,
    flexibilityLateMins: appData.defaults.flexibilityLateMins,
    modes: [],
    people: appData.defaults.people,
    walkMiles: appData.defaults.walkMiles,
    parkingMins: appData.defaults.parkingMins,
    costDollars: appData.defaults.costDollars,
  };

  // Initialize validModes from loaded data
  validModes = appData.validModes;

  // Read from URL fragment
  const params = parseFragment();
  if (params.modes !== undefined) {
    const modesArray = params.modes
      ? params.modes.split(",").filter((m) => validModes.includes(m))
      : [];
    state.modes = modesArray;
  } else {
    state.modes = defaultVisitModes();
  }

  if (params.day) {
    state.day = params.day;
    dayChanged = true; // Mark as changed since it came from fragment
  }
  if (params.time) {
    state.time = params.time;
    timeChanged = true; // Mark as changed since it came from fragment
  }
  if (params.people) {
    const peopleValue = Number(params.people);
    // Clamp to valid range (1-6)
    const clampedValue = Math.max(1, Math.min(6, peopleValue));
    if (clampedValue >= 1 && clampedValue <= 6) {
      state.people = clampedValue;
      peopleChanged = true; // Mark as changed since it came from fragment
    }
  }
  if (params.walk) {
    const walkValue = Number(params.walk);
    if (!isNaN(walkValue) && walkValue >= 0) {
      state.walkMiles = walkValue;
      walkChanged = true; // Mark as changed since it came from fragment
      walkSlider.value = walkValue;
      updatePreferencesVisibility(); // Update UI
    }
  }
  if (params.pay !== undefined) {
    const payValue = Number(params.pay);
    if (!isNaN(payValue) && payValue >= 0) {
      state.costDollars = payValue;
      costChanged = true; // Mark as changed since it came from fragment
      updatePreferencesVisibility(); // Update UI
    }
  }
  if (params.option !== undefined) {
    expandedStrategies = new Set(
      Array.isArray(params.option) ? params.option : [params.option],
    );
  }

  // Update reset button visibility after applying URL params (e.g. time=700 with no day)
  updateMinimizeButtonState();

  // Generate time options and initialize inputs
  generateTimeOptions();
  const destinationSelect = document.getElementById("destinationSelect");
  if (destinationSelect) {
    const destinations = Array.isArray(appData.destinations)
      ? [...appData.destinations].sort((a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
        )
      : [];
    destinationSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.textContent = "---";
    destinationSelect.appendChild(placeholder);
    destinations.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      destinationSelect.appendChild(opt);
    });
    destinationSelect.value = state.destination;
    if (state.destination) {
      destinationSelect.classList.remove("placeholder");
    } else {
      destinationSelect.classList.add("placeholder");
    }
    destinationSelect.addEventListener("change", () => {
      state.destination = destinationSelect.value;
      if (state.destination) {
        destinationSelect.classList.remove("placeholder");
      } else {
        destinationSelect.classList.add("placeholder");
      }
      updateFragment();
      updateResults();
      updateMinimizedView();
    });
  }
  daySelect.value = state.day || ""; // Clear day select if no day is set
  if (state.day) {
    daySelect.classList.remove("placeholder");
  } else {
    daySelect.classList.add("placeholder");
  }
  if (state.time) {
    timeSelect.value = state.time;
    timeSelect.classList.remove("placeholder");
  } else {
    timeSelect.value = ""; // Clear time select if no time is set
    timeSelect.classList.add("placeholder");
  }
  document.getElementById("peopleCount").textContent = state.people;

  // Update save button state
  updateSaveButtonState();

  // Collapse where/when card if all three required fields (destination, day, time) have values
  if (checkRequiredFields() && whereWhenContent && whereWhenMinimized) {
    minimizeWhereWhen();
  } else {
    // Update minimized view in case it's visible (shouldn't be, but just in case)
    updateMinimizedView();
  }

  // Initialize walk time estimate
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (walkTimeValue) {
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    walkTimeValue.textContent = walkMinutes;
  }

  // Set slider value AFTER all state initialization to avoid triggering input events
  costSlider.value = state.costDollars;
  earlySlider.value = state.flexibilityEarlyMins;
  lateSlider.value = state.flexibilityLateMins;
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;

  // Update Google Maps directions link
  updateDirectionsLink();

  // Expose state on window for testing (before rendering so tests can verify state)
  window.state = state;
  window.appData = appData;
  window.isParkingEnforced = isParkingEnforced;
  window.calculateRequiredMeteredParkingCost =
    calculateRequiredMeteredParkingCost;

  // Initialize UI
  updateModesSectionState();
  highlightMode();
  updatePreferencesVisibility();
  updateResetModesButtonVisibility();
  renderResults();
  // Final pass so reset button is correct after card expand/collapse and render
  updateMinimizeButtonState();

  // Set default hash only when there was no hash at load (so we didn't overwrite URL params like time=700)
  if (!initialHash) {
    window.location.hash = getDestinationPath();
  }

  if (isDataRoute()) {
    renderDataView();
  } else if (isModesRoute()) {
    renderModesView();
  } else {
    hideModesView();
    hideDataView();
  }
}

// Reset function to clear all URL fragments and reset state
function resetAll() {
  // Reset state to defaults
  state.destination = "";
  state.day = ""; // Don't prefill day
  state.time = ""; // Don't prefill time
  state.flexibilityEarlyMins = appData.defaults.flexibilityEarlyMins;
  state.flexibilityLateMins = appData.defaults.flexibilityLateMins;
  state.modes = defaultVisitModes();
  state.people = appData.defaults.people;
  state.walkMiles = appData.defaults.walkMiles;
  state.parkingMins = appData.defaults.parkingMins;
  state.costDollars = appData.defaults.costDollars;

  // Reset change flags
  dayChanged = false;
  timeChanged = false;
  peopleChanged = false;
  walkChanged = false;
  costChanged = false;

  // Clear expanded option steps
  expandedStrategies.clear();

  // Clear URL fragment completely (but keep destination path)
  window.location.hash = getDestinationPath();

  // Reset destination select to match state
  const destinationSelect = document.getElementById("destinationSelect");
  if (destinationSelect) {
    destinationSelect.value = state.destination;
    if (state.destination) {
      destinationSelect.classList.remove("placeholder");
    } else {
      destinationSelect.classList.add("placeholder");
    }
  }

  // Reset UI elements
  daySelect.value = state.day || ""; // Clear day select if no day is set
  if (state.day) {
    daySelect.classList.remove("placeholder");
  } else {
    daySelect.classList.add("placeholder");
  }
  if (state.time) {
    timeSelect.value = state.time;
    timeSelect.classList.remove("placeholder");
  } else {
    timeSelect.value = "";
    timeSelect.classList.add("placeholder");
  }
  document.getElementById("peopleCount").textContent = state.people;
  costSlider.value = state.costDollars;
  earlySlider.value = state.flexibilityEarlyMins;
  lateSlider.value = state.flexibilityLateMins;
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;

  // Reset walk slider
  walkSlider.value = state.walkMiles;
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (walkValue) walkValue.textContent = state.walkMiles.toFixed(1);
  if (walkUnit) walkUnit.textContent = " miles";
  if (walkTimeValue) {
    const walkMinutes = Math.round(state.walkMiles * 20);
    walkTimeValue.textContent = walkMinutes;
  }
  if (walkTime) walkTime.style.display = "inline";

  // Reset cost display
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  if (costValue) costValue.textContent = Math.round(state.costDollars);
  if (costPrefix) costPrefix.textContent = "$";

  // Update UI
  highlightMode();
  updatePreferencesVisibility();
  updateDirectionsLink();
  updateSaveButtonState();
  renderResults();
}

// Reset function to clear selected modes and preferences (walk/pay)
function resetModes() {
  // Remove modes, walk, and pay from URL fragment and reload
  const params = parseFragment();
  const newParts = [];

  // Keep only day, time, and people if they exist
  if (params.day) {
    newParts.push(`day=${encodeURIComponent(params.day)}`);
  }
  if (params.time) {
    newParts.push(`time=${timeToUrl(params.time)}`);
  }
  if (params.people) {
    newParts.push(`people=${encodeURIComponent(params.people)}`);
  }

  // Explicit empty modes so reload does not re-apply defaults
  newParts.push("modes=");

  // Update URL without walk or pay (modes cleared via modes=)
  const queryString = newParts.length > 0 ? `?${newParts.join("&")}` : "";
  window.location.hash = getDestinationPath() + queryString;

  // Reload the page to reset state
  window.location.reload();
}

// Attach reset button event listener (clear destination, day, time, and reset state)
const resetButton = document.getElementById("resetButton");
if (resetButton) {
  resetButton.addEventListener("click", (e) => {
    e.preventDefault();
    resetAll();
  });
}

// Attach reset modes button event listener
const resetModesButton = document.getElementById("resetModesButton");
if (resetModesButton) {
  resetModesButton.addEventListener("click", () => {
    resetModes();
  });
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

// Attach mode button event listeners
document.querySelectorAll(".modeBtn").forEach((btn) => {
  btn.addEventListener("click", function () {
    const mode = this.dataset.mode;
    if (mode) {
      toggleMode(mode);
    }
  });
});

// Start the application
init();
