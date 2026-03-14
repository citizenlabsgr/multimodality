# Agent guidance

## Hand-crafted recommendations

Hand-crafted recommendations are destination-specific, static options (e.g. “Park in on-site lot”) that appear as **blue** strategy cards. Each destination has a file `data/strategies/<destination-slug>.json` containing an array of recommendations. They are shown **first** when they fit the user’s preferences (selected modes, budget, and walk distance).

### Schema

Each recommendation has:

- **`title`** (string) – Card heading.
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
    "title": "Park in on-site lot",
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

Parking data is split by category under `data/parking/<category>.json` (e.g. `premium-ramps.json`, `city-garages.json`, `surface-lots.json`, `metered-parking.json`, `bike.json`, `micromobility.json`). The app merges these at load time and shows them on the **data** view (`#/data/parking`) with a map and mode filters. Each category applies to one or more transport **modes** (`drive`, `bike`, `micromobility`).

### Schema

Each parking file has:

| Attribute | Type   | Required | Description                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `name`    | string | yes      | Display name for the category (e.g. "Premium ramps", "Bike racks").         |
| `modes`   | array  | yes      | Transport modes this category applies to: `drive`, `bike`, `micromobility`. |
| `items`   | array  | yes      | List of parking locations (see below).                                      |

Each **item** (parking location) has:

| Attribute      | Type   | Required | Description                                                                 |
| -------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `latitude`     | number | yes      | Latitude for the map.                                                       |
| `longitude`    | number | yes      | Longitude for the map.                                                      |
| `name`         | string | no\*     | Location name (e.g. "Arena Place Garage"). Use `name` or `location`.        |
| `location`     | string | no\*     | Area description when there is no single place name (e.g. metered streets). |
| `address`      | string | no       | Street address.                                                             |
| `pricing`      | object | no       | Price info; shown in map popups. See below.                                 |
| `availability` | string | no       | e.g. "Good availability".                                                   |

\*At least one of `name` or `location` is recommended so the map popup has a label. Distance is computed later from latitude/longitude.

**`pricing`** (optional): an object. The app displays one value for the map popup, chosen in this order: `rate`, then `evening`, then `daytime`, then `events`. If none are present, the popup shows "Free". Examples: `{ "rate": "$8-$10 for 4 hours" }` or `{ "daytime": "Max $27", "evening": "$27-$30", "events": "$27-$30" }`.

### Example

**File:** `data/parking/premium-ramps.json`

```json
{
  "name": "Premium ramps",
  "modes": ["drive"],
  "items": [
    {
      "name": "Arena Place Garage",
      "address": "130 Ionia Ave SW, Grand Rapids, MI 49503",
      "latitude": 42.9634,
      "longitude": -85.6681,
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
- Category files are loaded in parallel and merged into `appData.parking` with keys like `premiumRamps`, `cityGarages`, `bike`, `micromobility`. The `name` and `modes` from each file are stored as `parking.categoryNames` and `parking.modes` for the UI.
