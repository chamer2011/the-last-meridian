# The hacking rework (2026-11-13): designed on example pages, planned, nothing built

## What was asked

"I would like to rework the mini-game for hacking. How can it be more realistic? Right now it resemble to the one in
the game Fallout. Should the player be able to prepare virus before starting the hack?" Today's hacking is the
Intrusion Console's word-likeness puzzle (`src/check-games/crack.js`, `public/check.js`, the `hacking` part of
`world/checks.json`: five classes from Door panel to the Beacon or the Choir, training from untrained to master, the
advisor's hints, layers, and `mark` for a trace that goes on the record). Getting into a computer opens its own system
(`src/computers.js`, `src/computer-use.js`, `public/computer.js`, `world/computers/<id>.txt`, seven written ones and
generic ones from `_flavor.json`).

## How the design went, round by round

1. Three ways on a playable page, https://claude.ai/artifact/HDejv2gMoGhhwDKbzjWqYN: A, a map of the computer with
   noise and a watcher; B, prepare, then run; C, a console by clicking. My pick was A with a light B.
2. "We will expand on A. Let's add B's preparation actions but should be done by the player on the map on his own and
   not via the terminal. The hacking window should look like an old CRT screen with windows 1999 ... Implement nothing,
   we will calibrate the style over multiple sessions." The second page, https://claude.ai/artifact/Tf4tQ4e2V8yBkGWheE3Wvx,
   is where everything since lives (its source is only in the artifact: read it with the Artifact tool, republish to
   the same URL). Its first version: a made-up 1999-era desktop, Keelworks 4.1 by Halden Yards, in three skins behind a
   CRT; A's parts as programs (Mail, the Event Log, Door Control) and the map as SCOPE.EXE; AuditGuard in the tray;
   getting ready as cards in the game's own windows (a talk, a pickpocket, a shelf, a bench, the clock).
3. "Shipyard grey as default but keep the other ones as cosmetic change in the settings ... much more 'viruses'
   available ... depending on his hacking ability ... the force it button is to easy ... the chip of the player like a
   invetory object he could modify ... faster but less powerful or completly silent ... I want that system to be deep."
   Version 2: no free way in (notes from the room, or a program strong enough: power plus the rig's against the
   computer's class); 24 programs in six kinds, gated by Hacking 1 to 10; the trace and the 02:00 nap counted in
   minutes; the rig built two ways, A parts in sockets, B a frame and three dials.
4. "A, parts in sockets." Version 3: a casing round a board (Yard, Slim, Navy, each its own socket grid), parts as items
   with heat, weight, condition (new, worn: half and a point warmer, broken: nothing) and a source; heat sinks cool the
   sockets beside them; a session warms the rig a point every ten minutes (the fan at 3, half speed at 5); links decide
   what it can plug into; the bench mends with the ship's parts crates and tunes with Engineering.
5. "Getting parts in play" (version 4), then "Both" for salvage-and-the-bench and the ports as the main way
   (version 5): three wrecks in the Graveyard (the Merrow, the Pale Wren, the Saint Ilse), a bottle of air a run;
   Haven's market, Kessara's fence (standing), Tessen Colony's workshop (air, scrap, tools); days restock and change
   what each port wants; Persuasion takes 2% a point; the soldering kit, cell press and micro lathe; now and then,
   taking the ship's own things apart (they stop working; the law's witnesses) and finds.
6. "What would the more computer to hack entail?", then "Yes, show them" (version 6): eleven computers as cards, four
   playable in their own looks: the Brig's door panel, junction box JB-3's amber service menu, passage camera D2-04,
   and NAVCOM 7 on the bridge watched by SENTRY.

## The plan

At "Plan building it", the plan went on a page they tick off: https://claude.ai/artifact/BFxFQGccmF8xjFWQeoY658.
Build only the step they name, each after they've tried the one before.

1. The new screen: computers open as the Keelworks desktop on an old screen, floating over the room; Settings gets the
   skin and the old-screen effect. Getting in stays the word puzzle.
2. The rig and its programs: the rig as an item in the pack (the plain yard build), programs as plain-text world files
   opened by Hacking, written at the Repair Bay's bench over hours or copied off computers, working inside a computer.
3. No free way in: the word puzzle goes; logons take found passwords, MIMIC with a lifted keycard, or a breaker strong
   enough for the class; the watcher's noise, trace in minutes and cut-off; the advisor says what each choice costs.
   Classes, the record's trace facts and computers already open in a save are kept.
4. Parts and the bench: boards, casings and parts as items; heat, wear, mending with parts crates, tuning, the lathe.
5. Getting parts: salvage on three wrecks, the three ports, tools; now and then the ship's own things and finds.
6. More computers: door panels, junction boxes, cameras and NAVCOM 7, through the systems that already run doors,
   power, cameras and the alarm.
7. The story knows: scenes and asks ask about the rig, give parts and programs, react to what was done; the checker and
   the Story board.

Later, if wanted: the ports' and the Navy's computers and the wrecks' dead ones, playable; other lives' rigs.

Seven choices with my picks, not yet answered: the computer floats over the room with the clock running; the captain
starts with the plain yard rig and DICTIONARY, DOORKEY and MASK; writing a program takes hours at the bench; old saves
keep computers already open; being caught works as now; NAVCOM 7 for the ship's main system and the Navy's computers;
the numbers are mine from the examples, to tune after they play.
