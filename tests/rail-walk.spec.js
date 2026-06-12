import { test, expect } from "@playwright/test";
import {
  FALLBACK_RAIL_CROSSING_EXTRA_MILES,
  gridWalkMilesForPedestrians,
  parseRailwaySegments,
  resolveRailWalkBarrier,
  walkPathCrossesRailSegments,
} from "../src/shared/rail-walk.mjs";
import { gridWalkMiles } from "../src/shared/data-loader.mjs";

/** Minimal east–west rail segment blocking a north lot from a west stop (lng/lat space). */
const TEST_RAIL_SEGMENTS = [
  [
    [-85.6825, 42.966],
    [-85.6815, 42.973],
  ],
];

test.describe("Rail walk barrier", () => {
  test("defaults extra miles when config omits railWalkBarrier", () => {
    expect(resolveRailWalkBarrier({}).extraMilesWhenCrossing).toBe(
      FALLBACK_RAIL_CROSSING_EXTRA_MILES,
    );
  });

  test("detects chord crossing a rail segment", () => {
    expect(
      walkPathCrossesRailSegments(
        42.969938,
        -85.681874,
        42.96927,
        -85.682516,
        TEST_RAIL_SEGMENTS,
      ),
    ).toBe(true);
  });

  test("does not flag walks that stay on one side of the tracks", () => {
    expect(
      walkPathCrossesRailSegments(
        42.97,
        -85.67,
        42.971,
        -85.675,
        TEST_RAIL_SEGMENTS,
      ),
    ).toBe(false);
  });

  test("inflates grid-walk miles when rails block the path", () => {
    const parkLat = 42.969938;
    const parkLng = -85.681874;
    const stopLat = 42.96927;
    const stopLng = -85.682516;
    const base = gridWalkMiles(parkLat, parkLng, stopLat, stopLng);
    const adjusted = gridWalkMilesForPedestrians(
      parkLat,
      parkLng,
      stopLat,
      stopLng,
      {
        railSegments: TEST_RAIL_SEGMENTS,
        railWalkBarrier: { extraMilesWhenCrossing: 0.35 },
      },
    );
    expect(adjusted).toBeCloseTo(base + 0.35, 10);
    expect(Math.round(adjusted * 24)).toBeGreaterThanOrEqual(10);
  });

  test("parseRailwaySegments reads data/railways.json line geometry", () => {
    const segs = parseRailwaySegments({
      lines: [
        {
          coordinates: [
            { latitude: 42.97, longitude: -85.68 },
            { latitude: 42.971, longitude: -85.679 },
          ],
        },
      ],
    });
    expect(segs).toHaveLength(1);
    expect(segs[0][0]).toEqual([-85.68, 42.97]);
    expect(segs[0][1]).toEqual([-85.679, 42.971]);
  });
});
