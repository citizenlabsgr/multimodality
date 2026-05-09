# Agent guidance

## Source layout

- **`src/main.mjs`** — ES module entry; loads the current UI.
- **`src/visit/planner.mjs`** — Visit planner (`#/visit`), modes explainer (`#/modes`), data explorer (`#/data`), and routing for the parking map (`#/parking`).
- **`src/parking/parking.mjs`** — **Parking-for-events** variant at `#/parking`: the goal is to help users **find parking when attending events** at downtown venues—pick a **venue**, see **DASH** routes/stops and nearby garages/lots, and compare costs with **event** pricing preferred in popups when the data includes it (see Parking data → **`pricing`** order). Leaflet map with **DASH** shuttle polylines/stops from `appData.busRoutes`, plus parking pins from `appData.parking` **garages and lots only** (public garages/lots and OSM private garages/lots—no meters, bike racks, or micromobility). Pins are limited to within **0.75 mi** (Haversine) of a DASH stop on the map. With **no** venue selected (`finish=` unset), map **`fitBounds`** frames **all listed destinations** only—not parking pins—so the red placeholder pins fill the view without zooming out to the full parking set. With **`finish=`** set and **no** **`start=`**, **`fitBounds`** uses **visible parking pins and the selected venue** (candidate starts plus the red finish pin). With **`start=`** set, **`fitBounds`** frames **that parking pick and the venue**. Category toggles and `location=` use ids **`public-garage`**, **`public-lot`**, **`private-garage`**, **`private-lot`** (mapped to `garages` / `lots` / `osmGarages` / `osmLots` in JSON); legacy `location=garages` etc. and old `cats=` still parse. Optional **`finish=<destination-slug>`** (legacy **`venue=`**, **`destination=`**, **`dest=`** still parse). Optional **`maxEvening=<dollars>`** caps evening parking cost: hides pins whose inferred evening rate (pricing **`evening`**, else public ramp/lot **`events`** fallback) parses to a dollar amount above the cap. With **`maxEvening`** omitted, the default cap is **$40** (slider **40**; param omitted for a short **`#/parking`** link). **`0`–`45`** in **`$5`** steps are spelled in the URL when not **40**; **`maxEvening=50`** (or snapped **≥50**, legacy **≥100**) means **any price** (no cap). Pins with **no** pricing tier fields (`evening`, `events`, `hourlyRate`, `rate`, `daytime`) are hidden while any finite **`pay`** cap is in effect; prose tiers without `$` amounts but recognized as free evenings/weekends count as **free**; other prose without dollars (still “some data”) stays visible unless **`pay`** is **free-only** (`0`). Optional **`maxWalk=<miles>`** — when **`venue`** is set (`finish=` canonical), hides pins whose straight-line distance to the **nearest DASH stop** exceeds that cap (Haversine); **`maxWalk=0`** (or **`0.0`**) is treated internally as **~100 ft** for that filter (slider **No distance** — walk overlays and auto **`start`** stay off); **`maxWalk` omitted** means **0.5 mi** (default; omitted from **`#/parking`** for short links); other **`0.1`**–**`1.5`** in **0.1** steps spell in the URL; minute hints assume **~3 mph** walking.

Each parking pin opens a **popup** with **Plan to park here** / **Clear parking selection**: choosing a start sets **`start=<category>~<lat>~<lng>`** (6 dp; legacy **`spot=`**) and the **green** pin; clearing removes **`start`** for that spot; the venue uses a **red** pin; reset clears **`start`**. **`start=`** is added to the URL **only** when the user taps **Plan to park here** (or opens a shared link that already includes **`start`** / **`spot`**). Sliders, destination, and category filters **do not** put **`start=`** in the hash; without it, the map still picks a recommended green pin on load and when overlays refresh using the same ranking rules. **How pins rank** (when **venue** is set and DASH stops exist): pins inferred as **free** ($0 evening/event ceiling) are excluded from the automatic **`start`** pool whenever **any** other visible pin has a **paid** (> $0) ceiling; if max walk to the nearest DASH stop is **at most 0.5 mi** (including the default when **`walk` is omitted**), prefer pins whose estimated trip **uses DASH** (multimodal overlay beats straight-line walk) over door-to-door-only pins; among multimodal picks use **farther** straight-line miles from the venue first (then walk-to-stop / paid-tier / dollars like generous walk). Among **only** door-to-door pins, use **closest** to the venue first, then highest inferred evening/event dollars, then longest walk to DASH. If max walk is **over 0.5 mi**, use **distance before cost**—**farthest** straight-line miles from the **venue** among pins within the walk-to-DASH cap (farther paid lots), **then** among ties **longest** walk to the nearest DASH stop, **then** pins with a **known paid** rate over free-evening or unknown/ambiguous pricing, **then** higher inferred dollars among ties. When **`pay`** is **any price** (max slider / no cap), the recommendation **never** uses a pin whose cost is **unknown** or **ambiguous-only** if **any** visible pin has a **parseable dollar** ceiling; only when **no** pin has known dollars does it fall back to unknown vs ambiguous. With **short-walk** rules and **any price**, door-to-door-only ties rank by highest inferred dollars before longest walk to DASH. With a **finite** **`pay`** cap under short-walk rules, known dollars rank above unknown or ambiguous before distance within the door-to-door pool. If there are no DASH stops, longest walk to the **venue** substitutes for walk-to-stop in tie-breaks under cost-first rules. When the **`walk`** slider is at index **0** (`walk=0`), pins farther than **~100 ft** from the nearest DASH stop are hidden (**`start`** is still omitted — no green parking pick). Pins farther than the max-walk cap are hidden when **venue** is set and DASH data exists (**including** **`walk=0`**). Overlap paint order is **`PARKING_CATEGORY_PAINT_ORDER`** (public garage / purple above private garage / orange). **`src/parking/parking.css`** — layout for that view.

- **`src/shared/data-loader.mjs`** — Fetches and merges JSON under **`data/`** (config, destinations, parking, strategies per destination, `builtins.json`, `data/bus/routes.json`) into the live **`appData`** object. Reuse this module if you add another front-end that reads the same datasets.

Static assets: **`index.html`** (shell + `#appView` markup), **`src/visit/planner.css`** (visit form controls), **`src/styles.css`** (data view, modes page, global).

## Snapshot workflow

- When any HTML file changes (especially **`index.html`**) or parking layout needs refreshed captures, run **`make snapshots`** from the repo root (runs **`tests/parking.spec.js`** tests tagged **`@snapshot`**). Equivalent: **`npx playwright test tests/parking.spec.js --grep "@snapshot"`**.
- Parking layout screenshots use Playwright **`expect(page).toHaveScreenshot()`** (see **`expect.toHaveScreenshot`** and **`snapshotPathTemplate`** in **`playwright.config.js`**). Baselines live in **`tests/snapshots/parking/`** as **`{device}-{n}-{variant}.png`** (e.g. **`desktop-1-blank.png`**): **`blank`** (no `finish=`), **`finish`** (venue + walk, no `start=`), **`start`** (venue + walk + `start=`), each for **`phone`**, **`tablet`**, **`desktop`** — see **`PARKING_SNAPSHOT_CASES`** in **`tests/parking.spec.js`**. Each run **compares** to those files without extra pixel-ratio / threshold slack; it does **not** rewrite PNGs on every successful run. After intentional layout changes, refresh baselines with **`npx playwright test tests/parking.spec.js --grep "@snapshot" --update-snapshots`**.
- When reviewing layout/spacing/responsiveness decisions, consult those snapshot images directly before finalizing.

## Destinations

Destinations are listed in `data/destinations.json` and define the venues the user can choose (e.g. Van Andel Arena, Acrisure Amphitheater). `loadData()` in `src/shared/data-loader.mjs` loads this file at startup; the planner uses it for the destination selector, strategy files per destination, and the data view map.

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

## Hand-crafted recommendations

Hand-crafted recommendations are destination-specific, static options (e.g. “Park On-Site”) that appear as **blue** strategy cards. Each destination has a file `data/strategies/<destination-slug>.json` containing an array of recommendations. They are shown **first** when they fit the user’s preferences (selected modes, budget, and walk distance).

**Copy style:** Use **short imperative commands** for the main strategy **card** **`title`** only (e.g. “Park in a Public Garage”, “Take DASH”, “Adjust Your Filters”)—name the action, not the category. For **public** scraped parking (`data/parking/public/` → `garages`, `lots`, `meters`), include **Public** in that card title so it contrasts with private OSM cards (“Park in a Private Lot”, “Park in a Private Garage”). **Step** headings (`steps[].title` in JSON, and titles inside `buildParkingBasedDriveRecommendations` / transit / bike / Lime step lists in `src/visit/planner.mjs`) can stay longer and more descriptive (title case is fine). Optional per-mode labels for hand-crafted step rows live in **`data/config.json`** under **`handCraftedModeLabels`**.

### Schema

Each recommendation has:

- **`title`** (string) – Main card heading (short imperative).
- **`body`** (string) – Short description shown on the card.
- **`steps`** (array) – At least two steps. The **last step is always walking** to the destination.

Each **step** has:

| Attribute  | Type           | Required | Description                                                                                  |
| ---------- | -------------- | -------- | -------------------------------------------------------------------------------------------- |
| `mode`     | string         | yes      | Transport mode: `drive`, `walk`, `transit`, `rideshare`, `micromobility`, `shuttle`, `bike`. |
| `location` | object or null | depends  | See below.                                                                                   |
| `cost`     | number         | yes      | Cost in dollars for this step (use `0` for free).                                            |
| `distance` | number or null | no       | Distance in miles for this step, or `null` if not applicable.                                |

#### Step `location` semantics

- **Drive steps:** `location` is the **parking location** (where the user parks), as `{ "latitude": number, "longitude": number }`. Use the latitude/longitude of the lot or garage.
- **Walk steps:** `location` should be **`null`**. The app assumes the user is walking to the destination, so no location is needed.
- **Other modes:** Use `location` when it’s meaningful (e.g. a specific stop or pickup point), or `null` otherwise.

### Example

**File:** `data/strategies/acrisure-amphitheater.json`

```json
[
  {
    "title": "Park On-Site",
    "body": "Use the venue's 400-space attached lot at 201 Market Ave SW.",
    "steps": [
      {
        "mode": "drive",
        "location": { "latitude": 42.9638, "longitude": -85.6722 },
        "cost": 15,
        "distance": null
      },
      {
        "mode": "walk",
        "location": null,
        "cost": 0,
        "distance": 0.05
      }
    ]
  }
]
```

### When they are shown

A hand-crafted recommendation is shown only if it **fits** the user’s preferences:

- Every non-walk mode in its steps must be in the user’s selected modes.
- Total cost of all steps must be ≤ the user’s “Willing to pay” budget.
- If the last (walk) step has a `distance`, the user’s “Willing to walk” must be ≥ that value.

Fitting hand-crafted recommendations are rendered **first** (blue cards), followed by the usual recommended and alternate strategies (green/yellow).

## Parking data

**`data/config.json`** may include **`parkingPrivateUnknown`** (`lotAssumedDollars`, `garageAssumedDollars`, **`cardCopy`**) for assumed private-lot/garage dollars when OSM items lack `pricing`—used in drive strategy cards and budget checks.

Parking JSON lives under **`data/parking/public/`** (Grand Rapids Visitor Parking ArcGIS map via `scripts/fetch_car_parking_arcgis.py` for garages and lots; meters; OSM bike racks via `scripts/fetch_bike_parking.py`) and **`data/parking/private/`** (`garages.json` and `lots.json` from OpenStreetMap via `scripts/fetch_car_parking_osm.py`; Lime micromobility via `scripts/fetch_lime_parking.py`). Lime snapshot buckets stay in `data/parking/.lime/`. `loadData()` merges these into **`appData.parking`** and the planner shows them on the **data** view (`#/data/parking`) with a map and mode filters. Each category applies to one or more transport **modes** (`drive`, `bike`, `micromobility`).

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

**`pricing`** (optional): an object. The **data view** map shows one line chosen in this order: `events`, then `evening`, then `rate`, then `daytime`. The **`#/parking`** map popup uses **`events`** as the primary cost when ArcGIS **`EVENT_CHRG`** is present; if **`hourlyRate`** (`Hour_Rate`) is also set, it is shown after the event line (weekend/hourly context). When `events` is absent, `#/parking` falls back in order: `hourlyRate`, `evening`, `rate`, `daytime`. If none are present, the data-view map shows **"Unknown"** for private OSM garages/lots (`osmGarages`, `osmLots`) and **"Free"** for other categories. Examples: `{ "rate": "$8-$10 for 4 hours" }` or `{ "daytime": "Max $27", "evening": "$27-$30", "events": "$27-$30" }`.

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

- **Parking map** (`#/parking`): event-oriented garage/lot finder with DASH context; see **`src/parking/parking.mjs`** in Source layout.
- **Data view** (`#/data/parking`): mode toggles filter categories by `modes`; the map shows all locations with popups (category name, location name, price).
- **`loadData()`** loads category files in parallel and merges them into `appData.parking` with keys such as `garages`, `lots`, `meters`, `racks`, `osmGarages`, `osmLots`, `micromobility`. The `name` and `modes` from each file are stored as `parking.categoryNames` and `parking.modes` for the UI.
