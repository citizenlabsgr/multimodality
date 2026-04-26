# Agent guidance

## Destinations

Destinations are listed in `data/destinations.json` and define the venues the user can choose (e.g. Van Andel Arena, Acrisure Amphitheater). The app loads this file at startup and uses it for the destination selector, strategy files per destination, and the data view map.

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

**Copy style:** Use **short imperative commands** for the main strategy **card** **`title`** only (e.g. “Park in a Public Garage”, “Take DASH”, “Adjust Your Filters”)—name the action, not the category. For **public** scraped parking (`data/parking/public/` → `garages`, `lots`, `meters`), include **Public** in that card title so it contrasts with private OSM cards (“Park in a Private Lot”, “Park in a Private Garage”). **Step** headings (`steps[].title` in JSON, and titles inside `buildParkingBasedDriveRecommendations` / transit / bike / Lime step lists in `src/script.js`) can stay longer and more descriptive (title case is fine). Optional per-mode labels for hand-crafted step rows live in **`data/config.json`** under **`handCraftedModeLabels`**.

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

Parking JSON lives under **`data/parking/public/`** (Grand Rapids Visitor Parking ArcGIS map via `scripts/fetch_car_parking_arcgis.py` for garages and lots; meters; OSM bike racks via `scripts/fetch_bike_parking.py`) and **`data/parking/private/`** (`garages.json` and `lots.json` from OpenStreetMap via `scripts/fetch_car_parking_osm.py`; Lime micromobility via `scripts/fetch_lime_parking.py`). Lime snapshot buckets stay in `data/parking/.lime/`. The app merges these at load time and shows them on the **data** view (`#/data/parking`) with a map and mode filters. Each category applies to one or more transport **modes** (`drive`, `bike`, `micromobility`).

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

**`pricing`** (optional): an object. The app displays one value for the map popup, chosen in this order: `rate`, then `evening`, then `daytime`, then `events`. If none are present, the data-view map shows **"Unknown"** for private OSM garages/lots (`osmGarages`, `osmLots`) and **"Free"** for other categories. Examples: `{ "rate": "$8-$10 for 4 hours" }` or `{ "daytime": "Max $27", "evening": "$27-$30", "events": "$27-$30" }`.

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

- **Data view** (`#/data/parking`): mode toggles filter categories by `modes`; the map shows all locations with popups (category name, location name, price).
- Category files are loaded in parallel and merged into `appData.parking` with keys such as `garages`, `lots`, `meters`, `racks`, `osmGarages`, `osmLots`, `micromobility`. The `name` and `modes` from each file are stored as `parking.categoryNames` and `parking.modes` for the UI.
