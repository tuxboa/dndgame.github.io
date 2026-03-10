/**
 * storyNodes.js — The static story graph for the Ironhold adventure.
 *
 * SCHEMA
 * ─────────────────────────────────────────────────────────────────────────────
 * StoryNode {
 *   id:          string          — Unique node key
 *   title:       string          — Shown as a heading in the narrative log
 *   description: string          — Prose shown when the node loads
 *   image?:      string          — Optional emoji / icon prefix (decorative)
 *   onEnter?:    Action          — Auto-executed when the node loads (before choices show)
 *   choices:     Choice[]
 * }
 *
 * Choice {
 *   id:      string
 *   label:   string              — Button text
 *   type:    ActionType
 *   ...      (type-specific fields below)
 * }
 *
 * ActionType variants
 * ─────────────────────────────────────────────────────────────────────────────
 *  navigate    target: nodeId
 *  combat      encounterId: key from encounters.js
 *              victoryNode: nodeId  (where to go after winning)
 *  loot        gold?: number
 *              items?: string[] | { itemId, name, quantity }[]
 *              then: nodeId         (navigate after items awarded)
 *  skillCheck  skill: keyof SKILL_ABILITIES
 *              dc: number
 *              successNode: nodeId
 *              failNode: nodeId
 *  addQuest    questId, title, description
 *              then: nodeId
 *  shop        merchantName: string
 *              items: { itemId, price, name?, description?, icon?, value?, healDice? }[]
 */

/** @type {Record<string, import('../systems/storyManager.js').StoryNode>} */
export const STORY_NODES = {
  // ── Act 1: The Town Gate ──────────────────────────────────────────────────

  town_gate: {
    id: "town_gate",
    title: "The Gates of Ironhold",
    image: "🏰",
    description:
      "Ironhold's iron-banded gates loom before you, streaked with rust and old blood. " +
      "A pair of guards eye you with weary suspicion. Over the wall, a city crier's voice " +
      "cuts through the noise: 'Work for able hands — Lord Vaelin's contract! Fifty gold " +
      "to whoever clears the eastern sewer. Inquire at the Rusty Flagon!' " +
      "To your left, a dark alley threads between crumbling tenements — the kind of shortcut " +
      "that either saves time or costs everything.",
    choices: [
      {
        id: "enter_main_gate",
        label: "▶ Enter the main gate — fifty gold is worth asking about",
        type: "navigate",
        target: "tavern",
      },
      {
        id: "browse_gate_stall",
        label: "🛒 Browse the market stall by the gate",
        type: "shop",
        merchantName: "Mira's Road Goods",
        items: [
          {
            itemId: "health_potion_minor",
            name: "Minor Healing Potion",
            price: 30,
            description: "Restores 2d4+2 HP.",
            value: 25,
            healDice: "2d4+2",
            icon: "🧪",
          },
          {
            itemId: "leather_armor",
            price: 45,
          },
          {
            itemId: "dagger",
            price: 20,
          },
          {
            itemId: "torch",
            name: "Torch Bundle",
            price: 5,
            description: "Three torches. Light is life in dark places.",
            value: 5,
            icon: "🔦",
          },
        ],
      },
      {
        id: "take_alley",
        label: "Slip into the dark alley unseen",
        type: "skillCheck",
        skill: "stealth",
        dc: 12,
        successNode: "alley_success",
        failNode: "alley_ambush",
      },
    ],
  },

  // ── Act 1a: Tavern ────────────────────────────────────────────────────────

  tavern: {
    id: "tavern",
    title: "The Rusty Flagon",
    image: "🍺",
    description:
      "Smoke-blackened beams, the smell of cheap tallow candles, and the low murmur of " +
      "desperate men. The barkeep — a broad woman with a branded wrist — slides a " +
      "frothy tankard across the bar without being asked. 'On the house,' she says. " +
      "'You look like you need it. And if you're looking for work…' she nods toward " +
      "the corkboard near the back, bristling with parchment notices.",
    onEnter: {
      type: "loot",
      items: [
        {
          itemId: "tavern_ale",
          name: "Tavern Ale",
          quantity: 1,
          description:
            "Strong enough to forget a night, weak enough to remember the morning.",
          value: 1,
        },
      ],
    },
    choices: [
      {
        id: "short_rest_tavern",
        label:
          "⛺️ Short Rest — sit down and catch your breath (partial HP + mana)",
        type: "rest",
        restType: "short",
      },
      {
        id: "long_rest_tavern",
        label: "🌙 Rent a room for the night — sleep it off (full HP + mana)",
        type: "rest",
        restType: "long",
      },
      {
        id: "check_board",
        label: "Read the notice board",
        type: "navigate",
        target: "quest_board",
      },
      {
        id: "buy_from_barkeep",
        label: "🛒 Buy something from the barkeep",
        type: "shop",
        merchantName: "Hilda's Bar",
        items: [
          {
            itemId: "tavern_ale",
            name: "Tavern Ale",
            price: 2,
            description: "Strong enough to forget a night. Restores 1d4 HP.",
            value: 1,
            icon: "🍺",
          },
          {
            itemId: "health_potion_minor",
            name: "Minor Healing Potion",
            price: 35,
            description: "Restores 2d4+2 HP.",
            value: 25,
            healDice: "2d4+2",
            icon: "🧪",
          },
          {
            itemId: "health_potion_standard",
            name: "Healing Potion",
            price: 60,
            description: "Restores 2d4+4 HP.",
            value: 50,
            healDice: "2d4+4",
            icon: "❤️‍🩹",
          },
        ],
      },
      {
        id: "leave_tavern",
        label: "Return to the gate",
        type: "navigate",
        target: "town_gate",
      },
    ],
  },

  // ── Act 1b: Quest Board ───────────────────────────────────────────────────

  quest_board: {
    id: "quest_board",
    title: "The Notice Board",
    image: "📋",
    description:
      "Most notices are old — bounties with the faces scratched out, crop reports from " +
      "villages that no longer exist. But one parchment is fresh, sealed with a black-wax " +
      "raven: 'URGENT: Ironhold's eastern sewers. The rats have grown. Something feeds " +
      "them. 50 gold to whoever clears the blockage. — Lord Vaelin.' " +
      "Beneath it, a smaller note in a shaking hand: 'Don't go. I did. — Unsigned.'",
    choices: [
      {
        id: "accept_quest",
        label: "Tear down the notice and accept the contract",
        type: "addQuest",
        questId: "clear_the_sewers",
        title: "Clear the Sewers",
        description:
          "Lord Vaelin has offered 50 gold to clear a rat infestation in Ironhold's eastern sewers. Someone — or something — has been feeding them.",
        then: "dungeon_entrance",
      },
      {
        id: "back_tavern",
        label: "Leave it… though your feet are already heading east",
        type: "navigate",
        target: "dungeon_entrance",
      },
    ],
  },

  // ── Act 1c: Dark Alley (skill check outcomes) ─────────────────────────────

  alley_ambush: {
    id: "alley_ambush",
    title: "Caught in the Alley",
    image: "🗡️",
    description:
      "You move too loudly. The shadows shift. Three figures detach from the walls — " +
      "goblins in mismatched leather, grinning with jagged teeth. 'Wrong alley, " +
      "softskin,' the tallest hisses. There's no room to run.",
    choices: [
      {
        id: "fight_ambush",
        label: "Draw your weapon and fight",
        type: "combat",
        encounterId: "goblin_scouts",
        victoryNode: "alley_success",
      },
    ],
  },

  alley_success: {
    id: "alley_success",
    title: "Spoils of the Alley",
    image: "🪙",
    description:
      "The alley opens into a small courtyard littered with refuse. " +
      "But there — wedged beneath a loose cobblestone — is a battered satchel. " +
      "Someone stashed it here and never came back. Their loss is your gain. " +
      "Through the thin courtyard wall, the city crier's call drifts over clearly now: " +
      "'Vaelin's sewer contract — fifty gold, Rusty Flagon notice board!' " +
      "Loot in hand and a paying job within reach. This city keeps pulling you in.",
    onEnter: {
      type: "loot",
      gold: 25,
      items: [
        {
          itemId: "health_potion_minor",
          name: "Minor Healing Potion",
          quantity: 2,
          description: "Restores 2d4+2 HP.",
          value: 25,
          type: "consumable",
          healDice: "2d4+2",
        },
        {
          itemId: "thieves_tools",
          name: "Thieves' Tools",
          quantity: 1,
          description:
            "Grants advantage on Dex (Sleight of Hand) checks to open locks.",
          value: 25,
        },
      ],
    },
    choices: [
      {
        id: "alley_to_board",
        label: "Follow the crier's voice — check that notice board",
        type: "navigate",
        target: "quest_board",
      },
    ],
  },

  // ── Act 2: The Sewers ─────────────────────────────────────────────────────

  dungeon_entrance: {
    id: "dungeon_entrance",
    title: "The Sewer Gate",
    image: "🕳️",
    description:
      "A rusted iron grate covers the entrance to Ironhold's eastern sewer. " +
      "The stench is ungodly. Scratches around the lock suggest something with claws " +
      "has been using this entrance. The darkness below is absolute — your torch " +
      "barely dents it. You can hear wet movement in the black.",
    choices: [
      {
        id: "descend",
        label: "Descend into the sewers",
        type: "navigate",
        target: "dungeon_corridor",
      },
      {
        id: "short_rest_gate",
        label: "⛺️ Take a moment to breathe before going in (Short Rest)",
        type: "rest",
        restType: "short",
      },
      {
        id: "retreat_to_town",
        label: "This is insane. Return to the tavern.",
        type: "navigate",
        target: "tavern",
      },
    ],
  },

  dungeon_corridor: {
    id: "dungeon_corridor",
    title: "The Sewer Corridor",
    image: "🐀",
    description:
      "The corridor is knee-deep in foul water. The walls glisten with moisture and " +
      "something darker. Gnawed bones float past your boots. Two massive rats — the " +
      "size of dogs, with eyes that catch your torch-light like copper coins — block " +
      "the passage. Then you notice the iron door at the far end: slightly ajar, " +
      "a faint mechanical hum coming from behind it. Something is very wrong here.",
    choices: [
      {
        id: "fight_rats",
        label: "Attack the giant rats",
        type: "combat",
        encounterId: "giant_rat_den",
        victoryNode: "dungeon_vault",
      },
      {
        id: "sneak_past",
        label: "Try to slip past them quietly",
        type: "skillCheck",
        skill: "stealth",
        dc: 14,
        successNode: "dungeon_vault",
        failNode: "dungeon_corridor",
      },
    ],
  },

  dungeon_vault: {
    id: "dungeon_vault",
    title: "The Feeding Chamber",
    image: "💀",
    description:
      "Beyond the iron door is a vaulted chamber that should not exist beneath a sewer. " +
      "Arcane sigils cover every surface. In the centre: a cracked pedestal, and on it, " +
      "a mechanism of brass and crystal that pulses with sickly green light — the " +
      "thing that has been attracting and growing the rats. It shatters the moment " +
      "you touch it. The hum dies. Somewhere above, you hear Lord Vaelin will be " +
      "pleased. And on the floor: the previous investigator's abandoned kit, and a " +
      "purse that escaped their notice.",
    onEnter: {
      type: "loot",
      gold: 60,
      items: [
        {
          itemId: "arcane_core_shard",
          name: "Arcane Core Shard",
          quantity: 1,
          description:
            "A fragment of the feeding mechanism. Magical in nature. Worth studying — or selling.",
          value: 75,
        },
        {
          itemId: "health_potion_standard",
          name: "Healing Potion",
          quantity: 1,
          description: "Restores 2d4+4 HP.",
          value: 50,
          type: "consumable",
          healDice: "2d4+4",
        },
      ],
    },
    choices: [
      {
        id: "short_rest_vault",
        label:
          "⛺️ Catch your breath in the chamber before leaving (Short Rest)",
        type: "rest",
        restType: "short",
      },
      {
        id: "escape_sewers",
        label: "Pocket everything and get out",
        type: "navigate",
        target: "quest_complete",
      },
    ],
  },

  quest_complete: {
    id: "quest_complete",
    title: "Contract Fulfilled",
    image: "🏆",
    description:
      "You emerge from the sewer into blinding daylight, reeking of filth and triumph. " +
      "Lord Vaelin's steward meets you at the gate — apparently someone was watching. " +
      "The agreed coin is counted out without ceremony. The steward pauses before leaving: " +
      "'His Lordship asks… where did you find the arcane device? He will see you personally. " +
      "Now.' It is not a request.",
    onEnter: {
      type: "loot",
      gold: 50,
      items: [],
      completeQuestIds: ["clear_the_sewers"],
    },
    choices: [
      {
        id: "visit_blacksmith",
        label: "🛒 Spend some coin at Gorran's Forge first",
        type: "shop",
        merchantName: "Gorran's Forge",
        items: [
          { itemId: "iron_sword", price: 80 },
          { itemId: "longsword", price: 110 },
          { itemId: "chain_shirt", price: 90 },
          { itemId: "chain_mail", price: 150 },
          { itemId: "shield", price: 40 },
          {
            itemId: "health_potion_minor",
            name: "Minor Healing Potion",
            price: 30,
            description: "Restores 2d4+2 HP.",
            value: 25,
            healDice: "2d4+2",
            icon: "🧪",
          },
        ],
      },
      {
        id: "meet_vaelin",
        label: "Follow the steward to Lord Vaelin's tower",
        type: "navigate",
        target: "vaelin_audience",
      },
    ],
  },

  // ── Act 3: Lord Vaelin's Tower ────────────────────────────────────────────

  vaelin_audience: {
    id: "vaelin_audience",
    title: "An Audience with Lord Vaelin",
    image: "🕯️",
    description:
      "The tower's top floor is cold despite the candles. Maps cover every wall — " +
      "troop positions, supply routes, sewer schematics with fresh ink annotations. " +
      "Lord Vaelin stands with his back to you, gauntleted hands clasped behind him. " +
      "He doesn't turn when he speaks: 'The mechanism you destroyed was not a rat-feeder. " +
      "It was a sensor — placed there six weeks ago by someone who wanted to know when " +
      "my vaults were being accessed from below. You have destroyed my only lead.' " +
      "A pause. 'Did you take anything from that chamber?'",
    choices: [
      {
        id: "give_shard",
        label: "Place the Arcane Core Shard on his desk",
        type: "navigate",
        target: "epilogue_shard_given",
      },
      {
        id: "keep_shard",
        label: "'Nothing of importance, my Lord.' Meet his eyes and hold them.",
        type: "navigate",
        target: "epilogue_shard_kept",
      },
    ],
  },

  // ── Epilogue A: Shard Surrendered ─────────────────────────────────────────

  epilogue_shard_given: {
    id: "epilogue_shard_given",
    title: "Epilogue — The Honest Blade",
    image: "⚖️",
    description:
      "Vaelin studies the shard for a long time. The green light plays across his face, " +
      "unreadable. Finally he sets it down and slides a second purse across the desk — " +
      "heavier than the first. 'You are either very honest or very stupid,' he says. " +
      "'In Ironhold, those are the same thing. But useful. Come to me in a fortnight " +
      "— I may have further use for someone who goes where I cannot.' " +
      "You leave the tower richer and watched. The city's gates are still open. " +
      "For now.",
    onEnter: {
      type: "loot",
      gold: 40,
      items: [],
    },
    choices: [
      {
        id: "epilogue_given_continue",
        label: "Step out of Ironhold. Chapter II awaits.",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  // ── Epilogue B: Shard Kept ────────────────────────────────────────────────

  epilogue_shard_kept: {
    id: "epilogue_shard_kept",
    title: "Epilogue — The Careful Hand",
    image: "🌑",
    description:
      "Vaelin's eyes don't move from yours for a very long time. Then he nods, once, " +
      "slowly — the nod of a man who has just decided something. 'Very well. Dismissed.' " +
      "You walk out of the tower under your own power. That may not last. " +
      "Three floors below, you pass a silver-robed scribe scrawling notes with fevered speed. " +
      "She glances at you — at your pack — and her quill stops. " +
      "In your bag, the shard pulses once, warm as a heartbeat. " +
      "It knows something you don't. " +
      "The road out of Ironhold is still open. Take it before that changes.",
    choices: [
      {
        id: "epilogue_kept_continue",
        label: "Leave Ironhold quickly, shard hidden. Chapter II awaits.",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  // ── Act 2: The Road From Ironhold ─────────────────────────────────────────

  act2_crossroads: {
    id: "act2_crossroads",
    title: "Chapter II — The Long Road",
    image: "🛤️",
    description:
      "The gates of Ironhold shrink behind you. The road forks half a league out — " +
      "three paths, three futures. To the west, the silver spires of Veilspire can just be " +
      "glimpsed above the treeline: Master Thalos keeps his archive there, and no one knows " +
      "the Vault Shard's history better than he does. " +
      "To the north, smoke marks a Free Clan encampment — Warchief Draven's people, " +
      "used as pawns by both factions in the coming war. " +
      "Behind you: Ironhold, where Lord Vaelin's coin is reliable, if his goodwill is not. " +
      "A cold wind cuts across the crossroads. Somewhere, a raven circles.",
    choices: [
      {
        id: "road_veilspire",
        label: "🔮 Head west to Veilspire — find Master Thalos",
        type: "navigate",
        target: "veilspire_road",
      },
      {
        id: "road_clans",
        label: "⛺ Head north to the Free Clan camp — speak with Draven",
        type: "navigate",
        target: "borderlands_path",
      },
      {
        id: "road_ironhold",
        label: "🏰 Return to Ironhold — Vaelin may have another contract",
        type: "navigate",
        target: "town_gate",
      },
    ],
  },

  // ── Act 2A: Veilspire ─────────────────────────────────────────────────────

  veilspire_road: {
    id: "veilspire_road",
    title: "The Veilspire Road",
    image: "🌲",
    description:
      "The western road is older than the Crimson Order — flagstones worn smooth by a " +
      "thousand years of scholar feet. You follow it through dense pine forest, the canopy " +
      "swallowing the light. Two miles in, you find a body: a Silver Circle scribe, " +
      "throat cut, documents scattered. Someone got here first. " +
      "Before you can search the body, movement. Dark robes, silver stitching. " +
      "Cultists — and they want whatever's in your pack. " +
      "'Give us the shard,' their leader calls. 'Or we take it from your corpse.'",
    choices: [
      {
        id: "veilspire_fight_cultists",
        label: "⚔️ Fight — no quarter for the Shard's servants",
        type: "combat",
        encounterId: "cultist_ambush",
        victoryNode: "veilspire_outskirts",
      },
      {
        id: "veilspire_deceive_cultists",
        label: "🎭 Bluff: 'I don't carry the shard — the scribe had it.'",
        type: "skillCheck",
        skill: "Deception",
        dc: 14,
        successNode: "veilspire_outskirts",
        failNode: "veilspire_cultists_forced",
      },
      {
        id: "veilspire_retreat",
        label: "🏇 Sprint — cut through the forest",
        type: "skillCheck",
        skill: "Athletics",
        dc: 12,
        successNode: "veilspire_outskirts",
        failNode: "veilspire_cultists_forced",
      },
    ],
  },

  veilspire_cultists_forced: {
    id: "veilspire_cultists_forced",
    title: "No Escape",
    image: "☠️",
    description:
      "They anticipated your move. The cultists close the gap before you can run. " +
      "There is no bluffing your way past a ring of drawn blades.",
    choices: [
      {
        id: "veilspire_forced_fight",
        label: "⚔️ Fight — there's no other way",
        type: "combat",
        encounterId: "cultist_ambush",
        victoryNode: "veilspire_outskirts",
      },
    ],
  },

  veilspire_outskirts: {
    id: "veilspire_outskirts",
    title: "The Spires of Veilspire",
    image: "🗼",
    description:
      "Veilspire rises from the valley like a cluster of needles: seven silver towers " +
      "connected by enclosed bridges, perched above a city that smells of old paper and " +
      "preserved specimens. The Silver Circle's stronghold in the east. " +
      "At the city gate, a Silver Circle archivist in round spectacles recognises the Vault " +
      "Shard's aura before you've said a word. He pales. 'Master Thalos will want to see " +
      "you. Immediately. Do not activate it — he says that every time. Not everyone listens.' " +
      "The tower doors swing open. Whatever comes next begins here.",
    onEnter: {
      type: "addQuest",
      questId: "thalos_audience",
      title: "An Audience with Thalos",
      description:
        "Master Thalos of the Silver Circle wishes to examine the Vault Shard. " +
        "His motives remain unclear — scholar's curiosity, faction duty, or something else.",
    },
    choices: [
      {
        id: "veilspire_enter",
        label: "▶ Enter Veilspire — meet with Master Thalos",
        type: "navigate",
        target: "thalos_study",
      },
    ],
  },

  // ── Act 2B: The Free Clan Borderlands ─────────────────────────────────────

  borderlands_path: {
    id: "borderlands_path",
    title: "The Northern Road",
    image: "🔥",
    description:
      "The northern road is barely a road: two ruts pressed into hard earth, winding " +
      "through scrubland toward columns of dark smoke. A Free Clan encampment — " +
      "goatskin tents, open cookfires, children watching from a careful distance. " +
      "Before you can approach, three scouts materialise from the hillside. " +
      "Their hands rest on their weapons. The leader speaks first: " +
      "'Ironhold sends spies this late in the season. Or is there another reason " +
      "an ironclad stranger walks our roads?'",
    choices: [
      {
        id: "borderlands_parley",
        label: "🤝 'I carry no coin from Vaelin — I want to speak to Draven'",
        type: "skillCheck",
        skill: "Persuasion",
        dc: 13,
        successNode: "clan_camp_welcome",
        failNode: "clan_scouts_fight",
      },
      {
        id: "borderlands_read",
        label: "👁 Say nothing — study the scouts' body language",
        type: "skillCheck",
        skill: "Insight",
        dc: 11,
        successNode: "clan_camp_welcome",
        failNode: "clan_scouts_fight",
      },
      {
        id: "borderlands_fight_scouts",
        label: "⚔️ Draw your weapon — let them decide what happens next",
        type: "combat",
        encounterId: "free_clan_scouts",
        victoryNode: "clan_camp_tense",
      },
    ],
  },

  clan_scouts_fight: {
    id: "clan_scouts_fight",
    title: "The Scouts Attack",
    image: "⚔️",
    description:
      "The scout's jaw tightens. He says something in Clan speech — two words, soft and final. " +
      "The other scouts move.",
    choices: [
      {
        id: "clan_scouts_forced_fight",
        label: "⚔️ Defend yourself",
        type: "combat",
        encounterId: "free_clan_scouts",
        victoryNode: "clan_camp_tense",
      },
    ],
  },

  clan_camp_welcome: {
    id: "clan_camp_welcome",
    title: "Among the Free Clans",
    image: "⛺",
    description:
      "The scouts exchange a glance. One nods. 'You speak like someone who has thought " +
      "about what they're saying,' the leader says. 'Come. Draven eats with his men.' " +
      "The camp is larger than you expected: families, smiths, healers. Not a raiding party " +
      "— a displaced people. Warchief Draven meets you at the central fire. A man of sixty " +
      "winters who still looks like he's winning fights. 'You've come from Ironhold,' he says " +
      "without preamble. 'Then you've seen what they do with us. I want to know whether " +
      "Vaelin sent you — or if someone else did.' He waits. The fire crackles. " +
      "Everything depends on what you say next.",
    onEnter: {
      type: "addQuest",
      questId: "draven_trust",
      title: "Earning Draven's Trust",
      description:
        "Warchief Draven suspects you of working for Lord Vaelin. " +
        "Convincing him otherwise may build a crucial alliance against the Silver Circle.",
    },
    choices: [
      {
        id: "camp_welcome_continue",
        label: "🗣 Speak honestly — tell Draven what you've seen",
        type: "navigate",
        target: "draven_dialogue",
      },
    ],
  },

  clan_camp_tense: {
    id: "clan_camp_tense",
    title: "Unwelcome Guest",
    image: "😤",
    description:
      "You defeated the scouts but left them breathing. A dozen more emerge from the " +
      "scrubland — bows at half-draw, not yet hostile. Draven himself walks forward, " +
      "unhurried. 'You fought my people and left them alive,' he says. 'That is either " +
      "mercy or a message.' He studies you the way a man studies an unfamiliar blade. " +
      "'Tell me why you're here. One chance.'",
    choices: [
      {
        id: "clan_tense_explain",
        label: "🗣 Explain yourself to Draven",
        type: "navigate",
        target: "draven_dialogue",
      },
    ],
  },

  // ── Act 2A: Thalos Study (inside Veilspire) ────────────────────────────────

  thalos_study: {
    id: "thalos_study",
    title: "Master Thalos's Study",
    image: "📚",
    description:
      "The archivist leads you up seven flights of stairs to a circular room " +
      "that smells of ink, old leather, and something faintly electrical. " +
      "Every wall is bookshelves; every surface is covered in maps, crystal fragments, " +
      "and annotated manuscripts. Master Thalos himself is a spare man of seventy with " +
      "white eyebrows and the precise stillness of someone who hasn't wasted a movement " +
      "in decades. He examines the Vault Shard through a jeweller's loupe without touching it. " +
      "'As I suspected,' he says at last. 'This is not a shard — it is a key. Third tier, " +
      "pre-Sundering manufacture. There are four others.' He sets the loupe down and " +
      "looks at you directly for the first time. 'The question is not what it opens. " +
      "The question is who else knows it's a key, and how far they've gotten.'" +
      "He moves to a locked cabinet. 'I can help you. Whether you trust my help " +
      "is another matter entirely.'",
    onEnter: {
      type: "updateQuest",
      questId: "thalos_audience",
      status: "active",
      note: "Thalos revealed the shard is one of five keys to a pre-Sundering vault.",
    },
    choices: [
      {
        id: "thalos_accept_help",
        label: "🤝 Trust Thalos — accept his offer of information",
        type: "skillCheck",
        skill: "Insight",
        dc: 10,
        successNode: "thalos_alliance",
        failNode: "thalos_cautious",
      },
      {
        id: "thalos_demand_answers",
        label: "⚠️ Demand he share what he knows before you commit to anything",
        type: "navigate",
        target: "thalos_negotiation",
      },
    ],
  },

  thalos_alliance: {
    id: "thalos_alliance",
    title: "An Unlikely Alliance",
    image: "🤝",
    description:
      "Thalos studies your face, then nods once. 'Wise. Or at least honest about your " +
      "limits.' He unlocks the cabinet and spreads three maps across the table: " +
      "the locations of the other four key fragments, each guarded by a different faction. " +
      "'The cult that ambushed you on the road? They have one. Lord Vaelin suspects " +
      "another is buried in the Free Clan borderlands — which is why he's been pushing " +
      "them off their land.' The picture sharpens into something darker than you expected. " +
      "'I'll share what I know,' Thalos says, 'if you'll bring me the pieces. " +
      "I want to study the complete key. What you do with the vault is your concern. " +
      "What's inside it is mine.'",
    onEnter: [
      { type: "setFlag", key: "thalos_allied", value: true },
      { type: "updateQuest", questId: "thalos_audience", status: "complete" },
      {
        type: "addQuest",
        questId: "fragment_hunt",
        title: "The Five Fragments",
        description:
          "Thalos has identified four other key fragments. Recover them before the cult does.",
      },
    ],
    choices: [
      {
        id: "thalos_alliance_continue",
        label: "▶ Accept the contract — head back to the crossroads",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  thalos_cautious: {
    id: "thalos_cautious",
    title: "Measured Caution",
    image: "🤔",
    description:
      "Something in Thalos's stillness reads wrong — too composed for a man who just " +
      "identified a world-altering artefact. You keep your cards close. " +
      "He notices, and doesn't seem offended. 'Caution is a survival strategy,' he says. " +
      "'I would do the same.' He gives you the three maps anyway. " +
      "'What you do with them is your choice. If you decide you need my help, " +
      "the Silver Circle's door opens at dawn.' He asks nothing in return. " +
      "That is, somehow, more unsettling than a bargain would have been.",
    onEnter: [
      { type: "setFlag", key: "thalos_cautious_approach", value: true },
      { type: "updateQuest", questId: "thalos_audience", status: "complete" },
    ],
    choices: [
      {
        id: "thalos_cautious_leave",
        label: "▶ Take the maps — return to the crossroads",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  thalos_negotiation: {
    id: "thalos_negotiation",
    title: "Bargaining with Knowledge",
    image: "⚖️",
    description:
      "You fold your arms. 'Before I agree to anything, I need to know what's in the vault.' " +
      "Thalos is quiet for a long moment. The fire in the corner hisses. " +
      "'No one knows exactly,' he says finally. 'That is not evasion — it is the truth. " +
      "Pre-Sundering records are... fragmentary. What we do know: the vault contains " +
      "something that ended the last war. The cult believes it is a weapon. " +
      "I believe it is a library. Both of us could be correct.' " +
      "He meets your eyes. 'I'll give you everything I have. In exchange: " +
      "if you reach the vault, you give me one hour inside before anything leaves it.'",
    choices: [
      {
        id: "thalos_negotiate_agree",
        label: "✓ Agreed — one hour inside the vault",
        type: "navigate",
        target: "thalos_alliance",
      },
      {
        id: "thalos_negotiate_refuse",
        label: "✕ Refuse — take what he'll give and leave",
        type: "navigate",
        target: "thalos_cautious",
      },
    ],
  },

  // ── Act 2B: Draven Dialogue (inside Clan Camp) ───────────────────────────

  draven_dialogue: {
    id: "draven_dialogue",
    title: "Warchief Draven Speaks",
    image: "🔥",
    description:
      "Draven listens. He is the kind of man who listens with his whole body, " +
      "perfectly still, eyes never leaving your face. When you've finished, " +
      "he is silent for thirty seconds. Then: " +
      "'Lord Vaelin has been claiming our border territory for six years. " +
      "Two winters ago he burned a grain cache — forty families lived on that cache. " +
      "The Silver Circle offers protection in exchange for access rights to our old sites. " +
      "They think there's something buried there. Could be this vault of yours.' " +
      "He pours two cups of something dark and bitter and pushes one toward you. " +
      "'I'm not interested in shard politics. I'm interested in whether you can " +
      "help my people survive the next winter. If those two things overlap, " +
      "we can talk about an arrangement.'",
    onEnter: {
      type: "updateQuest",
      questId: "draven_trust",
      status: "active",
      note: "Draven suspects the vault may be buried in Free Clan ancestral lands.",
    },
    choices: [
      {
        id: "draven_help_offer",
        label: "🤝 Offer to help the clans survive the winter",
        type: "skillCheck",
        skill: "Persuasion",
        dc: 14,
        successNode: "clan_alliance",
        failNode: "draven_standoff",
      },
      {
        id: "draven_ask_about_vault",
        label: "🔎 Ask Draven what he knows about the buried site",
        type: "skillCheck",
        skill: "History",
        dc: 12,
        successNode: "clan_vault_lead",
        failNode: "draven_standoff",
      },
      {
        id: "draven_leave",
        label: "🚶 Leave — return to the crossroads",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  clan_alliance: {
    id: "clan_alliance",
    title: "The Draven Compact",
    image: "🏹",
    description:
      "Draven sets down his cup. Something shifts behind his eyes — not warmth, exactly, " +
      "but the absence of something cold. 'You mean that,' he says. It's not a question. " +
      "'Two Ironhold grain convoys use the northern pass every harvest season. " +
      "If they were... delayed... my people would see those supplies. Vaelin would assume " +
      "bandits. He always does.' A pause. 'In exchange: I'll tell you about the old site. " +
      "And if it comes to a fight with Vaelin or the cult — you'll have a hundred bows " +
      "at your back.' He extends his hand. The firelight makes the scars on his palm " +
      "look like a map.",
    onEnter: [
      { type: "setFlag", key: "draven_allied", value: true },
      { type: "updateQuest", questId: "draven_trust", status: "complete" },
      {
        type: "addQuest",
        questId: "ironhold_convoy",
        title: "The Convoy Problem",
        description:
          "Draven wants two Ironhold grain convoys intercepted. He'll support you in return.",
      },
    ],
    choices: [
      {
        id: "clan_alliance_continue",
        label: "▶ Shake Draven's hand — return to the crossroads",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  clan_vault_lead: {
    id: "clan_vault_lead",
    title: "The Buried Site",
    image: "🗺️",
    description:
      "Draven's eyes narrow. 'You know about the site.' He stands and retrieves " +
      "something from a chest — a rolled piece of hide with a rough map burned into it. " +
      "'Two days north, through the Ashwood. There's a structure there, stone that " +
      "doesn't match anything the clans ever built. We've kept Vaelin away from it " +
      "because the Silver Circle pays us to — or used to.' He spreads the map. " +
      "'If that's your vault, and it's on our land, it belongs to us as much as anyone. " +
      "We go together, or not at all.' He looks up. 'Your call.'",
    onEnter: [
      { type: "setFlag", key: "vault_location_known", value: true },
      { type: "updateQuest", questId: "draven_trust", status: "active" },
    ],
    choices: [
      {
        id: "vault_lead_alliance",
        label: "🤝 Agree — you'll go together",
        type: "navigate",
        target: "clan_alliance",
      },
      {
        id: "vault_lead_alone",
        label: "🚫 Decline — you'll find it yourself",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },

  draven_standoff: {
    id: "draven_standoff",
    title: "Uneasy Stalemate",
    image: "🤜",
    description:
      "Draven's expression doesn't change but his shoulders settle into the posture " +
      "of a man who has heard too many promises. " +
      "'You believe what you're saying,' he says. 'That's not the same as it being true.' " +
      "He doesn't order you out of the camp, which is something. " +
      "'Come back when you have something concrete. The clans don't run on goodwill.' " +
      "The fire burns lower. The conversation is over.",
    choices: [
      {
        id: "draven_standoff_leave",
        label: "▶ Leave the camp — return to the crossroads",
        type: "navigate",
        target: "act2_crossroads",
      },
    ],
  },
};

/** The node to start on a new game */
export const STORY_START_NODE = "town_gate";
