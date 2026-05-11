/**
 * Circle marker styles for `#/visit` and drive pins on `#/data/parking`.
 * Keep in sync visually with Leaflet `circleMarker` options there.
 */

export const PARKING_SPOT_STYLE_PUBLIC_GARAGE = {
  color: "#4338ca",
  fillColor: "#818cf8",
  fillOpacity: 0.76,
};
export const PARKING_SPOT_STYLE_PUBLIC_LOT = {
  color: "#155e75",
  fillColor: "#67e8f9",
  fillOpacity: 0.75,
};
export const PARKING_SPOT_STYLE_PRIVATE_GARAGE = {
  color: "#b45309",
  fillColor: "#f59e0b",
  fillOpacity: 0.78,
};
export const PARKING_SPOT_STYLE_PRIVATE_LOT = {
  color: "#ca8a04",
  fillColor: "#fde047",
  fillOpacity: 0.78,
};

/**
 * Lime primary brand green (#00DD00) per Lime brand guidelines; darker stroke for map contrast.
 */
export const PARKING_SPOT_STYLE_MICROMOBILITY_LIME = {
  color: "#00820e",
  fillColor: "#00DD00",
  fillOpacity: 0.82,
};

/** `#/data/parking` meters — blue (distinct from public-lot cyan/teal). */
export const PARKING_DATA_VIEW_STYLE_METERS = {
  color: "#1e3a8a",
  fillColor: "#2563eb",
  fillOpacity: 0.8,
};

/** `#/data/parking` bike racks — pink (distinct from Lime green and drive blues/teals). */
export const PARKING_DATA_VIEW_STYLE_RACKS = {
  color: "#be185d",
  fillColor: "#f9a8d4",
  fillOpacity: 0.78,
};

/** `appData.parking` keys for drive garages/lots — bottom → top (same as `#/visit`). */
export const PARKING_DRIVE_DATA_KEYS_PAINT_ORDER = [
  "osmLots",
  "lots",
  "osmGarages",
  "garages",
];

/** `#/data/parking` map — full stacking order (bottom → top). */
export const PARKING_DATA_VIEW_PAINT_ORDER = [
  ...PARKING_DRIVE_DATA_KEYS_PAINT_ORDER,
  "meters",
  "racks",
  "micromobility",
];

export function parkingMapCategoryIdFromDataKey(dataKey) {
  const m = {
    garages: "public-garage",
    lots: "public-lot",
    osmGarages: "private-garage",
    osmLots: "private-lot",
  };
  return m[dataKey] || null;
}

export function circleStyleForParkingCategoryKey(key) {
  if (key === "public-garage") return PARKING_SPOT_STYLE_PUBLIC_GARAGE;
  if (key === "public-lot") return PARKING_SPOT_STYLE_PUBLIC_LOT;
  if (key === "private-garage") return PARKING_SPOT_STYLE_PRIVATE_GARAGE;
  if (key === "private-lot") return PARKING_SPOT_STYLE_PRIVATE_LOT;
  return PARKING_SPOT_STYLE_PUBLIC_GARAGE;
}

export function styleForParkingDatasetKey(dataKey) {
  if (dataKey === "micromobility") return PARKING_SPOT_STYLE_MICROMOBILITY_LIME;
  if (dataKey === "meters") return PARKING_DATA_VIEW_STYLE_METERS;
  if (dataKey === "racks") return PARKING_DATA_VIEW_STYLE_RACKS;
  const id = parkingMapCategoryIdFromDataKey(dataKey);
  return id ? circleStyleForParkingCategoryKey(id) : null;
}

export function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Inline HTML for dataset dropdown / legend (matches map circle fill + stroke). */
export function parkingDatasetSwatchHtml(style, sizeClass = "h-3 w-3") {
  if (!style?.fillColor) {
    return `<span class="data-parking-dataset-swatch data-parking-dataset-swatch--empty ${sizeClass}" aria-hidden="true"></span>`;
  }
  const fill = hexToRgba(style.fillColor, style.fillOpacity ?? 1);
  const stroke = style.color || "#64748b";
  return `<span class="data-parking-dataset-swatch inline-block ${sizeClass} shrink-0 rounded-full border border-solid box-border align-middle" style="background:${fill};border-color:${stroke}" aria-hidden="true"></span>`;
}

/**
 * Leaflet add order: earlier = underneath. Non-drive parking rows render below drive lots/garages.
 */
export function compareParkingDataViewPointsForPaintOrder(a, b) {
  function tier(key) {
    if (!key) return -100;
    const i = PARKING_DATA_VIEW_PAINT_ORDER.indexOf(key);
    return i >= 0 ? i : -1;
  }
  const ta = tier(a.parkingDatasetKey);
  const tb = tier(b.parkingDatasetKey);
  if (ta !== tb) return ta - tb;
  if (a.lat !== b.lat) return a.lat - b.lat;
  return a.lng - b.lng;
}
