/**
 * Text metrics of the bar's bitmap fonts. Knowing how wide a string renders and where its ink sits lets the app pick
 * the largest font that still fits and centre mixed-size text exactly.
 *
 * The widths are a compact copy of busy-lib's font maps for printable ASCII. busy-lib's own `textWidth` needs each
 * font's map registered, about 9 KiB of the app's 128 KiB heap per font; these tables take a few hundred bytes.
 * tests/fonts.test.ts checks them against busy-lib.
 */

export type Font = "tiny" | "small" | "condensed" | "large" | "extra_large";

/** Advance widths for printable ASCII (32..126), encoded as chr(32 + advance). */
const ADVANCES: Record<Font, string> = {
  tiny: "#\"$&$%%\"##$$\"$\"%$$$$$$$$$$\"\"$$$$$$$$$$$$$$$%$&%%$%$$$%&&$&%#%#$$#$$$$$##$\"\"$\"&$$$$#$$$$&$$$$\"$%",
  small: "\"\"$&$%%\"##$$\"#\"#$#$$$$$$$$\"#$$$$%%%%%%%%%\"$%$&%%%%%%$%$&$$$###$$$$$$$$#$$\"#$\"&$$$$#$#$$&$$$$\"$%",
  condensed: "%#$&&('\"##$&#$$%%%%%%%%%%%\"#$&$&(&&&&&&&&$%&%(&&&&&&&&&(&&&#%#&%%%%%%%%%%$$%$&%%%%$%%%&&&%%$#$&",
  large: "&#$)(*)\"$$&&#$$&'%''''''''\"#%&%&*(''(''(($'''*(('(''(((*(('#&#&&&&&&&&%&&$$&$(&&&&%&%&&*&&&$\"$(",
  extra_large: "$#&*)+*#%%''#$#&(%((((((((##%'%',((((''((%'(')(((((('())(('$&$(%%((((''((%'(')(((((('())(('&#&(",
};

/**
 * Where a capital's lit rows start below the element's `y`, and how many there are: busy-lib's `capBox`. A text
 * element is anchored by its font box, which has blank rows on top, so `y = row - inkTop(font)` puts ink on `row`.
 */
const CAP_BOX: Record<Font, { top: number; height: number }> = {
  tiny: { top: 1, height: 4 },
  small: { top: 2, height: 5 },
  condensed: { top: 2, height: 7 },
  large: { top: 2, height: 9 },
  extra_large: { top: 2, height: 10 },
};

export const inkTop = (font: Font): number => CAP_BOX[font].top;

/** The lit height of capitals and digits: what a font has to fit in. Descenders may reach a row or two further. */
export const inkHeight = (font: Font): number => CAP_BOX[font].height;

/** Width in pixels, letter spacing included; a character outside printable ASCII counts as 4. */
export function textWidth(text: string, font: Font): number {
  const table = ADVANCES[font];
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    const index = text.charCodeAt(i) - 32;
    total += index >= 0 && index < table.length ? table.charCodeAt(index) - 32 : 4;
  }
  return total;
}

/** The first of `fonts` that renders `text` within `maxWidth`, else the last one. */
export function fitFont(text: string, fonts: readonly Font[], maxWidth: number): Font {
  for (const font of fonts) if (textWidth(text, font) <= maxWidth) return font;
  return fonts[fonts.length - 1];
}
