# Agent guidance

## Hand-crafted recommendations

Hand-crafted recommendations are destination-specific, static options (e.g. “Park in on-site lot”) that appear as **blue** strategy cards. They are keyed by destination slug in `data/hand-crafted-recommendations.json` and are shown **first** when they fit the user’s preferences (selected modes, budget, and walk distance).

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

```json
{
  "handCraftedRecommendations": {
    "acrisure-amphitheater": [
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
  }
}
```

### When they are shown

A hand-crafted recommendation is shown only if it **fits** the user’s preferences:

- Every non-walk mode in its steps must be in the user’s selected modes.
- Total cost of all steps must be ≤ the user’s “Willing to pay” budget.
- If the last (walk) step has a `distance`, the user’s “Willing to walk” must be ≥ that value.

Fitting hand-crafted recommendations are rendered **first** (blue cards), followed by the usual recommended and alternate strategies (green/yellow).
