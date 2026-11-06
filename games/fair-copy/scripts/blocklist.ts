/**
 * What a 4+ word game must never show. Used only by scripts/words.ts at build time: the bundle ships the filtered
 * lists and, for the board check, 32-bit hashes of the hard words and their prefixes, never these words.
 *
 * Curated by hand for Fair Copy. Checked against SCOWL's own offensive/profane flags (misc/offensive.*,
 * misc/profane.*) and the "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (Shutterstock, CC BY 4.0).
 *
 * - HARD: slurs, profanity, and sexual or excretory vulgarity. Never accepted, shown, seeded or revealed, and no
 *   board may spell one along any path. Each entry also blocks its plain inflections (s, es, ed, ing, er, ers, y).
 * - HARD_STEMS: blocked wherever they appear inside a word (bullshit, motherfucker, niggle as well).
 * - SOFT: words with an innocent first meaning and an adult second one, or adult topics (with the same inflections).
 *   Accepted when a player traces one, but never planted, never used by the demo pen, never revealed as "missed".
 */

export const HARD_STEMS = ["fuck", "shit", "cunt", "nigg", "fag", "slut", "whore", "wank", "twat", "piss", "jizz", "dildo", "porn", "bitch", "bastard", "dyke"];

export const HARD = [
  "ass", "asses", "arse", "arses", "asshole", "arsehole", "damn", "dammit", "goddamn", "crap", "crappy", "fart", "turd",
  "cocksucker", "dick", "dickhead", "boob", "boobs", "tits", "titty", "titties", "pussy",
  "cum", "cumming", "orgasm", "orgy", "orgies", "masturbate", "masturbation", "rape", "raped", "rapes", "raping",
  "rapist", "incest", "sodomy", "sodomize", "sodomite", "pedophile", "paedophile", "molest", "molester",
  "bollocks", "bugger", "wanker", "tosser", "skank", "nazi", "nazis",
  "coon", "coons", "chink", "chinks", "gook", "gooks", "wop", "wops", "kraut", "krauts", "dago", "dagos", "paki",
  "gyp", "gypped", "retard", "retards", "retarded", "spaz", "spastic", "tranny", "homo", "homos", "negro", "negroes",
  "redskin", "redskins", "squaw", "squaws", "honky", "honkies", "wetback", "wetbacks", "towelhead", "raghead",
  "jap", "japs", "beaner", "darkie", "darky", "pikey", "gypsy", "gypsies", "spic", "spics", "kike", "kikes", "pussies",
];

export const SOFT = [
  "sex", "sexy", "sexier", "sexiest", "sexual", "sexually", "sexes", "sexed", "nude", "nudes", "nudity", "naked",
  "strip", "stripper", "strippers", "erotic", "erotica", "kinky", "lust", "lusty", "horny", "condom", "condoms",
  "nipple", "nipples", "penis", "vagina", "vulva", "clitoris", "semen", "sperm", "anal", "anus", "rectum", "butt",
  "butts", "bum", "bums", "booty", "tush", "poop", "poops", "pee", "pees", "feces", "screw", "screwed", "hump",
  "humping", "shag", "shagged", "knob", "knobs", "boner", "boners", "suck", "sucks", "sucker", "balls", "tit", "puss",
  "cock", "cocks", "prick", "pricks", "booby", "boobies", "hooker", "hookers", "hoe", "hoes",
  "hell", "hells", "bloody", "blasted", "queer", "gringo", "gringos", "swastika", "cocaine", "heroin", "meth", "opium",
  "drunk", "drunken", "booze", "boozy", "vodka", "whiskey", "whisky", "beer", "wine", "kill", "killer", "killed",
  "murder", "murders", "corpse", "suicide", "gun", "guns", "bomb", "bombs", "slave", "slaves", "slavery", "lynch",
  "breast", "breasts", "bra", "bras", "panty", "panties", "thong", "thongs", "bikini", "seduce", "cocky", "fatso",
  "fatty", "ugly", "stupid", "idiot", "moron", "dumb", "loser",
];

/**
 * Hard words built from the commonest letters. Like every hard word they are never accepted or shown, but a board is
 * only checked for them along straight lines (a row, column or diagonal you could read), not along every bent path:
 * checking every path would throw away a third of all boards for words nobody can see.
 */
export const MILD = ["ass", "asses", "arse", "arses", "rape", "raped", "rapes", "damn", "crap", "craps", "fart", "farts", "turd", "turds", "cum", "tits", "boob", "boobs"];

/** Plain inflections every hard and soft entry also covers. */
export const FORMS = ["", "s", "es", "ed", "ing", "er", "ers", "y", "ier", "iest"];
