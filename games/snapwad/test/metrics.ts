/**
 * Advance widths of the two Caveat faces the game ships (printable ASCII and the three symbols the copy uses), in
 * thousandths of an em, read from the bundled woff2 files. Only for the copy tests: they check that every line fits
 * its plate without a browser. Kerning is left out, so these run a little wide (the safe side).
 */
const BOLD = [242, 210, 237, 559, 450, 600, 564, 117, 330, 330, 363, 446, 198, 326, 198, 330, 450, 450, 450, 450, 450, 434, 471, 446, 450, 438, 198, 198, 446, 446, 446, 374, 643, 511, 523, 477, 587, 534, 466, 494, 574, 409, 315, 508, 426, 729, 619, 505, 468, 492, 544, 495, 458, 482, 490, 720, 524, 504, 522, 330, 330, 330, 446, 446, 353, 446, 444, 364, 402, 334, 300, 364, 473, 196, 213, 374, 178, 569, 459, 362, 378, 377, 360, 350, 331, 370, 331, 517, 343, 341, 315, 330, 330, 330, 446];
const MEDIUM = [242, 210, 237, 559, 450, 600, 564, 117, 330, 330, 363, 446, 198, 326, 198, 330, 450, 450, 450, 450, 450, 445, 457, 449, 450, 446, 198, 198, 446, 446, 446, 374, 643, 505, 521, 474, 581, 531, 458, 489, 567, 403, 309, 501, 426, 723, 606, 499, 465, 499, 539, 489, 458, 482, 490, 720, 524, 504, 522, 330, 330, 330, 446, 446, 353, 440, 438, 358, 396, 328, 294, 358, 467, 190, 207, 368, 172, 563, 453, 356, 378, 377, 360, 344, 331, 370, 331, 517, 343, 341, 315, 330, 330, 330, 446];
const EXTRA_BOLD: Record<string, number> = {"×": 446, "·": 187, "…": 594};
const EXTRA_MEDIUM: Record<string, number> = {"×": 446, "·": 187, "…": 594};

/** Width in CSS px of `text` in Caveat at `px`, bold (700) or medium (500). */
export function measure(text: string, px: number, weight: "bold" | "medium"): number {
  const adv = weight === "bold" ? BOLD : MEDIUM;
  const extra = weight === "bold" ? EXTRA_BOLD : EXTRA_MEDIUM;
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c < 127 ? adv[c - 32]! : (extra[ch] ?? 600);
  }
  return (w / 1000) * px;
}
