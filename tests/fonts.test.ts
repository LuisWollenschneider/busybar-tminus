import assert from "node:assert/strict";
import { test } from "node:test";
import { capBox, registerFontMaps, textWidth as libWidth } from "@busy-app/busy-lib";
import { condensed, extra_large, large, small, tiny } from "@busy-app/busy-lib/fonts";
import { inkHeight, inkTop, textWidth, type Font } from "../src/fonts.ts";

for (const map of [tiny, small, condensed, large, extra_large]) registerFontMaps(map);

const FONTS: Font[] = ["tiny", "small", "condensed", "large", "extra_large"];
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

test("the compact width tables match busy-lib for every printable character", () => {
  for (const font of FONTS) {
    for (const ch of ASCII) assert.equal(textWidth(ch, font), libWidth(ch, font), `${font} ${JSON.stringify(ch)}`);
  }
});

test("the ink boxes match busy-lib", () => {
  for (const font of FONTS) assert.deepEqual({ top: inkTop(font), height: inkHeight(font) }, capBox(font), font);
});
