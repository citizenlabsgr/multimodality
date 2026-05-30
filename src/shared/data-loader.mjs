/**
 * Loads JSON under `data/` (config, destinations, parking, bus routes).
 * Shared so additional apps in `src/` can reuse the same datasets.
 */

/** Downtown Grand Rapids — empty maps use this until route/stop data exists. */
export const MODES_PAGE_EMPTY_MAP_CENTER = [42.96333, -85.66806];

/** Private OSM garages/lots with no `pricing` — map popups and data view. */
export const PARKING_PRICE_NOT_LISTED_LABEL = "Not listed";

/** Same 1.75 mi from MODES_PAGE_EMPTY_MAP_CENTER as fetch_bike_parking.py, fetch_car_parking_osm.py, fetch_car_parking_arcgis.py (surface lots), etc. */
export const DOWNTOWN_PARKING_MAX_MILES_FROM_CENTER = 1.75;

/**
 * OSM pins within this Haversine distance (mi) of a **same-kind** City (ArcGIS)
 * centroid are dropped: **`osmGarages`** vs public **garages** only, **`osmLots`**
 * vs public **lots** only (a surface lot next to a ramp is not treated as a duplicate).
 * The same radius drops **`osmGarages`** / **`osmLots`** pins near **any** Ellis
 * garage or lot centroid (Ellis wins over duplicate OSM tagging).
 * Must match `OFFICIAL_VS_OSM_DEDUP_MILES` in `scripts/fetch_car_parking_osm.py`.
 */
const OFFICIAL_VS_OSM_DEDUP_MILES = 0.06;

export function haversineMiles(lat1, lon1, lat2, lon2) {
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

/**
 * Approximate pedestrian distance without cutting diagonally across blocks: sum of
 * north–south and east–west miles in local equirectangular space at the midpoint latitude
 * (taxicab / Manhattan metric). Always ≥ {@link haversineMiles} for the same pair.
 */
export function gridWalkMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const midLat = (lat1 + lat2) / 2;
  const latMiPerDeg = 69.172;
  const lonMiPerDeg = latMiPerDeg * Math.cos(toRad(midLat));
  const dLatMi = Math.abs(lat2 - lat1) * latMiPerDeg;
  const dLonMi = Math.abs(lon2 - lon1) * lonMiPerDeg;
  return dLatMi + dLonMi;
}

/** One decimal place for user-facing route / walk distances (trims trailing zeros). */
export function formatRouteDistanceMiles(mi) {
  if (typeof mi !== "number" || !Number.isFinite(mi)) return "";
  return String(Number(mi.toFixed(1)));
}

export function roundCoord5(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return n;
  return Math.round(n * 1e5) / 1e5;
}

/** @param {"garages" | "lots"} officialKey */
function collectOfficialDriveParkingLatLngs(parking, officialKey) {
  const out = [];
  const items = parking[officialKey];
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const loc = item?.location;
    if (
      loc &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number"
    ) {
      out.push([loc.latitude, loc.longitude]);
    }
  }
  return out;
}

/** `category` in overrides — `#/visit` ids (`private-lot`) or parking keys (`osmLots`). */
const PARKING_OVERRIDE_CATEGORY_TO_KEY = {
  "public-garage": "garages",
  "public-lot": "lots",
  "private-garage": "osmGarages",
  "private-lot": "osmLots",
  "ellis-garage": "ellisGarages",
  "ellis-lot": "ellisLots",
  garages: "garages",
  lots: "lots",
  osmGarages: "osmGarages",
  osmLots: "osmLots",
  ellisGarages: "ellisGarages",
  ellisLots: "ellisLots",
  airGarageGarages: "airGarageGarages",
  airGarageLots: "airGarageLots",
  meters: "meters",
  racks: "racks",
  micromobility: "micromobility",
};

/** Default Haversine match radius for override pins (miles). ~0.5 m at mid-lat. */
const PARKING_OVERRIDE_DEFAULT_MATCH_MILES = 0.0002;

/**
 * Pin object -> which `#/data` popup fields were set from `data/overrides.json`
 * (for red emphasis in the data map popup only).
 */
const parkingDataOverrideSourceFields = new WeakMap();

/**
 * @param {unknown} item — a parking row from `appData.parking.*`
 * @returns {{ name?: true, pricing?: true, owner?: true } | null}
 */
export function getParkingDataViewOverrideSourceFields(item) {
  if (item == null || typeof item !== "object") return null;
  return (
    parkingDataOverrideSourceFields.get(/** @type {object} */ (item)) ?? null
  );
}

/**
 * Merge manual rows from `data/overrides.json` (a JSON array) into loaded parking arrays
 * (after fetch filters and official/OSM dedupe). Unmatched entries log a console warning.
 * Use **`location`: `{ latitude, longitude }`** for pin coordinates (root-level lat/lng aliases still parse).
 * Each object may include **`note`** (string) for editors only — it is not copied onto pins or shown in the app.
 * Optional **`address`** (string) replaces the matched pin's address when non-empty.
 * Optional **`owner`** (string) sets who owns or operates the lot or garage (shown in **`#/visit`** for private pins).
 * **`hidden`: true** removes the matched pin from the merged dataset (no `#/visit` / `#/data` marker).
 * Private lots with AirGarage pricing often use **`owner`: `"AirGarage"`**; listing URLs are usually
 * `https://www.airgarage.com/location/` + kebab-case name + `-grand-rapids-mi` (confirm in browser — not stored in **`note`**).
 * @param {object} parking — merged `appData.parking` buckets
 * @param {unknown[] | null} list
 */
function applyParkingDataOverrides(parking, list) {
  if (!Array.isArray(list) || !list.length) return;
  for (const ov of list) {
    if (!ov || typeof ov !== "object") continue;
    const rawCat = ov.category;
    const key =
      typeof rawCat === "string"
        ? PARKING_OVERRIDE_CATEGORY_TO_KEY[rawCat.trim()]
        : null;
    if (!key) {
      console.warn(
        "data/overrides.json: unknown category",
        rawCat,
        "(use public-garage, public-lot, private-garage, private-lot, or garages, lots, …)",
      );
      continue;
    }
    const arr = parking[key];
    if (!Array.isArray(arr)) continue;

    const locOv =
      ov.location &&
      typeof ov.location === "object" &&
      !Array.isArray(ov.location)
        ? ov.location
        : null;
    const lat =
      locOv && typeof locOv.latitude === "number"
        ? locOv.latitude
        : locOv && typeof locOv.lat === "number"
          ? locOv.lat
          : typeof ov.latitude === "number"
            ? ov.latitude
            : typeof ov.lat === "number"
              ? ov.lat
              : null;
    const lng =
      locOv && typeof locOv.longitude === "number"
        ? locOv.longitude
        : locOv && typeof locOv.lon === "number"
          ? locOv.lon
          : locOv && typeof locOv.lng === "number"
            ? locOv.lng
            : typeof ov.longitude === "number"
              ? ov.longitude
              : typeof ov.lon === "number"
                ? ov.lon
                : typeof ov.lng === "number"
                  ? ov.lng
                  : null;
    if (lat == null || lng == null) {
      console.warn("data/overrides.json: missing latitude/longitude for", key);
      continue;
    }

    let tol = PARKING_OVERRIDE_DEFAULT_MATCH_MILES;
    if (
      typeof ov.matchToleranceMiles === "number" &&
      Number.isFinite(ov.matchToleranceMiles) &&
      ov.matchToleranceMiles > 0
    ) {
      tol = ov.matchToleranceMiles;
    }

    const idx = arr.findIndex((item) => {
      const loc = item?.location;
      if (
        !loc ||
        typeof loc.latitude !== "number" ||
        typeof loc.longitude !== "number"
      ) {
        return false;
      }
      return (
        haversineMiles(loc.latitude, loc.longitude, lat, lng) <= tol + 1e-12
      );
    });
    if (idx < 0) {
      console.warn(
        "data/overrides.json: no pin matched",
        key,
        "at",
        lat,
        lng,
        "(try matchToleranceMiles)",
      );
      continue;
    }

    if (ov.hidden === true) {
      arr.splice(idx, 1);
      continue;
    }

    const item = arr[idx];
    const next = { ...item };
    /** @type {{ name?: true, pricing?: true, owner?: true }} */
    const fromOverride = {};
    if (typeof ov.name === "string" && ov.name.trim()) {
      next.name = ov.name.trim();
      fromOverride.name = true;
    }
    if (
      ov.pricing &&
      typeof ov.pricing === "object" &&
      !Array.isArray(ov.pricing)
    ) {
      const pricingKeys = Object.keys(ov.pricing);
      if (pricingKeys.length > 0) {
        next.pricing = {
          ...(item.pricing && typeof item.pricing === "object"
            ? item.pricing
            : {}),
          ...ov.pricing,
        };
        fromOverride.pricing = true;
      }
    }
    if (typeof ov.address === "string" && ov.address.trim()) {
      next.address = ov.address.trim();
    }
    const ownerRaw =
      typeof ov.owner === "string" && ov.owner.trim()
        ? ov.owner.trim()
        : typeof ov.manager === "string" && ov.manager.trim()
          ? ov.manager.trim()
          : "";
    if (ownerRaw) {
      next.owner = ownerRaw;
      fromOverride.owner = true;
    }
    if (typeof ov.note === "string" && ov.note.trim()) {
      next.dataOverrideNote = ov.note.trim();
    }
    if (fromOverride.name || fromOverride.pricing || fromOverride.owner) {
      parkingDataOverrideSourceFields.set(next, fromOverride);
    }
    arr[idx] = next;
  }
}

/** Official public inventory defaults to municipal operation when **`owner`** is omitted. */
function ensureDefaultOwnersOnPublicDriveParking(parking) {
  const city = "City";
  for (const key of ["garages", "lots"]) {
    const arr = parking[key];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== "object") continue;
      const o = item.owner ?? item.manager;
      if (typeof o === "string" && o.trim() !== "") continue;
      arr[i] = { ...item, owner: city };
    }
  }
}

/** Remove OSM pins that duplicate a same-kind ArcGIS facility (nearby centroid). */
function dedupeOsmParkingNearOfficial(parking) {
  const cap = OFFICIAL_VS_OSM_DEDUP_MILES;
  /** @type {[string, "garages" | "lots"][]} */
  const pairs = [
    ["osmGarages", "garages"],
    ["osmLots", "lots"],
  ];
  for (const [osmKey, officialKey] of pairs) {
    const official = collectOfficialDriveParkingLatLngs(parking, officialKey);
    if (!official.length) continue;
    const arr = parking[osmKey];
    if (!Array.isArray(arr) || !arr.length) continue;
    parking[osmKey] = arr.filter((item) => {
      const loc = item?.location;
      if (
        !loc ||
        typeof loc.latitude !== "number" ||
        typeof loc.longitude !== "number"
      ) {
        return false;
      }
      const { latitude: lat, longitude: lng } = loc;
      for (const [olat, olng] of official) {
        if (haversineMiles(lat, lng, olat, olng) <= cap + 1e-12) {
          return false;
        }
      }
      return true;
    });
  }
}

/**
 * Remove OSM private garages/lots whose centroids sit near an Ellis pin (Ellis names/pricing win).
 * Uses the same radius as {@link dedupeOsmParkingNearOfficial} (see `scripts/fetch_car_parking_osm.py`).
 */
function dedupeOsmParkingNearEllis(parking) {
  const cap = OFFICIAL_VS_OSM_DEDUP_MILES;
  /** @type {[number, number][]} */
  const ellisPts = [];
  for (const key of ["ellisGarages", "ellisLots"]) {
    const arr = parking[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const loc = item?.location;
      if (
        !loc ||
        typeof loc.latitude !== "number" ||
        typeof loc.longitude !== "number"
      ) {
        continue;
      }
      ellisPts.push([loc.latitude, loc.longitude]);
    }
  }
  if (!ellisPts.length) return;

  for (const osmKey of ["osmGarages", "osmLots"]) {
    const arr = parking[osmKey];
    if (!Array.isArray(arr) || !arr.length) continue;
    parking[osmKey] = arr.filter((item) => {
      const loc = item?.location;
      if (
        !loc ||
        typeof loc.latitude !== "number" ||
        typeof loc.longitude !== "number"
      ) {
        return false;
      }
      const { latitude: lat, longitude: lng } = loc;
      for (const [elat, elng] of ellisPts) {
        if (haversineMiles(lat, lng, elat, elng) <= cap + 1e-12) {
          return false;
        }
      }
      return true;
    });
  }
}

const AIRGARAGE_OWNER_LABEL = "AirGarage";

function parkingOwnerTrimmed(item) {
  const o = item?.owner ?? item?.manager;
  return typeof o === "string" ? o.trim() : "";
}

/**
 * Move pins with owner AirGarage into their own buckets for `#/data/parking` (drive map).
 * `#/visit` merges them back with OSM via {@link parkingItemsForVisitDataKey} in `visit.mjs`.
 */
function splitAirGarageParkingIntoOwnCategories(parking) {
  for (const [osmKey, airKey] of /** @type {const} */ ([
    ["osmGarages", "airGarageGarages"],
    ["osmLots", "airGarageLots"],
  ])) {
    const arr = parking[osmKey];
    if (!Array.isArray(arr) || !arr.length) {
      parking[airKey] = [];
      continue;
    }
    const rest = [];
    const air = [];
    for (const item of arr) {
      if (parkingOwnerTrimmed(item) === AIRGARAGE_OWNER_LABEL) {
        air.push(item);
      } else {
        rest.push(item);
      }
    }
    parking[osmKey] = rest;
    parking[airKey] = air;
  }
  parking.modes.airGarageGarages = ["drive"];
  parking.modes.airGarageLots = ["drive"];
}

/** `#/data/parking` dataset labels for Ellis and AirGarage (drive-only buckets). */
function applyDriveParkingDatasetDisplayNames(parking) {
  if (!parking?.categoryNames) return;
  parking.categoryNames.ellisGarages = "Private Parking Garages (Ellis)";
  parking.categoryNames.ellisLots = "Private Parking Lots (Ellis)";
  parking.categoryNames.airGarageGarages =
    "Private Parking Garages (AirGarage)";
  parking.categoryNames.airGarageLots = "Private Parking Lots (AirGarage)";
}

export const FALLBACK_DATA = {
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
  parkingRoutePace: {
    walkMinutesPerMile: 24,
    dashMilesPerHour: 12,
    dashBoardingWaitMinutes: 5,
  },
  destinations: [],
  linkTexts: {},
  parking: {},
  busRoutes: null,
};

export let appData = null;

/** When true, the venue stays out of browse UI and map placeholder pins until linked (e.g. `#/<slug>` → `#/visit/<slug>`). */
export function isDestinationHiddenFromPublicMaps(dest) {
  return dest?.hidden === true;
}

export async function loadData() {
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
      { file: "public/garages-arcgis.json", key: "garages" },
      { file: "public/lots-arcgis.json", key: "lots" },
      { file: "private/garages-osm.json", key: "osmGarages" },
      { file: "private/lots-osm.json", key: "osmLots" },
      { file: "public/meters.json", key: "meters" },
      { file: "public/racks.json", key: "racks" },
      { file: "private/micromobility.json", key: "micromobility" },
      { file: "private/garages-ellis.json", key: "ellisGarages" },
      { file: "private/lots-ellis.json", key: "ellisLots" },
    ];
    const [parkingResolves, overridesList] = await Promise.all([
      Promise.all(
        parkingCategories.map(({ file }) =>
          fetch(`data/parking/${file}`).then((r) => (r.ok ? r.json() : null)),
        ),
      ),
      fetch("data/overrides.json").then((r) => (r.ok ? r.json() : null)),
    ]);
    const parking = {
      garages: [],
      lots: [],
      osmGarages: [],
      osmLots: [],
      airGarageGarages: [],
      airGarageLots: [],
      meters: [],
      racks: [],
      micromobility: [],
      ellisGarages: [],
      ellisLots: [],
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

    for (const osmKey of [
      "osmGarages",
      "osmLots",
      "ellisGarages",
      "ellisLots",
    ]) {
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

    dedupeOsmParkingNearOfficial(parking);
    applyParkingDataOverrides(parking, overridesList);
    ensureDefaultOwnersOnPublicDriveParking(parking);
    dedupeOsmParkingNearEllis(parking);
    splitAirGarageParkingIntoOwnCategories(parking);
    applyDriveParkingDatasetDisplayNames(parking);

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
      linkTexts: config.linkTexts || {},
      parking,
      busRoutes,
    };
  } catch (error) {
    console.error("Failed to load data:", error);
    appData = { ...FALLBACK_DATA };
  }
}
