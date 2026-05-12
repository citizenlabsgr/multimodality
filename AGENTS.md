# Agent guidance

## Source layout

- **`src/main.mjs`** — ES module entry; loads **`src/bootstrap.mjs`**.
- **`src/bootstrap.mjs`** — Loads data, hash routing for `#/visit`, `#/data`, `#/modes`, and legacy `#/parking` / `#/planner` → `#/visit` redirects; owns the modes page and data explorer UI.
- **`src/visit/visit.mjs`** — **Parking-for-events** main app at `#/visit`: the goal is to help users **find parking when attending events** at downtown venues—pick a **venue**, see **DASH** routes/stops and nearby garages/lots, and compare costs with **event** pricing preferred in popups when the data includes it (see Parking data → **`pricing`** order). Leaflet map with **DASH** shuttle polylines/stops from `appData.busRoutes`, plus parking pins from `appData.parking` **garages and lots only** (public garages/lots and OSM private garages/lots—no meters, bike racks, or micromobility). Pins are limited to within **0.75 mi** (Haversine) of a DASH stop on the map. With **no** venue selected (bare **`#/visit`** with no slug), map **`fitBounds`** frames **all listed destinations** only—not parking pins—so the red placeholder pins fill the view without zooming out to the full parking set. With **`#/visit/<destination-slug>`** (or legacy **`finish=`** / **`venue=`** / **`destination=`** / **`dest=`** in the query) and **no** **`park=`**, **`fitBounds`** uses **visible parking pins and the selected venue** (candidate picks plus the red finish pin). With **`park=`** set, **`fitBounds`** frames **that parking pick, the venue, and — when the trip uses DASH — the full shuttle leg (board → alight along the loop)** so every trip step stays on-screen. Category toggles and `location=` use ids **`public-garage`**, **`public-lot`**, **`private-garage`**, **`private-lot`** (mapped to `garages` / `lots` / `osmGarages` / `osmLots` in JSON); legacy `location=garages` etc. and old `cats=` still parse. Legacy **`#/parking?…`** URLs are rewritten to **`#/visit[/slug]?…`** on load (and **`start=`** → **`park=`**). Optional **`maxEvening=<dollars>`** caps evening parking cost: hides pins whose inferred evening rate (pricing **`evening`**, else public ramp/lot **`events`** fallback) parses to a dollar amount above the cap. With **`maxEvening`** omitted, the default cap is **$40** (slider **40**; param omitted for a short **`#/visit`** link). **`0`–`45`** in **`$5`** steps are spelled in the URL when not **40**; **`maxEvening=50`** (or snapped **≥50**, legacy **≥100**) means **any price** (no cap). Pins with **no** pricing tier fields (`evening`, `events`, `hourlyRate`, `rate`, `daytime`) are hidden while any finite **`pay`** cap is in effect; prose tiers without `$` amounts but recognized as free evenings/weekends count as **free**; other prose without dollars (still “some data”) stays visible unless **`pay`** is **free-only** (`0`). Optional **`maxWalk=<miles>`** — when a **venue** is selected (path slug or legacy query keys), hides pins whose grid-walk distance (N–S + E–W miles at mid-latitude, not a diagonal shortcut) to the **nearest DASH stop** exceeds that cap; **`maxWalk=0`** (or **`0.0`**) is treated internally as **~100 ft** for that filter (slider **No distance** — walk overlays and auto **pick** stay off); **`maxWalk` omitted** means **0.5 mi** (default; omitted from **`#/visit`** for short links); other **`0.1`**–**`1.5`** in **0.1** steps spell in the URL; minute hints use **`data/config.json`** **`parkingRoutePace.walkMinutesPerMile`** (about **2.5 mph** by default).

Each parking pin opens a **popup** with **Plan to park here** / **Clear parking selection**: choosing a spot sets **`park=<category>:<lat>,<lng>`** (6 dp; legacy tilde form still parses; legacy **`start=`**, **`spot=`**) and the **green** pin; clearing removes **`park=`** for that spot; the venue uses a **red** pin; reset clears **`park=`**. **`park=`** is added to the URL **only** when the user taps **Plan to park here** (or opens a shared link that already includes **`park=`** / legacy **`start=`** / **`spot=`**). Sliders, destination, and category filters **do not** put **`park=`** in the hash; without it, the map still picks a recommended green pin on load and when overlays refresh using the same ranking rules. **How pins rank** (when **venue** is set and DASH stops exist): pins inferred as **free** ($0 evening/event ceiling) are excluded from the automatic **pick** pool whenever **any other** eligible visible pin has a **paid** (> $0) ceiling (so default **`#/visit`** favors farther paid lots); when **every** pin that passes **`pay`** is free (e.g. a tight **`pay`** cap), free pins remain in the pool. If max walk to the nearest DASH stop is **at most 0.5 mi** (including the default when **`walk` is omitted**), prefer pins whose estimated trip **uses DASH** (multimodal overlay beats straight-line walk) over door-to-door-only pins; among multimodal picks use **farther** grid-walk miles from the venue first (then walk-to-stop / paid-tier / dollars like generous walk). Among **only** door-to-door pins, use **closest** to the venue first, then highest inferred evening/event dollars, then longest walk to DASH. If max walk is **over 0.5 mi**, use **distance before cost**—**farthest** grid-walk miles from the **venue** among pins within the walk-to-DASH cap (farther paid lots), **then** among ties **longest** walk to the nearest DASH stop, **then** pins with a **known paid** rate over free-evening or unknown/ambiguous pricing, **then** higher inferred dollars among ties. When **`pay`** is **any price** (max slider / no cap), the recommendation **never** uses a pin whose cost is **unknown** or **ambiguous-only** if **any** visible pin has a **parseable dollar** ceiling; only when **no** pin has known dollars does it fall back to unknown vs ambiguous. With **short-walk** rules and **any price**, door-to-door-only ties rank by highest inferred dollars before longest walk to DASH. With a **finite** **`pay`** cap under short-walk rules, known dollars rank above unknown or ambiguous before distance within the door-to-door pool. If there are no DASH stops, longest walk to the **venue** substitutes for walk-to-stop in tie-breaks under cost-first rules. When the **`walk`** slider is at index **0** (`walk=0`), pins farther than **~100 ft** from the nearest DASH stop are hidden (**`park=`** is still omitted — no green parking pick). Pins farther than the max-walk cap are hidden when **venue** is set and DASH data exists (**including** **`walk=0`**). Overlap paint order is **`PARKING_CATEGORY_PAINT_ORDER`** (public garage / purple above private garage / orange).

- **`src/shared/data-loader.mjs`** — Fetches and merges JSON under **`data/`** (config, destinations, parking, `data/bus/routes.json`) into the live **`appData`** object. Reuse this module if you add another front-end that reads the same datasets.

Static assets: **`index.html`** (shell + `#appView` placeholder, `#modesView`, `#dataView`, `#parkingView`), **`src/styles.css`** (data view, modes page, global), **`src/visit/visit.css`** (parking map layout).

## Snapshot workflow

- When any HTML file changes (especially **`index.html`**) or the visit layout needs refreshed captures, run **`make test`** or **`make snapshots`** (runs all tests tagged **`@snapshot`**). Equivalent: **`npx playwright test --grep "@snapshot"`**.
- Visit layout screenshots use Playwright **`expect(page).toHaveScreenshot()`** (see **`expect.toHaveScreenshot`**, **`updateSnapshots`**, and **`snapshotPathTemplate`** in **`playwright.config.js`**). Baselines live in **`tests/snapshots/`** as **`{device}-{n}-{variant}.png`** (e.g. **`desktop-1-blank.png`**): **`blank`** (no venue slug), **`finish`** (venue in path + walk, no `park=`), **`start`** (venue in path + walk + `park=`), each for **`phone`**, **`tablet`**, **`desktop`** — see **`PARKING_SNAPSHOT_CASES`** in **`tests/visit.spec.js`**. **`playwright.config.js`** sets **`updateSnapshots: "changed"`** so a **mismatched** baseline is **overwritten** and the test **passes**; review and commit updated PNGs in git. To rewrite **all** visit screenshots regardless of match, run with **`--update-snapshots=all`**.
- When reviewing layout/spacing/responsiveness decisions, consult those snapshot images directly before finalizing.

## Destinations

Destinations are listed in `data/destinations.json` and define the venues the user can choose (e.g. Van Andel Arena, Acrisure Amphitheater). `loadData()` in `src/shared/data-loader.mjs` loads this file at startup; the parking map and data view use it for venue selection and maps.

### Schema

The file has a single key **`destinations`**: an array of destination objects.

Each **destination** has:

| Attribute  | Type   | Required | Description                            |
| ---------- | ------ | -------- | -------------------------------------- |
| `name`     | string | yes      | Display name (e.g. "Van Andel Arena"). |
| `slug`     | string | yes      | URL-safe id (e.g. "van-andel-arena").  |
| `location` | object | yes      | Coordinates; see below.                |

**`location`** must be an object with:

| Attribute   | Type   | Required | Description |
| ----------- | ------ | -------- | ----------- |
| `latitude`  | number | yes      | Latitude.   |
| `longitude` | number | yes      | Longitude.  |

### Example

**File:** `data/destinations.json`

```json
{
  "destinations": [
    {
      "name": "Van Andel Arena",
      "slug": "van-andel-arena",
      "location": {
        "latitude": 42.962979222900344,
        "longitude": -85.67185878753664
      }
    }
  ]
}
```

## Parking data

**`data/config.json`** may include **`parkingPrivateUnknown`** (`lotAssumedDollars`, `garageAssumedDollars`, **`cardCopy`**) for assumed private-lot/garage dollars when OSM items lack `pricing`—used where the app shows planning estimates for private pins.

Parking JSON lives under **`data/parking/public/`** (Grand Rapids Visitor Parking ArcGIS map via `scripts/fetch_car_parking_arcgis.py` for garages and lots; meters; OSM bike racks via `scripts/fetch_bike_parking.py`) and **`data/parking/private/`** (`garages.json` and `lots.json` from OpenStreetMap via `scripts/fetch_car_parking_osm.py`; Lime micromobility via `scripts/fetch_lime_parking.py`). OSM drive garages/lots that fall within **~0.06 mi** (Haversine) of any public ArcGIS garage/lot centroid are omitted in **`loadData()`** and when regenerating private JSON, so official names and pricing win over near-duplicate OSM pins. Lime snapshot buckets stay in `data/parking/.lime/`. `loadData()` merges these into **`appData.parking`** and the **data** view (`#/data/parking`) shows them with a map and mode filters. Each category applies to one or more transport **modes** (`drive`, `bike`, `micromobility`).

### Schema

Each parking file has:

| Attribute | Type   | Required | Description                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `name`    | string | yes      | Display name for the category (e.g. "Premium ramps", "Bike racks").         |
| `modes`   | array  | yes      | Transport modes this category applies to: `drive`, `bike`, `micromobility`. |
| `items`   | array  | yes      | List of parking locations (see below).                                      |

Each **item** (parking location) has:

| Attribute      | Type   | Required | Description                                                     |
| -------------- | ------ | -------- | --------------------------------------------------------------- |
| `location`     | object | yes      | Coordinates: `{ "latitude": number, "longitude": number }`.     |
| `name`         | string | no       | Display name for the map and popup (e.g. "Arena Place Garage"). |
| `address`      | string | no       | Street address.                                                 |
| `pricing`      | object | no       | Price info; shown in map popups. See below.                     |
| `availability` | string | no       | e.g. "Good availability".                                       |

**`pricing`** (optional): an object. The **data view** map shows one line chosen in this order: `events`, then `evening`, then `rate`, then `daytime`. The **`#/visit`** map popup uses **`events`** as the primary cost when ArcGIS **`EVENT_CHRG`** is present; if **`hourlyRate`** (`Hour_Rate`) is also set, it is shown after the event line (weekend/hourly context). When `events` is absent, `#/visit` falls back in order: `hourlyRate`, `evening`, `rate`, `daytime`. If none are present, the data-view map shows **"Not listed"** for private OSM garages/lots (`osmGarages`, `osmLots`) and **"Free"** for other categories. Examples: `{ "rate": "$8-$10 for 4 hours" }` or `{ "daytime": "Max $27", "evening": "$27-$30", "events": "$27-$30" }`.

### Example

**File:** `data/parking/public/garages.json`

```json
{
  "name": "Public Parking Garages",
  "modes": ["drive"],
  "items": [
    {
      "name": "Arena Place Garage",
      "address": "130 Ionia Ave SW, Grand Rapids, MI 49503",
      "location": {
        "latitude": 42.9634,
        "longitude": -85.6681
      },
      "pricing": {
        "daytime": "Max $27",
        "evening": "$27-$30",
        "events": "$27-$30"
      },
      "availability": "Often better availability due to higher cost"
    }
  ]
}
```

### Where it is used

- **Parking map** (`#/visit`): event-oriented garage/lot finder with DASH context; see **`src/visit/visit.mjs`** in Source layout.
- **Data view** (`#/data/parking`): mode toggles filter categories by `modes`; the map shows all locations with popups (category name, location name, price).
- **`loadData()`** loads category files in parallel and merges them into `appData.parking` with keys such as `garages`, `lots`, `meters`, `racks`, `osmGarages`, `osmLots`, `micromobility`. The `name` and `modes` from each file are stored as `parking.categoryNames` and `parking.modes` for the UI.
