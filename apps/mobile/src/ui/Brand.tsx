import { memo } from "react";
import { SvgXml } from "react-native-svg";
import { c } from "./theme";
import { markSvg, wordmarkSvg } from "./brand.generated";

const wordmarkPaper = wordmarkSvg.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${c.text}"`);

export const BrandMark = memo(function BrandMark({ size = 64 }: { size?: number }) {
  return <SvgXml xml={markSvg} width={size} height={size} accessibilityLabel="Thumbcade" />;
});

export const Wordmark = memo(function Wordmark({ height = 18, color }: { height?: number; color?: string }) {
  const xml = color ? wordmarkSvg.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${color}"`) : wordmarkPaper;
  return <SvgXml xml={xml} height={height} width={(height * 771) / 150} accessibilityLabel="Thumbcade" />;
});
