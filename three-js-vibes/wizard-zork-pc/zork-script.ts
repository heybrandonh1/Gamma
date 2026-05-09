/**
 * Pure-data script for the wizard's CRT.
 *
 * The text below is short, deliberately paraphrased Zork-flavour fiction
 * rather than verbatim transcripts of the 1981 game — enough atmosphere to
 * read as Zork while staying clear of any licence fuzz. Three layers:
 *
 *   1. {@link OPENING}   — the boot banner the autoplay always types first.
 *   2. {@link AUTO_DEMO} — ordered command/response pairs the autoplay
 *      walks through after the opening, so a passive viewer sees a small
 *      adventure happen on its own.
 *   3. {@link COMMAND_MAP} — canned responses for the hybrid prompt,
 *      keyed by lowercased trimmed input. Anything that misses falls
 *      through to {@link UNKNOWN_RESPONSE}.
 *
 * Lines are wrapped manually to ~58 columns so the amber-phosphor canvas
 * never has to soft-wrap mid-word at runtime.
 */

export const PROMPT = ">";

export const OPENING: readonly string[] = [
  "ZORK I: The Great Underground Empire",
  "Infocom interactive fiction - a fantasy story",
  "Copyright (c) 1977, 1978, 1979 Infocom, Inc.",
  "Revision 88 / Serial number 770814",
  "",
  "West of House",
  "You are standing in an open field west of a",
  "white house, with a boarded front door.",
  "There is a small mailbox here.",
  "",
];

export interface DemoStep {
  command: string;
  response: readonly string[];
}

export const AUTO_DEMO: readonly DemoStep[] = [
  {
    command: "open mailbox",
    response: [
      "Opening the small mailbox reveals a leaflet.",
      "",
    ],
  },
  {
    command: "read leaflet",
    response: [
      '"WELCOME TO ZORK!"',
      "",
      "ZORK is a game of adventure, danger, and low",
      "cunning. In it you will explore some of the most",
      "amazing territory ever seen by mortals. No",
      "computer should be without one!",
      "",
    ],
  },
  {
    command: "north",
    response: [
      "North of House",
      "You are facing the north side of a white house.",
      "There is no door here, and all the windows are",
      "boarded up. To the north a narrow path winds",
      "through the trees.",
      "",
    ],
  },
];

export const UNKNOWN_RESPONSE: readonly string[] = [
  "I don't understand that.",
  "",
];

/**
 * Lowercased command -> response. Aliases (single-letter directions, `i`,
 * `l`) point to the same arrays as their long forms so the canned
 * fiction stays in one place.
 */
export const COMMAND_MAP: Record<string, readonly string[]> = (() => {
  const map: Record<string, readonly string[]> = {};

  const openMailbox = [
    "Opening the small mailbox reveals a leaflet.",
    "",
  ];
  map["open mailbox"] = openMailbox;

  const takeLeaflet = ["Taken.", ""];
  map["take leaflet"] = takeLeaflet;
  map["get leaflet"] = takeLeaflet;

  const readLeaflet = [
    '"WELCOME TO ZORK!"',
    "",
    "ZORK is a game of adventure, danger, and low",
    "cunning. No computer should be without one!",
    "",
  ];
  map["read leaflet"] = readLeaflet;

  const inventory = [
    "You are carrying:",
    "  a leaflet",
    "",
  ];
  map["inventory"] = inventory;
  map["i"] = inventory;
  map["inv"] = inventory;

  const look = [
    "West of House",
    "You are standing in an open field west of a",
    "white house, with a boarded front door.",
    "There is a small mailbox here.",
    "",
  ];
  map["look"] = look;
  map["l"] = look;

  const north = [
    "North of House",
    "You are facing the north side of a white house.",
    "There is no door here, and all the windows are",
    "boarded up. To the north a narrow path winds",
    "through the trees.",
    "",
  ];
  map["north"] = north;
  map["n"] = north;
  map["go north"] = north;

  const south = [
    "South of House",
    "You are facing the south side of a white house.",
    "There is no door or window here.",
    "",
  ];
  map["south"] = south;
  map["s"] = south;
  map["go south"] = south;

  const east = [
    "The door is boarded and you can't remove the",
    "boards.",
    "",
  ];
  map["east"] = east;
  map["e"] = east;
  map["go east"] = east;

  const west = [
    "Forest",
    "This is a forest, with trees in all directions.",
    "To the east, there appears to be sunlight.",
    "",
  ];
  map["west"] = west;
  map["w"] = west;
  map["go west"] = west;

  const up = ["There is no way up from here.", ""];
  map["up"] = up;
  map["u"] = up;

  const down = [
    "You can't go that way.",
    "",
  ];
  map["down"] = down;
  map["d"] = down;

  const enterHouse = [
    "The door is boarded and you can't remove the",
    "boards.",
    "",
  ];
  map["enter house"] = enterHouse;
  map["enter"] = enterHouse;

  const xyzzy = ["A hollow voice says \"Fool.\"", ""];
  map["xyzzy"] = xyzzy;

  const score = [
    "Your score is 0 (total of 350 points), in 1 move.",
    "This gives you the rank of Beginner.",
    "",
  ];
  map["score"] = score;

  const help = [
    "Try: open mailbox, read leaflet, north, look,",
    "inventory, xyzzy.",
    "",
  ];
  map["help"] = help;
  map["?"] = help;

  const quit = [
    "The wizard waves a hand. The session continues.",
    "",
  ];
  map["quit"] = quit;
  map["q"] = quit;

  return map;
})();

/**
 * Resolve a raw input string to a canned response. Trims, lowercases,
 * collapses internal whitespace. Empty input echoes a blank prompt.
 */
export function resolveCommand(raw: string): readonly string[] {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (key.length === 0) return [""];
  return COMMAND_MAP[key] ?? UNKNOWN_RESPONSE;
}
