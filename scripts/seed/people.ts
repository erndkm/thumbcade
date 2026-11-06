/**
 * Demo players for the seeded social graph. Distinct, believable, international; bios have a voice.
 * Interests are hashtags used as a ranking prior.
 */
export interface DemoPerson {
  handle: string;
  displayName: string;
  bio: string;
  interests: string[];
  /** 0..1 — how much this person plays, likes and comments. */
  activity: number;
}

export const DEMO_PLAYER = {
  email: "demo@thumbcade.dev",
  password: "thumbcade-demo",
  handle: "demo.player",
  displayName: "Demo Player",
  bio: "The account reviewers sign in with. Be nice to it.",
  interests: ["arcade", "puzzle", "reflex"],
} as const;

export const DEMO_PEOPLE: DemoPerson[] = [
  { handle: "noor.plays", displayName: "Noor Haddad", bio: "Commute gamer. Line 7, every morning, one more run.", interests: ["arcade", "reflex"], activity: 0.9 },
  { handle: "tobi_k", displayName: "Tobias Keller", bio: "I will not explain my Shortwick strategy. It is a feeling.", interests: ["puzzle", "merge"], activity: 0.8 },
  { handle: "yuki.sato", displayName: "Yuki Sato", bio: "Speedrunner of things nobody asked to be speedrun.", interests: ["reflex", "speed"], activity: 0.85 },
  { handle: "camila.rv", displayName: "Camila Restrepo", bio: "Medellín. Designer by day, high scores by night.", interests: ["chill", "arcade"], activity: 0.7 },
  { handle: "ade.builds", displayName: "Adebayo Ogun", bio: "Stacking things professionally (towers, not boxes).", interests: ["3d", "arcade"], activity: 0.75 },
  { handle: "lenaplays", displayName: "Lena Fischer", bio: "Chess puzzles with coffee. Mate in two before the milk foams.", interests: ["chess", "brain"], activity: 0.65 },
  { handle: "marco.b", displayName: "Marco Bianchi", bio: "Retired from competitive Snek. Unretired yesterday.", interests: ["arcade", "snake"], activity: 0.8 },
  { handle: "priya.m", displayName: "Priya Menon", bio: "Matching games are my cardio.", interests: ["matching", "brain"], activity: 0.6 },
  { handle: "jonas.wav", displayName: "Jonas Lund", bio: "Plays everything with the sound on. Sorry to the bus.", interests: ["reflex", "3d"], activity: 0.7 },
  { handle: "fatima.z", displayName: "Fatima Zahra", bio: "Casablanca. Collecting new bests like stamps.", interests: ["puzzle", "chill"], activity: 0.55 },
  { handle: "owen.ok", displayName: "Owen O'Keefe", bio: "Mostly here for the comments, honestly.", interests: ["arcade"], activity: 0.95 },
  { handle: "sofia.lima", displayName: "Sofia Lima", bio: "A clean Mines board is a love language.", interests: ["logic", "puzzle"], activity: 0.6 },
  { handle: "kwame.a", displayName: "Kwame Asante", bio: "If it has a leaderboard I am on it. Somewhere. Low.", interests: ["arcade", "reflex"], activity: 0.7 },
  { handle: "hana.choi", displayName: "Hana Choi", bio: "Seoul. Rhythm in the hands, chaos in the heart.", interests: ["rhythm", "reflex"], activity: 0.75 },
  { handle: "mateo.g", displayName: "Mateo García", bio: "One-thumb games only. The other thumb holds the coffee.", interests: ["onetap", "arcade"], activity: 0.65 },
  { handle: "elif.dmr", displayName: "Elif Demir", bio: "Istanbul. I came for Neon Chop, I stayed for the surge cells.", interests: ["arcade", "reflex"], activity: 0.7 },
  { handle: "sam.reyes", displayName: "Sam Reyes", bio: "Teacher. Grading papers between runs. Not during. Mostly.", interests: ["brain", "chill"], activity: 0.5 },
  { handle: "ines.costa", displayName: "Inês Costa", bio: "Lisbon. Heatfall made me late for a train once.", interests: ["3d", "chill"], activity: 0.6 },
  { handle: "dmitri.v", displayName: "Dmitri Volkov", bio: "Brick-breaker veteran. My paddle has seen things.", interests: ["arcade", "retro"], activity: 0.75 },
  { handle: "aisha.k", displayName: "Aisha Kamara", bio: "Night shift nurse. 3am runs hit different.", interests: ["chill", "arcade"], activity: 0.55 },
  { handle: "liam.oc", displayName: "Liam O'Connor", bio: "Competitive about everything except sleep.", interests: ["reflex", "speed"], activity: 0.8 },
  { handle: "mei.lin", displayName: "Mei Lin", bio: "Taipei. Pairs world record (in my apartment).", interests: ["matching", "puzzle"], activity: 0.6 },
  { handle: "ravi.s", displayName: "Ravi Shankar", bio: "Software engineer. I read the patch notes. All of them.", interests: ["3d", "puzzle"], activity: 0.65 },
  { handle: "julia.nowak", displayName: "Julia Nowak", bio: "Kraków. Kingsnare daily puzzle streak: do not ask, it hurts.", interests: ["chess", "logic"], activity: 0.55 },
  { handle: "theo.m", displayName: "Théo Martin", bio: "Lyon. Duskrail, then croissant. In that order.", interests: ["runner", "3d"], activity: 0.7 },
  { handle: "zara.ali", displayName: "Zara Ali", bio: "Mostly lurking, occasionally dominating.", interests: ["arcade", "onetap"], activity: 0.5 },
  { handle: "ben.adler", displayName: "Ben Adler", bio: "Dad of two. Plays during bedtime stories. Allegedly.", interests: ["chill", "brain"], activity: 0.45 },
  { handle: "nina.petrova", displayName: "Nina Petrova", bio: "Sofia. I keep my score screenshots in a folder called evidence.", interests: ["reflex", "arcade"], activity: 0.7 },
  { handle: "kofi.mensah", displayName: "Kofi Mensah", bio: "Accra. Snek enjoyer, Shortwick doubter.", interests: ["snake", "arcade"], activity: 0.6 },
  { handle: "olivia.tan", displayName: "Olivia Tan", bio: "Singapore. Will trade you a tip for a tip.", interests: ["puzzle", "merge"], activity: 0.55 },
  { handle: "max.richter", displayName: "Max Richter", bio: "Not that one. Same playlist though.", interests: ["chill", "3d"], activity: 0.5 },
  { handle: "ana.souza", displayName: "Ana Souza", bio: "São Paulo. Big fan of games that respect my time.", interests: ["onetap", "chill"], activity: 0.6 },
  { handle: "erik.hansen", displayName: "Erik Hansen", bio: "Oslo. Three lanes, zero chill, as advertised.", interests: ["runner", "reflex"], activity: 0.65 },
  { handle: "layla.h", displayName: "Layla Hassan", bio: "Amman. Collecting NEW BEST stamps.", interests: ["arcade", "matching"], activity: 0.7 },
  { handle: "chris.park", displayName: "Chris Park", bio: "Toronto. I make games too, just worse ones.", interests: ["3d", "arcade"], activity: 0.75 },
  { handle: "vera.kz", displayName: "Vera Kuznetsova", bio: "Physics teacher. Heatfall is a lesson in gravity.", interests: ["3d", "brain"], activity: 0.5 },
  { handle: "diego.mx", displayName: "Diego Hernández", bio: "CDMX. Neon Chop main. The static fears me.", interests: ["arcade", "reflex"], activity: 0.7 },
  { handle: "amara.n", displayName: "Amara Nwosu", bio: "Lagos. Daily puzzle, daily coffee, daily humility.", interests: ["chess", "puzzle"], activity: 0.55 },
  { handle: "felix.w", displayName: "Felix Wagner", bio: "Vienna. Breaking bricks and personal records.", interests: ["arcade", "retro"], activity: 0.6 },
  { handle: "rosa.m", displayName: "Rosa Martínez", bio: "Valencia. My thumbs have opinions.", interests: ["onetap", "reflex"], activity: 0.65 },
];
