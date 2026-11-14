/**
 * Map class fills.
 *
 * The legend and the shapes are coloured by the same function, so what is
 * checked here is the one thing a reader relies on: that classes climb the
 * ramp in order, as far apart as the ramp allows, in whichever scheme the
 * viewer picked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAP_SCHEME,
  MAP_RAMP_STEPS,
  MAP_SCHEMES,
  isMapScheme,
  mapClassFill,
  mapClassStep,
  mapRamp,
} from "../src/components/charts/palette";

test("a single class takes the deepest step", () => {
  assert.equal(mapClassStep(0, 1), MAP_RAMP_STEPS);
  assert.equal(mapClassStep(0, 0), MAP_RAMP_STEPS);
});

test("two classes take the two ends of the ramp", () => {
  assert.equal(mapClassStep(0, 2), 1);
  assert.equal(mapClassStep(1, 2), MAP_RAMP_STEPS);
});

test("up to six classes climb the ramp in order without sharing a step", () => {
  for (let count = 1; count <= MAP_RAMP_STEPS; count += 1) {
    const steps = Array.from({ length: count }, (_, index) => mapClassStep(index, count));
    for (const step of steps) {
      assert.ok(step >= 1 && step <= MAP_RAMP_STEPS, `${count} classes: step ${step} is off the ramp`);
    }
    for (let index = 1; index < steps.length; index += 1) {
      assert.ok(steps[index] > steps[index - 1], `${count} classes: ${steps.join(",")} is not strictly rising`);
    }
    assert.equal(steps[0], count === 1 ? MAP_RAMP_STEPS : 1);
    assert.equal(steps[steps.length - 1], MAP_RAMP_STEPS);
  }
});

test("the fixed coverage scale takes every step", () => {
  const steps = Array.from({ length: 6 }, (_, index) => mapClassStep(index, 6));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6]);
});

test("an index past the last class is clamped, never off the ramp", () => {
  assert.equal(mapClassStep(-1, 5), 1);
  assert.equal(mapClassStep(9, 5), MAP_RAMP_STEPS);
});

test("fills name the chosen scheme's tokens, and the default is blue", () => {
  assert.equal(mapClassFill(2, 5, "green"), "var(--map-green-4)");
  assert.equal(mapClassFill(0, 3), `var(--map-${DEFAULT_MAP_SCHEME}-1)`);
  assert.equal(DEFAULT_MAP_SCHEME, "blue");
});

test("every scheme has a six-step ramp and nothing else is a scheme", () => {
  for (const scheme of MAP_SCHEMES) {
    assert.ok(isMapScheme(scheme.id));
    assert.equal(mapRamp(scheme.id).length, MAP_RAMP_STEPS);
    assert.equal(mapRamp(scheme.id)[0], `var(--map-${scheme.id}-1)`);
  }
  assert.equal(isMapScheme("rainbow"), false);
  assert.equal(isMapScheme(null), false);
  assert.equal(isMapScheme(undefined), false);
});
