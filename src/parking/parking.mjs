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

/** `#/parking` — slider max (50) means no evening price cap; scale is 0–50 in $5 steps. */
const PARKING_MAX_EVENING_SLIDER_CEILING = 50;
const PARKING_MAX_EVENING_SLIDER_STEP = 5;
/** When `pay` is omitted from the URL, default to max (`Any price`) for a short `#/parking` link. */
const PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE =
  PARKING_MAX_EVENING_SLIDER_CEILING;
const PARKING_PAY_QUERY_KEY = "pay";
const PARKING_PAY_QUERY_KEY_LEGACY = "maxEvening";

/**
 * Straight-line miles from parking to selected destination (~3 mph for minute hints).
 * **Internal/DOM index:** **0** → no distance; **1…15** → **0.1…1.5 mi**.
 * **default** index **10** = **1.0 mi** (URL omits `walk`).
 */
const PARKING_MAX_WALK_MI_MAX = 1.5;
const PARKING_MAX_WALK_SLIDER_CEILING_IDX = Math.round(
  PARKING_MAX_WALK_MI_MAX * 10,
);
const PARKING_DEFAULT_WALK_SLIDER_INDEX = 10;
const PARKING_WALK_QUERY_KEY = "walk";
const PARKING_WALK_QUERY_KEY_LEGACY = "maxWalk";
const PARKING_WALK_MINUTES_PER_MILE = 20;
/** Show feet (with minute hint) when under this mileage. */
const PARKING_WALK_FEET_UNDER_MI = 0.25;

/** @param {unknown} dom — `<input>` value (**0–15**) */
function snapParkingWalkDomSliderValue(dom) {
  const v = Number.parseInt(String(dom), 10);
  if (!Number.isFinite(v)) return PARKING_DEFAULT_WALK_SLIDER_INDEX;
  return Math.min(PARKING_MAX_WALK_SLIDER_CEILING_IDX, Math.max(0, v));
}

/** @param {unknown} idx — logical index: **0** no distance, **1…15** = tenth-miles */
function snapParkingWalkInternalIndex(idx) {
  const v = Number.parseInt(String(idx), 10);
  if (!Number.isFinite(v)) return PARKING_DEFAULT_WALK_SLIDER_INDEX;
  return Math.min(PARKING_MAX_WALK_SLIDER_CEILING_IDX, Math.max(0, v));
}

/** @param {unknown} dom */
function parkingWalkInternalFromDom(dom) {
  return snapParkingWalkDomSliderValue(dom);
}

/** @param {number} internalIx */
function parkingWalkDomFromInternal(internalIx) {
  return snapParkingWalkInternalIndex(internalIx);
}

/** Estimated walk time at ~3 mph. */
function parkingWalkEstimateMinutesForMiles(miles) {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  return Math.max(1, Math.round(miles * PARKING_WALK_MINUTES_PER_MILE));
}

/** @param {number} walkSliderIndex — internal: **0** no distance; **1…15** → **0.1 … 1.5** mi */
function parkingWalkOutputLabelFromSliderIndex(walkSliderIndex) {
  const i = snapParkingWalkInternalIndex(walkSliderIndex);
  if (i === 0) return "Any distance";
  const miles = i / 10;
  const min = parkingWalkEstimateMinutesForMiles(miles);
  if (miles < PARKING_WALK_FEET_UNDER_MI) {
    const ft = Math.round(miles * 5280);
    return `${ft} ft (~${min} min)`;
  }
  const miTxt = miles === 1 ? "1 mi" : `${Number(miles.toFixed(1))} mi`;
  return `${miTxt} (~${min} min)`;
}

function formatParkingMaxWalkHashValue(walkSliderIndex) {
  const ix = snapParkingWalkInternalIndex(walkSliderIndex);
  if (ix === 0) return "0";
  return String(Number((ix / 10).toFixed(1)));
}

function getParkingWalkCapMilesFromHash() {
  const params = getParkingRouteSearchParams();
  let raw = params.get(PARKING_WALK_QUERY_KEY);
  if (raw == null || String(raw).trim() === "") {
    raw = params.get(PARKING_WALK_QUERY_KEY_LEGACY);
  }
  if (raw == null || String(raw).trim() === "") {
    return 1;
  }
  const t = String(raw).trim().toLowerCase();
  if (t === "0" || t === "0.0") return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 0;
  const snapped = Math.round(Math.min(n, PARKING_MAX_WALK_MI_MAX) * 10) / 10;
  if (!Number.isFinite(snapped) || snapped < 0) return 0;
  return snapped;
}

function walkSliderIndexFromCapMiles(capMiles) {
  if (capMiles == null) return PARKING_DEFAULT_WALK_SLIDER_INDEX;
  const ix = Math.round(capMiles * 10);
  return Math.min(PARKING_MAX_WALK_SLIDER_CEILING_IDX, Math.max(0, ix));
}

function resolvedParkingWalkCapMiles(walkSliderIndexOverride) {
  if (
    walkSliderIndexOverride !== undefined &&
    walkSliderIndexOverride !== null
  ) {
    const ix = snapParkingWalkInternalIndex(walkSliderIndexOverride);
    return ix / 10;
  }
  const walkSlider = document.getElementById("parkingMaxWalkSlider");
  if (walkSlider) {
    const ix = parkingWalkInternalFromDom(walkSlider.value);
    return ix / 10;
  }
  return getParkingWalkCapMilesFromHash();
}

function getParkingMaxWalkSliderValueForHash() {
  const el = document.getElementById("parkingMaxWalkSlider");
  if (!el) return PARKING_DEFAULT_WALK_SLIDER_INDEX;
  return parkingWalkInternalFromDom(el.value);
}

function syncParkingWalkSliderFromHash() {
  const slider = document.getElementById("parkingMaxWalkSlider");
  const out = document.getElementById("parkingMaxWalkBudgetOut");
  if (!slider) return;
  const cap = getParkingWalkCapMilesFromHash();
  const ix = walkSliderIndexFromCapMiles(cap);
  slider.value = String(parkingWalkDomFromInternal(ix));
  if (out) out.textContent = parkingWalkOutputLabelFromSliderIndex(ix);
}

function syncParkingWalkOutputLive() {
  const slider = document.getElementById("parkingMaxWalkSlider");
  const out = document.getElementById("parkingMaxWalkBudgetOut");
  if (!slider || !out) return;
  out.textContent = parkingWalkOutputLabelFromSliderIndex(
    parkingWalkInternalFromDom(slider.value),
  );
}

function ensureParkingWalkDelegation() {
  if (parkingWalkDelegated) return;
  const slider = document.getElementById("parkingMaxWalkSlider");
  if (!slider) return;
  parkingWalkDelegated = true;
  slider.addEventListener("input", () => {
    syncParkingWalkOutputLive();
    scheduleParkingMapOverlaySync();
  });
  slider.addEventListener("change", () => {
    const dom = snapParkingWalkDomSliderValue(slider.value);
    slider.value = String(dom);
    const ix = parkingWalkInternalFromDom(dom);
    syncParkingWalkOutputLive();
    const keys = new Set(getEnabledParkingKeys());
    const dest = getParkingDestinationSlugFromSelect();
    window.location.hash = buildParkingHashFromState(
      keys,
      dest,
      chooseBestParkingStartSpotId(),
      undefined,
      ix,
    );
    if (parkingMap) syncParkingMapOverlays(parkingMap);
  });
}

function scheduleParkingMapOverlaySync() {
  if (parkingOverlaySyncRaf) cancelAnimationFrame(parkingOverlaySyncRaf);
  parkingOverlaySyncRaf = requestAnimationFrame(() => {
    parkingOverlaySyncRaf = 0;
    if (parkingMap) syncParkingMapOverlays(parkingMap, { fit: false });
  });
}

/** Snaps to the nearest step in [0, **PARKING_MAX_EVENING_SLIDER_CEILING**] (typically from URL parsing). */
function snapParkingEveningSliderSteps(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return PARKING_MAX_EVENING_SLIDER_CEILING;
  const clamped = Math.max(0, Math.min(PARKING_MAX_EVENING_SLIDER_CEILING, v));
  const snapped =
    Math.round(clamped / PARKING_MAX_EVENING_SLIDER_STEP) *
    PARKING_MAX_EVENING_SLIDER_STEP;
  return Math.min(snapped, PARKING_MAX_EVENING_SLIDER_CEILING);
}

/**
 * SVG overlap paint order (bottom → top): earlier categories are underneath when circles overlap.
 * Public garages (purple) render above private garages (orange).
 */
const PARKING_CATEGORY_PAINT_ORDER = [
  "private-lot",
  "public-lot",
  "private-garage",
  "public-garage",
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

/** Card subheading label (singular) for parking category names. */
function singularizeParkingCategoryLabel(label) {
  const raw = String(label || "").trim();
  if (!raw) return "";
  if (/\bGarages\b/.test(raw)) return raw.replace(/\bGarages\b/g, "Garage");
  if (/\bLots\b/.test(raw)) return raw.replace(/\bLots\b/g, "Lot");
  return raw;
}

function parseDollarAmountsFromPriceText(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const nums = [];
  const re = /\$(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

/** Sentinels from {@link parkingSpotEveningPriceCeilingOrAbsent} (numeric ceilings ≥ 0). */
const PARKING_EVENING_PRICE_ABSENT = null;
/** Tier text exists (not wholly empty pricing) but no parseable dollars and not a free window — still visible when pay > free-only. */
const PARKING_EVENING_PRICE_AMBIGUOUS_PROSE = -1;

function pricingObjectHasAnyKnownTierField(pricing) {
  if (!pricing || typeof pricing !== "object") return false;
  for (const k of ["evening", "events", "hourlyRate", "rate", "daytime"]) {
    if (typeof pricing[k] === "string" && pricing[k].trim()) return true;
  }
  return false;
}

/**
 * ArcGIS / OSM prose that describes free parking during evenings or weekends (no `$` in source).
 * Grand Rapids meters: free after 7pm weekdays and weekends — visitor map sometimes uses `hourlyRate` for that prose.
 */
function parkingPriceTextImpliesEveningFree(text) {
  const s = typeof text === "string" ? text.trim().toLowerCase() : "";
  if (!s) return false;
  if (/\bfree\b/.test(s)) return true;
  if (/no\s+(charge|fee)\b/.test(s)) return true;
  if (/\bcomplimentary\b/.test(s)) return true;
  if (/\b\$0\b/.test(text || "")) return true;
  if (/\bweekends?\b/.test(s) && /\bweekdays?\b/.test(s) && /\bafter\b/.test(s))
    return true;
  if (/\bweekdays?\s+after\s+7\b/.test(s)) return true;
  if (/\bafter\s+7\s*:?\s*(pm|00)\b/.test(s)) return true;
  if (/\bafter\s+7\s*pm\b/.test(s)) return true;
  return false;
}

function pickEveningTierStringForCap(pricing, categoryKey) {
  const isPublic =
    categoryKey === "public-garage" || categoryKey === "public-lot";
  if (typeof pricing.evening === "string" && pricing.evening.trim()) {
    return pricing.evening.trim();
  }
  if (isPublic && typeof pricing.events === "string" && pricing.events.trim()) {
    return pricing.events.trim();
  }
  if (
    isPublic &&
    typeof pricing.hourlyRate === "string" &&
    pricing.hourlyRate.trim()
  ) {
    return pricing.hourlyRate.trim();
  }
  if (typeof pricing.rate === "string" && pricing.rate.trim()) {
    return pricing.rate.trim();
  }
  if (typeof pricing.daytime === "string" && pricing.daytime.trim()) {
    return pricing.daytime.trim();
  }
  if (
    !isPublic &&
    typeof pricing.events === "string" &&
    pricing.events.trim()
  ) {
    return pricing.events.trim();
  }
  return "";
}

/**
 * Worst-case posted dollars for evening-style pricing (used vs max-evening filter).
 * **`null`** means no pricing tier fields at all (true unknown). **`-1`** means prose without dollars
 * (still shown unless pay is free-only). **`0`** means inferred free evenings/weekends.
 */
function parkingSpotEveningPriceCeilingOrAbsent(pricing, categoryKey) {
  if (!pricing || typeof pricing !== "object")
    return PARKING_EVENING_PRICE_ABSENT;
  if (!pricingObjectHasAnyKnownTierField(pricing))
    return PARKING_EVENING_PRICE_ABSENT;

  const tier = pickEveningTierStringForCap(pricing, categoryKey);
  if (!tier) return PARKING_EVENING_PRICE_ABSENT;

  const nums = parseDollarAmountsFromPriceText(tier);
  if (nums.length > 0) return Math.max(...nums);

  if (parkingPriceTextImpliesEveningFree(tier)) return 0;

  return PARKING_EVENING_PRICE_AMBIGUOUS_PROSE;
}

function parkingSpotPassesEveningBudget(
  pricing,
  categoryKey,
  budgetCapDollars,
) {
  if (
    budgetCapDollars == null ||
    typeof budgetCapDollars !== "number" ||
    !Number.isFinite(budgetCapDollars) ||
    budgetCapDollars >= PARKING_MAX_EVENING_SLIDER_CEILING
  ) {
    return true;
  }
  const ceil = parkingSpotEveningPriceCeilingOrAbsent(pricing, categoryKey);
  if (ceil === PARKING_EVENING_PRICE_ABSENT) return false;
  if (ceil === PARKING_EVENING_PRICE_AMBIGUOUS_PROSE)
    return budgetCapDollars > 0;
  return ceil <= budgetCapDollars;
}

function getParkingEveningBudgetCapFromHash() {
  const params = getParkingRouteSearchParams();
  let raw = params.get(PARKING_PAY_QUERY_KEY);
  if (raw == null || String(raw).trim() === "") {
    raw = params.get(PARKING_PAY_QUERY_KEY_LEGACY);
  }
  if (raw == null || String(raw).trim() === "") {
    return PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    return PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE;
  }
  const snapped = snapParkingEveningSliderSteps(n);
  if (snapped >= PARKING_MAX_EVENING_SLIDER_CEILING) return null;
  return snapped;
}

function resolvedParkingEveningBudgetCap(budgetCapOverride) {
  if (budgetCapOverride !== undefined && budgetCapOverride !== null) {
    const snapped = snapParkingEveningSliderSteps(budgetCapOverride);
    if (snapped < PARKING_MAX_EVENING_SLIDER_CEILING) return snapped;
    return null;
  }
  const paySlider = document.getElementById("parkingMaxEveningSlider");
  if (paySlider) {
    const snapped = snapParkingEveningSliderSteps(paySlider.value);
    if (snapped < PARKING_MAX_EVENING_SLIDER_CEILING) return snapped;
    return null;
  }
  return getParkingEveningBudgetCapFromHash();
}

function getParkingMaxEveningSliderValueForHash() {
  const el = document.getElementById("parkingMaxEveningSlider");
  if (!el) return PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE;
  return snapParkingEveningSliderSteps(el.value);
}

/** Human label beside the slider (`cap` **null** = any price); **0** shows **Free only**. */
function parkingMaxEveningBudgetOutputLabel(cap) {
  if (cap == null) return "Any price";
  const n = snapParkingEveningSliderSteps(cap);
  if (n >= PARKING_MAX_EVENING_SLIDER_CEILING) return "Any price";
  if (n === 0) return "Free only";
  return `$${n}`;
}

function syncParkingEveningBudgetSliderFromHash() {
  const slider = document.getElementById("parkingMaxEveningSlider");
  const out = document.getElementById("parkingMaxEveningBudgetOut");
  if (!slider) return;
  const cap = getParkingEveningBudgetCapFromHash();
  const pos =
    cap == null
      ? PARKING_MAX_EVENING_SLIDER_CEILING
      : snapParkingEveningSliderSteps(cap);
  slider.value = String(pos);
  if (out) out.textContent = parkingMaxEveningBudgetOutputLabel(cap);
}

function syncParkingEveningBudgetOutputLive() {
  const slider = document.getElementById("parkingMaxEveningSlider");
  const out = document.getElementById("parkingMaxEveningBudgetOut");
  if (!slider || !out) return;
  const snapped = snapParkingEveningSliderSteps(slider.value);
  out.textContent = parkingMaxEveningBudgetOutputLabel(snapped);
}

function ensureParkingEveningBudgetDelegation() {
  if (parkingEveningBudgetDelegated) return;
  const slider = document.getElementById("parkingMaxEveningSlider");
  if (!slider) return;
  parkingEveningBudgetDelegated = true;
  slider.addEventListener("input", () => {
    syncParkingEveningBudgetOutputLive();
    scheduleParkingMapOverlaySync();
  });
  slider.addEventListener("change", () => {
    const v = snapParkingEveningSliderSteps(slider.value);
    slider.value = String(v);
    syncParkingEveningBudgetOutputLive();
    const keys = new Set(getEnabledParkingKeys());
    const dest = getParkingDestinationSlugFromSelect();
    window.location.hash = buildParkingHashFromState(
      keys,
      dest,
      chooseBestParkingStartSpotId(),
      undefined,
      undefined,
    );
    if (parkingMap) syncParkingMapOverlays(parkingMap);
  });
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

/** Index in overlap paint order (`PARKING_CATEGORY_PAINT_ORDER`, bottom → top). */
function parkingCategoryPaintIndex(categoryKey) {
  const i = PARKING_CATEGORY_PAINT_ORDER.indexOf(categoryKey);
  return i === -1 ? PARKING_CATEGORY_PAINT_ORDER.length : i;
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
let parkingSpotPickLayerGroup = null;
let parkingStartFinishLineLayerGroup = null;
let parkingFilterBarDelegated = false;
let parkingDestinationSelectDelegated = false;
let parkingResetDelegated = false;
let parkingEveningBudgetDelegated = false;
let parkingWalkDelegated = false;
let parkingOverlaySyncRaf = 0;

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
  if (pricing.events) return pricing.events;
  if (pricing.evening) return pricing.evening;
  if (pricing.rate) return pricing.rate;
  if (pricing.daytime) return pricing.daytime;
  return privateOsm ? "Unknown" : "Free";
}

/** Whether `s` looks like a dollar amount (not prose-only Hour_Rate garbage). */
function parkingCostTextLooksLikeRate(s) {
  if (typeof s !== "string" || s.trim() === "") return false;
  return /[\$€£]|\d+\.\d{2}\b/.test(s);
}

/**
 * When ArcGIS has both **EVENT_CHRG** (`events`) and **Hour_Rate** (`hourlyRate`), show both in the popup.
 * @returns {{ text: string, hourlyHint: boolean } | null}
 */
function parkingMapEventPlusHourlySupplement(eventsText, hourlyText) {
  const ev = typeof eventsText === "string" ? eventsText.trim() : "";
  const hr = typeof hourlyText === "string" ? hourlyText.trim() : "";
  if (!ev || !hr) return null;
  const evLo = ev.replace(/\s+/g, " ").toLowerCase();
  const hrLo = hr.replace(/\s+/g, " ").toLowerCase();
  if (evLo === hrLo) return null;
  const alreadyHourly = /\b(per\s+hour|\/hr|hourly)\b/i.test(hr);
  return {
    text: hr,
    hourlyHint: parkingCostTextLooksLikeRate(hr) && !alreadyHourly,
  };
}

/**
 * Cost line for `#/parking` popups: prefers ArcGIS `hourlyRate` when set, else events → evening → rate → daytime (see {@link formatParkingPrice}).
 * When **`events`** and **`hourlyRate`** are both set (city map), primary line is the **event** charge plus **`hourlyRate`** as a supplement (weekend / hourly context).
 * @returns {{ text: string, costHourlyHint: boolean, costSupplement?: string, costSupplementHint?: boolean }}
 */
function getParkingMapCostDisplay(pricing, categoryKey) {
  const privateOsm =
    categoryKey === "private-garage" || categoryKey === "private-lot";
  if (!pricing || typeof pricing !== "object") {
    return { text: privateOsm ? "Unknown" : "Free", costHourlyHint: false };
  }
  const eventsRaw =
    typeof pricing.events === "string" ? pricing.events.trim() : "";
  const hrRaw =
    typeof pricing.hourlyRate === "string" ? pricing.hourlyRate.trim() : "";

  if (eventsRaw && hrRaw) {
    const extra = parkingMapEventPlusHourlySupplement(eventsRaw, hrRaw);
    if (extra) {
      return {
        text: eventsRaw,
        costHourlyHint: false,
        costSupplement: extra.text,
        costSupplementHint: extra.hourlyHint,
      };
    }
    return { text: eventsRaw, costHourlyHint: false };
  }

  if (hrRaw) {
    const alreadyHourly = /\b(per\s+hour|\/hr|hourly)\b/i.test(hrRaw);
    return {
      text: hrRaw,
      costHourlyHint: parkingCostTextLooksLikeRate(hrRaw) && !alreadyHourly,
    };
  }
  if (pricing.events)
    return {
      text: String(pricing.events).trim(),
      costHourlyHint: false,
    };
  if (pricing.evening)
    return {
      text: String(pricing.evening).trim(),
      costHourlyHint: false,
    };
  if (pricing.rate)
    return {
      text: String(pricing.rate).trim(),
      costHourlyHint: false,
    };
  if (pricing.daytime)
    return {
      text: String(pricing.daytime).trim(),
      costHourlyHint: false,
    };
  return { text: privateOsm ? "Unknown" : "Free", costHourlyHint: false };
}

/**
 * Pull a stall count from scraped `availability` text (e.g. `291 spaces; …`, OSM `Capacity: 61`).
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseTotalSpacesFromAvailability(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const s = raw.trim();
  let m = s.match(/(\d+)\s*spaces?\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  m = s.match(/Capacity:\s*(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

/** Venue slug from `#/parking?finish=…`, or legacy `destination` / `dest`, or "" if absent / invalid. */
function parseParkingDestSlugFromHash() {
  const params = getParkingRouteSearchParams();
  let raw = null;
  if (params.has("finish")) raw = params.get("finish");
  else if (params.has("destination")) raw = params.get("destination");
  else if (params.has("dest")) raw = params.get("dest");
  if (raw == null || String(raw).trim() === "") return "";
  const slug = String(raw).trim();
  const ok =
    Array.isArray(appData?.destinations) &&
    appData.destinations.some((d) => d.slug === slug);
  return ok ? slug : "";
}

/** Query param for selected parking start pin on `#/parking` (`category~lat~lng`, 6dp). Legacy: `spot`. */
const PARKING_START_QUERY_KEY = "start";

/**
 * Stable id for a parking circle (category + coordinates to 6 decimals).
 * @param {string} categoryKey
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function encodeParkingSpotId(categoryKey, lat, lng) {
  if (!PARKING_MAP_ITEM_KEYS.includes(categoryKey)) return "";
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  )
    return "";
  return `${categoryKey}~${lat.toFixed(6)}~${lng.toFixed(6)}`;
}

/**
 * @param {string} raw
 * @returns {{ categoryKey: string, lat: number, lng: number } | null}
 */
function parseParkingSpotIdToken(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const parts = s.split("~");
  if (parts.length !== 3) return null;
  const [cat, la, lo] = parts;
  if (!PARKING_MAP_ITEM_KEYS.includes(cat)) return null;
  const lat = Number(la);
  const lng = Number(lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { categoryKey: cat, lat, lng };
}

/** @param {string} raw */
function normalizeParkingSpotId(raw) {
  const p = parseParkingSpotIdToken(raw);
  if (!p) return null;
  return encodeParkingSpotId(p.categoryKey, p.lat, p.lng);
}

function isParkingSpotIdKnown(spotId) {
  if (!spotId) return false;
  const norm = normalizeParkingSpotId(spotId);
  if (!norm) return false;
  return getAllParkingSpotMarkers().some((m) => m.spotId === norm);
}

/** Normalized start-spot id from hash if valid for current filters/data, else `undefined`. */
function getParkingSpotIdForHash() {
  const params = getParkingRouteSearchParams();
  let raw = params.get(PARKING_START_QUERY_KEY);
  if (raw == null || String(raw).trim() === "") raw = params.get("spot");
  if (raw == null || String(raw).trim() === "") return undefined;
  const n = normalizeParkingSpotId(String(raw).trim());
  if (!n) return undefined;
  return isParkingSpotIdKnown(n) ? n : undefined;
}

function buildParkingHashFromState(
  enabledKeys,
  destSlug,
  spotId,
  maxEveningSliderValue,
  maxWalkSliderValue,
) {
  const sliderValOnly =
    maxEveningSliderValue === undefined || maxEveningSliderValue === null;
  const sliderVal = sliderValOnly
    ? getParkingMaxEveningSliderValueForHash()
    : snapParkingEveningSliderSteps(maxEveningSliderValue);

  const walkIxOnly =
    maxWalkSliderValue === undefined || maxWalkSliderValue === null;
  const walkIx = walkIxOnly
    ? getParkingMaxWalkSliderValueForHash()
    : snapParkingWalkInternalIndex(maxWalkSliderValue);

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
    parts.push(`finish=${encodeURIComponent(d)}`);
  }
  if (typeof sliderVal === "number" && Number.isFinite(sliderVal)) {
    if (sliderVal >= PARKING_MAX_EVENING_SLIDER_CEILING) {
      if (
        PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE <
        PARKING_MAX_EVENING_SLIDER_CEILING
      ) {
        parts.push(
          `${PARKING_PAY_QUERY_KEY}=${PARKING_MAX_EVENING_SLIDER_CEILING}`,
        );
      }
    } else if (sliderVal !== PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE) {
      parts.push(`${PARKING_PAY_QUERY_KEY}=${Math.round(sliderVal)}`);
    }
  }
  if (walkIx === 0) {
    parts.push(`${PARKING_WALK_QUERY_KEY}=0`);
  } else if (walkIx !== PARKING_DEFAULT_WALK_SLIDER_INDEX) {
    parts.push(
      `${PARKING_WALK_QUERY_KEY}=${formatParkingMaxWalkHashValue(walkIx)}`,
    );
  }
  let spotNorm = "";
  if (typeof spotId === "string" && spotId.trim() !== "") {
    const n = normalizeParkingSpotId(spotId.trim());
    if (n) {
      const enabledArr = [...enabled];
      if (
        getAllParkingSpotMarkers(enabledArr, sliderVal, walkIx).some(
          (m) => m.spotId === n,
        )
      )
        spotNorm = n;
    }
  }
  if (spotNorm)
    parts.push(`${PARKING_START_QUERY_KEY}=${encodeURIComponent(spotNorm)}`);
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
  window.location.hash = buildParkingHashFromState(
    current,
    dest,
    chooseBestParkingStartSpotId(current),
    undefined,
    undefined,
  );
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
    undefined,
    PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE,
    PARKING_DEFAULT_WALK_SLIDER_INDEX,
  );
  if (window.location.hash === nextHash) {
    const sel = document.getElementById("parkingDestinationSelect");
    if (sel && sel.value !== "") {
      sel.value = "";
      syncParkingDestinationSelectAppearance();
    }
    syncParkingEveningBudgetSliderFromHash();
    syncParkingWalkSliderFromHash();
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
      chooseBestParkingStartSpotId(),
      undefined,
      undefined,
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
  const where = document.createElement("span");
  where.className = "shrink-0 text-xs font-medium text-slate-600";
  where.textContent = "To park in";
  bar.appendChild(where);
  for (const categoryId of PARKING_MAP_ITEM_KEYS) {
    const dataKey = parkingCategoryDataKey(categoryId);
    const rawLabel = parking?.categoryNames?.[dataKey] || categoryId;
    const label = String(rawLabel)
      .replace(/\bParking\b\s*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const active = enabled.has(categoryId);
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.parkingCategory = categoryId;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.setAttribute("aria-label", `${active ? "Hide" : "Show"} ${label}`);
    b.textContent = label;
    const layout =
      "parking-category-filter-btn rounded-md border px-1.5 py-1 text-xs font-medium transition-colors";
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
  // TODO: Enable #parkingAndDashCheckbox and wire DASH-aware parking filtering.
  const dashLabel = document.createElement("label");
  dashLabel.className =
    "parking-dash-filter ml-auto flex shrink-0 cursor-not-allowed items-center gap-2 text-xs font-medium text-slate-500 select-none";
  const dashCb = document.createElement("input");
  dashCb.type = "checkbox";
  dashCb.id = "parkingAndDashCheckbox";
  dashCb.className =
    "size-4 shrink-0 cursor-not-allowed rounded border-slate-300 accent-green-700 disabled:opacity-60";
  dashCb.disabled = true;
  dashCb.setAttribute("aria-disabled", "true");
  dashLabel.setAttribute("for", "parkingAndDashCheckbox");
  dashLabel.appendChild(dashCb);
  dashLabel.appendChild(document.createTextNode("And DASH"));
  bar.appendChild(dashLabel);
}

/**
 * @param {number | undefined} eveningSliderValue — 0–50 in $5 steps from UI; 50 = no cap. Omit to use `pay` from the hash.
 * @param {number | undefined} walkSliderIndex — internal **0** = no distance; omit to use `walk` from the hash.
 * @returns {Array<{ lat: number, lng: number, name: string, address: string, categoryKey: string, categoryName: string, price: string, costHourlyHint: boolean, totalSpaces: number | null, spotId: string }>}
 */
function getAllParkingSpotMarkers(
  enabledKeys,
  eveningSliderValue,
  walkSliderIndex,
) {
  const keys = Array.isArray(enabledKeys)
    ? enabledKeys
    : getEnabledParkingKeys();
  const budgetCap = resolvedParkingEveningBudgetCap(
    eveningSliderValue === undefined ? undefined : eveningSliderValue,
  );
  const walkCapMiles = resolvedParkingWalkCapMiles(
    walkSliderIndex === undefined ? undefined : walkSliderIndex,
  );
  const destLl = getParkingDestinationLatLng();
  /** Slider index **0** ⇒ **unlimited** walk (`walkCapMiles === 0`); otherwise cap straight-line miles from **finish**. */
  const applyWalkCap =
    destLl != null && walkCapMiles > 0 && Number.isFinite(walkCapMiles);

  const out = [];
  const parking = appData?.parking;
  if (!parking) return out;
  const dashStops = getDashStopLatLngsForParkingProximity();
  for (const categoryId of keys) {
    const dataKey = parkingCategoryDataKey(categoryId);
    const items = dataKey ? parking[dataKey] : null;
    if (!Array.isArray(items)) continue;
    const categoryName = singularizeParkingCategoryLabel(
      parking.categoryNames?.[dataKey] || categoryId,
    );
    for (const item of items) {
      const loc = item?.location;
      const lat = loc?.latitude ?? item?.latitude;
      const lng = loc?.longitude ?? item?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!isParkingWithinDashStopRadius(lat, lng, dashStops)) continue;
      if (!parkingSpotPassesEveningBudget(item.pricing, categoryId, budgetCap))
        continue;
      if (applyWalkCap) {
        const walkMi = haversineMiles(lat, lng, destLl[0], destLl[1]);
        if (!Number.isFinite(walkMi) || walkMi > walkCapMiles) continue;
      }
      const cost = getParkingMapCostDisplay(item.pricing, categoryId);
      const ceil = parkingSpotEveningPriceCeilingOrAbsent(
        item.pricing,
        categoryId,
      );
      let eveningSortDollars = Number.POSITIVE_INFINITY;
      if (typeof ceil === "number") eveningSortDollars = ceil;

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
        price: cost.text,
        costHourlyHint: cost.costHourlyHint,
        priceSupplement:
          typeof cost.costSupplement === "string"
            ? cost.costSupplement.trim()
            : "",
        priceSupplementHint: cost.costSupplementHint === true,
        eveningSortDollars,
        totalSpaces: parseTotalSpacesFromAvailability(item.availability),
        spotId: encodeParkingSpotId(categoryId, lat, lng),
      });
    }
  }
  return out;
}

/**
 * With **finish** set: prefer the **longest** straight-line walk within the user's max-walk setting
 * (uses tolerance toward cheaper / less crowded options); tie-break by lowest inferred evening dollars.
 * Without **finish**: lowest evening dollars only.
 *
 * @param {Set<string>|string[]|undefined} enabledKeysOverride — when provided (e.g. category toggle **before** hash updates), use this instead of **`location=`** from the URL.
 */
function chooseBestParkingStartSpotId(enabledKeysOverride) {
  const markers =
    enabledKeysOverride instanceof Set
      ? getAllParkingSpotMarkers([...enabledKeysOverride])
      : Array.isArray(enabledKeysOverride)
        ? getAllParkingSpotMarkers(enabledKeysOverride)
        : getAllParkingSpotMarkers();
  if (markers.length === 0) return undefined;
  const destLl = getParkingDestinationLatLng();

  const sorted = [...markers].sort((a, b) => {
    if (destLl) {
      const wa = haversineMiles(a.lat, a.lng, destLl[0], destLl[1]);
      const wb = haversineMiles(b.lat, b.lng, destLl[0], destLl[1]);
      if (Math.abs(wa - wb) > 1e-9) return wb - wa;
    }
    const ca =
      typeof a.eveningSortDollars === "number"
        ? a.eveningSortDollars
        : Number.POSITIVE_INFINITY;
    const cb =
      typeof b.eveningSortDollars === "number"
        ? b.eveningSortDollars
        : Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;
    return String(a.spotId).localeCompare(String(b.spotId));
  });

  return sorted[0].spotId;
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

/** Leading icon: map pin (plan) / X-in-circle (clear selection); inherits `currentColor`. */
function parkingStartBtnIconSvg(checked) {
  if (checked) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">` +
      `<circle cx="12" cy="12" r="9"/>` +
      `<path stroke-linecap="round" d="M15 9l-6 6M9 9l6 6"/>` +
      `</svg>`
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">` +
    `<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>` +
    `<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>` +
    `</svg>`
  );
}

/**
 * Shared Leaflet popup HTML for a parking spot row (circle or green start pin).
 * @param {{ name: string, categoryName: string, price?: string, costHourlyHint?: boolean, priceSupplement?: string, priceSupplementHint?: boolean, totalSpaces?: number | null, address?: string }} row
 */
function parkingSpotPopupHtml(row) {
  const costText =
    row.price && String(row.price).trim() !== "" ? row.price : "—";
  const hourlySpan =
    row.costHourlyHint === true
      ? ` <span style="color:#64748b;font-weight:500;font-size:11px">(hourly)</span>`
      : "";
  const supRaw =
    typeof row.priceSupplement === "string" ? row.priceSupplement.trim() : "";
  const supplementSpan =
    supRaw !== ""
      ? ` <span style="color:#94a3b8" aria-hidden="true">·</span> ${escapeHtml(supRaw)}` +
        (row.priceSupplementHint === true
          ? ` <span style="color:#64748b;font-weight:500;font-size:11px">(hourly)</span>`
          : "")
      : "";
  const sizeText =
    typeof row.totalSpaces === "number" && Number.isFinite(row.totalSpaces)
      ? `${row.totalSpaces} total spaces`
      : "Not listed";
  let html =
    `<div class="parking-spot-popup" style="font-size:12px;min-width:12rem">` +
    `<strong>${escapeHtml(row.name)}</strong><br>` +
    `<span style="color:#64748b">${escapeHtml(row.categoryName)}</span>`;
  if (row.address) html += `<br>${escapeHtml(row.address)}`;
  html +=
    `<br><span style="color:#475569">Cost:</span> ${escapeHtml(costText)}${hourlySpan}${supplementSpan}` +
    `<br><span style="color:#475569">Size:</span> ${escapeHtml(sizeText)}`;
  html +=
    `<div class="parking-spot-popup-actions" style="margin-top:10px;display:block;width:100%;clear:both">` +
    `<button type="button" data-parking-start-btn aria-pressed="false"` +
    ` style="margin-top:0;box-sizing:border-box;max-width:100%;padding:6px 10px;font-size:12px;font-weight:600;color:#fff;background:#16a34a;border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;vertical-align:top">` +
    `<span data-parking-start-btn-icon style="display:inline-flex;flex-shrink:0;line-height:0">` +
    parkingStartBtnIconSvg(false) +
    `</span>` +
    `<span data-parking-start-btn-label style="text-align:left;white-space:normal">Plan to park here</span>` +
    `</button>` +
    `</div></div>`;
  return html;
}

/** Circle markers and the green start pin share this popup + plan-to-park control. */
function attachParkingSpotStartButton(marker, row) {
  marker.bindPopup(parkingSpotPopupHtml(row));
  marker.on("popupopen", () => {
    const wrap = marker.getPopup()?.getElement?.();
    const btn = wrap?.querySelector?.("[data-parking-start-btn]");
    const label = btn?.querySelector?.("[data-parking-start-btn-label]");
    const iconWrap = btn?.querySelector?.("[data-parking-start-btn-icon]");
    if (!btn || !row.spotId) return;
    const syncPressed = () => {
      const on = getParkingSpotIdForHash() === row.spotId;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) {
        btn.style.background = "#e5e7eb";
        btn.style.color = "#374151";
      } else {
        btn.style.background = "#16a34a";
        btn.style.color = "#fff";
      }
      btn.title = on
        ? "Clear parking selection"
        : "Use this parking spot as your trip start";
      if (iconWrap) iconWrap.innerHTML = parkingStartBtnIconSvg(on);
      if (label)
        label.textContent = on
          ? "Clear parking selection"
          : "Plan to park here";
    };
    syncPressed();
    btn.onclick = () => {
      const dest = getParkingDestinationSlugFromSelect();
      const keys = new Set(getEnabledParkingKeys());
      if (getParkingSpotIdForHash() === row.spotId) {
        window.location.hash = buildParkingHashFromState(
          keys,
          dest,
          undefined,
          undefined,
          undefined,
        );
      } else {
        window.location.hash = buildParkingHashFromState(
          keys,
          dest,
          row.spotId,
          undefined,
          undefined,
        );
      }
      if (parkingMap) syncParkingSpotPickMarker(parkingMap);
    };
  });
}

/** When `start` is set but the spot is missing from current filters, still drive the same popup. */
function parkingSpotRowFallback(spotId, parsed) {
  const cat = parsed.categoryKey;
  const dk = parkingCategoryDataKey(cat);
  const categoryName = singularizeParkingCategoryLabel(
    appData?.parking?.categoryNames?.[dk] || cat,
  );
  return {
    spotId,
    name: "Parking location",
    categoryName,
    price: "",
    costHourlyHint: false,
    totalSpaces: null,
    address: "",
    categoryKey: cat,
    lat: parsed.lat,
    lng: parsed.lng,
  };
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
      radius: 4,
      weight: 1,
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
    globalThis.__parkingSpotsLayerForTest = null;
  }

  const spots = getAllParkingSpotMarkers();
  if (spots.length === 0) {
    globalThis.__parkingSpotsLayerForTest = null;
    return;
  }

  spots.sort((a, b) => {
    const d =
      parkingCategoryPaintIndex(a.categoryKey) -
      parkingCategoryPaintIndex(b.categoryKey);
    if (d !== 0) return d;
    if (a.lat !== b.lat) return a.lat - b.lat;
    return a.lng - b.lng;
  });

  parkingSpotsLayerGroup = L.layerGroup().addTo(map);
  const g = parkingSpotsLayerGroup;
  globalThis.__parkingSpotsLayerForTest = g;

  const markersByCategory = {};
  for (const k of PARKING_MAP_ITEM_KEYS) markersByCategory[k] = [];

  for (const s of spots) {
    const style = circleStyleForParkingCategoryKey(s.categoryKey);
    const m = L.circleMarker([s.lat, s.lng], {
      ...style,
      radius: 10,
      weight: 1,
      parkingCategoryKey: s.categoryKey,
    });
    attachParkingSpotStartButton(m, s);
    m.addTo(g);
    if (markersByCategory[s.categoryKey])
      markersByCategory[s.categoryKey].push(m);
  }

  // Paint order: see `PARKING_CATEGORY_PAINT_ORDER` (purple public garage above orange private garage).
  for (const categoryId of PARKING_CATEGORY_PAINT_ORDER) {
    for (const m of markersByCategory[categoryId] || []) {
      if (typeof m.bringToFront === "function") m.bringToFront();
    }
  }
}

/** Green map-pin for a user-selected parking spot (SVG, no asset fetch). */
function parkingSpotPickIcon(L) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#16a34a" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2zm0 16a5 5 0 110-10 5 5 0 010 10z"/></svg>';
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

function syncParkingSpotPickMarker(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  if (parkingSpotPickLayerGroup) {
    try {
      map.removeLayer(parkingSpotPickLayerGroup);
    } catch {
      /* ignore */
    }
    parkingSpotPickLayerGroup = null;
  }

  const id = getParkingSpotIdForHash();
  if (!id) return;

  const p = parseParkingSpotIdToken(id);
  if (!p) return;

  const spot = getAllParkingSpotMarkers().find((m) => m.spotId === id);
  const row = spot ?? parkingSpotRowFallback(id, p);
  parkingSpotPickLayerGroup = L.layerGroup().addTo(map);
  const g = parkingSpotPickLayerGroup;
  const m = L.marker([p.lat, p.lng], {
    icon: parkingSpotPickIcon(L),
    zIndexOffset: 650,
  });
  attachParkingSpotStartButton(m, row);
  m.addTo(g);
}

/** Straight walk hint: dashed gray between green **start** and red **finish** (marker pane stays above). */
function syncParkingStartFinishWalkLine(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  if (parkingStartFinishLineLayerGroup) {
    try {
      map.removeLayer(parkingStartFinishLineLayerGroup);
    } catch {
      /* ignore */
    }
    parkingStartFinishLineLayerGroup = null;
  }

  const destLl = getParkingDestinationLatLng();
  const id = getParkingSpotIdForHash();
  if (!destLl || !id) return;

  const start = parseParkingSpotIdToken(id);
  if (!start) return;

  parkingStartFinishLineLayerGroup = L.layerGroup().addTo(map);
  const g = parkingStartFinishLineLayerGroup;
  const line = L.polyline(
    [
      [start.lat, start.lng],
      [destLl[0], destLl[1]],
    ],
    {
      color: "#64748b",
      weight: 3,
      opacity: 0.92,
      dashArray: "2 12",
      lineCap: "round",
      lineJoin: "round",
      interactive: true,
    },
  );
  line.bindTooltip(
    "Estimated walk — straight line only (not turn-by-turn routing).",
    {
      sticky: true,
      direction: "center",
      opacity: 0.95,
      className: "parking-estimated-walk-tooltip",
    },
  );
  line.addTo(g);

  const stampWalkLineDotAnimationClass = () => {
    const el = line.getElement?.() ?? line._path;
    if (el?.classList) el.classList.add("parking-estimated-walk-line-path");
  };
  stampWalkLineDotAnimationClass();
  requestAnimationFrame(() => {
    requestAnimationFrame(stampWalkLineDotAnimationClass);
  });
}

/** Red finish pin for the selected destination (green pick / red venue). */
function parkingDestinationMarkerIcon(L) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#dc2626" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round" ' +
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

/**
 * @param {{ fit?: boolean } | undefined} opts — **`fit: false`** refreshes pins/routes/markers without refitting zoom (for live slider `input`).
 */
function syncParkingMapOverlays(map, opts) {
  const doFit = opts?.fit !== false;
  syncParkingDashRoutes(map);
  syncParkingSpots(map);
  syncParkingDestinationMarker(map);
  if (doFit) fitParkingMapToAllContent(map);
  syncParkingSpotPickMarker(map);
  syncParkingStartFinishWalkLine(map);
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
  ensureParkingEveningBudgetDelegation();
  syncParkingEveningBudgetSliderFromHash();
  ensureParkingWalkDelegation();
  syncParkingWalkSliderFromHash();
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
