/**
 * The eight kinds of lump, in the order a run meets them. Each has its own silhouette, colour and face, so a pot reads
 * at a glance without colour: a domed bun, a heart, a leaf with its vein, a sardine with its tail, a chubby star, a
 * snail with its shell, a six-petal flower and a spotted mushroom.
 */
export interface Kind {
  name: string;
  body: string;
  deep: string;
  hi: string;
  /** Where the eyes sit (in units of the lump's half width), their size, and the mouth's height. */
  ex: number;
  ey: number;
  er: number;
  my: number;
  /** Horizontal shift of the face (the sardine and the snail look out from one end). */
  fx: number;
}

export const KINDS: readonly Kind[] = [
  { name: "bun", body: "#F4D27E", deep: "#D9AC4C", hi: "#FFF0C4", ex: 0.24, ey: 0.06, er: 0.075, my: 0.26, fx: 0 },
  { name: "heart", body: "#F08C7A", deep: "#CF6455", hi: "#FFC3B6", ex: 0.22, ey: -0.08, er: 0.075, my: 0.14, fx: 0 },
  { name: "leaf", body: "#9CCB84", deep: "#6FA25A", hi: "#D2EDC1", ex: 0.2, ey: -0.02, er: 0.07, my: 0.17, fx: -0.06 },
  { name: "sardine", body: "#D9E2EC", deep: "#8FA3BC", hi: "#FFFFFF", ex: 0.13, ey: -0.06, er: 0.068, my: 0.13, fx: -0.42 },
  { name: "star", body: "#C9B2EC", deep: "#9B82D2", hi: "#EEE4FE", ex: 0.15, ey: 0.02, er: 0.068, my: 0.18, fx: 0 },
  { name: "snail", body: "#F3DDB4", deep: "#C9A46D", hi: "#FFF4DD", ex: 0.12, ey: 0.08, er: 0.06, my: 0.22, fx: -0.5 },
  { name: "flower", body: "#F5A3C2", deep: "#D4749A", hi: "#FFD6E6", ex: 0.12, ey: -0.02, er: 0.06, my: 0.14, fx: 0 },
  { name: "mushroom", body: "#F5E6CC", deep: "#CDB48E", hi: "#FFF8EA", ex: 0.15, ey: 0.3, er: 0.062, my: 0.44, fx: 0 },
];

/** The snail's shell, the mushroom's cap. */
export const SHELL = { body: "#F0A45E", deep: "#C77634", hi: "#FFD2A2" } as const;
export const CAP = { body: "#8A5442", deep: "#5E3528", hi: "#B98068" } as const;

/** Raw putty: a covered lump before it shows its kind. */
export const PUTTY = { body: "#C9B9A3", deep: "#9E8C76", hi: "#E8DCCB" } as const;

/** The colour particles and stamps use for a kind. */
export const kindColor = (k: number): string => (k === 5 ? SHELL.body : k === 7 ? CAP.body : KINDS[k]!.body);
export const kindDeep = (k: number): string => (k === 5 ? SHELL.deep : k === 7 ? CAP.deep : KINDS[k]!.deep);
