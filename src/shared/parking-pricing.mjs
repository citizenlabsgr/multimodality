/**
 * Parking `pricing` object helpers. Tier amounts are **numbers** (dollars) or **`[low, high]`**
 * ranges. **`hourly`** is always **dollars per hour** (half-hour source rates are stored ×2).
 * Optional metadata: **`rateLabel`**, **`rateNote`**, **`hourlyFreeWhen`**.
 * **`rateLabel`**, **`rateNote`**, **`hourlyFreeWhen`** (prose free window, not a dollar amount).
 */

import { PARKING_PRICE_NOT_LISTED_LABEL } from "./data-loader.mjs";

function isPrivateParkingCategory(categoryKey) {
  return (
    categoryKey === "private-garage" ||
    categoryKey === "private-lot" ||
    categoryKey === "ellis-garage" ||
    categoryKey === "ellis-lot" ||
    categoryKey === "osmGarages" ||
    categoryKey === "osmLots" ||
    categoryKey === "airGarageGarages" ||
    categoryKey === "airGarageLots" ||
    categoryKey === "ellisGarages" ||
    categoryKey === "ellisLots"
  );
}

export const PRICING_AMOUNT_KEYS = [
  "events",
  "evening",
  "hourly",
  "rate",
  "daily",
];

/** No pricing tier fields. */
export const PARKING_EVENING_PRICE_ABSENT = null;
/** Tier exists but no parseable dollars (not free prose). */
export const PARKING_EVENING_PRICE_AMBIGUOUS_PROSE = -1;

export const PRICING_META_KEYS = ["rateLabel", "rateNote", "hourlyFreeWhen"];

const NON_PRICE_KEYS = new Set([
  ...PRICING_META_KEYS,
  "maxDuration",
  "enforcement",
  "free",
]);

/** @typedef {number | [number, number]} PricingAmount */

/**
 * @param {unknown} v
 * @returns {v is PricingAmount}
 */
export function isPricingAmount(v) {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/**
 * Legacy `$` strings (tests / old JSON). Prefer {@link isPricingAmount} in data files.
 * @param {unknown} text
 * @returns {number[]}
 */
export function parseDollarAmountsFromPriceText(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const nums = [];
  const re = /\$(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (Number.isFinite(n)) nums.push(n);
  }
  const singleDollarRange = /\$(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\b/g;
  while ((m = singleDollarRange.exec(text)) !== null) {
    const a = Number.parseFloat(m[1]);
    const b = Number.parseFloat(m[2]);
    if (Number.isFinite(a)) nums.push(a);
    if (Number.isFinite(b)) nums.push(b);
  }
  return nums;
}

/**
 * @param {unknown} v
 * @returns {number[]}
 */
export function tierDollarAmounts(v) {
  if (isPricingAmount(v)) {
    if (typeof v === "number") return [v];
    return [v[0], v[1]];
  }
  if (typeof v === "string" && v.trim())
    return parseDollarAmountsFromPriceText(v);
  return [];
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatDollarAmount(n) {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "$0";
  if (Math.abs(n - Math.round(n)) < 1e-6) return `$${Math.round(n)}`;
  const fixed = n.toFixed(2);
  return `$${fixed.replace(/\.?0+$/, "")}`;
}

/**
 * @param {PricingAmount} amount
 * @returns {string}
 */
export function formatPricingAmount(amount) {
  if (typeof amount === "number") return formatDollarAmount(amount);
  const lo = formatDollarAmount(amount[0]);
  const hi = formatDollarAmount(amount[1]);
  return `${lo}–${hi}`;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {Record<string, unknown> | null | undefined} pricing
 * @returns {string}
 */
export function formatPricingTierForDisplay(key, value, pricing) {
  if (key === "hourlyFreeWhen" && typeof value === "string")
    return value.trim();
  if (NON_PRICE_KEYS.has(key) && typeof value === "string") return value.trim();

  const amounts = tierDollarAmounts(value);
  if (amounts.length === 0) {
    if (typeof value === "string") return value.trim();
    return "";
  }

  let line =
    isPricingAmount(value) && typeof value !== "number"
      ? formatPricingAmount(value)
      : formatDollarAmount(Math.max(...amounts));

  if (key === "daily" && typeof value === "number") {
    line = `Max ${formatDollarAmount(value)} / day`;
  }

  const p = pricing && typeof pricing === "object" ? pricing : {};
  if (key === "hourly") {
    line += " per hour";
    const note = typeof p.rateNote === "string" ? p.rateNote.trim() : "";
    if (note) line += ` ${note}`;
  }
  if (key === "rate") {
    const label = typeof p.rateLabel === "string" ? p.rateLabel.trim() : "";
    if (label && amounts[0] === 0) return `${label} $0`;
    if (label) line = `${label} ${line}`;
  }

  return line;
}

/**
 * @param {Record<string, unknown> | null | undefined} pricing
 * @returns {boolean}
 */
export function pricingObjectHasAnyKnownTierField(pricing) {
  if (!pricing || typeof pricing !== "object") return false;
  for (const k of PRICING_AMOUNT_KEYS) {
    if (isPricingAmount(pricing[k])) return true;
    if (typeof pricing[k] === "string" && pricing[k].trim()) return true;
  }
  if (
    typeof pricing.hourlyFreeWhen === "string" &&
    pricing.hourlyFreeWhen.trim()
  ) {
    return true;
  }
  return false;
}

export function parkingPriceTextImpliesEveningFree(text) {
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

export const PARKING_EVENING_HOURLY_ASSUMED_HOURS = 6;

function tierValueLooksLikeHourlyCap(key) {
  return key === "hourly";
}

/**
 * @param {Record<string, unknown>} pricing
 * @param {string} categoryKey
 * @returns {{ key: string, value: unknown } | null}
 */
export function pickEveningTierForCap(pricing, categoryKey) {
  const isPublic =
    categoryKey === "public-garage" || categoryKey === "public-lot";
  const order = isPublic
    ? ["events", "evening", "hourly", "rate", "daily"]
    : ["events", "evening", "rate", "daily", "hourly"];
  for (const key of order) {
    const v = pricing[key];
    if (isPricingAmount(v)) return { key, value: v };
    if (typeof v === "string" && v.trim()) return { key, value: v };
  }
  if (
    typeof pricing.hourlyFreeWhen === "string" &&
    pricing.hourlyFreeWhen.trim()
  ) {
    return { key: "hourlyFreeWhen", value: pricing.hourlyFreeWhen };
  }
  return null;
}

/**
 * @param {unknown} tierValue
 * @param {string} tierKey
 * @param {Record<string, unknown>} pricing
 * @returns {number | null}
 */
export function ceilingFromPricingTier(tierValue, tierKey, pricing) {
  if (
    tierKey === "hourlyFreeWhen" &&
    typeof tierValue === "string" &&
    parkingPriceTextImpliesEveningFree(tierValue)
  ) {
    return 0;
  }
  if (typeof tierValue === "string") {
    if (parkingPriceTextImpliesEveningFree(tierValue)) return 0;
    const nums = parseDollarAmountsFromPriceText(tierValue);
    if (nums.length === 0) return null;
    const base = Math.max(...nums);
    const multiply =
      tierKey === "hourly" || /\b(per\s+hour|\/hr|hourly)\b/i.test(tierValue);
    if (multiply) return base * PARKING_EVENING_HOURLY_ASSUMED_HOURS;
    return base;
  }
  const nums = tierDollarAmounts(tierValue);
  if (nums.length === 0) return null;
  const base = Math.max(...nums);
  if (tierValueLooksLikeHourlyCap(tierKey)) {
    return base * PARKING_EVENING_HOURLY_ASSUMED_HOURS;
  }
  return base;
}

/** @param {Record<string, unknown> | null | undefined} pricing */
export function parkingSpotEveningPriceCeilingOrAbsent(pricing, categoryKey) {
  if (!pricing || typeof pricing !== "object")
    return PARKING_EVENING_PRICE_ABSENT;
  if (!pricingObjectHasAnyKnownTierField(pricing))
    return PARKING_EVENING_PRICE_ABSENT;

  const picked = pickEveningTierForCap(pricing, categoryKey);
  const hourlyOnly =
    isPricingAmount(pricing.hourly) ||
    (typeof pricing.hourly === "string" && pricing.hourly.trim());
  const hourlyFree =
    typeof pricing.hourlyFreeWhen === "string" && pricing.hourlyFreeWhen.trim();

  if (picked) {
    const c = ceilingFromPricingTier(picked.value, picked.key, pricing);
    if (c != null) return c;
    return PARKING_EVENING_PRICE_AMBIGUOUS_PROSE;
  }

  if (hourlyOnly) {
    const raw = pricing.hourly ?? pricing.hourlyFreeWhen ?? "";
    const c = ceilingFromPricingTier(raw, "hourly", pricing);
    if (c != null) return c;
    return PARKING_EVENING_PRICE_AMBIGUOUS_PROSE;
  }

  if (hourlyFree) {
    const c = ceilingFromPricingTier(
      pricing.hourlyFreeWhen,
      "hourlyFreeWhen",
      pricing,
    );
    if (c != null) return c;
    return PARKING_EVENING_PRICE_AMBIGUOUS_PROSE;
  }

  return PARKING_EVENING_PRICE_ABSENT;
}

/**
 * @param {Record<string, unknown> | null | undefined} pricing
 * @param {string} categoryKey
 * @returns {string}
 */
export function formatParkingPrice(pricing, categoryKey) {
  const privateOsm = isPrivateParkingCategory(categoryKey);
  if (!pricing || typeof pricing !== "object") {
    return privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
  }
  for (const key of ["events", "daily", "evening", "rate", "hourly"]) {
    if (key === "hourly" && pricing.hourlyFreeWhen) {
      return formatPricingTierForDisplay(
        "hourlyFreeWhen",
        pricing.hourlyFreeWhen,
        pricing,
      );
    }
    if (isPricingAmount(pricing[key]) || typeof pricing[key] === "string") {
      const line = formatPricingTierForDisplay(key, pricing[key], pricing);
      if (line) return line;
    }
  }
  return privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
}

function parkingMapCostLineForTierText(tierText) {
  if (typeof tierText !== "string" || tierText.trim() === "") return "";
  const t = tierText.trim();
  if (parseDollarAmountsFromPriceText(t).length > 0) return t;
  if (parkingPriceTextImpliesEveningFree(t)) return "Free";
  return t;
}

function tierDisplayLine(pricing, key) {
  if (key === "hourly" && pricing.hourlyFreeWhen) {
    return formatPricingTierForDisplay(
      "hourlyFreeWhen",
      pricing.hourlyFreeWhen,
      pricing,
    );
  }
  const v = pricing[key];
  if (!isPricingAmount(v) && typeof v !== "string") return "";
  return formatPricingTierForDisplay(key, v, pricing);
}

/**
 * Parenthetical hourly rate for map cards, e.g. `($4.99 per hour)`.
 * @param {Record<string, unknown>} pricing
 * @returns {string}
 */
function formatHourlyParenthetical(pricing) {
  if (!pricing || !isPricingAmount(pricing.hourly)) return "";
  const nums = tierDollarAmounts(pricing.hourly);
  if (nums.length === 0) return "";
  return `(${formatDollarAmount(Math.max(...nums))} per hour)`;
}

function primaryLineAlreadyIncludesHourlyRate(primaryText) {
  const s =
    typeof primaryText === "string" ? primaryText.trim().toLowerCase() : "";
  if (!s) return false;
  return (
    /\bhourly\b/.test(s) ||
    /\/\s*hour\b/.test(s) ||
    /\bper\s+hour\b/.test(s) ||
    /\/\s*half\s+hour\b/.test(s) ||
    /\bper\s+half\s+hour\b/.test(s)
  );
}

/**
 * @param {string} primaryLine
 * @param {Record<string, unknown>} pricing
 * @param {string} [hrDisplayLine]
 * @returns {string}
 */
function combinePrimaryWithHourlyParenthetical(
  primaryLine,
  pricing,
  hrDisplayLine = "",
) {
  const primary =
    typeof primaryLine === "string" && primaryLine.trim() !== ""
      ? primaryLine.trim()
      : "";
  if (!primary || primaryLineAlreadyIncludesHourlyRate(primary)) return primary;
  const paren = formatHourlyParenthetical(pricing);
  if (!paren) return primary;
  const hr = typeof hrDisplayLine === "string" ? hrDisplayLine.trim() : "";
  if (hr) {
    const norm = (x) => x.replace(/\s+/g, " ").toLowerCase();
    if (norm(primary) === norm(hr)) return primary;
  }
  return `${primary} ${paren}`;
}

/** @param {string} text */
function mapCostDisplayResult(text) {
  return { text, costHourlyHint: false };
}

/**
 * @param {Record<string, unknown> | null | undefined} pricing
 * @param {string} categoryKey
 */
export function getParkingMapCostDisplay(pricing, categoryKey) {
  const privateOsm = isPrivateParkingCategory(categoryKey);

  if (!pricing || typeof pricing !== "object") {
    return {
      text: privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free",
      costHourlyHint: false,
    };
  }

  const eventsRaw = tierDisplayLine(pricing, "events");
  const hrRaw = tierDisplayLine(pricing, "hourly");
  const dailyRaw = tierDisplayLine(pricing, "daily");
  const eveningRaw = tierDisplayLine(pricing, "evening");
  const rateRaw = tierDisplayLine(pricing, "rate");

  if (eventsRaw) {
    const line = parkingMapCostLineForTierText(eventsRaw) || eventsRaw;
    return mapCostDisplayResult(
      hrRaw
        ? combinePrimaryWithHourlyParenthetical(line, pricing, hrRaw)
        : line,
    );
  }

  function primaryPlusHourly(primaryRaw) {
    const line = parkingMapCostLineForTierText(primaryRaw) || primaryRaw;
    return mapCostDisplayResult(
      combinePrimaryWithHourlyParenthetical(line, pricing, hrRaw),
    );
  }

  if (dailyRaw && hrRaw) return primaryPlusHourly(dailyRaw);
  if (eveningRaw && hrRaw) return primaryPlusHourly(eveningRaw);
  if (rateRaw && hrRaw) return primaryPlusHourly(rateRaw);

  if (dailyRaw)
    return mapCostDisplayResult(
      parkingMapCostLineForTierText(dailyRaw) || dailyRaw,
    );
  if (eveningRaw)
    return mapCostDisplayResult(
      parkingMapCostLineForTierText(eveningRaw) || eveningRaw,
    );
  if (rateRaw)
    return mapCostDisplayResult(
      parkingMapCostLineForTierText(rateRaw) || rateRaw,
    );

  if (hrRaw) {
    const paren = formatHourlyParenthetical(pricing);
    if (paren) {
      const standalone = paren.slice(1, -1);
      const line = parkingMapCostLineForTierText(standalone) || standalone;
      return mapCostDisplayResult(line);
    }
    return mapCostDisplayResult(parkingMapCostLineForTierText(hrRaw) || hrRaw);
  }

  return mapCostDisplayResult(
    privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free",
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} pricing
 * @param {string} categoryKey
 * @returns {{ label: string, value: string }[]}
 */
export function getDataViewParkingPricingRows(pricing, categoryKey) {
  const privateOsm = isPrivateParkingCategory(categoryKey);
  const fallbackValue = privateOsm ? PARKING_PRICE_NOT_LISTED_LABEL : "Free";
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return [{ label: "Cost", value: fallbackValue }];
  }

  const KEY_ORDER = [
    "events",
    "evening",
    "hourly",
    "rate",
    "daily",
    "maxDuration",
    "enforcement",
    "free",
  ];
  const KEY_LABELS = {
    events: "Events",
    evening: "Evening",
    hourly: "Hourly",
    rate: "Rate",
    daily: "Daily",
    maxDuration: "Max duration",
    enforcement: "Enforcement",
    free: "Free",
    hourlyFreeWhen: "Hourly",
  };

  /** @type {{ key: string, label: string, value: string }[]} */
  const entries = [];

  if (
    typeof pricing.hourlyFreeWhen === "string" &&
    pricing.hourlyFreeWhen.trim()
  ) {
    entries.push({
      key: "hourlyFreeWhen",
      label: KEY_LABELS.hourlyFreeWhen,
      value: pricing.hourlyFreeWhen.trim(),
    });
  }

  for (const key of KEY_ORDER) {
    const rawVal = pricing[key];
    if (rawVal == null) continue;
    let value = "";
    if (isPricingAmount(rawVal) || typeof rawVal === "string") {
      value = formatPricingTierForDisplay(key, rawVal, pricing);
    } else if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      value = formatPricingTierForDisplay(key, rawVal, pricing);
    }
    if (!value) continue;
    entries.push({
      key,
      label: KEY_LABELS[key] || key,
      value,
    });
  }

  if (entries.length === 0) {
    return [{ label: "Cost", value: fallbackValue }];
  }

  entries.sort((a, b) => {
    const ia = KEY_ORDER.indexOf(a.key);
    const ib = KEY_ORDER.indexOf(b.key);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.key.localeCompare(b.key);
  });
  return entries.map(({ label, value }) => ({ label, value }));
}
