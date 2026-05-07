import { MODES_PAGE_EMPTY_MAP_CENTER } from "../shared/data-loader.mjs";

/** `#/parking` — standalone map shell (no pins yet). */
export function isParkingRoute() {
  const hash = window.location.hash.slice(1);
  const pathPart =
    hash.indexOf("?") >= 0 ? hash.slice(0, hash.indexOf("?")) : hash;
  return pathPart === "/parking" || pathPart === "/parking/";
}

let parkingMap = null;

export function hideParkingView() {
  const parkingView = document.getElementById("parkingView");
  if (parkingView) parkingView.classList.add("hidden");
  document.querySelector("main")?.classList.remove("parking-map-active");
}

function ensureParkingMap() {
  const L = globalThis.L;
  if (!L) return null;
  const el = document.getElementById("parkingAppMap");
  if (!el) return null;

  if (parkingMap) {
    parkingMap.invalidateSize();
    return parkingMap;
  }

  const [lat, lng] = MODES_PAGE_EMPTY_MAP_CENTER;
  parkingMap = L.map(el, { zoomControl: true }).setView([lat, lng], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(parkingMap);
  return parkingMap;
}

export function renderParkingView() {
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

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const map = ensureParkingMap();
      if (map) map.invalidateSize();
    });
  });
}
