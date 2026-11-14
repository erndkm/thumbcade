/**
 * The hand pass over the answer candidates (SCOWL's shared english list up to size 35, five letters, inflections and
 * the blocklist already gone). Used only by scripts/words.ts. Everything here is still accepted as a guess; it is
 * only never hidden on a slip.
 *
 * Read through in full on 2026-11-06. Out:
 * - obscure, technical or one-dialect words a player shouldn't need (datum, fiche, octal, lorry, karat, filet);
 * - plurals the stem test can't see (cacti, menus, kiwis, taxis, radii) and plural-only nouns (dregs, mumps);
 * - comparatives and odd adverbs (apter, bluer, gayer, slyly, dully), informal spellings (gonna, kinda, sorta);
 * - slurs and slur-adjacent words, and insults (spade, spook, paddy, nappy, pansy, fairy, gaily, leper, yokel,
 *   ninny, sissy, dunce, loony, shrew, tramp, dusky, bigot);
 * - bodies, illness and the bathroom (bowel, bosom, buxom, urine, vomit, enema, mucus, ulcer, polio, privy);
 * - crime, death and adult topics (abort, abuse, arson, death, felon, slain, harem, madam, nymph, spank, lager);
 * - religion and politics, which a puzzle shouldn't pick for anyone (bible, godly, pagan, papal, psalm, rabbi,
 *   junta, trump).
 */
export const EXCLUDE = [
  // obscure, technical, one dialect
  "antic", "biped", "burro", "butte", "byway", "calve", "clime", "datum", "deify", "dimer", "edger", "feted",
  "fiche", "filet", "fiver", "fount", "franc", "gnarl", "goner", "haler", "halon", "idler", "infix", "inter",
  "karat", "letup", "liker", "lorry", "lymph", "maria", "modal", "multi", "muter", "natty", "newsy", "nippy",
  "octal", "pence", "peter", "pokey", "radii", "redid", "riser", "roman", "sizer", "skein", "sunup", "tepee",
  "thous", "tonne", "unman", "unsay", "unset", "weest", "homey", "goody", "mamma", "payer", "bandy",
  // plurals the stem test misses, plural-only nouns
  "cacti", "delis", "dregs", "fungi", "genii", "gurus", "kiwis", "menus", "mumps", "oases", "pends", "saris",
  "taxis", "uteri",
  // comparatives, odd adverbs, informal spellings
  "amply", "apter", "barer", "baser", "bluer", "coyer", "dully", "gayer", "huger", "laxer", "newer", "nuder",
  "odder", "rawer", "sager", "saner", "slyly", "viler", "dumpy", "pudgy", "gimme", "gonna", "kinda", "lemme",
  "sorta", "wanna",
  // slurs, slur-adjacent, insults
  "bigot", "dunce", "dusky", "fairy", "gaily", "leper", "loony", "nappy", "ninny", "paddy", "pansy", "shrew",
  "sissy", "spade", "spook", "tramp", "yokel", "harry", "psych", "prude", "obese",
  // bodies, illness, the bathroom
  "bosom", "bowel", "buxom", "enema", "fetus", "groin", "mucus", "ovary", "polio", "polyp", "privy", "retch",
  "ulcer", "urine", "vomit",
  // crime, death, weapons, adult topics, alcohol
  "abort", "abuse", "arson", "bawdy", "death", "felon", "grope", "harem", "lager", "madam", "nymph", "rifle",
  "roach", "slain", "spank", "spunk", "tipsy", "widow",
  // religion and politics
  "bible", "godly", "junta", "pagan", "papal", "psalm", "rabbi", "trump",
];

/** Base words that only look inflected ("th" + ing, "twee" + d). */
export const KEEP = ["thing", "tweed"];
