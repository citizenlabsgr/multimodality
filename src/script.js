// Load data from data/ folder (config, strategies per destination, per-destination recommendations, parking)
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
  destinations: [],
  recommendations: {},
  handCraftedRecommendations: {},
  linkTexts: {},
  parking: {},
};

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
      { file: "garages.json", key: "garages" },
      { file: "lots.json", key: "lots" },
      { file: "meters.json", key: "meters" },
      { file: "racks.json", key: "racks" },
      { file: "micromobility.json", key: "micromobility" },
    ];
    const parkingResolves = await Promise.all(
      parkingCategories.map(({ file }) =>
        fetch(`data/parking/${file}`).then((r) => (r.ok ? r.json() : null)),
      ),
    );
    const parking = {
      garages: [],
      lots: [],
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

    const recommendationPromises = destinations.map((d) =>
      fetch(`data/recommendations/${d.slug}.json`).then((r) =>
        r.ok ? r.json().then((data) => ({ slug: d.slug, data })) : null,
      ),
    );
    const recommendationResults = await Promise.all(recommendationPromises);

    const recommendations = {};
    for (const result of recommendationResults) {
      if (result) recommendations[result.slug] = result.data;
    }

    appData = {
      ...config,
      destinations,
      handCraftedRecommendations,
      recommendations,
      linkTexts: config.linkTexts || {},
      parking,
    };
  } catch (error) {
    console.error("Failed to load data:", error);
    appData = { ...FALLBACK_DATA };
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
          label: item.name || "Location",
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

function formatParkingPrice(pricing) {
  if (!pricing || typeof pricing !== "object") return "Free";
  if (pricing.rate) return pricing.rate;
  if (pricing.evening) return pricing.evening;
  if (pricing.daytime) return pricing.daytime;
  if (pricing.events) return pricing.events;
  return "Free";
}

function updateDataViewMap(points) {
  const container = document.getElementById("dataViewMap");
  if (!container) return;
  if (!points || points.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  if (typeof L === "undefined") return;
  if (!dataMap) {
    dataMap = L.map("dataViewMap").setView([points[0].lat, points[0].lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(dataMap);
    dataMapPolylinesLayer = L.layerGroup().addTo(dataMap);
    dataMapMarkersLayer = L.layerGroup().addTo(dataMap);
  }
  dataMapPolylinesLayer.clearLayers();
  dataMapMarkersLayer.clearLayers();
  const tableStyle =
    "border-collapse:collapse;font-size:12px;font-family:system-ui,sans-serif";
  const thStyle =
    "text-align:left;padding:4px 16px 4px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;vertical-align:top";
  const tdStyle =
    "padding:4px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top";
  points.forEach((p) => {
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
          `<tr><th style="${thStyle}">Location</th><td style="${tdStyle}">${escapeHtml(p.locationName)}</td></tr>`,
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
          `<tr><th style="${thStyle}">Location</th><td style="${tdStyle}">${escapeHtml(p.locationName)}</td></tr>`,
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
      popupContent = escapeHtml(p.label);
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
  for (const p of points) {
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
  if (points.length === 1) {
    dataMap.setView([points[0].lat, points[0].lng], 16);
  } else {
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
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

  appView.classList.add("hidden");
  dataView.classList.remove("hidden");
  document.querySelector("main")?.classList.add("data-view-active");

  const isIndex = path === "" || path === "parking";
  const hideDetail =
    isIndex ||
    path === "strategies" ||
    path.startsWith("strategies/") ||
    path === "destinations";
  dataViewIndex.classList.toggle("hidden", !isIndex);
  dataViewDetail.classList.toggle("hidden", hideDetail);
  document.getElementById("dataViewParkingModes")?.classList.add("hidden");
  document.getElementById("dataViewStrategiesFilters")?.classList.add("hidden");
  document.getElementById("dataViewDestinationsBar")?.classList.add("hidden");
  document.getElementById("dataViewMap")?.classList.add("hidden");

  if (path === "") {
    // Index: list datasets with links
    const links = [
      { href: "#/data/parking", label: "parking" },
      { href: "#/data/strategies", label: "strategies" },
      { href: "#/data/destinations", label: "destinations" },
    ];
    const destinations = Array.isArray(appData.destinations)
      ? appData.destinations
      : [];
    destinations.forEach((d) => {
      links.push({
        href: `#/data/recommendations/${d.slug}`,
        label: `recommendations/${d.slug}`,
      });
    });
    dataViewIndex.innerHTML = links
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

  if (path === "parking") {
    const parkingKeys = [
      { file: "garages", key: "garages" },
      { file: "lots", key: "lots" },
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
          btn.classList.toggle("bg-slate-900", active);
          btn.classList.toggle("text-white", active);
          btn.classList.toggle("border-slate-900", active);
          if (!active) {
            btn.classList.add(
              "bg-white",
              "text-slate-700",
              "hover:bg-slate-100",
            );
          } else {
            btn.classList.add("hover:bg-slate-800");
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
              price: formatParkingPrice(item.pricing),
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
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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

  // Detail: show one dataset
  let title = path;
  let data = null;

  if (path.startsWith("parking/")) {
    const fileKey = path.slice("parking/".length);
    const parkingKeys = {
      garages: "garages",
      lots: "lots",
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
  } else if (path.startsWith("recommendations/")) {
    const slug = path.slice("recommendations/".length);
    title = `recommendations/${slug}.json`;
    data = appData.recommendations?.[slug] ?? null;
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
          price: formatParkingPrice(item.pricing),
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

  // Walk slider: disabled only if rideshare is the ONLY mode (everyone can walk a little)
  // If other modes are selected that need walking distance, keep it enabled
  const walkDisabled =
    state.modes.length === 1 && state.modes.includes("rideshare");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  walkSlider.disabled = walkDisabled;
  if (walkDisabled) {
    walkValue.textContent = "—";
    walkUnit.textContent = "";
    if (walkTime) walkTime.style.display = "none";
  } else {
    walkValue.textContent = state.walkMiles.toFixed(1);
    walkUnit.textContent = " miles";
    // Calculate walking time (assuming 3 mph average walking speed)
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    if (walkTimeValue) walkTimeValue.textContent = walkMinutes;
    if (walkTime) walkTime.style.display = "inline";
  }

  // Cost slider: disabled for bike mode (biking is free) or if shuttle is the only mode (DASH is free)
  const costDisabled =
    state.modes.includes("bike") ||
    (state.modes.length === 1 && state.modes.includes("shuttle"));
  costSlider.disabled = costDisabled;
  if (costDisabled) {
    costValue.textContent = "—";
    costPrefix.textContent = "";
  } else {
    // For transit and micromobility, show total cost (per-person * people), otherwise show per-person cost
    const displayCost =
      state.modes.includes("transit") || state.modes.includes("micromobility")
        ? state.costDollars * state.people
        : state.costDollars;
    // Show as whole dollar amount
    costValue.textContent = Math.round(displayCost);
    costPrefix.textContent = "$";
  }

  // Update cost label based on primary mode
  const primaryMode = state.modes.length > 0 ? state.modes[0] : "drive";
  costLabel.textContent = getCostLabel(primaryMode);

  // Gray out entire section if all preferences are disabled
  const allDisabled = walkDisabled && costDisabled;
  const preferencesSection = document.getElementById("preferencesSection");
  const preferencesHeading = document.getElementById("preferencesHeading");
  if (preferencesSection) {
    preferencesSection.classList.toggle("opacity-50", allDisabled);
  }
  if (preferencesHeading) {
    preferencesHeading.classList.toggle("opacity-50", allDisabled);
  }
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
  updateResults();
  updateMinimizeButtonState();
  // Don't update fragment here to avoid loop
});

function highlightMode() {
  document.querySelectorAll(".modeBtn").forEach((btn) => {
    const active = state.modes.includes(btn.dataset.mode);
    btn.classList.toggle("bg-slate-900", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("border-slate-900", active);
    // Update hover state based on active state (only if not disabled)
    if (!btn.disabled) {
      if (active) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-slate-800");
      } else {
        btn.classList.remove("hover:bg-slate-800");
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
  const preferencesSection = document.getElementById("preferencesSection");
  const modeButtons = document.querySelectorAll(".modeBtn");
  const isEnabled = checkRequiredFields();

  if (preferencesSection) {
    if (isEnabled) {
      preferencesSection.classList.remove("disabled");
    } else {
      preferencesSection.classList.add("disabled");
    }
  }

  // Disable/enable mode buttons
  modeButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
    if (!isEnabled) {
      btn.classList.add("opacity-50", "cursor-not-allowed");
      btn.classList.remove("hover:bg-slate-100", "hover:bg-slate-800");
    } else {
      btn.classList.remove("opacity-50", "cursor-not-allowed");
      // Add appropriate hover state based on active state
      const isActive = state.modes.includes(btn.dataset.mode);
      if (isActive) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-slate-800");
      } else {
        btn.classList.remove("hover:bg-slate-800");
        btn.classList.add("hover:bg-slate-100");
      }
    }
  });

  // Disable sliders when modes section is disabled
  if (walkSlider) {
    if (!isEnabled) {
      walkSlider.disabled = true;
    } else {
      // Re-enable if not disabled by other logic (e.g., rideshare mode)
      // updatePreferencesVisibility will handle the actual state
      updatePreferencesVisibility();
    }
  }
  if (costSlider) {
    if (!isEnabled) {
      costSlider.disabled = true;
    } else {
      // Re-enable if not disabled by other logic (e.g., bike mode)
      // updatePreferencesVisibility will handle the actual state
      updatePreferencesVisibility();
    }
  }
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

function renderResults() {
  const resultsEl = document.getElementById("results");
  resultsEl.innerHTML = "";

  const { primary, alternate } = buildRecommendation();

  // Build array of strategies so we can number them and support more than 2 later
  const strategies = [primary, alternate].filter(Boolean);
  const slug = getDestinationSlug(state.destination);
  const handCraftedAll = appData?.handCraftedRecommendations?.[slug] || [];
  const handCrafted = handCraftedAll.filter(handCraftedRecFits);
  const handCraftedTotalCost = (rec) =>
    (rec.steps || []).reduce(
      (sum, step) => sum + (typeof step.cost === "number" ? step.cost : 0),
      0,
    );
  handCrafted.sort((a, b) => handCraftedTotalCost(a) - handCraftedTotalCost(b));
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
                ? "Walk to destination"
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
              return `
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">${
                  index + 1
                }</span>
                <div class="flex-1 pt-0.5">
                  <div class="font-semibold text-sm text-slate-900">${modeLabel}</div>
                  <div class="text-sm text-slate-600 mt-1 leading-relaxed">${description}</div>
                  ${
                    mapHref
                      ? `<a href="${mapHref}" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block px-2.5 py-1 rounded border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors">View in maps →</a>`
                      : ""
                  }
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
            ${
              stepsExpanded ? "Hide" : "Show"
            } steps <span class="inline-block ml-1">${
              stepsExpanded ? "▲" : "▼"
            }</span>
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
          ? 'Show steps <span class="inline-block ml-1">▼</span>'
          : 'Hide steps <span class="inline-block ml-1">▲</span>';
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
            ${
              stepsExpanded ? "Hide" : "Show"
            } steps <span class="inline-block ml-1">${
              stepsExpanded ? "▲" : "▼"
            }</span>
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
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">${
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
                  ${
                    step.link
                      ? `<a href="${
                          step.link
                        }" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block px-2.5 py-1 rounded border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors">View in maps →</a>`
                      : ""
                  }
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
          const arrow = toggleBtn.querySelector("span span");
          if (arrow) {
            arrow.textContent = isHidden ? "▼" : "▲";
          }
          toggleBtn.innerHTML = isHidden
            ? 'Show steps <span class="inline-block ml-1">▼</span>'
            : 'Hide steps <span class="inline-block ml-1">▲</span>';
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
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
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

function estimateParkingCostRange(pricing, category) {
  const fallbacks = {
    meters: { min: 1, max: 7 },
    lots: { min: 8, max: 11 },
    garages: { min: 8, max: 30 },
  };
  const fb = fallbacks[category] || fallbacks.garages;
  if (!pricing || typeof pricing !== "object") return { ...fb };
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

function garageVariantAndPriority(costRange) {
  if (costRange.max >= 20 || costRange.min >= 20) {
    return { variantKey: "premiumRamp", priority: 60 };
  }
  return { variantKey: "cheaperGarage", priority: 50 };
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
  ];

  for (const { key, id } of driveCategories) {
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

      const costRange = estimateParkingCostRange(item.pricing, id);
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
        const g = garageVariantAndPriority(costRange);
        variantKey = g.variantKey;
        priority = g.priority;
      }
      if (walkBudget + 1e-9 < minWalkMiles) continue;

      const itemLabel = item.name || item.address || "Parking";
      const pricingNote = item.pricing
        ? Object.values(item.pricing).slice(0, 3).join(" · ")
        : "";
      const link = googleMapsPinUrl(loc.latitude, loc.longitude);

      let title;
      if (id === "meters") {
        title = "Park at metered street parking";
      } else if (id === "lots") {
        title = "Park at affordable surface lot and walk";
      } else if (variantKey === "premiumRamp") {
        title = "Park at premium parking garage";
      } else {
        title = "Park at parking garage";
      }

      const walkLabel =
        distanceMi >= 0.095 ? `${distanceMi.toFixed(2)} mi` : "a short";
      const costLabel =
        costRange.min === costRange.max
          ? `about $${costRange.min}`
          : `$${costRange.min}–$${costRange.max}`;
      const body = `${itemLabel} is ~${walkLabel} from ${destName}. Typical cost: ${costLabel}.${pricingNote ? " " + pricingNote : ""}`;

      const parkingItemKey = `${id}-${i}-${slugifyParkingItemKey(itemLabel)}`;

      const meta = {
        requiredModes: ["drive"],
        minWalkMiles,
        minCost: costRange.min,
        maxCost: costRange.max,
        priority,
      };

      const steps = [
        {
          title: `Park at ${itemLabel}`,
          description: item.address
            ? `${item.address}. ${pricingNote || "Confirm current rates on site."}`
            : `${pricingNote || "Confirm rates and hours before you park."}`,
          link,
        },
        {
          title: "Walk to destination",
          description: `Walk from your parking spot to ${destName} (~${walkLabel}).`,
        },
      ];

      let badge = "Budget-friendly";
      if (id === "meters") badge = "Affordable";
      else if (variantKey === "premiumRamp") badge = "Convenient";

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
      title: "Find free street parking",
      body: weekend
        ? "Spend 20 minutes in traffic circling the area to find street parking. Meters are not enforced on the weekend."
        : "Spend 20 minutes in traffic circling the area to find street parking. Meters are not enforced outside weekday enforcement hours.",
      badge: "Free",
      isDiscouraged: true,
      steps: [
        {
          title: "Spend 20 minutes in traffic looking for free street parking",
          description:
            "Circle the blocks looking for free unmetered parking. Watch for odd-even winter restrictions. This often takes 20+ minutes.",
          link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQ)}`,
          linkText: "View area on Google Maps",
        },
        {
          title: "Park and walk",
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

      // Check if there's free parking available
      const hasFreeParkingAvailable = state.walkMiles > 0.5;
      if (hasFreeParkingAvailable) {
        return false; // Don't show noCost if free parking is available
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

    if (rec.variantKey === "cheaperGarage") {
      // If user can walk 0.5+ miles and can pay $8-$11, prefer surface lot
      // But if they can't walk 0.5 miles, show garage
      // This preference is handled in scoring, not filtering
    }

    return true;
  }

  // Rideshare, transit (The Rapid), and micromobility (Lime) costs in data are one-way; user's "willing to pay" must cover both ways
  const bothWaysModes = ["rideshare", "transit", "micromobility"];
  if (bothWaysModes.includes(rec.modeKey)) {
    const minBothWays = minCost !== undefined ? 2 * minCost : undefined;
    const maxBothWays = maxCost !== undefined ? 2 * maxCost : undefined;
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

  // Boost score for rideshare
  if (rec.modeKey === "rideshare") {
    score += 30;
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

    // Higher cost options get higher scores (premium > garage > lot > meter > free)
    if (rec.variantKey === "premiumRamp") {
      score += 10;
    } else if (rec.variantKey === "cheaperGarage") {
      score += 5;
      // Prefer affordableLot over cheaperGarage when walk distance is sufficient
      if (
        state.walkMiles >= 0.5 &&
        effectiveCostDollars >= 8 &&
        effectiveCostDollars < 12
      ) {
        score -= 2; // Lower score to prefer affordableLot
      }
    } else if (rec.variantKey === "affordableLot") {
      score += 3;
      // Boost score when walk distance is sufficient
      if (
        state.walkMiles >= 0.5 &&
        effectiveCostDollars >= 8 &&
        effectiveCostDollars < 12
      ) {
        score += 2; // Higher score to prefer over cheaperGarage
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

function buildRecommendation() {
  // Guard against state not being initialized
  if (!state) return { primary: null, alternate: null };

  const { modes, walkMiles, costDollars } = state;

  if (!modes || modes.length === 0) return { primary: null, alternate: null };

  // Prepare placeholder values
  const placeholders = {
    walkMiles: walkMiles.toFixed(1),
    destination: state.destination,
    destinationEncoded: encodeURIComponent(
      state.destination + ", Grand Rapids, MI",
    ),
  };

  const staticRecs = getAllRecommendationsForDestination(state.destination);
  const parkingDriveRecs = buildParkingBasedDriveRecommendations(state);
  const allRecs = [...staticRecs, ...parkingDriveRecs];

  // Filter recommendations by basic constraints
  const filtered = allRecs.filter((rec) => {
    return (
      matchesModes(rec, modes) &&
      matchesWalkDistance(rec, walkMiles) &&
      matchesCost(rec, costDollars, state)
    );
  });

  // Calculate scores and sort
  const scored = filtered.map((rec) => ({
    rec,
    score: calculateScore(rec, state),
  }));

  // Sort by score (highest first), then prefer shorter walks for parking-derived ties
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aw =
      typeof a.rec.parkingWalkMiles === "number" ? a.rec.parkingWalkMiles : 99;
    const bw =
      typeof b.rec.parkingWalkMiles === "number" ? b.rec.parkingWalkMiles : 99;
    return aw - bw;
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
    return { primary: null, alternate: null };
  }

  // Process primary recommendation
  let primary = processRecommendationData(primaryScored.rec, placeholders);
  if (!primary) {
    return { primary: null, alternate: null };
  }

  // Handle alternate recommendation
  let alternate = null;
  let useExplicitAlternate = false;
  if (primary.alternate) {
    // Don't show surface lot alternate if user can't walk 0.5+ miles
    if (
      primaryScored.rec.modeKey === "drive" &&
      primaryScored.rec.variantKey === "cheaperGarage" &&
      walkMiles < 0.5 &&
      primary.alternate.title &&
      primary.alternate.title.toLowerCase().includes("surface lot")
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
    // Use first option that isn't primary and isn't noOptions (handles fallback when primary was changed)
    const secondScored = scored.find(
      (s) => s !== primaryScored && s.score > 0 && !s.rec.isNoOptions,
    );
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

  return { primary, alternate };
}

// Initialize application
async function init() {
  // Migrate old hash format to new format with destination path (don't overwrite yet if no hash - read params first)
  const initialHash = window.location.hash.slice(1); // Remove the #
  const defaultPath = "/visit";
  if (
    initialHash &&
    !initialHash.startsWith("/visit") &&
    !initialHash.startsWith("/data")
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
  if (params.modes) {
    const modesArray = params.modes
      .split(",")
      .filter((m) => validModes.includes(m));
    if (modesArray.length > 0) {
      state.modes = modesArray;
    }
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
  } else {
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
  state.modes = [];
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

  // Update URL without modes, walk, or pay
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
