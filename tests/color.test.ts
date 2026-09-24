/**
 * Text colours for a user-painted panel.
 *
 * The promise on screen is that titles, legends and notes stay readable on any
 * background the viewer picks, so it is checked here against WCAG AA for every
 * preset and for the awkward middle of the range, where neither black nor
 * white has much to spare.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_TEXT_CONTRAST, contrast, panelInk, panelStyle, parseHex } from "@/lib/color";

const PRESETS = ["#ffffff", "#e5e7eb", "#374151", "#000000", "#dbeafe"];
const AWKWARD = ["#808080", "#777777", "#8a2be2", "#ff0000", "#00a0a0", "#ffff00", "#123"];

describe("parseHex", () => {
  it("reads short and long hex, with or without #", () => {
    assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
    assert.deepEqual(parseHex("374151"), [55, 65, 81]);
  });

  it("rejects anything that is not a hex colour", () => {
    assert.equal(parseHex("red"), null);
    assert.equal(parseHex("#12345"), null);
    assert.equal(parseHex("url(x)"), null);
  });
});

describe("panelInk", () => {
  it("uses dark text on light panels and light text on dark ones", () => {
    assert.equal(panelInk("#ffffff")?.tone, "dark");
    assert.equal(panelInk("#dbeafe")?.tone, "dark");
    assert.equal(panelInk("#374151")?.tone, "light");
    assert.equal(panelInk("#000000")?.tone, "light");
  });

  for (const background of [...PRESETS, ...AWKWARD]) {
    it(`keeps every text colour at AA on ${background}`, () => {
      const ink = panelInk(background)!;
      const bg = parseHex(background)!;
      for (const [role, colour] of Object.entries({
        ink: ink.ink,
        ink2: ink.ink2,
        muted: ink.muted,
      })) {
        const ratio = contrast(parseHex(colour)!, bg);
        assert.ok(ratio >= MIN_TEXT_CONTRAST, `${role} ${colour} is ${ratio.toFixed(2)}:1`);
      }
    });
  }

  it("keeps secondary text softer than the main ink where there is room", () => {
    const ink = panelInk("#ffffff")!;
    assert.notEqual(ink.ink2, ink.ink);
  });
});

describe("panelStyle", () => {
  it("leaves the theme alone for no choice or a value that is not a colour", () => {
    assert.equal(panelStyle(null), null);
    assert.equal(panelStyle("javascript:alert(1)"), null);
  });

  it("paints the background and re-inks the text, and nothing else", () => {
    const style = panelStyle("#000")!;
    assert.deepEqual(Object.keys(style).sort(), ["--hair", "--ink", "--ink-2", "--muted", "background"]);
    assert.equal(style.background, "#000000");
    assert.equal(style["--ink"], "#ffffff");
  });
});
