# project-mutiny-opening

On 2026-11-12, the day all seven hands-on features were finished, the owner wrote, word for word:

> I would like for you to get rid of the story quest you made last week. Not the organic quest system, just the railread story. Disable the other start execpt the captain one. The start of the story should happenend when a group of unamed mutineer try to get control of the ship. This creates battle everywhere along the bridge level. The officers and all of the crew on the level should fight this mutiny, the captain too. The aftermath of the fight leaves the ship in bad condition and force the player to act on the defferent system present in the game. Show me a plan of the request

They asked for a plan, so **nothing has been built**. The plan is a page for them to read and answer: https://claude.ai/artifact/TY8dxcTRqyd5YV83WLMjoo. Build nothing until they say so, and then only the step they name.

This replaces what they said on 2026-11-04 (that they'd write the stories themselves and the stories weren't to be changed meanwhile) as far as the main story goes: they now want it out. They still write their own universe; the few lines the opening needs would be drafts marked for them to rewrite.

## What was found before planning

- **What the "railroad story" is in the files.** `STARTING_QUESTS` in `src/data.js` (The Beacon, main, and Fuel for the Ship). Ten scene files in `world/scenes`: `opening.txt` (the plain one for any life without its own), `opening_captain.txt` ("A Light on Every Band"), `opening_engine_hand.txt`, `opening_docker.txt`, `arrive_haven.txt`, `thread_main_the_old_scholar.txt` (The Warm Room), `thread_main_two_weeks_of_fuel.txt`, `thread_main_visiting_hours.txt`, `thread_main_the_council.txt` and `thread_crew_naomi_under_crew.txt` (The Downstairs Crew). The 20 `main_` stories in `world/stories` (one already set aside), and the main story's own clock in `world/story-clock.json` (four events an act and `moves_on`, played by `actDay` in `src/story-clock.js`). `talk_tharel.txt`, since Tharel is the old story's scholar. Seven crew talks open on facts only the old scenes leave (`aduro_knows`, `downstairs_crew`, `downstairs_enemies`, `downstairs_hidden`, `marrow_knows_fourteen`, `brandt_knows`, `knows_about_the_list`), which the checker would report as facts nothing leaves once the scenes are gone.
- **What isn't it.** The 19 `request_` scenes (the organic quests), the 3 `command_` scenes (the chain of command's own mutiny), the 13 other talks, the scene engine, the Story board and the checker, and the other stories (22 crew, 16 deep, 18 fleet and 52 out, ten of them among the eleven already set aside): none of those can be played, they tick by their clock and make news.
- **The lives.** `world/starts.json` has 22 (`captain`, three more aboard, two on the kept ships, sixteen out in the world); `creatorSetup` in `src/creator.js` lists them all from `START_LIST`. Many tests make games with other lives through `createGameFromDraft`, so switching lives off belongs in what the new-game screen offers and what the server accepts, not in `createGameFromDraft`.
- **Who's on deck 1 when a new game begins (08:00).** Voss, Pell, Sorel and Vey on the bridge; Roe, Deckhand Kofi and three people with no job (Yusuf, Teo, Petra) along the Names Bulkhead. The three ensigns are at the sitting in the mess, Tarrow is in the Aft Holds, Marrow and Hask in Engineering, Aduro in the Medbay, Halm and Brandt in the mess. The five story people on deck 1 have fights in their files (Voss 40 health, Pell 16, Sorel 14, Vey 13, Roe 16).
- **The fight as it is.** `MAX_PER_SIDE` is 4 counting the player and `MAX_ARRIVALS` 3 (`src/combat.js`). A fight in the room (`src/live-fight.js`) keeps its fighters' planning inside the room's rectangle (`inRoom` in `planFor`), and looks 4 or 5 tiles for somewhere better to stand, so nobody crosses a deck after anyone. `fightGround` in `src/walk.js` already gives the whole level with the room as `area`. A scene's `FIGHT` takes `enemy_followers`, `allies` and `arrivals`. `world/enemies/mutineer.txt` exists ("Fleet Mutineer", 22 health, a strip of red cloth round one arm).
- **Deck 1's rooms and parts.** The Bridge (junction box, vent, light switch, camera, speaker, relay, nav core), the Names Bulkhead (junction box, which also feeds the Galley and the Garden; vent, light switch, speaker), the Chart Room, Comms & Sensors, the Officers' Cabins, the Wardroom, the Quiet Room, the Heads, the Boat Bay and the two stairs (a vent, a light switch and a speaker each). The stairs' ways down are at 73,29 and 111,29.
- **What leans on the old story.** Nine test files (`act1`, `board`, `clock`, `notes`, `quests`, `record`, `scenes`, `stories`, `story-text`), about 130 tests, many of them tests of the scene engine that use the real scenes as their examples. 31 stories, 13 places and 13 people speak of the Beacon in their words.

## The plan, as shown

1. **The old story goes:** the two starting quests, the ten scene files (the captain's opening is replaced), the main stories and the main story's clock, Tharel's talk, and the dead branches in seven talks. A game already under way keeps playing, with its two quests closed by one line.
2. **One life:** the new-game screen offers only the captain; the other 21 are switched off in the starts file, not deleted.
3. **The opening:** at 08:00 twelve unnamed mutineers come up both stairs of deck 1. The fight starts paused. Everyone on the deck fights (the four bridge officers, Roe, Kofi, the captain), the three civilians take cover, and about a minute in Tarrow, the guards and the three ensigns come up from below. It ends with the mutineers down or given up, talked down, or with the captain down (they wake in the medbay and the damage is worse).
4. **The aftermath:** the fallen lie where they fell (four cots, two nurses), and every time there's a fire where the fighting was thickest, a breach in the Boat Bay, the Names Bulkhead junction box shot out (a dark Galley and Garden, so an empty kettle), and the nav core damaged (no jump). More breaks in each room fought in. Medicine and parts run down, posts and jobs are left uncovered, the living mutineers are a number in the Brig, and morale and the council's confidence fall. The tracker shows "After the mutiny", a list the game ticks from the ship's real state in any order, and the officers' asks come through the organic quests, with four new kinds (the prisoners, the dead, an empty post, Voss's damage report).

**It needs one of their rules bent, and the page asks:** fights keep `src/combat.js`'s rules and numbers, and this battle needs the four-a-side limit lifted, for this battle only.

## The seven choices, with my picks

- **A, the other background stories:** A1 keep them ticking (my pick, the narrow reading of their words); A2 switch them all off and leave only what people are saying in the Leads menu.
- **B, the files:** B1 taken out of the game and left in the project's history (my pick); B2 moved to a folder the game doesn't read.
- **C, saved games with another life:** C1 they still open (my pick); C2 they're refused.
- **D, the battle:** D1 one fight across the whole deck with everyone in it (my pick); D2 keep the limit and let the dice settle the other rooms out of sight.
- **E, if the captain goes down:** E1 wake in the medbay with worse damage (my pick); E2 the ship is taken and the player goes on as crew, as in the game's own mutiny.
- **F, the mutineers afterwards:** F1 prisoners in the Brig as a number, with a decision to make (my pick); F2 gone.
- **G, the tracker:** G1 the "After the mutiny" list (my pick); G2 nothing but people's asks.

## The six steps, each after their test

1. The old story out, one life in.
2. The battle.
3. The aftermath, the people.
4. The aftermath, the ship.
5. The list in the corner and the officers' asks.
6. Tuning, once they've played it.

## What I told them I'm not sure of

How the fight plays with twenty people at once (it was built for eight); whether a fire, a dozen wounded and a dark galley is too much for a first hour; that the words would be my drafts; and that about 130 tests would be rewritten against small test scenes.

## Status

| What | State |
|------|-------|
| The plan page | shown on 2026-11-12, waiting for their answer |
| Any of the six steps | not started |
