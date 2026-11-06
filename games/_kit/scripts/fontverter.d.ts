/** fontverter 2 ships no types; the two calls the font build uses. */
declare module "fontverter" {
  type Format = "sfnt" | "truetype" | "woff" | "woff2";
  export function convert(font: Uint8Array, toFormat: Format, fromFormat?: Format): Promise<Buffer>;
  export function detectFormat(font: Uint8Array): "sfnt" | "woff" | "woff2";
}
