/**
 * Loads JSON under `data/` (config, destinations, parking, strategies, bus routes).
 * Shared so additional apps in `src/` can reuse the same datasets.
 */

/** Downtown Grand Rapids — empty maps use this until route/stop data exists. */
export const MODES_PAGE_EMPTY_MAP_CENTER = [42.96333, -85.66806];

/** Same 1.75 mi from MODES_PAGE_EMPTY_MAP_CENTER as fetch_bike_parking.py, fetch_car_parking_osm.py, fetch_car_parking_arcgis.py (surface lots), etc. */
export const DOWNTOWN_PARKING_MAX_MILES_FROM_CENTER = 1.75;

/**
 * OSM private garage/lot pins within this Haversine distance (mi) of any City
 * (ArcGIS) garage or lot are dropped — prefer official pricing/names (e.g. Museum
 * ramp vs OSM “Museum Parking”). Must match `OFFICIAL_VS_OSM_DEDUP_MILES` in
 * scripts/fetch_car_parking_osm.py.
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

export function roundCoord5(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return n;
  return Math.round(n * 1e5) / 1e5;
}

function collectOfficialDriveParkingLatLngs(parking) {
  const out = [];
  for (const key of ["garages", "lots"]) {
    const items = parking[key];
    if (!Array.isArray(items)) continue;
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
  }
  return out;
}

/** Remove OSM pins that duplicate ArcGIS facilities (nearby centroid). */
function dedupeOsmParkingNearOfficial(parking) {
  const official = collectOfficialDriveParkingLatLngs(parking);
  if (!official.length) return;
  const cap = OFFICIAL_VS_OSM_DEDUP_MILES;
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
      for (const [olat, olng] of official) {
        if (haversineMiles(lat, lng, olat, olng) <= cap + 1e-12) {
          return false;
        }
      }
      return true;
    });
  }
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

function attachRideshareAppLinksToBuiltInRecommendations(recs) {
  const step0 = recs?.rideshare?.default?.steps?.[0];
  if (!step0 || (Array.isArray(step0.links) && step0.links.length > 0)) return;
  step0.links = [
    { href: UBER_APP_PAGE_URL, label: "Uber app →" },
    { href: LYFT_APP_PAGE_URL, label: "Lyft app →" },
  ];
}

export let appData = null;

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

    dedupeOsmParkingNearOfficial(parking);

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
}
