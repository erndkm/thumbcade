/** The little of opentype.js 2.0 the scripts and tests use (the package ships no types). */
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Path {
    commands: PathCommand[];
    toPathData(decimals?: number): string;
  }
  export interface Font {
    unitsPerEm: number;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean }): Path;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
declare module "fontverter" {
  export function convert(buffer: Buffer, to: "truetype" | "woff" | "woff2" | "sfnt", from?: string): Promise<Buffer>;
}
