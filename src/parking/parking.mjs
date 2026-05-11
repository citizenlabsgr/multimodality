import {
  appData,
  formatRouteDistanceMiles,
  gridWalkMiles,
  haversineMiles,
  MODES_PAGE_EMPTY_MAP_CENTER,
  PARKING_PRICE_NOT_LISTED_LABEL,
} from "../shared/data-loader.mjs";
import {
  compareParkingWalkVersusDashMinutes,
  resolveParkingRoutePace,
} from "./parking-route-planning.mjs";
import {
  circleStyleForParkingCategoryKey,
  hexToRgba,
} from "../shared/parking-map-marker-styles.mjs";

/**
 * Parking map category ids — same strings as `#/visit?location=` (not `appData.parking` JSON keys).
 */
const PARKING_MAP_ITEM_KEYS = [
  "public-garage",
  "public-lot",
  "private-garage",
  "private-lot",
];

/** `#/visit` — slider max (50) means no evening price cap; scale is 0–50 in $5 steps. */
const PARKING_MAX_EVENING_SLIDER_CEILING = 50;
const PARKING_MAX_EVENING_SLIDER_STEP = 5;
/** When `pay` is omitted from the URL, default to max (`Any price`) for a short `#/visit` link. */
const PARKING_DEFAULT_MAX_EVENING_SLIDER_VALUE =
  PARKING_MAX_EVENING_SLIDER_CEILING;
const PARKING_PAY_QUERY_KEY = "pay";
const PARKING_PAY_QUERY_KEY_LEGACY = "maxEvening";

/**
 * Grid-style walk miles (N–S + E–W, no diagonal shortcut) to the **nearest DASH stop** from each pin
 * (minute hints from **`parkingRoutePace.walkMinutesPerMile`**, default ~2.5 mph).
 * **Internal/DOM index:** **0** → no distance; **1…15** → **0.1…1.5 mi**.
 * **default** index **5** = **0.5 mi** (URL omits `walk`).
 */
const PARKING_MAX_WALK_MI_MAX = 1.5;
const PARKING_MAX_WALK_SLIDER_CEILING_IDX = Math.round(
  PARKING_MAX_WALK_MI_MAX * 10,
);
const PARKING_DEFAULT_WALK_SLIDER_INDEX = 5;
const PARKING_WALK_QUERY_KEY = "walk";
const PARKING_WALK_QUERY_KEY_LEGACY = "maxWalk";
/** Show feet (with minute hint) when below this cap — slider **0.1–0.4 mi**; **0.5+** as miles. */
const PARKING_WALK_FEET_BELOW_MI = 0.5;
/**
 * Route badges only: feet for walks **under** **2,000 ft**; at **2,000 ft** and up use miles.
 * {@link PARKING_WALK_FEET_BELOW_MI} stays **0.5** for the walk slider labels.
 */
const PARKING_ROUTE_WALK_METRICS_FEET_BELOW_MI = 2000 / 5280;
/**
 * **`walk=0`** / slider index **0**: pin filter uses this grid-walk distance to nearest DASH (~**100 ft** ≈ **0.019** mi),
 * not unlimited and not a literal **0** mi cut.
 */
const PARKING_WALK_ZERO_EFFECTIVE_FEET = 100;

function parkingWalkMinutesPerMileFromConfig() {
  return resolveParkingRoutePace(appData?.parkingRoutePace).walkMinutesPerMile;
}

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

/** Estimated walk time using `config.json` → **`parkingRoutePace.walkMinutesPerMile`** (~2.5 mph when 24). */
function parkingWalkEstimateMinutesForMiles(miles) {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  const mpm = parkingWalkMinutesPerMileFromConfig();
  return Math.max(1, Math.round(miles * mpm));
}

/**
 * Route-badge feet only: nearest **500** ft (display). Does not affect the walk slider; see {@link roundParkingWalkFeetForDisplay}.
 * @param {number} ftExact
 */
function roundParkingWalkFeetNearest500ForRouteBadge(ftExact) {
  if (!Number.isFinite(ftExact) || ftExact <= 0) return 0;
  return Math.round(ftExact / 500) * 500;
}

/** Right-column copy: grid-walk distance + time (`parkingRoutePace.walkMinutesPerMile`). Below {@link PARKING_ROUTE_WALK_METRICS_FEET_BELOW_MI} mi (under **2,000 ft**), distance is feet; longer legs use miles. */
function parkingInstructionWalkEstimateMetrics(miles) {
  if (!Number.isFinite(miles) || miles <= 0) return "";
  const min = parkingWalkEstimateMinutesForMiles(miles);
  if (miles < PARKING_ROUTE_WALK_METRICS_FEET_BELOW_MI) {
    const ftExact = Math.round(miles * 5280);
    let ft = roundParkingWalkFeetNearest500ForRouteBadge(ftExact);
    // Nearest-500 can be 0 for short legs; nearest 50 ft (min 50) avoids bogus "0 mi · N min".
    if (ft <= 0 && ftExact > 0) {
      ft = Math.max(50, Math.round(ftExact / 50) * 50);
    }
    if (ft > 0) {
      return `${ft.toLocaleString("en-US")} ft · ${min} min`;
    }
  }
  const d = formatRouteDistanceMiles(miles);
  if (d && d !== "0" && Number(d) !== 0) {
    return `${d} mi · ${min} min`;
  }
  return `${min} min`;
}

/** Right-column copy: typical wait at the stop (`parkingRoutePace.dashBoardingWaitMinutes`). */
function parkingInstructionDashWaitMetrics(multimodal) {
  const waitM = multimodal.dashBoardingWaitMinutes;
  if (typeof waitM !== "number" || !Number.isFinite(waitM)) return "";
  return `${waitM} min wait`;
}

/** Right-column copy: on-board time along the DASH loop (excludes wait at the stop; no distance in the badge). */
function parkingInstructionDashOnboardMetrics(multimodal) {
  const rideM = multimodal.shuttleMinutes;
  if (typeof rideM !== "number" || !Number.isFinite(rideM)) return "";
  return `${rideM} min ride`;
}

/**
 * One route step: main instruction (left) and optional badge(s) (right).
 * @param {string} mainHtml
 * @param {string[]} metricLines — plain text / escaped snippets (already safe HTML); ignored for **`drive`** unless non-empty (custom label)
 * @param {'drive' | 'walk' | 'wait' | 'dash' | undefined} badgeVariant — **`drive`** = green “15+ min drive” chip for park step; walk/wait/dash for metrics
 */
function parkingRouteStepLi(mainHtml, metricLines, badgeVariant) {
  const lines = Array.isArray(metricLines)
    ? metricLines.filter((s) => typeof s === "string" && s.trim() !== "")
    : [];
  const isDrive = badgeVariant === "drive";
  let variant = null;
  if (isDrive) {
    variant = "drive";
  } else if (
    lines.length > 0 &&
    (badgeVariant === "walk" ||
      badgeVariant === "wait" ||
      badgeVariant === "dash")
  ) {
    variant = badgeVariant;
  }
  const badgeLines =
    variant === "drive"
      ? lines.length > 0
        ? lines
        : ["15+ min drive"]
      : lines;
  const metricsAria =
    variant === "drive" ? "Route step" : "Time and distance estimates";
  const metrics =
    variant && badgeLines.length > 0
      ? `<span class="parking-route-step-metrics" aria-label="${metricsAria}">${badgeLines
          .map(
            (line) =>
              `<span class="parking-route-step-badge parking-route-step-badge--${variant}">${line}</span>`,
          )
          .join("")}</span>`
      : "";
  return `<li class="parking-route-step-item"><div class="parking-route-step-row"><span class="parking-route-step-main">${mainHtml}</span>${metrics}</div></li>`;
}

/** Under 1,000 ft: nearest **500** ft; 1,000 ft and up: nearest **1,000** ft. */
function roundParkingWalkFeetForDisplay(ftExact) {
  if (!Number.isFinite(ftExact) || ftExact <= 0) return 0;
  if (ftExact < 1000) return Math.round(ftExact / 500) * 500;
  return Math.round(ftExact / 1000) * 1000;
}

/** @param {number} walkSliderIndex — internal: **0** no distance; **1…15** → **0.1 … 1.5** mi */
function parkingWalkOutputLabelFromSliderIndex(walkSliderIndex) {
  const i = snapParkingWalkInternalIndex(walkSliderIndex);
  if (i === 0) return "No distance";
  const miles = i / 10;
  const min = parkingWalkEstimateMinutesForMiles(miles);
  if (miles < PARKING_WALK_FEET_BELOW_MI) {
    const ftExact = Math.round((i * 5280) / 10);
    const ft = roundParkingWalkFeetForDisplay(ftExact);
    return `${ft.toLocaleString("en-US")} ft (~${min} min)`;
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
    return 0.5;
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

/**
 * Pin filtering only: **`walk=0`** resolves to {@link PARKING_WALK_ZERO_EFFECTIVE_FEET} ft grid-walk to the
 * nearest DASH stop. Other features keep raw **0** (no overlay, no auto **`start`**).
 * @param {number} resolvedCapMiles — from {@link resolvedParkingWalkCapMiles}
 */
function effectiveWalkCapMilesForParkingPins(resolvedCapMiles) {
  if (!Number.isFinite(resolvedCapMiles)) return resolvedCapMiles;
  if (resolvedCapMiles <= 0) return PARKING_WALK_ZERO_EFFECTIVE_FEET / 5280;
  return resolvedCapMiles;
}

/** True when the parking URL explicitly sets **`walk`** / **`maxWalk`** (not merely defaults). */
function parkingRouteHashHasExplicitWalkParam() {
  const params = getParkingRouteSearchParams();
  return (
    params.has(PARKING_WALK_QUERY_KEY) ||
    params.has(PARKING_WALK_QUERY_KEY_LEGACY)
  );
}

function resolvedParkingWalkCapMiles(walkSliderIndexOverride) {
  if (
    walkSliderIndexOverride !== undefined &&
    walkSliderIndexOverride !== null
  ) {
    const ix = snapParkingWalkInternalIndex(walkSliderIndexOverride);
    return ix / 10;
  }
  /** Prefer query **`walk`** over the range input so filtering/recommendation match the URL before the slider is synced or if it is stale. */
  if (parkingRouteHashHasExplicitWalkParam()) {
    return getParkingWalkCapMilesFromHash();
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
      getParkingCommittedStartSpotIdForHashWrite(undefined),
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
      getParkingCommittedStartSpotIdForHashWrite(undefined),
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

/** Visible parking pin size (px). Invisible {@link PARKING_SPOT_MARKER_HIT_RADIUS} keeps taps usable on mobile. */
const PARKING_SPOT_MARKER_RADIUS = 6;
/** Transparent circleMarker radius (px) for touch / click; larger than {@link PARKING_SPOT_MARKER_RADIUS}. */
const PARKING_SPOT_MARKER_HIT_RADIUS = 14;

/** Index in overlap paint order (`PARKING_CATEGORY_PAINT_ORDER`, bottom → top). */
function parkingCategoryPaintIndex(categoryKey) {
  const i = PARKING_CATEGORY_PAINT_ORDER.indexOf(categoryKey);
  return i === -1 ? PARKING_CATEGORY_PAINT_ORDER.length : i;
}

/** `#/visit` — DASH routes + drive parking locations (garages/lots only). Legacy `#/parking` is rewritten on load. */
export function isParkingRoute() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  if (pathPart === "/parking" || pathPart === "/parking/") return true;
  return (
    pathPart === "/visit" ||
    pathPart === "/visit/" ||
    pathPart.startsWith("/visit/")
  );
}

/** Same downtown filter as `src/visit/planner.mjs` / `#/data/routes`. */
const DATA_ROUTES_CITY_CENTER_LAT = 42.96333;
const DATA_ROUTES_CITY_CENTER_LON = -85.66806;
const DATA_ROUTES_STOP_MAX_MILES_FROM_CENTER = 1.5;

/** `#/visit` — hide parking pins farther than this from any shown DASH stop. */
const PARKING_MAX_MILES_FROM_DASH_STOP = 0.75;

/** Grand Rapids region page in the Transit app (DASH, The Rapid, real-time). */
const PARKING_TRANSIT_APP_GRAND_RAPIDS_URL =
  "https://transitapp.com/en/region/grand-rapids";

/** Dashed estimated-walk polylines — Tailwind `blue-600`, same family as `#parkingMaxWalkSlider` (`accent-blue-600`). */
const PARKING_WALK_OVERLAY_COLOR = "#2563eb";
/** Wider underlay so blue dashes read on varied tiles (same dash pattern as foreground). */
const PARKING_WALK_OVERLAY_HALO_COLOR = "rgba(255, 255, 255, 0.92)";
const PARKING_WALK_OVERLAY_HALO_WEIGHT = 8;
const PARKING_WALK_OVERLAY_FG_WEIGHT = 5;

/**
 * DASH shuttle foreground dash pattern — period **32** (`20+12`) → sync `parking.css`.
 * Halo is solid white (no dashes) underneath.
 */
const PARKING_DASH_TRIP_SHUTTLE_DASH_ARRAY = "20 12";
const PARKING_DASH_TRIP_SHUTTLE_HALO_COLOR = "rgba(255, 255, 255, 0.94)";
const PARKING_DASH_TRIP_SHUTTLE_HALO_WEIGHT = 10;
const PARKING_DASH_TRIP_SHUTTLE_FG_WEIGHT = 5;

/**
 * Smooth wiggle along a straight chord — suggests an approximate walk, not a surveyed path.
 * Integer wave count keeps both endpoints exactly on the original segment.
 * @param {[number, number]} a [lat, lng]
 * @param {[number, number]} b [lat, lng]
 * @returns {number[][]}
 */
function wavyApproxWalkChordLatLngs(a, b) {
  const lat1 = a[0];
  const lng1 = a[1];
  const lat2 = b[0];
  const lng2 = b[1];
  const dlat = lat2 - lat1;
  const dlng = lng2 - lng1;
  const len = Math.sqrt(dlat * dlat + dlng * dlng);
  if (len < 1e-14) return [a, b];
  const perpLat = -dlng / len;
  const perpLng = dlat / len;
  const chordMi = gridWalkMiles(lat1, lng1, lat2, lng2);
  const ampDeg = Math.min(0.00044, Math.max(0.0001, chordMi * 0.00024));
  const waveCycles = 4;
  const samples = Math.max(30, Math.min(84, Math.round(34 + chordMi * 128)));
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const w = Math.sin(t * waveCycles * 2 * Math.PI);
    out.push([
      lat1 + t * dlat + w * ampDeg * perpLat,
      lng1 + t * dlng + w * ampDeg * perpLng,
    ]);
  }
  return out;
}

/**
 * Symmetric fitBounds padding in px. Leaflet combines TL+BR into one point for
 * getBoundsZoom, so max-zoom uses 2× each axis.
 */
const PARKING_MAP_FIT_PADDING = [44, 44];
/** Inset when framing placeholder venue pins only (smaller ⇒ more zoom; balance vs. pin clipping). */
const PARKING_MAP_FIT_DEST_ONLY_PADDING = [28, 28];
/** Upper bound for `fitBounds` / `setView` — must not use “zoom that fits all city context” (a *low* zoom). */
const PARKING_MAP_FIT_MAX_ZOOM = 18;

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

/** "DASH shuttle" in the route wait step -> Transit app (Grand Rapids). */
function parkingRouteDashShuttleTransitAppAnchorHtml() {
  return `<a href="${escapeHtml(PARKING_TRANSIT_APP_GRAND_RAPIDS_URL)}" class="parking-route-transit-app-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml("Free DASH shuttle in the Transit app for Grand Rapids")}">DASH shuttle</a>`;
}

/** Google Maps deep link: pin at **lat/lng**, or text search from **addressFallback** if coords invalid. */
function parkingGoogleMapsHref(lat, lng, addressFallback) {
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  const a = typeof addressFallback === "string" ? addressFallback.trim() : "";
  if (a !== "") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
  }
  return "";
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

function formatParkingPrice(pricing, categoryKey) {
  const privateOsm =
    categoryKey === "private-garage" || categoryKey === "private-lot";
  if (!pricing || typeof pricing !== "object") {
    return privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
  }
  if (pricing.events) return pricing.events;
  if (pricing.evening) return pricing.evening;
  if (pricing.rate) return pricing.rate;
  if (pricing.daytime) return pricing.daytime;
  return privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
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
 * Single-tier popup line: keep posted dollar text; prose-only evenings inferred as free → **Free**
 * (aligned with {@link parkingSpotEveningPriceCeilingOrAbsent} / {@link parkingPriceTextImpliesEveningFree}).
 */
function parkingMapCostLineForTierText(tierText) {
  if (typeof tierText !== "string" || tierText.trim() === "") return "";
  const t = tierText.trim();
  if (parseDollarAmountsFromPriceText(t).length > 0) return t;
  if (parkingPriceTextImpliesEveningFree(t)) return "Free";
  return t;
}

/**
 * Cost line for `#/visit` popups: prefers ArcGIS `hourlyRate` when set, else events → evening → rate → daytime (see {@link formatParkingPrice}).
 * When **`events`** and **`hourlyRate`** are both set (city map), primary line is the **event** charge plus **`hourlyRate`** as a supplement (weekend / hourly context).
 * @returns {{ text: string, costHourlyHint: boolean, costSupplement?: string, costSupplementHint?: boolean }}
 */
function getParkingMapCostDisplay(pricing, categoryKey) {
  const privateOsm =
    categoryKey === "private-garage" || categoryKey === "private-lot";
  if (!pricing || typeof pricing !== "object") {
    return {
      text: privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free",
      costHourlyHint: false,
    };
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
    const line = parkingMapCostLineForTierText(hrRaw);
    const alreadyHourly = /\b(per\s+hour|\/hr|hourly)\b/i.test(hrRaw);
    return {
      text: line,
      costHourlyHint:
        line !== "Free" &&
        parkingCostTextLooksLikeRate(hrRaw) &&
        !alreadyHourly,
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
  return {
    text: privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free",
    costHourlyHint: false,
  };
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
 * Query string for `#/visit?…` (empty when no `?` in hash).
 */
function getParkingRouteSearchParams() {
  const hash = window.location.hash.slice(1);
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

/**
 * `null` = no `location` (or legacy `cats`) param → show all categories.
 * `Set` (possibly empty) = explicit filter from `#/visit?location=public-garage,private-lot`.
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

/** Query param for chosen venue (destination slug) when not using the `/visit/<slug>` path. Legacy: `venue`, `destination`, `dest`. */
const PARKING_FINISH_QUERY_KEY = "finish";

/** Query param for selected parking pin on `#/visit` (`category~lat~lng`, 6dp). Legacy: `start`, `spot`. */
const PARKING_PARK_QUERY_KEY = "park";

function parseParkingRoutePathSlug() {
  const hash = window.location.hash.slice(1);
  const qIdx = hash.indexOf("?");
  const path = (qIdx >= 0 ? hash.slice(0, qIdx) : hash).replace(/\/$/, "");
  if (path === "/visit" || path === "/visit/") return "";
  if (!path.startsWith("/visit/")) return "";
  return path.slice("/visit/".length).trim();
}

/** Venue slug from `#/visit/<slug>` or legacy `finish=` / `venue` / `destination` / `dest`, or "" if absent / invalid. */
function parseParkingDestSlugFromHash() {
  const pathSlug = parseParkingRoutePathSlug();
  if (pathSlug) {
    const ok =
      Array.isArray(appData?.destinations) &&
      appData.destinations.some((d) => d.slug === pathSlug);
    if (ok) return pathSlug;
  }
  const params = getParkingRouteSearchParams();
  let raw = null;
  if (params.has(PARKING_FINISH_QUERY_KEY))
    raw = params.get(PARKING_FINISH_QUERY_KEY);
  else if (params.has("venue")) raw = params.get("venue");
  else if (params.has("destination")) raw = params.get("destination");
  else if (params.has("dest")) raw = params.get("dest");
  if (raw == null || String(raw).trim() === "") return "";
  const slug = String(raw).trim();
  const ok =
    Array.isArray(appData?.destinations) &&
    appData.destinations.some((d) => d.slug === slug);
  return ok ? slug : "";
}

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

/** Normalized `park` / legacy `start` / `spot` token from the hash when syntactically valid (no marker filter). */
function normalizeParkingSpotIdFromHashRaw() {
  const params = getParkingRouteSearchParams();
  let raw = params.get(PARKING_PARK_QUERY_KEY);
  if (raw == null || String(raw).trim() === "") raw = params.get("start");
  if (raw == null || String(raw).trim() === "") raw = params.get("spot");
  if (raw == null || String(raw).trim() === "") return undefined;
  return normalizeParkingSpotId(String(raw).trim());
}

/**
 * User-committed `park=` / legacy `start=` / `spot=` preserved when rewriting the hash — only when already in the URL
 * and still a visible marker for `enabledKeysOverride` (or current categories when omitted).
 * Auto-recommendation never writes here; use {@link getParkingEffectiveStartSpotId} for the green pin.
 *
 * @param {Set<string> | undefined} enabledKeysOverride — **new** `location=` set when toggling categories before the hash updates.
 */
function getParkingCommittedStartSpotIdForHashWrite(enabledKeysOverride) {
  if (getParkingMaxWalkSliderValueForHash() === 0) return undefined;
  const n = normalizeParkingSpotIdFromHashRaw();
  if (!n) return undefined;
  const keys =
    enabledKeysOverride instanceof Set
      ? [...enabledKeysOverride]
      : getEnabledParkingKeys();
  return getAllParkingSpotMarkers(keys).some((m) => m.spotId === n)
    ? n
    : undefined;
}

/** Normalized committed start from the hash if valid for current filters (`walk` ≠ 0). */
function getParkingSpotIdForHash() {
  return getParkingCommittedStartSpotIdForHashWrite(undefined);
}

/**
 * Both a **destination** (path or `finish=` / legacy venue keys) and committed **`park=`** / legacy **`start=`** / **`spot=`** are in the URL —
 * trip step digits (**1**–**4**) appear on map pins; otherwise badges stay blank.
 */
function parkingTripStepNumbersHashReady() {
  if (parseParkingDestSlugFromHash() === "") return false;
  const sid = getParkingSpotIdForHash();
  return typeof sid === "string" && sid.length > 0;
}

/**
 * Recommended or committed parking start for map overlays — URL wins when present; otherwise auto pick.
 * Auto pick (muted green pin, unnumbered) runs only when a **destination** is chosen so bare `#/visit` does not suggest a pick.
 */
function getParkingEffectiveStartSpotId() {
  const committed = getParkingSpotIdForHash();
  if (committed) return committed;
  if (!getParkingDestinationLatLng()) return undefined;
  return parkingStartSpotIdForAutoPick();
}

/**
 * After slider/toggle/destination updates: when **`walk` index is 0**, omit `park` (do not auto-pick).
 *
 * @param {Set<string>|string[]|undefined} enabledKeysOverride
 * @param {number|undefined} walkSliderIndexOverride — internal index after a walk-slider commit
 */
function parkingStartSpotIdForAutoPick(
  enabledKeysOverride,
  walkSliderIndexOverride,
) {
  const walkIx =
    walkSliderIndexOverride !== undefined && walkSliderIndexOverride !== null
      ? snapParkingWalkInternalIndex(walkSliderIndexOverride)
      : getParkingMaxWalkSliderValueForHash();
  if (walkIx === 0) return undefined;
  return chooseBestParkingStartSpotId(enabledKeysOverride);
}

function parkingVisitBasePath(destSlug) {
  const d = typeof destSlug === "string" ? destSlug.trim() : "";
  if (
    d &&
    Array.isArray(appData?.destinations) &&
    appData.destinations.some((x) => x.slug === d)
  ) {
    return `/visit/${d}`;
  }
  return "/visit";
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
  const basePath = parkingVisitBasePath(d);
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
  if (walkIx !== 0 && typeof spotId === "string" && spotId.trim() !== "") {
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
    parts.push(`${PARKING_PARK_QUERY_KEY}=${encodeURIComponent(spotNorm)}`);
  const q = parts.join("&");
  return q ? `#${basePath}?${q}` : `#${basePath}`;
}

/** Drop stale `park=` when `walk=0` so the URL matches “no parking pick” semantics. */
function syncParkingHashStripStartWhenWalkZero() {
  if (getParkingMaxWalkSliderValueForHash() !== 0) return;
  if (!normalizeParkingSpotIdFromHashRaw()) return;
  const keys = new Set(getEnabledParkingKeys());
  const dest = getParkingDestinationSlugFromSelect();
  const next = buildParkingHashFromState(
    keys,
    dest,
    undefined,
    undefined,
    undefined,
  );
  if (window.location.hash !== next) window.location.hash = next;
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
    getParkingCommittedStartSpotIdForHashWrite(current),
    undefined,
    undefined,
  );
  if (parkingMap) {
    parkingMap.invalidateSize();
    syncParkingMapOverlays(parkingMap);
  }
}

/** All parking categories on, no destination — `#/visit` with no query. */
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

function applyParkingDestinationFromSelectChange() {
  syncParkingDestinationSelectAppearance();
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  window.location.hash = buildParkingHashFromState(
    new Set(getEnabledParkingKeys()),
    sel.value,
    getParkingCommittedStartSpotIdForHashWrite(undefined),
    undefined,
    undefined,
  );
  if (parkingMap) syncParkingMapOverlays(parkingMap);
}

/** Programmatic destination choice (map pins); keeps hash + overlays in sync with the dropdown. */
function selectParkingDestinationBySlug(slug) {
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel || typeof slug !== "string" || slug.trim() === "") return;
  const v = slug.trim();
  if (![...sel.options].some((o) => o.value === v)) return;
  sel.value = v;
  applyParkingDestinationFromSelectChange();
}

/** Clear `finish` only (map popup / mirror of clearing parking start); keeps filters, pay/walk, and valid `start`. */
function clearParkingDestinationFromMap() {
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  sel.value = "";
  syncParkingDestinationSelectAppearance();
  window.location.hash = buildParkingHashFromState(
    new Set(getEnabledParkingKeys()),
    "",
    getParkingCommittedStartSpotIdForHashWrite(undefined),
    undefined,
    undefined,
  );
  if (parkingMap) syncParkingMapOverlays(parkingMap);
}

function ensureParkingDestinationSelectDelegation() {
  if (parkingDestinationSelectDelegated) return;
  const sel = document.getElementById("parkingDestinationSelect");
  if (!sel) return;
  parkingDestinationSelectDelegated = true;
  sel.addEventListener("change", applyParkingDestinationFromSelectChange);
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

/** @returns {[number, number]|null} lat, lng from a destination record */
function parkingLatLngFromDestinationRecord(dest) {
  if (!dest) return null;
  const lat = dest.latitude ?? dest.location?.latitude;
  const lng = dest.longitude ?? dest.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return [lat, lng];
}

/** @returns {[number, number]|null} lat, lng for selected destination */
function getParkingDestinationLatLng() {
  const sel = document.getElementById("parkingDestinationSelect");
  const slug = sel?.value;
  if (!slug) return null;
  const dest = appData?.destinations?.find((d) => d.slug === slug);
  return parkingLatLngFromDestinationRecord(dest);
}

/** Every destination with valid coordinates — for fitting the map when no venue is selected. */
function getAllParkingDestinationFitLatLngs() {
  const out = [];
  const destinations = Array.isArray(appData?.destinations)
    ? appData.destinations
    : [];
  for (const dest of destinations) {
    const slug = dest?.slug;
    if (typeof slug !== "string" || slug.trim() === "") continue;
    const ll = parkingLatLngFromDestinationRecord(dest);
    if (ll) out.push(ll);
  }
  return out;
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
  const walkCapMiles = effectiveWalkCapMilesForParkingPins(
    resolvedParkingWalkCapMiles(
      walkSliderIndex === undefined ? undefined : walkSliderIndex,
    ),
  );
  const destLl = getParkingDestinationLatLng();
  const dashStops = getDashStopLatLngsForParkingProximity();
  /**
   * **`walk`** omitted from URL defaults to **0.5** mi — never **0** unless explicit **`walk=0`**.
   * **`walk=0`** uses {@link PARKING_WALK_ZERO_EFFECTIVE_FEET} ft (~**0.019** mi) grid-walk for this filter only.
   */
  const applyWalkCap =
    destLl != null &&
    dashStops.length > 0 &&
    Number.isFinite(walkCapMiles) &&
    walkCapMiles > 0;

  const out = [];
  const parking = appData?.parking;
  if (!parking) return out;
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
        const walkToStopMi = nearestDashStopWalkMiles(lat, lng, dashStops);
        if (
          !Number.isFinite(walkToStopMi) ||
          walkToStopMi > walkCapMiles + 1e-9
        ) {
          continue;
        }
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
 * Higher score = prefer for auto-recommendation — **most expensive** inferred evening/event dollars
 * the user’s **pay** cap still allows (product assumption: pricier spots are typically less crowded at
 * events). Unknown / ambiguous tiers rank below known dollar amounts.
 *
 * @param {number} eveningSortDollars — from {@link getAllParkingSpotMarkers} rows
 */
function eveningPricePickScoreForRecommendation(eveningSortDollars) {
  if (eveningSortDollars === Number.POSITIVE_INFINITY) return -1e9;
  if (!Number.isFinite(eveningSortDollars)) return -1e9;
  if (eveningSortDollars === PARKING_EVENING_PRICE_AMBIGUOUS_PROSE) return -1e6;
  return eveningSortDollars;
}

/** Parseable dollar ceiling on the marker (including **$0** free); excludes unknown and ambiguous prose. */
function parkingMarkerHasKnownEveningDollars(eveningSortDollars) {
  if (eveningSortDollars === Number.POSITIVE_INFINITY) return false;
  if (eveningSortDollars === PARKING_EVENING_PRICE_AMBIGUOUS_PROSE)
    return false;
  return Number.isFinite(eveningSortDollars);
}

/** Paid (~$) > free ($0 known) > unknown/ambiguous — used when tie-breaking after distance. */
function parkingMarkerPaidTierRank(eveningSortDollars) {
  if (!parkingMarkerHasKnownEveningDollars(eveningSortDollars)) return 0;
  if (eveningSortDollars > 0) return 2;
  return 1;
}

/**
 * Auto-recommendation pool: keep only markers with parseable known dollars (including `$0`).
 * {@link buildParkingRecommendationMarkerPool} uses this first, then falls back to all eligible
 * markers when every visible pin is unknown / ambiguous-priced.
 *
 * @param {Array<{ eveningSortDollars: number }>} markers
 */
function filterParkingMarkersForRecommendation(markers) {
  if (!Array.isArray(markers) || markers.length === 0) return [];
  return markers.filter((m) =>
    parkingMarkerHasKnownEveningDollars(m.eveningSortDollars),
  );
}

/**
 * Markers eligible for the muted green auto-pick: prefer known-dollar ceilings (including **$0**
 * free); if none, use unknown / ambiguous so private-only filters still get a suggestion.
 * {@link filterParkingMarkersExcludeFreeWhenPaidExists} drops known-free pins when **some other**
 * eligible pin has a paid ceiling so ranking prefers farther paid lots (e.g. Acrisure default); when
 * every qualifying pin is free (tight **`pay`**), free pins stay in the pool (e.g. GLC + **`pay=5`**).
 *
 * @param {Array<{ eveningSortDollars: number }>} markers — already pay / walk / category filtered
 */
function buildParkingRecommendationMarkerPool(markers) {
  if (!Array.isArray(markers) || markers.length === 0) return [];
  let pool = filterParkingMarkersForRecommendation(markers);
  pool = filterParkingMarkersExcludeFreeWhenPaidExists(pool);
  if (pool.length > 0) return pool;
  return filterParkingMarkersExcludeFreeWhenPaidExists(markers);
}

/**
 * When the user is willing to pay and **any** eligible marker has a known paid (**> $0**) ceiling,
 * exclude known-free **`$0`** markers so auto-pick matches farther paid lots. If only free pins fit the
 * **`pay`** cap, keep them so low-budget links still get a suggestion.
 *
 * @param {Array<{ eveningSortDollars: number }>} markers
 */
function filterParkingMarkersExcludeFreeWhenPaidExists(markers) {
  if (!Array.isArray(markers) || markers.length === 0) return markers;
  const cap = resolvedParkingEveningBudgetCap();
  const userWillingToPay = cap == null || cap > 0;
  if (!userWillingToPay) return markers;

  const hasPaidPin = markers.some(
    (m) =>
      typeof m.eveningSortDollars === "number" &&
      Number.isFinite(m.eveningSortDollars) &&
      m.eveningSortDollars > 0,
  );
  if (!hasPaidPin) return markers;

  return markers.filter(
    (m) =>
      !(
        typeof m.eveningSortDollars === "number" &&
        Number.isFinite(m.eveningSortDollars) &&
        m.eveningSortDollars === 0
      ),
  );
}

/**
 * Whether {@link tryParkingDashMultimodalPath} would draw the DASH multimodal overlay for this spot
 * (same rules as on-map estimated trip — approach walk capped by **`walk`**, alight→venue leg can exceed it).
 *
 * @param {{ lat: number; lng: number }} m
 * @param {[number, number]|null} destLl
 * @param {number} walkCapMiles — {@link resolvedParkingWalkCapMiles}
 */
function markerUsesDashMultimodalForRecommendation(m, destLl, walkCapMiles) {
  if (m._usesDashMultimodalCached !== undefined)
    return m._usesDashMultimodalCached;
  const v =
    Array.isArray(destLl) &&
    destLl.length >= 2 &&
    typeof walkCapMiles === "number" &&
    Number.isFinite(walkCapMiles) &&
    walkCapMiles > 0 &&
    tryParkingDashMultimodalPath(
      m.lat,
      m.lng,
      destLl[0],
      destLl[1],
      walkCapMiles,
    ) != null;
  m._usesDashMultimodalCached = v;
  return v;
}

function markerUsesDashMultimodalForRecommendationFromPool(m) {
  const destLl = getParkingDestinationLatLng();
  const walkCap = resolvedParkingWalkCapMiles();
  return markerUsesDashMultimodalForRecommendation(m, destLl, walkCap);
}

/**
 * Sort key for auto-recommended parking follows **`AGENTS.md`**:
 *
 * - **Short** max walk (≤ **0.5** mi): prefer spots whose estimated trip **uses DASH** (multimodal overlay)
 *   over door-to-door walks to the venue when both are eligible; among multimodal picks use **farther**
 *   grid-walk miles from the venue first (same tie order as generous walk). Door-to-door-only picks
 *   stay **closest** to the venue first, then evening dollars, then longest walk to DASH.
 * - **Generous** max walk (&gt; **0.5** mi): **farther** grid-walk miles from the venue first (paid lots away from
 *   the entrance), **then** longest walk to nearest DASH among ties (use approach distance), then paid-tier rank,
 *   then dollars (still paid / within walk-to-stop cap).
 *
 * Eligibility (pay + walk + category toggles) is already applied by {@link getAllParkingSpotMarkers}.
 *
 * @returns {number}
 */
function compareParkingMarkersForRecommendation(a, b) {
  const destLl = getParkingDestinationLatLng();
  if (!destLl) {
    return String(a.spotId).localeCompare(String(b.spotId));
  }

  const da = gridWalkMiles(a.lat, a.lng, destLl[0], destLl[1]);
  const db = gridWalkMiles(b.lat, b.lng, destLl[0], destLl[1]);

  const walkCap = resolvedParkingWalkCapMiles();
  const shortWalk =
    Number.isFinite(walkCap) && walkCap > 0 && walkCap <= 0.5 + 1e-9;

  const dashStops = getDashStopLatLngsForParkingProximity();
  const scoreA = eveningPricePickScoreForRecommendation(a.eveningSortDollars);
  const scoreB = eveningPricePickScoreForRecommendation(b.eveningSortDollars);

  if (shortWalk) {
    const usesA = markerUsesDashMultimodalForRecommendation(a, destLl, walkCap);
    const usesB = markerUsesDashMultimodalForRecommendation(b, destLl, walkCap);
    if (usesA !== usesB) return usesA ? -1 : 1;

    const wda = nearestDashStopWalkMiles(a.lat, a.lng, dashStops);
    const wdb = nearestDashStopWalkMiles(b.lat, b.lng, dashStops);

    if (usesA && usesB) {
      if (Math.abs(da - db) > 1e-9) return db - da;
      if (dashStops.length === 0) {
        if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
        return String(a.spotId).localeCompare(String(b.spotId));
      }
      if (Math.abs(wda - wdb) > 1e-9) return wdb - wda;
      const rankA = parkingMarkerPaidTierRank(a.eveningSortDollars);
      const rankB = parkingMarkerPaidTierRank(b.eveningSortDollars);
      if (rankA !== rankB) return rankB - rankA;
      if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
      return String(a.spotId).localeCompare(String(b.spotId));
    }

    if (Math.abs(da - db) > 1e-9) return da - db;
    if (dashStops.length === 0) {
      if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
      return String(a.spotId).localeCompare(String(b.spotId));
    }
    if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
    if (Math.abs(wda - wdb) > 1e-9) return wdb - wda;
    return String(a.spotId).localeCompare(String(b.spotId));
  }

  if (dashStops.length === 0) {
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
    return String(a.spotId).localeCompare(String(b.spotId));
  }

  const wda = nearestDashStopWalkMiles(a.lat, a.lng, dashStops);
  const wdb = nearestDashStopWalkMiles(b.lat, b.lng, dashStops);

  if (Math.abs(da - db) > 1e-9) return db - da;
  if (Math.abs(wda - wdb) > 1e-9) return wdb - wda;
  const rankA = parkingMarkerPaidTierRank(a.eveningSortDollars);
  const rankB = parkingMarkerPaidTierRank(b.eveningSortDollars);
  if (rankA !== rankB) return rankB - rankA;
  if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
  return String(a.spotId).localeCompare(String(b.spotId));
}

/**
 * Best parking pin for auto **`start`** — {@link buildParkingRecommendationMarkerPool} then
 * {@link compareParkingMarkersForRecommendation}.
 *
 * @param {Set<string>|string[]|undefined} enabledKeysOverride — when provided (e.g. category toggle **before** hash updates), use this instead of **`location=`** from the URL.
 */
function chooseBestParkingStartSpotId(enabledKeysOverride) {
  let markers =
    enabledKeysOverride instanceof Set
      ? getAllParkingSpotMarkers([...enabledKeysOverride])
      : Array.isArray(enabledKeysOverride)
        ? getAllParkingSpotMarkers(enabledKeysOverride)
        : getAllParkingSpotMarkers();
  const pool = buildParkingRecommendationMarkerPool(markers);
  if (pool.length === 0) return undefined;
  const sorted = [...pool].sort(compareParkingMarkersForRecommendation);
  return sorted[0].spotId;
}

if (typeof globalThis !== "undefined") {
  globalThis.__chooseBestParkingStartSpotIdForTest =
    chooseBestParkingStartSpotId;
  globalThis.__getAllParkingSpotMarkersForTest = getAllParkingSpotMarkers;
  globalThis.__compareParkingMarkersForRecommendationForTest =
    compareParkingMarkersForRecommendation;
  globalThis.__filterParkingMarkersForRecommendationForTest =
    filterParkingMarkersForRecommendation;
  globalThis.__buildParkingRecommendationMarkerPoolForTest =
    buildParkingRecommendationMarkerPool;
  globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest =
    filterParkingMarkersExcludeFreeWhenPaidExists;
  globalThis.__getParkingEffectiveStartSpotIdForTest =
    getParkingEffectiveStartSpotId;
  globalThis.__parkingTripStepNumbersHashReadyForTest =
    parkingTripStepNumbersHashReady;
  globalThis.__markerUsesDashMultimodalForRecommendationForTest =
    markerUsesDashMultimodalForRecommendationFromPool;
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

/** Shortest grid-walk miles from a point to any DASH stop (walk slider vs chosen venue). */
function nearestDashStopWalkMiles(lat, lng, dashStops) {
  if (!Array.isArray(dashStops) || dashStops.length === 0)
    return Number.POSITIVE_INFINITY;
  let best = Infinity;
  for (const s of dashStops) {
    const d = gridWalkMiles(lat, lng, s.lat, s.lng);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Closed-loop vertices from the primary DASH shape (first route, first shape), dropping the duplicate closing point.
 * @returns {{ verts: Array<{ lat: number; lng: number }>; segMi: number[]; perimeterMi: number } | null}
 */
function getParkingDashLoopRingGeometry() {
  const bus = appData?.busRoutes;
  const dashList = Array.isArray(bus?.dash_routes) ? bus.dash_routes : [];
  const legacyList = Array.isArray(bus?.routes) ? bus.routes : [];
  const routes = dashList.length > 0 ? dashList : legacyList;
  const r = routes[0];
  const coords = r?.shapes?.[0]?.coordinates;
  if (!Array.isArray(coords) || coords.length < 3) return null;
  const last = coords[coords.length - 1];
  const first = coords[0];
  const ring =
    typeof first?.latitude === "number" &&
    typeof first?.longitude === "number" &&
    typeof last?.latitude === "number" &&
    typeof last?.longitude === "number" &&
    first.latitude === last.latitude &&
    first.longitude === last.longitude
      ? coords.slice(0, -1)
      : coords.slice();
  const verts = [];
  for (const c of ring) {
    if (typeof c.latitude !== "number" || typeof c.longitude !== "number") {
      return null;
    }
    verts.push({ lat: c.latitude, lng: c.longitude });
  }
  if (verts.length < 3) return null;
  const n = verts.length;
  const segMi = [];
  let perimeterMi = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mi = haversineMiles(
      verts[i].lat,
      verts[i].lng,
      verts[j].lat,
      verts[j].lng,
    );
    segMi.push(mi);
    perimeterMi += mi;
  }
  return { verts, segMi, perimeterMi };
}

/** @param {Array<{ lat: number; lng: number }>} verts */
function closestParkingDashRingVertexIndex(lat, lng, verts) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const d = haversineMiles(lat, lng, verts[i].lat, verts[i].lng);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

function dashRingForwardDistanceMi(iFrom, iTo, segMi, n) {
  if (iFrom === iTo) return 0;
  let d = 0;
  let i = iFrom;
  while (i !== iTo) {
    d += segMi[i];
    i = (i + 1) % n;
  }
  return d;
}

function buildDashRingForwardLatLngs(verts, iFrom, iTo) {
  const n = verts.length;
  const out = [];
  let i = iFrom;
  out.push([verts[i].lat, verts[i].lng]);
  while (i !== iTo) {
    i = (i + 1) % n;
    out.push([verts[i].lat, verts[i].lng]);
  }
  return out;
}

/**
 * Shuttle segment along the DASH loop following **GTFS shape vertex order** (same direction as
 * `shapes.txt` / animated base route). Not the geometrically shorter arc — buses follow one-way
 * loop circulation; the shorter arc can trace the ring backward vs actual traffic.
 * @returns {{ latLngs: number[][]; shuttleMi: number }}
 */
function dashShuttleAlongGtfsRing(geom, iBoard, iAlight) {
  const { verts, segMi } = geom;
  const n = verts.length;
  const shuttleMi = dashRingForwardDistanceMi(iBoard, iAlight, segMi, n);
  let latLngs = buildDashRingForwardLatLngs(verts, iBoard, iAlight);
  if (latLngs.length < 2) latLngs = [latLngs[0], latLngs[0]];
  return { latLngs, shuttleMi };
}

/**
 * @param {Array<{ lat: number; lng: number; label: string }>} dashPoints — `getParkingDashMapData().points`
 */
function nearestParkingDashStopFromPoints(lat, lng, dashPoints) {
  let best = null;
  let bestD = Infinity;
  for (const p of dashPoints) {
    const d = gridWalkMiles(lat, lng, p.lat, p.lng);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return null;
  return {
    lat: best.lat,
    lng: best.lng,
    label: typeof best.label === "string" ? best.label : "DASH stop",
    walkMi: bestD,
  };
}

/**
 * When total time (walk–board + shuttle + walk–venue) is **less** than walking door-to-door
 * (same pace knobs as **`parkingRoutePace`** in `config.json`), the walk **to DASH** fits `walkCapMiles`
 * (same idea as pin filtering: max willingness to reach a stop), and grid-walk parking→venue distance
 * **exceeds** the max-walk cap (otherwise show door-to-door walk only). The alight→venue leg uses the
 * nearest stop to the destination and is **not** capped by `walkCapMiles` (venues off the loop can be
 * farther than that last-mile walk).
 * Otherwise the map keeps a single door-to-door walk segment (walking-only is faster or ties).
 * @param {number} walkCapMiles — must be **> 0** (slider above minimum); **0** / invalid ⇒ no multimodal trip (cannot reach DASH without walking).
 */
function tryParkingDashMultimodalPath(
  startLat,
  startLng,
  destLat,
  destLng,
  walkCapMiles,
) {
  if (
    typeof walkCapMiles !== "number" ||
    !Number.isFinite(walkCapMiles) ||
    walkCapMiles <= 0
  ) {
    return null;
  }

  const dashPoints = getParkingDashMapData().points;
  if (dashPoints.length === 0) return null;

  const geom = getParkingDashLoopRingGeometry();
  if (!geom) return null;

  const board = nearestParkingDashStopFromPoints(
    startLat,
    startLng,
    dashPoints,
  );
  const alight = nearestParkingDashStopFromPoints(destLat, destLng, dashPoints);
  if (!board || !alight) return null;

  const w1 = board.walkMi;
  const w2 = gridWalkMiles(alight.lat, alight.lng, destLat, destLng);

  const walkCapFinite =
    typeof walkCapMiles === "number" &&
    walkCapMiles > 0 &&
    Number.isFinite(walkCapMiles);
  /** Cap applies to approach to DASH only; see JSDoc — `w2` can exceed cap when the venue is far from stops. */
  if (walkCapFinite && w1 > walkCapMiles) return null;

  const directMi = gridWalkMiles(startLat, startLng, destLat, destLng);
  /** Finite max-walk and grid-walk parking→venue distance already fits — prefer direct walk overlay only. */
  if (walkCapFinite && directMi <= walkCapMiles + 1e-9) return null;

  const pace = resolveParkingRoutePace(appData?.parkingRoutePace);

  const iBoard = closestParkingDashRingVertexIndex(
    board.lat,
    board.lng,
    geom.verts,
  );
  const iAlight = closestParkingDashRingVertexIndex(
    alight.lat,
    alight.lng,
    geom.verts,
  );
  const { latLngs: shuttleLatLngs, shuttleMi } = dashShuttleAlongGtfsRing(
    geom,
    iBoard,
    iAlight,
  );

  const { useDashOverlay } = compareParkingWalkVersusDashMinutes({
    directMi,
    w1,
    w2,
    shuttleMi,
    walkMinutesPerMile: pace.walkMinutesPerMile,
    dashMilesPerHour: pace.dashMilesPerHour,
    dashBoardingWaitMinutes: pace.dashBoardingWaitMinutes,
  });

  if (!useDashOverlay) return null;

  const shuttleRideMinutes = Math.max(
    1,
    Math.round((shuttleMi * 60) / pace.dashMilesPerHour),
  );

  return {
    walk1: [
      [startLat, startLng],
      [board.lat, board.lng],
    ],
    shuttle: shuttleLatLngs,
    walk2: [
      [alight.lat, alight.lng],
      [destLat, destLng],
    ],
    boardStop: {
      lat: board.lat,
      lng: board.lng,
      label: board.label,
    },
    alightStop: {
      lat: alight.lat,
      lng: alight.lng,
      label: alight.label,
    },
    walk1Mi: w1,
    walk2Mi: w2,
    shuttleMi,
    /** On-board time along the DASH loop (excludes typical wait at the stop). */
    shuttleMinutes: shuttleRideMinutes,
    dashBoardingWaitMinutes: pace.dashBoardingWaitMinutes,
    tooltip:
      "Estimated trip — walk to DASH, shuttle along the route, then walk to the venue (walk legs are approximate, not turn-by-turn).",
  };
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
 * Route prompt — same pin as {@link parkingDestinationPlaceholderIcon} (tap a **venue** on the map).
 */
function parkingRouteDestinationTapPromptIconSvg() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="0 0 28 42" fill="none" aria-hidden="true">` +
    `<path fill="#fecaca" stroke="#dc2626" stroke-width="1.25" stroke-linejoin="round" ` +
    `d="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>` +
    `<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>` +
    `</svg>`
  );
}

/**
 * Route prompt after a venue is set — same pin as {@link parkingSpotPickSuggestionIcon} (tap **parking** on the map).
 */
function parkingRouteParkingTapPromptIconSvg() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="0 0 28 42" fill="none" aria-hidden="true">` +
    `<path fill="#bbf7d0" stroke="#16a34a" stroke-width="1.25" stroke-linejoin="round" ` +
    `d="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>` +
    `<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>` +
    `</svg>`
  );
}

/** @param {boolean} destinationChosen — **false** → red venue pin; **true** → green parking pin. */
function parkingRoutePromptIconSvg(destinationChosen) {
  return destinationChosen
    ? parkingRouteParkingTapPromptIconSvg()
    : parkingRouteDestinationTapPromptIconSvg();
}

/** Empty, em dash, or OSM **Unknown** — not a real place name for UI copy. */
function parkingSpotNameIsPlaceholder(name) {
  const raw = name != null ? String(name).trim() : "";
  return raw === "" || raw === "—" || /^unknown$/i.test(raw);
}

/**
 * Map popup heading / route "Park at …": real **name**, else **categoryName**, else **fallback**.
 * @param {{ name?: string, categoryName?: string }} row
 */
function parkingSpotResolvedDisplayLabel(row, fallback) {
  if (!parkingSpotNameIsPlaceholder(row?.name)) return String(row.name).trim();
  const cat =
    typeof row?.categoryName === "string" ? row.categoryName.trim() : "";
  if (cat !== "") return cat;
  return fallback;
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
  const heading = parkingSpotResolvedDisplayLabel(row, "Parking location");
  const catLine =
    typeof row.categoryName === "string" ? row.categoryName.trim() : "";
  const showCategorySub =
    catLine !== "" &&
    heading.replace(/\s+/g, " ").toLowerCase() !==
      catLine.replace(/\s+/g, " ").toLowerCase();
  let html =
    `<div class="parking-spot-popup" style="font-size:12px;min-width:12rem">` +
    `<strong>${escapeHtml(heading)}</strong>`;
  if (showCategorySub) {
    html += `<br><span style="color:#64748b">${escapeHtml(catLine)}</span>`;
  }
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
      if (parkingMap) syncParkingMapOverlays(parkingMap, { fit: false });
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
    const ll = [s.lat, s.lng];
    const hit = L.circleMarker(ll, {
      radius: PARKING_SPOT_MARKER_HIT_RADIUS,
      stroke: false,
      fill: true,
      fillColor: "#000000",
      fillOpacity: 0,
      interactive: true,
      parkingCategoryKey: s.categoryKey,
      parkingSpotPopupLayer: true,
    });
    const visible = L.circleMarker(ll, {
      ...style,
      radius: PARKING_SPOT_MARKER_RADIUS,
      weight: 1,
      parkingCategoryKey: s.categoryKey,
      interactive: false,
    });
    attachParkingSpotStartButton(hit, s);
    const fg = L.featureGroup([hit, visible]);
    fg.addTo(g);
    if (markersByCategory[s.categoryKey])
      markersByCategory[s.categoryKey].push(fg);
  }

  // Paint order: see `PARKING_CATEGORY_PAINT_ORDER` (purple public garage above orange private garage).
  for (const categoryId of PARKING_CATEGORY_PAINT_ORDER) {
    for (const m of markersByCategory[categoryId] || []) {
      if (typeof m.bringToFront === "function") m.bringToFront();
    }
  }
}

/**
 * Solid green map-pin; optional **`glyph`** (default **`1`**). Pass **`""`** for a committed start pin with no
 * digit until {@link parkingTripStepNumbersHashReady}.
 */
function parkingSpotPickIcon(L, glyph) {
  const raw = glyph === undefined || glyph === null ? "1" : String(glyph);
  const showDigit = raw.trim() !== "";
  const safeGlyph = showDigit ? escapeHtml(raw.slice(0, 1)) : "";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#16a34a" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>' +
    '<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>' +
    (showDigit
      ? `<text x="14" y="15.4" text-anchor="middle" font-size="7.2" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-weight="700" fill="#16a34a">${safeGlyph}</text>`
      : "") +
    "</svg>";
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

/**
 * Muted green pick marker for {@link chooseBestParkingStartSpotId} when **`park=`** is omitted —
 * same pin badge as {@link parkingSpotPickIcon} (**blank** white circle, no glyph).
 */
function parkingSpotPickSuggestionIcon(L) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#bbf7d0" stroke="#16a34a" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>' +
    '<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>' +
    "</svg>";
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

  const id = getParkingEffectiveStartSpotId();
  if (!id) return;

  const p = parseParkingSpotIdToken(id);
  if (!p) return;

  const spot = getAllParkingSpotMarkers().find((m) => m.spotId === id);
  const row = spot ?? parkingSpotRowFallback(id, p);
  const committed = getParkingSpotIdForHash();
  const isCommitted =
    typeof committed === "string" && committed.length > 0 && committed === id;
  const stepNums = parkingTripStepNumbersHashReady();
  parkingSpotPickLayerGroup = L.layerGroup().addTo(map);
  const g = parkingSpotPickLayerGroup;
  const m = L.marker([p.lat, p.lng], {
    icon: !isCommitted
      ? parkingSpotPickSuggestionIcon(L)
      : stepNums
        ? parkingSpotPickIcon(L, "1")
        : parkingSpotPickIcon(L, ""),
    zIndexOffset: isCommitted ? 650 : 620,
  });
  attachParkingSpotStartButton(m, row);
  m.addTo(g);
}

function stampParkingEstimatedWalkLineAnimation(line) {
  const stampWalkLineDotAnimationClass = () => {
    const el = line.getElement?.() ?? line._path;
    if (el?.classList) el.classList.add("parking-estimated-walk-line-path");
  };
  stampWalkLineDotAnimationClass();
  requestAnimationFrame(() => {
    requestAnimationFrame(stampWalkLineDotAnimationClass);
  });
}

/** Animated dashed stroke for the multimodal DASH leg only (not base route layer). */
function stampParkingDashTripSegmentAnimation(line) {
  const stamp = () => {
    const el = line.getElement?.() ?? line._path;
    if (el?.classList) el.classList.add("parking-dash-trip-segment-path");
  };
  stamp();
  requestAnimationFrame(() => {
    requestAnimationFrame(stamp);
  });
}

/**
 * Light “outline” underlay + blue dashes (same geometry; halo not interactive).
 */
function addParkingWalkDashedLineWithHalo(
  g,
  L,
  latLngs,
  tooltipText,
  walkTooltipOpts,
) {
  const dashPattern = "2 12";
  const halo = L.polyline(latLngs, {
    color: PARKING_WALK_OVERLAY_HALO_COLOR,
    weight: PARKING_WALK_OVERLAY_HALO_WEIGHT,
    opacity: 1,
    dashArray: dashPattern,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  });
  halo.addTo(g);
  stampParkingEstimatedWalkLineAnimation(halo);

  const fg = L.polyline(latLngs, {
    color: PARKING_WALK_OVERLAY_COLOR,
    weight: PARKING_WALK_OVERLAY_FG_WEIGHT,
    opacity: 0.92,
    dashArray: dashPattern,
    lineCap: "round",
    lineJoin: "round",
    interactive: true,
  });
  fg.bindTooltip(tooltipText, walkTooltipOpts);
  fg.addTo(g);
  stampParkingEstimatedWalkLineAnimation(fg);
}

/** Highlighted DASH trip stops use pin markers (not circles) so they read as true map destinations. */
const PARKING_DASH_TRIP_STOP_FILL = "#933145";

/**
 * @param {{ lat: number; lng: number; label: string }} boardStop
 * @param {{ lat: number; lng: number; label: string }} alightStop
 */
function addParkingDashTripStopMarkers(g, L, boardStop, alightStop) {
  const fill = PARKING_DASH_TRIP_STOP_FILL;
  const sameTripStop =
    haversineMiles(
      boardStop.lat,
      boardStop.lng,
      alightStop.lat,
      alightStop.lng,
    ) < 2e-5;

  const popupHtml = (title, stopLabel, detail) =>
    `<div style="font-size:12px"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(stopLabel)}` +
    (detail
      ? `<br><span style="color:#64748b;font-size:11px">${escapeHtml(detail)}</span>`
      : "") +
    `</div>`;

  const dashTripStopIcon = (glyph) => {
    const showDigit = typeof glyph === "string" && glyph.trim() !== "";
    const safeGlyph = showDigit ? escapeHtml(glyph) : "";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38">' +
      `<path fill="${fill}" stroke="#ffffff" stroke-width="1.15" stroke-linejoin="round" d="M13 1.8c-5.7 0-10.3 4.6-10.3 10.3 0 7.4 9.6 22.9 10.1 23.7.2.3.6.3.8 0 .5-.8 10.2-16.3 10.2-23.7 0-5.7-4.6-10.3-10.3-10.3z"/>` +
      '<circle cx="13" cy="12.2" r="5.1" fill="#ffffff"/>' +
      (showDigit
        ? `<text x="13" y="14.35" text-anchor="middle" font-size="6.6" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-weight="700" fill="${fill}">${safeGlyph}</text>`
        : "") +
      "</svg>";
    return L.icon({
      iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      iconSize: [26, 38],
      iconAnchor: [13, 38],
      popupAnchor: [0, -33],
    });
  };

  const showTripDigits = parkingTripStepNumbersHashReady();
  const glyphBoard = showTripDigits ? "2" : "";
  const glyphAlight = showTripDigits ? "3" : "";

  const makeStopPin = (lat, lng, glyph, title, stopLabel, detail) => {
    const m = L.marker([lat, lng], {
      icon: dashTripStopIcon(glyph),
      zIndexOffset: 500,
    });
    m.bindPopup(popupHtml(title, stopLabel, detail));
    m.addTo(g);
    if (typeof m.bringToFront === "function") m.bringToFront();
    return m;
  };

  if (sameTripStop) {
    makeStopPin(
      boardStop.lat,
      boardStop.lng,
      glyphBoard,
      "DASH (board & exit)",
      boardStop.label,
      "Same stop for boarding and exiting on this trip.",
    );
    return;
  }

  const boardM = makeStopPin(
    boardStop.lat,
    boardStop.lng,
    glyphBoard,
    "Board DASH",
    boardStop.label,
    "Walk here to catch the shuttle.",
  );

  const alightM = makeStopPin(
    alightStop.lat,
    alightStop.lng,
    glyphAlight,
    "Exit DASH",
    alightStop.label,
    "Walk from here to the venue.",
  );

  if (typeof boardM.bringToFront === "function") boardM.bringToFront();
  if (typeof alightM.bringToFront === "function") alightM.bringToFront();
}

/**
 * Dashed blue approximate walk (wavy chord) and, when faster than walking direct and within walk caps, DASH leg along the loop.
 */
function syncParkingStartFinishWalkLine(map) {
  const L = globalThis.L;
  if (!map || !L) {
    globalThis.__parkingWalkUsesDashOverlay = false;
    return;
  }

  if (parkingStartFinishLineLayerGroup) {
    try {
      map.removeLayer(parkingStartFinishLineLayerGroup);
    } catch {
      /* ignore */
    }
    parkingStartFinishLineLayerGroup = null;
  }

  const destLl = getParkingDestinationLatLng();
  const id = getParkingEffectiveStartSpotId();
  if (!destLl || !id) {
    globalThis.__parkingWalkUsesDashOverlay = false;
    return;
  }

  const start = parseParkingSpotIdToken(id);
  if (!start) {
    globalThis.__parkingWalkUsesDashOverlay = false;
    return;
  }

  const walkCap = resolvedParkingWalkCapMiles();
  /** Slider / URL **`walk=0`** — user is not willing to walk; omit approximate walk + DASH trip polylines. */
  if (!Number.isFinite(walkCap) || walkCap <= 0) {
    globalThis.__parkingWalkUsesDashOverlay = false;
    return;
  }

  parkingStartFinishLineLayerGroup = L.layerGroup().addTo(map);
  const g = parkingStartFinishLineLayerGroup;

  const multimodal = tryParkingDashMultimodalPath(
    start.lat,
    start.lng,
    destLl[0],
    destLl[1],
    walkCap,
  );

  const walkTooltipOpts = {
    sticky: true,
    direction: "center",
    opacity: 0.95,
    className: "parking-estimated-walk-tooltip",
  };

  if (multimodal) {
    const w1LL = wavyApproxWalkChordLatLngs(
      multimodal.walk1[0],
      multimodal.walk1[1],
    );
    addParkingWalkDashedLineWithHalo(
      g,
      L,
      w1LL,
      multimodal.tooltip,
      walkTooltipOpts,
    );

    const shuttleHalo = L.polyline(multimodal.shuttle, {
      color: PARKING_DASH_TRIP_SHUTTLE_HALO_COLOR,
      weight: PARKING_DASH_TRIP_SHUTTLE_HALO_WEIGHT,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    });
    shuttleHalo.addTo(g);

    const shuttle = L.polyline(multimodal.shuttle, {
      color: PARKING_DASH_TRIP_STOP_FILL,
      weight: PARKING_DASH_TRIP_SHUTTLE_FG_WEIGHT,
      opacity: 0.95,
      dashArray: PARKING_DASH_TRIP_SHUTTLE_DASH_ARRAY,
      lineCap: "round",
      lineJoin: "round",
      interactive: true,
    });
    shuttle.bindTooltip(multimodal.tooltip, walkTooltipOpts);
    shuttle.addTo(g);
    stampParkingDashTripSegmentAnimation(shuttle);

    const w2LL = wavyApproxWalkChordLatLngs(
      multimodal.walk2[0],
      multimodal.walk2[1],
    );
    addParkingWalkDashedLineWithHalo(
      g,
      L,
      w2LL,
      multimodal.tooltip,
      walkTooltipOpts,
    );

    addParkingDashTripStopMarkers(
      g,
      L,
      multimodal.boardStop,
      multimodal.alightStop,
    );
    globalThis.__parkingWalkUsesDashOverlay = true;
    return;
  }

  const directLL = wavyApproxWalkChordLatLngs(
    [start.lat, start.lng],
    [destLl[0], destLl[1]],
  );
  addParkingWalkDashedLineWithHalo(
    g,
    L,
    directLL,
    "Approximate walk — not turn-by-turn routing.",
    walkTooltipOpts,
  );
  globalThis.__parkingWalkUsesDashOverlay = false;
}

/**
 * Red finish pin for the selected destination.
 * **`4`** when the walk overlay uses DASH (1 park → 2 board → 3 exit → 4 venue); **`2`** when the trip is
 * park + walk to venue only (1 → 2). Pass **`""`** for selected venue without {@link parkingTripStepNumbersHashReady}.
 */
function parkingDestinationMarkerIcon(L, glyph) {
  const raw = glyph === undefined || glyph === null ? "4" : String(glyph);
  const showDigit = raw.trim() !== "";
  const safeGlyph = showDigit ? escapeHtml(raw.slice(0, 1)) : "";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#dc2626" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>' +
    '<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>' +
    (showDigit
      ? `<text x="14" y="15.4" text-anchor="middle" font-size="7.2" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-weight="700" fill="#dc2626">${safeGlyph}</text>`
      : "") +
    "</svg>";
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

/** Muted red pin for venues not selected — **blank** white badge (same circle as numbered finish pin); popup **Set as destination**. */
function parkingDestinationPlaceholderIcon(L) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">' +
    '<path fill="#fecaca" stroke="#dc2626" stroke-width="1.25" stroke-linejoin="round" ' +
    'd="M14 2C7.9 2 3 6.9 3 13c0 7.8 10.2 24.6 10.8 25.5.2.3.6.3.8 0 .6-.9 10.9-17.7 10.9-25.5C25 6.9 20.1 2 14 2z"/>' +
    '<circle cx="14" cy="13" r="5.2" fill="#ffffff"/>' +
    "</svg>";
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

function parkingDestinationPlaceholderPopupHtml(name) {
  return (
    `<div class="parking-destination-popup" style="font-size:12px;min-width:12rem">` +
    `<strong>${escapeHtml(name)}</strong>` +
    `<p style="margin:8px 0 0;color:#64748b;font-size:11px;line-height:1.35">Pick this venue for routes, walk limits, and parking.</p>` +
    `<div class="parking-spot-popup-actions" style="margin-top:10px;display:block;width:100%;clear:both">` +
    `<button type="button" data-parking-destination-select-btn` +
    ` title="Set as destination"` +
    ` style="margin-top:0;box-sizing:border-box;max-width:100%;padding:6px 10px;font-size:12px;font-weight:600;color:#fff;background:#dc2626;border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;vertical-align:top">` +
    `<span style="display:inline-flex;flex-shrink:0;line-height:0" aria-hidden="true">` +
    parkingStartBtnIconSvg(false) +
    `</span>` +
    `<span style="text-align:left;white-space:normal;line-height:1.25">Set as destination</span>` +
    `</button>` +
    `</div></div>`
  );
}

/** Placeholder venue pins: pin opens popup; button confirms selection (same hash/select as dropdown). */
function attachParkingDestinationSelectButton(marker, name, slug) {
  marker.bindPopup(parkingDestinationPlaceholderPopupHtml(name));
  marker.on("popupopen", () => {
    const wrap = marker.getPopup()?.getElement?.();
    const btn = wrap?.querySelector?.("[data-parking-destination-select-btn]");
    if (!btn) return;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectParkingDestinationBySlug(slug);
      try {
        marker.closePopup();
      } catch {
        /* ignore */
      }
    };
  });
}

function parkingDestinationSelectedPopupHtml(name) {
  return (
    `<div class="parking-destination-popup parking-destination-popup--selected" style="font-size:12px;min-width:12rem">` +
    `<strong>${escapeHtml(name)}</strong>` +
    `<p style="margin:8px 0 0;color:#64748b;font-size:11px;line-height:1.35">Selected destination</p>` +
    `<div class="parking-spot-popup-actions" style="margin-top:10px;display:block;width:100%;clear:both">` +
    `<button type="button" data-parking-destination-clear-btn` +
    ` title="Clear selected destination"` +
    ` style="margin-top:0;box-sizing:border-box;max-width:100%;padding:6px 10px;font-size:12px;font-weight:600;color:#374151;background:#e5e7eb;border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;vertical-align:top">` +
    `<span style="display:inline-flex;flex-shrink:0;line-height:0" aria-hidden="true">` +
    parkingStartBtnIconSvg(true) +
    `</span>` +
    `<span style="text-align:left;white-space:nowrap;line-height:1.25;flex-shrink:0">Clear selected destination</span>` +
    `</button>` +
    `</div></div>`
  );
}

/** Selected venue red pin: popup **Clear selected destination** (digits only when {@link parkingTripStepNumbersHashReady}). */
function attachParkingDestinationClearButton(marker, name) {
  marker.bindPopup(parkingDestinationSelectedPopupHtml(name));
  marker.on("popupopen", () => {
    const wrap = marker.getPopup()?.getElement?.();
    const btn = wrap?.querySelector?.("[data-parking-destination-clear-btn]");
    if (!btn) return;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearParkingDestinationFromMap();
      try {
        marker.closePopup();
      } catch {
        /* ignore */
      }
    };
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

  const destinations = Array.isArray(appData?.destinations)
    ? [...appData.destinations].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        }),
      )
    : [];

  const sel = document.getElementById("parkingDestinationSelect");
  const selectedSlug = sel?.value?.trim() || "";

  parkingDestinationLayerGroup = L.layerGroup().addTo(map);
  const g = parkingDestinationLayerGroup;

  const placeholderMarkers = [];
  const selectedMarkers = [];

  for (const dest of destinations) {
    const ll = parkingLatLngFromDestinationRecord(dest);
    if (!ll) continue;
    const slug = dest.slug;
    if (typeof slug !== "string" || slug.trim() === "") continue;
    const name = dest.name || slug || "Destination";

    if (selectedSlug !== "") {
      // Finish chosen: only the selected venue pin (hide other destinations).
      if (slug !== selectedSlug) continue;
      const stepNums = parkingTripStepNumbersHashReady();
      const venueGlyph = stepNums
        ? globalThis.__parkingWalkUsesDashOverlay === true
          ? "4"
          : "2"
        : "";
      const m = L.marker(ll, {
        icon: parkingDestinationMarkerIcon(L, venueGlyph),
      });
      attachParkingDestinationClearButton(m, name);
      selectedMarkers.push(m);
      continue;
    }

    const m = L.marker(ll, { icon: parkingDestinationPlaceholderIcon(L) });
    attachParkingDestinationSelectButton(m, name, slug);
    placeholderMarkers.push(m);
  }

  for (const m of placeholderMarkers) m.addTo(g);
  for (const m of selectedMarkers) m.addTo(g);
}

function fitParkingMapToAllContent(map) {
  const L = globalThis.L;
  if (!map || !L) return;

  map.invalidateSize();

  const spots = getAllParkingSpotMarkers();
  const spotLatLngs = spots.map((s) => [s.lat, s.lng]);
  const destLl = getParkingDestinationLatLng();
  const startId = getParkingSpotIdForHash();
  const startPt = startId ? parseParkingSpotIdToken(startId) : null;

  const mapMaxZ = typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19;
  const fitMaxZoom = Math.min(PARKING_MAP_FIT_MAX_ZOOM, mapMaxZ);
  const fitOpts = {
    padding: PARKING_MAP_FIT_PADDING,
    maxZoom: fitMaxZoom,
  };
  const cappedSetZoom = (latlng, z) =>
    map.setView(latlng, Math.min(z, fitMaxZoom));

  const noFinish = !destLl;
  const allDestLatLngs = noFinish ? getAllParkingDestinationFitLatLngs() : [];

  /**
   * No venue: frame **only** placeholder destination pins — not parking (parking spreads
   * far past venues and leaves empty margin, especially on tall viewports).
   */
  if (noFinish && allDestLatLngs.length > 1) {
    map.fitBounds(L.latLngBounds(allDestLatLngs), {
      padding: PARKING_MAP_FIT_DEST_ONLY_PADDING,
      maxZoom: fitMaxZoom,
    });
    return;
  }

  /**
   * Finish selected, **no** `park=` yet: frame visible parking pins **and** the venue so the red
   * finish pin stays on-screen when the pick pool is far from the destination (off-downtown venues).
   */
  if (destLl && !startPt && spotLatLngs.length > 0) {
    map.fitBounds(L.latLngBounds([...spotLatLngs, destLl]), fitOpts);
    return;
  }

  /** `park=` committed: frame chosen parking + venue for trip context. */
  if (destLl && startPt) {
    map.fitBounds(
      L.latLngBounds([[startPt.lat, startPt.lng], destLl]),
      fitOpts,
    );
    return;
  }

  /** Rare: one destination in data — keep it in view when also fitting many spots. */
  const mergeDestWhenNoFinish = (pts) =>
    noFinish && allDestLatLngs.length === 1 ? [...pts, ...allDestLatLngs] : pts;

  // Fit to parking pins only (no `finish=` yet, or single-destination data edge case).
  if (spotLatLngs.length > 1) {
    map.fitBounds(L.latLngBounds(mergeDestWhenNoFinish(spotLatLngs)), fitOpts);
    return;
  }
  if (spotLatLngs.length === 1) {
    const merged = mergeDestWhenNoFinish(spotLatLngs);
    if (merged.length > 1) {
      map.fitBounds(L.latLngBounds(merged), fitOpts);
      return;
    }
    cappedSetZoom(spotLatLngs[0], 15);
    return;
  }
  if (destLl) {
    cappedSetZoom(destLl, 15);
    return;
  }

  if (allDestLatLngs.length === 1) {
    cappedSetZoom(allDestLatLngs[0], 15);
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
    cappedSetZoom(MODES_PAGE_EMPTY_MAP_CENTER, 12);
  }
}

/** Text panel under the map — mirrors walk / DASH overlays from {@link syncParkingStartFinishWalkLine}. */
function syncParkingRouteInstructionsPanel() {
  const body = document.getElementById("parkingRouteInstructionsBody");
  if (!body) return;

  const unverifiedNote = document.getElementById(
    "parkingRouteUnverifiedDataNote",
  );
  const setParkingRouteUnverifiedNoteVisible = (visible) => {
    if (!unverifiedNote) return;
    unverifiedNote.classList.toggle("hidden", !visible);
  };

  const destLl = getParkingDestinationLatLng();
  const walkCap = resolvedParkingWalkCapMiles();
  const destSlug = getParkingDestinationSlugFromSelect();
  const destRec = appData?.destinations?.find((d) => d.slug === destSlug);
  const destName =
    typeof destRec?.name === "string" && destRec.name.trim() !== ""
      ? destRec.name.trim()
      : "the venue";

  const routeNextHtml = (inner, destinationChosen = false) =>
    `<p class="parking-route-instructions-placeholder parking-route-instructions-prompt">` +
    `<span class="parking-route-prompt-icon" aria-hidden="true">${parkingRoutePromptIconSvg(destinationChosen)}</span>` +
    `<span class="parking-route-prompt-msg">${inner}</span></p>`;

  if (!destLl) {
    body.innerHTML = routeNextHtml(
      `Choose <strong class="font-semibold text-slate-800">where you're going</strong> with the destination menu above or click on one of the map markers.`,
    );
    setParkingRouteUnverifiedNoteVisible(true);
    return;
  }

  if (!Number.isFinite(walkCap) || walkCap <= 0) {
    body.innerHTML = routeNextHtml(
      `Move <strong class="font-semibold text-slate-800">And then walk</strong> above zero so we can show walking distance from parking to DASH.`,
      true,
    );
    setParkingRouteUnverifiedNoteVisible(true);
    return;
  }

  const rawStartId = normalizeParkingSpotIdFromHashRaw();
  const committedId = getParkingSpotIdForHash();
  if (rawStartId && !committedId) {
    body.innerHTML = `<p class="parking-route-instructions-placeholder">Your chosen parking isn't on the map with the current <strong class="font-semibold text-slate-800">To park in</strong> filters. Turn a category back on or pick another spot.</p>`;
    setParkingRouteUnverifiedNoteVisible(true);
    return;
  }

  if (!committedId) {
    body.innerHTML = routeNextHtml(
      `Tap a parking location, then <strong class="font-semibold text-slate-800">Plan to park here</strong> to set where you'll leave your car.`,
      true,
    );
    setParkingRouteUnverifiedNoteVisible(true);
    return;
  }

  const start = parseParkingSpotIdToken(committedId);
  if (!start) {
    body.innerHTML = routeNextHtml(
      `Pick a parking spot and tap <strong class="font-semibold text-slate-800">Plan to park here</strong> again.`,
      true,
    );
    setParkingRouteUnverifiedNoteVisible(true);
    return;
  }

  const spot =
    getAllParkingSpotMarkers().find((m) => m.spotId === committedId) ??
    parkingSpotRowFallback(committedId, start);
  const parkLabel = parkingSpotResolvedDisplayLabel(spot, "this location");
  const addrRaw = typeof spot.address === "string" ? spot.address.trim() : "";
  const mapsHref = parkingGoogleMapsHref(start.lat, start.lng, addrRaw);
  const parkAddressInline =
    addrRaw !== "" && mapsHref !== ""
      ? ` <a href="${escapeHtml(mapsHref)}" class="parking-route-step-detail parking-route-step-maps-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`Open ${addrRaw} in Google Maps`)}">(${escapeHtml(addrRaw)})</a>`
      : addrRaw !== ""
        ? ` <span class="parking-route-step-detail">(${escapeHtml(addrRaw)})</span>`
        : "";
  const parkLabelAria =
    parkLabel === "this location"
      ? "Open this parking spot in Google Maps"
      : `Open ${parkLabel} in Google Maps`;
  const parkLabelHtml =
    mapsHref !== ""
      ? `<a href="${escapeHtml(mapsHref)}" class="parking-route-step-maps-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(parkLabelAria)}">${escapeHtml(parkLabel)}</a>`
      : escapeHtml(parkLabel);
  const parkMainHtml = `<strong>Park</strong> at ${parkLabelHtml}${parkAddressInline}`;

  const venueMapsHref = parkingGoogleMapsHref(
    destLl[0],
    destLl[1],
    destName === "the venue" ? "" : destName,
  );
  const venueLinkAria =
    destName === "the venue"
      ? "Open destination in Google Maps"
      : `Open ${destName} in Google Maps`;
  const venueNameHtml =
    venueMapsHref !== ""
      ? `<a href="${escapeHtml(venueMapsHref)}" class="parking-route-step-maps-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(venueLinkAria)}">${escapeHtml(destName)}</a>`
      : escapeHtml(destName);

  const multimodal = tryParkingDashMultimodalPath(
    start.lat,
    start.lng,
    destLl[0],
    destLl[1],
    walkCap,
  );

  const listOpen = `<ol class="parking-route-steps">`;
  const listClose = `</ol>`;

  if (multimodal) {
    const sameTripStop =
      haversineMiles(
        multimodal.boardStop.lat,
        multimodal.boardStop.lng,
        multimodal.alightStop.lat,
        multimodal.alightStop.lng,
      ) < 2e-5;

    const steps = [];
    steps.push(parkingRouteStepLi(parkMainHtml, [], "drive"));
    const w1m = parkingInstructionWalkEstimateMetrics(multimodal.walk1Mi);
    const w2m = parkingInstructionWalkEstimateMetrics(multimodal.walk2Mi);
    const waitM = parkingInstructionDashWaitMetrics(multimodal);
    const onboardM = parkingInstructionDashOnboardMetrics(multimodal);
    const boardRaw =
      typeof multimodal.boardStop.label === "string"
        ? multimodal.boardStop.label.trim()
        : "";
    const boardDisplay = boardRaw !== "" ? boardRaw : "DASH stop";
    const boardMapsHref = parkingGoogleMapsHref(
      multimodal.boardStop.lat,
      multimodal.boardStop.lng,
      boardRaw || boardDisplay,
    );
    const boardLabelHtml =
      boardMapsHref !== ""
        ? `<a href="${escapeHtml(boardMapsHref)}" class="parking-route-step-maps-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`Open ${boardDisplay} in Google Maps`)}">${escapeHtml(boardDisplay)}</a>`
        : escapeHtml(boardDisplay);
    const alightRaw =
      typeof multimodal.alightStop.label === "string"
        ? multimodal.alightStop.label.trim()
        : "";
    const alightDisplay = alightRaw !== "" ? alightRaw : "DASH stop";
    const alightMapsHref = parkingGoogleMapsHref(
      multimodal.alightStop.lat,
      multimodal.alightStop.lng,
      alightRaw || alightDisplay,
    );
    const alightLabelHtml =
      alightMapsHref !== ""
        ? `<a href="${escapeHtml(alightMapsHref)}" class="parking-route-step-maps-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`Open ${alightDisplay} in Google Maps`)}">${escapeHtml(alightDisplay)}</a>`
        : escapeHtml(alightDisplay);
    const boardLabelPlain = escapeHtml(boardDisplay);
    const alightLabelPlain = escapeHtml(alightDisplay);

    steps.push(
      parkingRouteStepLi(
        `<strong>Walk</strong> to ${boardLabelHtml}`,
        w1m ? [w1m] : [],
        "walk",
      ),
    );
    steps.push(
      parkingRouteStepLi(
        `<strong>Wait</strong> for the free ${parkingRouteDashShuttleTransitAppAnchorHtml()}`,
        waitM ? [waitM] : [],
        "wait",
      ),
    );
    if (sameTripStop) {
      steps.push(
        parkingRouteStepLi(
          `<strong>Board</strong> DASH at ${boardLabelPlain} and <strong>exit</strong> at the same stop`,
          onboardM ? [onboardM] : [],
          "dash",
        ),
      );
    } else {
      steps.push(
        parkingRouteStepLi(
          `<strong>Board</strong> DASH, then <strong>ride</strong> to ${alightLabelPlain} and <strong>exit</strong>`,
          onboardM ? [onboardM] : [],
          "dash",
        ),
      );
    }
    steps.push(
      parkingRouteStepLi(
        `<strong>Walk</strong> to ${venueNameHtml}`,
        w2m ? [w2m] : [],
        "walk",
      ),
    );

    body.innerHTML = listOpen + steps.join("") + listClose;
    setParkingRouteUnverifiedNoteVisible(false);
    return;
  }

  const doorMi = gridWalkMiles(start.lat, start.lng, destLl[0], destLl[1]);
  const doorMetrics = parkingInstructionWalkEstimateMetrics(doorMi);
  const steps = [
    parkingRouteStepLi(parkMainHtml, [], "drive"),
    parkingRouteStepLi(
      `<strong>Walk</strong> to ${venueNameHtml}`,
      doorMetrics ? [doorMetrics] : [],
      "walk",
    ),
  ];
  body.innerHTML = listOpen + steps.join("") + listClose;
  setParkingRouteUnverifiedNoteVisible(false);
}

/**
 * @param {{ fit?: boolean } | undefined} opts — **`fit: false`** refreshes pins/routes/markers without refitting zoom (for live slider `input`).
 */
function syncParkingMapOverlays(map, opts) {
  const doFit = opts?.fit !== false;
  syncParkingDashRoutes(map);
  syncParkingSpots(map);
  syncParkingSpotPickMarker(map);
  syncParkingStartFinishWalkLine(map);
  syncParkingDestinationMarker(map);
  syncParkingRouteInstructionsPanel();
  if (doFit) fitParkingMapToAllContent(map);
}

const PARKING_VISIT_VIEWPORT_LOCK_CLASS = "parking-visit-viewport-lock";

export function hideParkingView() {
  const parkingView = document.getElementById("parkingView");
  if (parkingView) parkingView.classList.add("hidden");
  document.getElementById("parkingMapChrome")?.classList.add("hidden");
  document.querySelector("main")?.classList.remove("parking-map-active");
  document.documentElement.classList.remove(PARKING_VISIT_VIEWPORT_LOCK_CLASS);
}

function applyParkingRouteLayoutShell() {
  const appView = document.getElementById("appView");
  const dataView = document.getElementById("dataView");
  const modesView = document.getElementById("modesView");
  const parkingView = document.getElementById("parkingView");
  if (!appView || !dataView || !modesView || !parkingView) return;
  appView.classList.add("hidden");
  dataView.classList.add("hidden");
  modesView.classList.add("hidden");
  parkingView.classList.remove("hidden");
  const mainEl = document.querySelector("main");
  mainEl?.classList.remove("data-view-active");
  mainEl?.classList.add("parking-map-active");
  document.documentElement.classList.add(PARKING_VISIT_VIEWPORT_LOCK_CLASS);
}

/**
 * Hide the planner and show the parking map shell before data loads (default `#/visit`).
 * Map chrome stays hidden until {@link renderParkingView} finishes wiring controls.
 */
export function prepareParkingShellVisibility() {
  applyParkingRouteLayoutShell();
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
    12,
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
  syncParkingHashStripStartWhenWalkZero();
  ensureParkingResetDelegation();
  document.getElementById("parkingMapChrome")?.classList.remove("hidden");

  applyParkingRouteLayoutShell();

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
