# The hacking rework (2026-11-13): designed on example pages, planned, steps 1 to 6 built

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

Seven choices with my picks, taken at "Your picks, step 1": the computer floats over the room with the clock running; the captain
starts with the plain yard rig and DICTIONARY, DOORKEY and MASK; writing a program takes hours at the bench; old saves
keep computers already open; being caught works as now; NAVCOM 7 for the ship's main system and the Navy's computers;
the numbers are mine from the examples, to tune after they play.

## Step 1, the new screen (built 2026-11-13, at "Your picks, step 1")

The seven picks were taken. What changed, all on the page side except one line of text:

- `public/computer.js` draws the computer as Keelworks 4.1 on an old monitor, in the same floating window over the room
  (`check-float`, the line to what you sat down at, pulled aside and sliding back). The server and its actions are as
  they were: a folder's things send `file`, `mail`, `log`, `program`, `connect` or `show`; a system's switches `system`;
  the menu's Log off and Esc `logoff`. The desktop is drawn at 640 by 480 and scaled to the glass (`--s`, a
  ResizeObserver). Windows (folder, viewer, session log) keep their places in the window's own state, come to the front
  on a press without redrawing (so the click still lands), and move by their title bars. A new screen from the server
  brings the viewer up. The command line went: typing is still understood by the server, but nothing needs it, and Help
  (which lists typed commands) isn't in the menu.
- `public/desktop.css` holds the monitor, the old screen's effects and the three skins, all under `.desk` and `.os`, and
  undoes the game's own button look inside the desktop (its brackets and inverted hover). The game already used `.title`
  and `.screen`, so the desktop's are `.wtitle` and `.desk-screen`.
- Settings: `deskSkin` and `deskCrt` in the reading preferences (`public/app.js`, kept in `meridian-reading`), on the
  root as `data-desk-skin` and `data-desk-crt`; a Computers fold in `public/menus.js`.
- `public/pull.js`: `.os` is in `NOT_FOR_PULLING`, so the desktop's windows drag and the monitor is pulled by its frame.
- `src/computers.js`: the first line in a session's log says to open a folder on the desktop, not to click on the left
  or type.

Checked: all 1,098 tests; on a test copy (port 3297, its own data folder, two saves made with the game's own code: the
 medbay's records terminal, and Haven's berth board hacked with the trace at 75%), at 1400 and 810 wide: folders open,
 files show, a system's switch works and the trace warning comes through, a window drags without pulling the monitor,
 Log off closes it, the hacked one's eye, light and warning show, Settings' Phosphor and Heavy save and apply. At 810
 the advisor moved under the monitor (below 980 wide), and the icons were tightened so six fit above the taskbar.
Not done: the NAVCOM look (step 6). The owner hasn't tried it.

## Step 2, the rig and its programs (built 2026-11-13, at "Yes, step 2")

- The rig is an item, `world/items/rig.txt` (a gadget, 2 by 2, 1.6 kg; 65 items now), put in the pack by
  `assembleGame` with `game.rig = newRig()` (`src/rig.js`): `programs` (those `on every rig`, KNOCK, plus DICTIONARY,
  DOORKEY and MASK), `loaded` (the starting three as memory allows; a `built in` one, SCOPE, is never in the list and
  always runs) and `timers` (what's left behind). `RIG_MEMORY` is 4 blocks. Save version 25: `fromVersion24` gives an
  older save the same rig and the item.
- The programs are `world/programs/<id>.txt`, 24 of them, my drafts from the example pages, with
  `_how-to-write-a-program.txt`. `src/programs.js` reads them (`parseProgram`, `programsNow`, which looks at the files at
  most once a second and reads them again when one changed, `programById`, `PROGRAM_KINDS`, `GAME_PROGRAMS_DIR` for
  tests), and their problems go through `addChecker` into `npm run check-story`, which now names the folder and counts
  them. Lines: order, kind, hacking, size, power, noise, minutes (read and kept, used by nothing yet), once, written in,
  found on, sold at (only said: nobody sells programs until step 5), on every rig, built in.
- Hacking decides only what can be written. The captain starts at Hacking 0, so if running needed it, the starting
  programs would be dead weight. Where a program runs is its `power` against the computer's class number (1 door panel up
  to 5 the Beacon or the Choir, `classNumber`, from the order of the classes in `world/checks.json`). `noise` above 0
  costs a point of trace per run through `act`, as any action on a hacked computer does; DOORKEY, MASTERKEY and RELAY have
  noise 0, as their words say (the code had overridden their files at first; the files decide now).
- `rigCommand` (`POST /api/rig`): load (memory permitting), unload, and write: at `BENCH`, the Repair Bay (through
  `roomHere`), with Hacking enough and a `written in` line, the hours passed with `passTime` (its notes logged), loaded if
  it fits. It refuses everything while a computer is open, since the owner wanted getting ready done in the room and not
  at the terminal, and swapping programs at the desk would make the memory meaningless; and in a fight; and writing in a
  talk.
- At a computer: `computerView` carries `rig` (`rigInComputer`: what's loaded, each with why it won't run here, and the
  computer's programs to copy). The desktop has a **Rig (D:)** folder (a click sends `{action: "rig", id}`; one that won't
  run is greyed with the reason as its tooltip; the status bar shows the memory), and the **Programs** folder ends with
  "Copy X.EXE to your rig" (`{action: "copy", id}`). `computerCommand` hands them to `runRigProgram` and `copyProgram`
  (an action, a point of trace on a hacked computer).
- What each does is by id in `runRigProgram`: doorkey and masterkey unlock the doors the computer runs, relay puts its
  cameras off for ten minutes, mask and ghost (`session.free`, 3 and 6) and blindfold (`session.blind`) work in `act`,
  cleaner, decoy and forger take the trace down, lullaby raises `maxTrace` by 2, cutout makes `thrownOut` end with nothing
  on the record, digger reads everything (`readEverything` in `src/computer-use.js`), scope and mapper say what it runs
  and reaches, worm and backdoor learn passwords, and sniffer, sleeper and saboteur leave timers on `game.rig.timers` that
  `addClockWork` fires with `[COMPUTER]` lines (a day later; the next 02:00; the next 03:00, through `damagePart`). The
  kind `in` (KNOCK, DICTIONARY, SKELETON, SHADOW, MIMIC) says there's nothing to break once you're in: getting in with
  them is step 3. The trace programs need a hacked computer.
- Where copies are: GHOST and WORM on the plot table, BLINDFOLD and BACKDOOR on the Ministry archive; SHADOW, MASTERKEY,
  SNIFFER and CUTOUT are `sold at: kessara`.
- The Rig page (`public/rig.js`; `rig` in `MENUS` under Gear, 13 entries now): Your rig (the memory bar, Hacking, the
  bench, a note while at a computer, Left behind), Loaded, On the rig but not loaded, and every other program by kind in
  two columns, each with its blocks, the Hacking to write it (not for one built in), its power, whether the trace notices
  it, once a session, what it does, where it's copied or sold, and Load, Unload or Write it. At a computer or in a fight
  the buttons are greyed and the note says why. In the inventory (`public/bag.js`) the rig's tip says what's loaded and
  the memory free, and a double-click or **Open the rig** on its right-click menu opens the page (`openMenu` handed to
  `initBag` from `public/app.js`); it has its own drawing in `public/item-art.js`. A program that's only copied or
  bought shows no Hacking to write, and says where it comes from once.
- Found while checking and fixed: every click on the desktop typed the session log's newest lines out again, so the log
  blinked (`comp.seen` now moves on once a drawing has shown them, in `computerNode`); MASK's result repeated its
  description word for word; BACKDOOR was filed under getting in, so it never ran inside a computer, and is under
  leaving things behind now, where its words put it.
- Tests: `test/rig.test.js` (13, one of them running every program that works inside a computer and letting what's
  left behind come due). Older tests moved to version 25 and 65 items, and the two computer tests that keep the
  password from the browser now look for a `"password"` key, since the programs' words say "passwords".
- Screens, on a test copy (port 3297, its own data folder, three saves made with the game's own code), at 1400 and 810
  wide: the Rig page at the bench, writing CLEANER (two hours on the clock, not loaded for want of room); the plot table's
  Programs folder copying GHOST; a hacked door console's Rig (D:) running CLEANER (the trace from 33% to 0%), MASK,
  DOORKEY and SLEEPER; the Rig page at a computer with its note and greyed buttons; no overflow among the 24 cards at 810.
- Not done: getting in with the programs (step 3), the rig's parts (step 4), selling programs (step 5), programs on the
  Story board (step 7), and `minutes`. The owner hasn't tried it.

## Step 3, no free way in (built 2026-11-13, at "Yes, step 3")

- The word puzzle is gone: `src/check-games/crack.js` is deleted, the hacking part of `world/checks.json` keeps only the
  classes (name, mark, and the watcher's `notices`, `traces`, `finds`, `cuts`) and `training.room` (what training adds
  to notices, traces and cuts: 0, 1, 1, 2, 3 by tier), and `src/hack-classes.js` holds the defaults and `classOf`,
  `allClasses`, `roomFor`, read by the checks, the computers and the migration. A hacking check never opens a window:
  `startCheck` hands it to the handler `src/computers.js` puts in `src/hack-hook.js` (`setHackHandler`; a file of its own
  because the check engine and the computer code read each other and one registering at load hit the other half-loaded).
  `hackFromCheck` opens the computer the tag names, or this place's of the class, or for practice a made-up one of the
  class that's never the player's and runs nothing (`practiceContent`).
- Every way in goes through `openLogon` (straight in when it's the player's or the password's known, else
  `openSession(..., { locked: true })`): Use on a console or a computer thing (`useComputer`, `useConsolePart`), a door's
  Hack the door panel (`workOnDoor` returns `{ panel }` for hacking, with the tampering alarm when a camera sees it, and
  `src/walk.js` opens `openDoorPanel`), a map file's door with a hacking rule (`askAtDoor`: the panel's logon with a
  `doorRule`, so the door opens and says its pass line once the player is in, or its fail line if they log off or are
  thrown out at the logon; the Foundry's sublevel door is the one), reaching over the network (`connectTo`), a scene's
  `[hacking:...]` choice or check, and practice. `enterAfterHack` and `enterDoorPanel` are gone, and the check route no
  longer opens computers.
- A locked session shows the page nothing of the computer (empty lists, no user) and refuses everything but the rig and
  logging off ("Log on first"). `computerView` sends `locked`, `practice`, `logon.ways` (the loaded breakers and SCOPE,
  each with its noise, minutes, power and why it won't work) and `watch` (`name`, `stage` calm/noticed/tracing, `noise`,
  the marks, `traceLeft`), and `trace`/`maxTrace` are gone.
- The breakers in `src/rig.js` (`cantRun`, `breakIn`): at a logon only kind `in` and SCOPE run; power against the class;
  SKELETON needs `session.scanned` (SCOPE at the logon); MIMIC needs a `keycard` item (new, `world/items/keycard.txt`, 66
  items; a clean pocket lift has a `keycard` chance in `world/deeds.json`, 0.25); SHADOW needs working hours (07:00 to
  21:00) and sets `session.shadow` (every noisy action one louder). A breaker's noise is spent first; if that cuts the
  player off they're out, else `gotIn` (user: service for KNOCK and SKELETON, keycard for MIMIC, the computer's own for
  DICTIONARY and SHADOW). Inside, kind `in` says "you're already in".
- The watcher, `act(game, session, { noise, minutes })` in `src/computer-use.js`: every action adds its minutes to
  `session.minutes` (2 by default, a rig program its `minutes` line); on any computer that isn't the player's (a
  password's included) its noise is heard: silent under MASK/GHOST (`free`) or BLINDFOLD (`blindLeft` minutes, then +2),
  +1 shadowing, +1 once noticed. At `notices` it notices (`noticed`), at `traces` a trace starts (`traceLeft = finds`),
  counted down by the action minutes, and at `cuts`, or when the trace is up, `thrownOut` (CUTOUT: elsewhere, no mark;
  else the record's `traced_on_<class>` on marked classes). Noise per action: a first read `readNoise` (1 on very_hard
  and worse, else 0), a computer's own program, a switch and a copy 1, a rig program its `noise`. CLEANER, FORGER and
  DECOY take noise off, lose a trace once under its mark, and settle the watcher under the notice mark; LULLABY adds 4
  minutes to a running trace; the session's minutes are only what's done, so reading and thinking never run a trace.
- `settleHack` (once a session): learning (3× or 2× the class's `DIFFICULTY_LEARNING`, not in practice or by right),
  `notePut` for requests on a pass, and for a story's hack `game.lastCheck` with a `[HACK] reason: ACCESS GRANTED`,
  `TRACED`, `CUT OFF` or `NOT IN` line; only the story's own hacks (`choice`, `tool`) set `lastCheck`, so a console the
  player hacks on their own can't answer a scene waiting on a different check. Logging off at the logon settles a
  failure. `finish`: a practice session leaves no line and passes no time; otherwise the line says what the watcher
  made of the player ("never noticed you", "had noticed you", "A trace was still running"), and the minutes owed are
  `session.minutes` less the clock's running time.
- The advisor (`hintsFor`): at a logon, `logonHints` per tier: untrained, whether each way gets in and if it's loud or
  quiet; novice, its noise and minutes; trained, the watcher's marks; expert, what each would do to the watcher; master,
  the quietest way in; with nothing that works, novice and up are told which breaker suits which class. Inside, the
  `_flavor.json` hints by tier with `{read}`, `{noise}`, `{notices}`, `{traces}`, `{cuts}`, `{finds}`, `{left}`, `{next}`,
  and lines about the watcher hidden on the player's own computers.
- The page (`public/computer.js`, `public/desktop.css`): a locked session draws `logonNode` (Keelworks' box at the top of
  the desktop, the class and LOGON or PRACTICE, the three fields, From your rig with each way's reason under it, and Log
  off) in place of the folders and windows; the Keel menu has only the session log and Log off. The tray shows the
  eye and Calm, Noticed or "Tracing: N min"; the frame's light amber when noticed and red when tracing; the balloon once
  per stage, noticed ("Unusual activity...") and tracing ("...finds you in N min"), until clicked.
- Practice from the SKILLS page's hacking buttons opens a practice computer at its logon over the room: nothing runs
  anything or reaches anywhere, `leave` programs refuse ("in practice nothing's left behind"), no time, no line, no
  learning.
- Save version 26 (`fromVersion25`): a computer the player is on keeps going, its trace turned into noise (the same share
  of the way to the trace's mark, less one), `minutes` from its actions, unlocked; a hacking window open mid-puzzle is
  closed with a `[HACK]` line saying to use the computer again; `computerAsked` goes.
- The programs' words changed with it (MASK, GHOST, CLEANER, FORGER, DECOY, LULLABY, BLINDFOLD, CUTOUT, SHADOW, SCOPE),
  and so did the scenes', computers' and programs' how-tos and the README (Skill checks, Computers with a new Getting in,
  Your rig).
- Tests: `test/logon.test.js` (10) for the logon, the breakers' conditions, the marks by class and training, being cut
  off at the logon, logging off at it, practice, the Foundry door, the advisor by tier, the keycard and the old save;
  `test/checks.test.js` lost the puzzle's tests and skips hacking where it went through every window; the computers,
  rig, systems, anyone and deeds tests moved from the trace to noise and the logon; versions to 26 and 66 items.
- Screens, on a test copy (port 3297, saves made with the game's own code), at 1400 and 810 wide: the berth board's logon
  (DICTIONARY and SCOPE, the advisor untrained, Calm), DICTIONARY getting in as dockmaster and the desktop opening, a
  ship's main system's logon with DICTIONARY greyed as too weak, a session with a trace running (balloon, "Tracing: 4
  min", red light) and one noticed (amber, its balloon); at 810 the logon fits above the session log with the advisor
  under the monitor, nothing overlapping.
- Not done: the rig's own power from parts (step 4: the yard build adds nothing, so a Ministry or Navy server or worse
  needs a password for now), noise from a rig's heat or a radio (step 4), the NAVCOM look and SENTRY (step 6), the
  Story board for programs (step 7). The owner hasn't tried it.

## Step 4, the rig built from parts (built 2026-11-13, at "Yes, step 4")

- From the design page's third round (option A, parts in sockets): the boards, casings and parts are
  `world/rig-parts/<id>.txt`, 21 of them (yard, slim and Navy boards; plain, shielded, ghost foil and open frame
  casings; stock, racing, deep and whisper cores; 2-block, 4-block and scrap memory; the cable jack; standard and hot
  cells; fin sink and cold plate; overclock board and echo buffer), with `_how-to-build-a-rig.txt`. `src/rig-parts.js`
  reads them (`parseRigPart`, `rigPartsNow`, `GAME_RIG_PARTS_DIR`; problems through `addChecker` into check-story,
  which counts them now): kind, order, grade, weight, heat, power, quiet, speed, memory, cools, cooling, echo, a board's
  `sockets` ("core at 1 1, ... extra at 5 1 from Hacking 7", keys core1, memory1, memory2...), `made from` ("2 scrap,
  Engineering 1, 2 hours") and `where from`. Only the cable jack is a link for now: the other links (clip, optic,
  radio, Navy coupler) belong with step 6's computers that need them.
- `rigStats(rig, hacking)`: board and casing numbers (half if worn, +1 heat worn), each open socket's part
  (`partNumbers`: worn half and +1 heat, broken nothing, a core's `tune`), heat sinks taking their `cools` off each
  socket beside them, the parts' heat less the casing's cooling; memory, power (−1..3), speed (0.4..2.5), quiet
  (−1..3), echo, weight; `dead` without a working core, cell and link, or with a broken board. `rigNoise`, `rigMinutes`
  and `sessionHeat` are the session's sums. My numbers: overclock speed +0.3 heat +2 (the design had +1, which the yard
  build's sink and case swallowed), undervolt −0.2 and −1; both Engineering 1 (the design's 3 and 2 were out of a new
  captain's reach, 0 or 1); mending Engineering and hours by grade, a parts crate; the lathe 2 scrap and 2 hours for a
  broken part back as worn; taking apart 1 scrap (2 for a board or casing), 1 hour. No charge on cells (the design's
  battery): a cell is needed to start, and the hot cell adds power.
- The save (version 27, `fromVersion26`): `game.rig.parts` [{ uid, id, cond, tune, from }], `game.rig.build`
  { board, casing, fit: { socket: uid } }, `nextUid`; `newRig`/`giveStartingBuild` make the yard build (the same 4
  blocks as before). The rig's memory is the build's (`memoryOf`), and anything that takes memory away unloads what
  no longer fits, last loaded first (`trimLoaded`).
- At a computer that isn't the player's, `act` in `src/computer-use.js` puts the rig in: minutes divided by its speed
  and doubled when overheating, noise through its quiet and its fan (heat 3 and up), heat rising a point every 10 of
  the session's minutes, the fan and overheating said once each in the log (`fanOn`, `overheated`), and `finish`
  wearing the hottest working part a step (`wearHottest`) after an overheated session, not in practice. `cantRun`
  refuses everything on a rig that won't start and adds the rig's power to a program's against the class; CLEANER
  takes `3 + echo`. `computerView` sends `rigHeat`, shown in the tray as Rig cool, warm, hot or overheating.
- The Rig page (`public/rig.js`, styles in `public/desktop.css`): The build section with the board and casing tiles,
  the totals, when the fan and overheating come in a session (or that it won't start), the sockets as card tiles on
  their grid (part, condition, tune, heat and cooling), the picked part's details and its actions from the server
  (`partActions`: Use this board/casing, Take it out, Mend, Rebuild on the lathe, Overclock, Undervolt, Put it back,
  Take it apart, each with why not), the spare parts (a picked one lights the sockets it fits; a click fits it), scrap,
  crates aboard and Engineering, the Make buttons, and a folded Every part there is. `rigCommand` takes fit, remove,
  board (the old parts find sockets of their kind on the new board), casing, mend, tune, rebuild, apart and make;
  fitting anywhere but at a computer or in a fight, the bench's jobs at the Repair Bay with the clock running.
- `world/items/scrap.txt` (67 items); the pack weighs the rig by its parts (`loadOf` in `src/bag.js`) and its tip
  shows that weight.
- Tests: `test/rig-build.test.js` (9): the files, the yard build's numbers and weight, worn and broken and a rig that
  won't start, the sink's neighbours, fitting and taking out, the bench's jobs, a session's fan and overheating and
  wear, quiet and power and the echo buffer with the Navy board, the old save. Versions to 27, 67 items.
- Screens, on a test copy at 1400 and 810 wide: the build at the bench with spare parts (worn 4-block memory, broken
  whisper core, Navy board) and three scrap; picking and fitting the 4-block memory (the rig going warm, the fan
  sooner); overclocking the core on screen (speed 1.3, the fan on from the start with the worn memory away from the
  sink); the tray's "Rig hot" at a hacked computer; at 810 a rig without its link saying it won't start, and fitting
  the cable jack back; Every part there is opened, nothing overflowing.
- Not done: getting the other parts (step 5: wrecks, ports, tools, finds), the other links and the computers that
  need them (step 6), cell charge, and the Story board for programs and parts (step 7). The owner hasn't tried it.

## Step 5, getting parts (built 2026-11-13, at "Yes, step 5")

- From the design page's getting-parts tab (salvage, the bench and the ports as one loop; the ship's own things and
  finds now and then), fitted to the game:
- **The wrecks** (`src/wrecks.js`, `world/wrecks/<id>.txt` with a how-to, `GAME_WRECKS_DIR`): the Merrow, the Pale
  Wren and the Saint Ilse at the Graveyard, as the design had them, played like the Harrow from You can (room acts
  wreck-start, wreck-job, wreck-back). A run takes an `air_bottle` (a new item, 69 items now) for 60 minutes; a new
  game has two (`assembleGame`), and save version 28 (`fromVersion27`) gives an old game two. Jobs: minutes,
  Engineering (parts worn at or above it, broken below; scrap as it is), "behind the hatch", what comes out. Done stays
  done, taken stays taken (`game.wrecks.done`), a wreck stripped bare can't be run. Out of air, what's carried is left
  by the airlock (`game.wrecks.left`) and a job picks it up next run: the design lost it, which felt too hard on a
  finite wreck. The run is `game.wreckRun`; the Harrow (src/salvage.js, unchanged otherwise, still 90 minutes of the
  suit's own air) and the wrecks hide each other while one is on, and trade.js offers nothing while either is.
- **The dealers** (`src/dealers.js`, `world/dealers/<place>.txt` with a how-to, `GAME_DEALERS_DIR`): Haven's market
  (buys what works), Kessara's fence (markup 1.5, buys anything, a broken part 5, friends pay less) and Tessen Colony's
  workshop (`frontier`: air bottles, scrap by the sack, the bench's tools; buys scrap at 4), with the design's
  numbers: each bought a fifth dearer until a day's restock (`game.dealers.bought`, an `addDayWork`), a wanted kind
  a day in turn at half again, selling at half (anything) or two fifths (working), worn half that. The design's
  Persuasion 2% became the market's own `priceEdge` (Commerce and Presence), now exported from src/rules.js. "Friends"
  are the player's standing with whoever holds the place (Kessara: the Drift, as Kessara Syndicate), a step a fifth of
  it, -2 to 3, 5% each; a sale at the fence counts +1 with them once a day. Parts have a `worth` line now (boards and
  casings the design's values, parts grade x 35). The four programs `sold at: kessara` are sold there, at a new
  `price` line in their files (SHADOW 120, CUTOUT 100, SNIFFER 110, MASTERKEY 180) times the markup. The bench's tools
  are paid from the ship's purse when the player is the captain (`openPurse`, exported from src/trade.js), the
  rest from their credits: my call, from the plan's "draws on the ship's purse". Shown in the **Market** menu beside
  the market's goods, as cards like the market's (`dealerSections` in `public/rig.js`, from `rigView(game).dealer`;
  orders deal-buy, deal-program, deal-sell and deal-scrap through `/api/rig`). A market no longer buys the rig whole
  (it was 66 credits at Kessara, beside the fence's parts).
- **Tools for the bench** (`world/rig-parts/_tools.txt`, `benchToolsNow` in src/rig-parts.js, `game.rig.tools`): the
  soldering kit, the cell press and the micro lathe, as the design had them. `made from` reads ingredients now
  (scrap, any item by name, a parts crate from the ship's stores, joined by "and"), Engineering, hours and "with the
  <tool>": the fin sink (3 scrap, Engineering 2, 2 hours, soldering kit), the optical reader (a lens unit and 1 scrap,
  Engineering 3, soldering kit) and the hot cell (a fuel cell and a parts crate, Engineering 4, 3 hours, cell press).
  The lathe's rebuild (step 4's, built in until now) needs the micro lathe, which the plan's "buy the lathe at Tessen"
  asked for. The Rig page's build lists the tools on the bench and the ones not yet.
- **The links** came in now, not in step 6, because the design's sources give them (the Wren, Haven, the Ilse, the
  mutineers, Oona): the service clip, the optical reader, the short radio and the Navy coupler, with a `reaches` line
  on every link (the cable jack's too). Nothing reads it yet: step 6's computers will say which they take, and until
  then any link that works starts the rig. The design's long cell (a battery) wasn't made, as in step 4.
- **The ship's own things** (`src/ship-parts.js`, `world/rig-parts/_from-the-ship.txt`): by kind of systems part, not
  the design's four named things, since the game has a junction box, a relay, cameras and a nav core but no spare
  handset, Brig door panel or galley chiller: junction box (fin sink and 2 scrap; 25 minutes, Engineering 2; the chief
  engineer), relay (short radio; 15, 1; the comms officer), camera (a `lens_unit`, a new item, for the optical
  reader; 20, 2; the chief of security) and nav core (overclock board; 30, 3; the helm officer). Only the captain's own
  (`ownedBy`) and whole parts; the part is damaged `by: "stripped"` ("It's been taken apart for parts, and it's
  dead.") and the systems do the rest (dark rooms, no comms, a blind camera, jumps by hand) until the engineers mend it
  with a crate. Seen (`whoSees` from src/law.js), the post's holder gets a story memory, -4. A new hook,
  `addPartActs`/`partExtras` in src/room-hooks.js, gives a systems part `does` acts, which `public/walk.js` now shows
  in a part's window and right-click menu.
- **Finds** (`world/rig-parts/_finds.txt`, room acts find-take, `game.rig.found`): the mutineers' belongings in the
  Brig once `game.battles.mutiny` exists (a short radio, a scrap memory and a scrap), and Tech Oona's old service clip
  in the Repair Bay for two of the ship's parts crates. Oona doesn't remember it (she's a crowd name); the line says
  she takes the crates for her repair list.
- `npm run check-story` counts the bench's tools, the wrecks and the dealers, and checks every file, the programs
  sold where there's no dealer, and the kinds and posts in _from-the-ship.txt.
- Tests: `test/part-sources.test.js` (11): the files, the air bottles and the old save, a whole Merrow run (worn and
  broken, not enough air, stripped bare, no bottle), the Wren's hatch and running out of air, Kessara (markup, dearer,
  restock, broken, friends, once a day, programs), Haven and Tessen (working only, wants, scrap, sacks, bottles), the
  tools from the purse and the lathe, soldering kit and cell press, the lathe needed, the junction box taken apart and
  remembered, Engineering and the captain only, the finds. `test/rig-build.test.js` and `test/salvage.test.js` were
  moved on (25 parts, the lathe as a tool, the Harrow's act found by its id). 1,133 tests.
- Screens, on a test copy (port 3297, its own data folder): at 1400, out at the Merrow mid-run (jobs with their
  Engineering, one too long for the air left) and back with the parts; the Rig page's spare parts and the bench's
  tools; Kessara's fence beside the market, selling a broken cable jack (the standing line came up); the bench with the
  micro lathe rebuilding it. At 810: Tessen's workshop, buying the micro lathe from the purse; Engineering's junction
  box window with Take it apart, the room going dark; the Brig's find; the Graveyard's You can with the cargo, the
  passengers, the Harrow and the three wrecks. Nothing overlapped.
- Not done: the links' reach and the computers that need them (step 6), the story asking about parts or giving them
  (step 7), the Story board for wrecks and dealers, the Harrow on air bottles, and a wreck to walk through. The owner
  hasn't tried it.

## Step 6, more computers (built 2026-11-13, at "Yes, step 6")

- From the design page's More computers tab (eleven kinds of computer, four playable: the Brig's door panel, junction
  box JB-3's service menu, passage camera D2-04, NAVCOM 7 on the bridge) and the plan's pick "NAVCOM 7 for the ship's
  main system and the Navy's computers; Keelworks for the rest". `src/devices.js` (new) has the looks, what reaches
  them, and the four's rules; a session keeps its `look` (`lookOf`: a file's `look` line, a door line, else keelworks).
- **Reach:** `LOOKS` gives each look a link (keelworks cable, door optic, service clip, camera radio, navcom navy), and
  a computer file's `reached by` line can say otherwise (`reachOf`; both lines are new in `COMPUTER` in
  public/world-text.js, after flavor, and the how-to). `rigLinks` reads the fitted links that work; `reachWhy` says
  why not. `cantRun` refuses every rig program without reach ("your rig can't reach it: it takes an optical reader,
  and your rig has a cable jack"), `copyProgram` refuses copying, and the copies list says why. Using a computer by
  right or with a password needs no rig; a junction box and a camera can only be opened through it. Haven's market now
  sells an optical reader, so a new captain can reach a door's panel without Engineering 3 (my call).
- **The watcher by look** (`watcherOf` in src/computers.js, used by act, thrownOut and the rig's lines): DoorCtl, The
  fault board, The security desk, SENTRY; AuditGuard on Keelworks. Same marks and mechanics by class. A look's own
  greeting lines (`LOOKS[look].how`) and its leaving button (Unclip, Exit, Switch off the radio, Log off).
- **A door's panel** (look door; generic door panels and written computers with a door line): an LCD of two lines (the
  room, and LOCKED, ENTER CODE, OPEN, NEW CODE, or DOORCTL 2.1 / ADMIN LOCK once SCOPE has read it), a decorative
  keypad and card slot whose light is green when the door's open; the logon's ways under it. Inside, for a door the
  place's systems run: Open/Lock the door, and **Give the door a new code** (`setDoor(..., { recode: true })`: locked,
  `recoded`, no `backAt`, so nobody of the place switches it back; `game.passwords[content.id]` so the player gets
  straight back in; unlocking clears `recoded`). The design's "read the panel with your reader" is SCOPE's line; the
  design's morning log read and its consequences are the shared watcher.
- **A junction box's service menu** (look service, content `serviceContent`, class easy, "Junction box JB-n"): opened
  from the box's window/menu (**Open its service menu**, `addPartActs`) with a service clip. MENU, STATUS, BREAKERS,
  LOG, CLEAR LOG, EXIT on an amber screen; BREAKERS toggles one room's feed (`cutFeed` in src/systems.js: `state.cut`,
  honoured by `roomPowered`, put back by the place's people at `backAt` like any switch at a place that isn't yours,
  kept by `tidy`); each toggle is 2 noise on the fault board (my number: three of them notices at a door panel's
  marks, the design's "a tech comes at 3 faults" is the trace). CLEAR LOG needs CLEANER loaded or the password, and
  takes 2 noise off.
- **A camera's feed** (look camera, `cameraContent`, "Camera Dn-NN"): **Tap its feed** on the camera, or **Tap the
  camera in ... by radio** under You can for a camera in a room through a door of this one (a short radio's reach). The
  picture: the room, the time, figures and names for whoever is in it (`peopleInRoom` from `peopleAboard`, and
  "you" when the player is there). **Loop the last minute** (`loopCamera`: `loopUntil` and `frozen` on the part's
  state for 10 minutes; `watched()` ignores a looped camera, so the law, tampering and taking the ship apart don't
  count it; 3 noise if anyone was in the picture), **Blind it** (switched off, 3 noise), **Back to live**. The design's
  pan between views wasn't built: each camera sees one room.
- **NAVCOM 7** (look navcom): the plot table's file is `class: hard` (a ship's main system), `look: navcom`, `reached
  by: navy`. The Keelworks desktop in the Navy's colours (`.os.navcom`), a red RESTRICTED · CFS MERIDIAN · NAVCOM 7 bar
  with SENTRY's meter when it listens, NAVCOM's menu name, smaller icons, and two folders: **Ship's log** (the last 12
  lines of `game.ship.log`, each with Strike: `nav-strike:<i>` removes it, `game.rig.struck` counts, 2 noise, and on
  the captain's own system the first officer remembers -2, "saw a line struck from the ship's log under your name")
  and **Crew** (the first officer's assessments: each officer's loyalty from `loyaltyOf` and a few words). The design's
  Accounts (moving 100 credits) and Navigation (plotting a jump) apps weren't built; Voss's code from the medbay and
  SKELETON on the maintenance account are the general logon. Copying GHOST and WORM off the plot table now needs the
  Navy coupler (the Pale Wren's bridge, Engineering 4): a call to mention.
- Screens drawn by `deviceWindow` in public/computer.js (doorPlate, serviceScreen, cameraPicture, waysNode, actsNode;
  styles at the end of public/desktop.css); a device's message and the advisor sit with it.
- Tests: `test/devices.test.js` (7). `test/logon.test.js`, `test/rig.test.js` and `test/systems.test.js` fit the link
  their computer now takes (an optical reader for door panels, a Navy coupler for the plot table).
- Screens on a test copy: at 1400, the service menu on its breakers (switching the Aft Holds back on by clicking), the
  camera's picture and the loop (the room's "A camera's watching" line went), the Hook door panel's logon and inside,
  NAVCOM 7 with its icons and the crew assessments; at 810, the Hook panel inside with a new code given, the Keel
  Passage's two radio taps, and the Engineering camera by radio with the player out of its picture.
- Not done: the eleven computers' other seven (the deck 2 security terminal, the quartermaster's ledger, Kessara's
  ledger, Haven's registry, a Navy relay, the Pale Wren's dead bridge computer: "later" on the plan), a camera in the
  Main Passage (the plan's try-it: for the captain the Armory is theirs anyway), pan, Accounts and Navigation, and the
  story knowing (step 7). The owner hasn't tried it.

## The ship's network: decided and planned (2026-11-13, after step 6)

- They asked: "To push this further, all of the systems in the ship should be connected in the network sessions in the
  computer. The vulnerabilies of different computer lies in other part of the networks and some computer cannot be
  hacked locally but we must go from another part of the networks", and to be shown examples.
- Three playable readings on https://claude.ai/artifact/Vf4pZfHUVhXXnaSkwysKf4 (source in my scratchpad only), all on
  one map of the Meridian's network (three deck bands; terminals, door panels, junction boxes, cameras, the comms
  relay, NAVCOM 7, the reactor's safety controller; the data network and the maintenance bus): **A**, one map, many
  routes (open the Armory from the Long Mess: through the security desk is short and caught, through JB-2 on the bus
  is quiet but you walk there and plug in); **B**, the weak point lives elsewhere (Brandt's open breakfast session
  into her ledger, the cameras' old cam/cam account into the security desk's mail, the Armory code there); **C**,
  sealed from the front (NAVCOM 7's crew file opens only from Voss's terminal: the comms relay gets navigation only;
  the medbay records, which her terminal trusts, then her idle session, then NAVCOM as her). My pick: all three as
  layers in that order. They said **"All three, layered"**.
- The hacking plan page (https://claude.ai/artifact/BFxFQGccmF8xjFWQeoY658, version 8) now has ten steps: 7 the ship's
  network (the Network folder as a map of the place's network, moving along it, joining from any port), 8 weak points
  elsewhere, 9 sealed systems and trust, and 10 the story knows (moved from 7, now also seeing the network), with
  seven more choices and my picks: the map in any computer's Network folder; every place with systems, worked out
  from its systems file, the Meridian's by hand first; the captain passes through the Meridian's own systems freely
  except sealed ones and private terminals; plugging in at a box or camera can be seen; a hop is two minutes and a
  point of noise at each end; NAVCOM's crew file sealed to the first officer's terminal (it's open to the captain
  since step 6); weak points by hand for the Meridian's key systems and from patterns for the rest.
- Build only the step they name.

## Step 7, the ship's network (built 2026-11-13, at "Yes, step 7")

- "Yes, step 7" took the seven picks on the plan page. Of them, step 7 uses: the map in any computer's Network folder;
  every place with systems gets a network worked out from its systems file (the Meridian's with a link by hand); the
  captain goes through the Meridian's own systems freely; plugging in at a box or a camera can be seen; a hop is two
  minutes and a point of noise at each end. The crew file sealed to the first officer's terminal and the weak points
  are steps 9 and 8.
- **The network** is `src/network.js`. `networkOf(place)` is worked out once per systems model (a WeakMap): nodes are
  the written computers (`c:<id>`), consoles, junction boxes, cameras and the relay (`part:<id>`), the door panels of
  the doors a computer runs (`door:<room>`) and things used as terminals (`t:<level:thing>`), each with its room, its
  deck band and its place fore to aft. Links: the **data network** from each computer to what it runs (its door
  panels, cameras, the relay, and the junction boxes when it runs power) and between written computers that name each
  other; the **maintenance bus** along the junction boxes by band and position, and from each box to the door panels
  and the relay in the rooms it feeds; and a systems file's new **Network** part, "A to B[, bus]" by the map's names or
  by kind and room (`public/systems-text.js` reads and writes it; `world/systems/meridian.txt` has "the records
  terminal to the plot table"; the how-to has THE NETWORK). A line naming nothing is a checker problem.
  `nodeOfSession` says where an open session is on it.
- **A hop** (`hop`, through `computerCommand`'s `hop`): only to a node linked to where you are; the leaving session
  takes the action's noise and minutes (`act`, so a watcher can still cut you off there, and then you never arrive);
  if it holds, it's finished with a note, and the target opens through `openLogon` with `remote: true` and a point of
  noise. On the player's own systems that's straight in; anywhere else it's the logon with the rig's breakers. Over
  the network the rig is still plugged in where the player started, so `reachWhy` is skipped for a remote session
  (`src/rig.js`, the copies too) and the view's `reach.ok` is true.
- **Plugging in seen:** `openDevice` in `src/devices.js` asks `whoSees` (src/law.js) when the part isn't the player's
  and is in their room, and `seenTampering` (new in `src/systems.js`) gives the line, the standing and the
  `seen_tampering_at_<place>` fact.
- **The map:** `networkView` sends the bands, the nodes with their order in their band (`i`), what's linked to here,
  what's been visited and the links. `public/net-layout.js` (new, pure, tested) lays it out: a band per deck, the
  boxes spread across it from half a box in on each side, and a crowded deck staggered over as many rows as keep two
  boxes on one row apart (100 by 36 at most; names clamp at two lines, the full name in the tooltip). The page
  (`netMapNode` in `public/computer.js`) draws the bands, the links behind (data solid blue, bus dashed amber, the
  ones from here bolder) and the boxes: here outlined green, linked ones in dark type with a blue outline and
  clickable, the rest greyed by the desktop's disabled look with a light fade. The Network folder's window is sized to
  the map (`netWindow`); a door panel, a junction box or a camera has **The network** under its face. A hop keeps the
  map open on the next system, desktop or face.
- **Found and fixed while checking the screens:** boxes overlapped on decks of six (the layout moved to
  `public/net-layout.js`, with a test that no two touch at the Meridian, at Haven or on a deck of thirty); a redraw
  made a new monitor glass that stayed unscaled until measured, so a click straight after a redraw could land a row
  off in the hidden test pane (the last scale is now carried over, `lastScale`); the map toggle stayed on into the
  next, unrelated session (`showNet` resets); the news lines at the top left ran under the window after a hop (they
  hide while a computer is open, as they do for the inventory and the log pages, `body:has(#computer) .pop-notes`).
- Tests: `test/network.test.js` (6): the Meridian's 16 nodes and their links, the Network part round trip, hopping
  aboard (two minutes, straight in, linked only, on along the bus to a junction box's menu), Haven (a logon, heard on
  arrival, the rig's link irrelevant, cut off before arriving), the map laid out apart, and plugging in seen at Haven's
  docks.
- Screens on a test copy: at 1400, the records terminal's Network folder (the whole map, no scroll bars), a hop to the
  plot table (NAVCOM, the map kept), on to the comms relay (its face, The network) and JB-3 (the map kept); at 810,
  JB-3's face with the map, the records terminal's folder, Haven's berth board (one band of eleven in four staggered
  rows) and the hop to the harbor master's machine, arriving at its logon. Two things about the test pane, not the
  game: a click by reference scrolls `.game` sideways first (the closed menu drawer makes it scrollable), and a
  screenshot can show the frame before.
- Not done: weak points elsewhere (step 8), sealed systems and trust (step 9), the story knowing (step 10); going back
  along the network from a logon you haven't got past (log off instead); the Story board keeps a Network part as
  written but doesn't draw it. The owner hasn't tried it.

## A change asked after step 7: the rig's map beside a panel (examples shown 2026-11-13, not built)

- They said: "Before continuing, a little modification, the network map should appear on a computer but if it's a
  keypad, door, alarm control, etc. The network map should appear beside it on windows of your rig, show me examples
  before implementing".
- Three examples on https://claude.ai/artifact/BPcqWZnXpN8DpeYNiiutD5 (source in my scratchpad only), each in a scaled
  copy of the game screen at 1400 or 810 wide, starting from the Bridge door's keypad, JB-3 or Camera D3-02, with the
  Meridian's real map and hops that work: **A**, a window of the rig's in the game's green glued to the panel's side
  (the map only; it folds to a strip); **B**, the rig as a pocket computer beside the panel (YARD BOARD · PLAIN CASE,
  link and heat lights), wired to it by how it's plugged in (a clip lead, the optical reader's beam, radio arcs), its
  screen with NET (the map), D: (the loaded programs, moved out of the panel's window) and LOG; **C**, the rig's own
  Keelworks windows (Network, Programs, Log) beside the panel with a strip to open and close them. My pick: B. In all
  three a computer keeps the map in its Network folder and the panel's window loses its The network button. The game
  has no alarm panel (the alarm is run from computers and speakers); one added later would get the rig the same way.
- Build only what they pick.

## The rig beside a panel, built (2026-11-13, at "Do the pocket computer")

- They picked B. A door's panel, a junction box or a camera (`PANEL_LOOKS`, in `src/devices.js` and on the page) now
  opens as two things side by side in the floating window: the panel's own window (its face, its buttons, its last
  log lines and its leave button; no map and no breakers any more) and the rig as a pocket computer (`pocketNode` in
  `public/computer.js`), joined by a lead drawn by the link (`LEADS`: a clip lead, the optical reader's red beam,
  radio arcs, a cable, the Navy coupler, and a dashed blue line over the network; nothing when it isn't plugged in).
- The rig shows its board and casing by name (`rigFace` in `src/rig.js`, sent as the view's `rigFace` for panels), a
  LINK light (green plugged in, blue over the network, dark not plugged in) and a HEAT light from `rigHeat` (dark on
  the player's own systems, green, amber with the fan, blinking red overheating). Its screen has NET (the network map,
  in the rig's green; a note instead when it isn't plugged in, at a logon, or off the network), D: (at a logon the
  ways in, `logon.ways`; inside, the loaded programs, `rig.loaded`, each with why it won't run; RUN or READ) and LOG
  (the session's last 14 lines). It opens on D: at a logon and on NET inside, and turns to NET when the logon gives way
  (`comp.rigTab`, reset when the locked state changes or the session does). The bottom says the blocks used and the
  minutes a hop. A click on a map sets `comp.hopping`, so a desktop reached from the rig's map (or a folder's) opens
  its Network folder; the old `showNet` toggle and `waysNode` are gone.
- **A rule that came with it:** going on from a panel needs the rig plugged into it (`hop` in `src/network.js` gets
  the leaving content; a panel session that isn't remote and whose link the rig lacks is refused with the reason, and
  no time passes). Remote sessions still skip the link. Desktops don't need it, since the map there is the computer's.
- Layout: the panel, the lead and the rig sit in one row that never wraps (`.device-row`); the hints go beside them
  where there's room and under them where there isn't. Beside a panel the page measures the room on the game's box
  (`pocketRoom`, where `--rail-width` is set): under 960 px the panel's window is 300 wide and the lead 26, else 380 and
  56, and the map takes the rest between 300 and 440 (`pocketMapWidth`); the window is drawn again when the screen
  changes size. A panel's log keeps 10em now, since at 300 wide its lines wrap more.
- Found while checking: the map's boxes near the right edge were squeezed by the browser to the room left of the edge
  and their names wrapped and clipped ("Hot Bunks…", in the Network folder too); `width: max-content` on the node fixes
  it. The rig's width variable lives on `.game`, not the page's root.
- Tests: `test/network.test.js` gained one (7): the captain's own Bridge door panel by right carries the rig's face,
  a hop from it without an optical reader is refused with no time passing, and with one fitted it goes to the plot
  table, whose view has no rig face. 1,147 tests pass.
- Screens on a test copy at 1400 and 810 wide (and 1000 and 1200 by resizing): JB-3 with a service clip (NET, D:, LOG,
  a hop to the comms relay over the network, then to the plot table, which opened NAVCOM 7 with its Network folder),
  the Bridge door with no optical reader (not plugged in, no lead), and Haven's docks camera by radio at its logon
  (D: first, DICTIONARY and SCOPE). Not tried: an overheating rig's red light, and a rig that won't start.
- Not done: the casing's look following the build (a shielded case darker, an open frame showing its board), which the
  examples page said could come later. The owner hasn't tried it.

## The rig at a computer too (example shown 2026-11-13, not built)

- They said: "For it for the computer too, the networks, the programs and the logs are gonna be there. You cannot
  hack a computer a computer with your rig and you have to connect it before starting to hack. Show me the computer
  one and integrate the rest that you did before". Read as: the pocket computer comes out at every computer too,
  with NET, D: and LOG on it; hacking needs the rig connected first; show the computer version, with the panels fitted
  to the same rule.
- The example is https://claude.ai/artifact/59oKwP59cJaTkgcyvkrkj1 (source in my scratchpad only): a scaled copy of
  the game screen at 1400 or 810 wide, starting at Haven's berth board (someone else's, locked), the records terminal,
  the Bridge door's keypad or JB-3 (all the captain's), with a choice of the link in the rig. The Keelworks desktop
  keeps Systems, Files, Mail, Logs, Programs and the viewer, and loses its Network folder, Rig (D:) folder and Session
  log window; the logon loses its "From your rig" list and says whether a rig is on its cable port. The rig starts
  NOT CONNECTED with CONNECT BY <link> (a minute; at someone else's machine anyone in the room can see), greyed with the
  reason for a wrong link; once plugged in its lead shows (a grey-sheathed cable for a desk) and D: offers the ways
  in. A keypad works by hand and connects to be hacked; a junction box or a camera connects as it opens. At 1400 the
  monitor is 660 wide beside the rig; at 810 the rig folds to a strip down the monitor's side (LINK, HEAT, NET, D:,
  LOG, PLUG IN) and a page slides out over the monitor.
- Calls of mine on the page: the strip at narrow screens; "the logs" as the session's log (the computer's own Logs
  folder stays); NAVCOM 7's map needing the Navy coupler even for the captain; unplugging to swap a link. Build only
  when they say so.

## The rig at a computer too, built (2026-11-13, at "Build it as shown")

- **Server.** A session keeps `plugged`: false when it opens, true from the start for a hack that already got in
  (`hacked`) and for practice, and `rigMinutes`, the minutes the rig has worked there. `plugIn` in
  `src/devices.js` (the `plug` order, allowed at a logon) plugs the rig in by the link the computer takes, taking
  `PLUG_MINUTES` (1) through `act`; it's refused over the network ("plugged in where you started"), when connected
  already, and with the reason when the link doesn't fit; at someone else's place, where `playerSpot` is, `whoSees`
  decides whether it's seen (`seenTampering`: the line, the standing, `seen_tampering_at_<place>`). `unplugRig`
  (`unplug`) takes it off, except at a junction box or a camera (`THROUGH_RIG`), which `openDevice` plugs into as it
  opens. `cantRun`, `copyProgram` and the copies' reasons in `rigInComputer` need the rig plugged in or the session
  remote ("your rig isn't connected", or the link's reason when it doesn't fit), and so does `hop` from any look
  ("Your rig isn't connected, so it can't go on from here"). `act` works the rig (speed, quiet, the fan, overheating)
  only while it's plugged in or remote, and heat comes from `rigMinutes`; `rigHeat` in the view is null otherwise.
  The view's `reach` is `{ link, words, fits, why, plugged, remote, ok }` (ok = plugged or remote), every view has
  `rigFace`, and the logon's line in the session log says to connect first. The advisor's logon hints say "Connect your
  rig first" (or why it can't) and weigh each way by `whyIn`, its reason once plugged in.
- **Page.** The desktop loses the Network folder, the Rig (D:) folder and the Session log window (and `netWindow`,
  `rigHeatNode`, the hop-to-folder logic `hopping`; the welcome text no longer counts a network). The logon has a
  `logon-rig` line in place of its list. `windowNode` puts every computer in a `.desk.computer` row with the rig:
  `computerLayout` puts them side by side when the room keeps the monitor at 600 or more beside the rig at its
  narrowest (the monitor up to 696, the map up to 440), else the rig folds to `stripNode` down the monitor's side
  (LINK, HEAT, NET, D:, LOG, PLUG IN) and a page slides out over the monitor (`.rig-slide`, `comp.rigSlide`, kept open
  across a hop to a remote system, with a round close button). `pocketNode(view, width, { closeable })` is shared with
  the panels: `plugPage` (NOT CONNECTED, CONNECT BY <link>, a minute and the warning, or the reason), UNPLUG at the
  foot, and a dot on LOG when lines arrived since it was last looked at (`comp.logSeen`). The monitor's width is
  inline, `min(<px>, calc((100vh - 16em) * 1.3))`; the hints go under the row. The window is drawn again on any
  resize while a computer is open. `pocketRoom` falls back to the stylesheet's rule (the rail above 860 wide) when
  the game's box isn't on the page yet, which is how the first drawing had sized the monitor for no rail.
- **Tests.** `test/network.test.js` gained one (8 in all): Haven's berth board waits for Connect, the advisor says so,
  plugging in at the busy docks is seen, takes a minute and warms nothing yet, Unplug takes it off, and a junction box
  connects as it opens and can't be unplugged. Tests that hack, run, copy or hop now connect first (the logon and rig
  helpers start plugged in). 1,148 tests pass.
- **Screens** on a test copy at 1400 and 810 wide: Haven's berth board (CONNECT seen by Mott, DICTIONARY from D:, the
  desktop without the removed folders, NET), the folded strip and its slide-out with a hop to the harbor master's
  logon, the Bridge door's keypad by optical reader, and the records terminal with its cable.
- Not done: the casing's look following the build. The owner hasn't tried it.

## Three seconds to connect (examples shown 2026-11-13, not built)

- They said: "Add a small loading screen for you connect you rig, like 3 seconds. Show me a few examples of what it
  could look like, 6-7 examples".
- Seven playable examples on https://claude.ai/artifact/8HLSA11GoqmNJeShfXWDom (source in my scratchpad only), each the
  rig beside a sliver of a computer, three seconds of connecting on its screen with the cable in and LINK blinking
  amber, then the connected rig on D:: **1 Handshake** (the port, the speed, the handshake and D: typed out line by
  line; my pick), **2 Progress bar** (twenty segments and a percent), **3 Port sweep** (a radar finds the port and
  locks), **4 The cable goes in** (the lead draws itself and seats with a spark while the screen ticks off steps),
  **5 Carrier tone** (oscilloscope noise settling into a clean wave), **6 The rig wakes up** (a boot: BIOS, a memory
  count, the link, D:), **7 Pins seat** (the port's twelve pins lighting one by one). Clicking the screen skips any of
  them. In the game the words would follow the link (OPTICAL READER, NAVY COUPLER), a junction box or a camera would
  play it as it opens, and on the folded strip its LINK light would blink for the three seconds.
- Build only what they pick.
- **Built: number 6, "Do the rig wakes up"** (2026-11-13), untried by them. Page only (`public/computer.js`): `plug`
  calls `startBoot` (`comp.boot = { at, id }`) as it sends the order; while `booting()` (3 seconds, `BOOT_MS`) the
  pocket's page is `bootPage` (`#rig-boot`, refreshed every 100 ms by `bootLines`: the board's name and BIOS 2.1, the
  maker (Halden Yards, or the Naval Arsenal for a Navy board), MEMORY counting to the rig's blocks, LINK: <link> OK,
  D: MOUNTED, READY, and a blinking cursor) and LINK is `.lamp.busy`, amber and blinking; then it draws the connected
  rig. A click on the screen skips it; `sync` starts it for a junction box or a camera that opened plugged and stops
  it when a plug comes back refused; `resetComputer` clears it. On the folded strip only LINK blinks unless a page is
  out. Checked at 1400 wide on a test copy (Haven's berth board).

## Step 8, weak points elsewhere (built 2026-11-13, untried)

- Asked as "Do the rig wakes up and start the next step". The plan page's step 8: hardened systems where no breaker
  works from the front, each with a weak point written into another system, found by reading, marked on the map.
- **The rules** (`src/weak-points.js`): a hardened computer refuses every breaker (`weakWay` from `cantRun`) except
  KNOCK once its service account on the bus is known, and SHADOW once its open session is known and it's within the
  session's hours; those two skip the power and working-hours checks. A password found is an ordinary password
  (`game.passwords[id] = "found"`), so `openLogon` lets the player straight in, from the room or over the network.
  What's known is `game.weak[id][kind] = { from, hours }` (no save version: missing means nothing known).
- **Where they're written:** a computer file's `hardened: yes` and `Weak points:` lines (`readWeakLine`), or
  `, hardened` on a console line of a systems file. With none written, `madeUp` picks one of three patterns by a hash
  of the id: a note.txt password on another unhardened written computer at the place, a session 06:00 to 08:00 in that
  computer's logs, or a maint/maint service account on the bus. With nowhere to put one, the computer isn't hardened
  (`hardenedAt` leaves it out) and `npm run check-story` says so. The checker also names a line it can't read, a
  computer that isn't there, one at another place, the computer itself, and weak points on a computer that isn't
  hardened.
- **Finding them:** `contentOf` in `src/computers.js` adds the items another computer holds (`withWeakPoints`;
  the content isn't changed, the items carry `reveals`); `openFile`, `openMail`, `openLog` and DIGGER call
  `weakFound`; a junction box's service view lists `busWeakPoints` as SVC lines until its log is cleared, and
  opening 3 LOG learns them.
- **On screen:** the logon's HARDENED line (what's known, or that its way in is written somewhere else here), each
  breaker's reason on the D: page, the advisor's `hardenedHints` (tier 1 says to look on the other computers and the
  junction boxes' log, tier 3 names where), Scope's own line, and on the map a dashed amber box with `TERM · HARD`,
  then `TERM · WAY IN` in green.
- **Content:** `haven_harbor_office` hardened, with a letter from the harbor master to Mott (BRINEWATER) and a log of
  his session left open 06:00 to 08:00 on the berth board, and `SERVICE ACCT harbor/harbor STILL OPENS THE HARBOR
  OFFICE` on the junction boxes. Haven's watch console in The Neutral Ground hardened in `world/systems/haven.txt`,
  its way in made up (a note on the berth board with the word BULKHEAD).
- **Calls of mine:** the pick of hand-written weak points for the Meridian's key systems (the security desk, the
  ledger, Voss's terminal, the Armory) waits for step 9: as the captain, the only life offered, every Meridian system
  is the player's own and opens by right, and those private terminals come with the sealed systems. A hack a scene
  asks for without naming a computer (`computerForPlace`) never lands on a hardened one, which the logon test caught.
- **Fixed on the way:** opening any letter showed the list of letters again (`screenNode` in `public/computer.js`
  treated every `mail` screen as the list); a letter with its id now shows its words, like a file. Older than this
  step, so a letter has never been readable on screen since the Keelworks screen.
- **Tests:** `test/weak-points.test.js` (8: the line's grammar and the file round trip, the office refusing every
  breaker, the letter's password, the session's hours, the bus's account and KNOCK, the made-up console, a scene's
  hack avoiding hardened ones, the checker), 1,156 in all, `check-story` clean.
- **Screens** on a test copy at 1400 and 810 wide: the berth board's three letters, the opened letter, the log line
  and the map turning to WAY IN, the hop straight in over the network; the office's logon with HARDENED, its D: page
  and the advisor; a junction box's 3 LOG with the service account; the folded strip's slide-outs at 810.

## Step 9, sealed systems (built 2026-11-13, untried)

- Asked as "Step 9". The plan page's step 9: a few systems take nothing at their own keyboard and let in only the
  machines they trust, what you can do inside set by the machine you came through; NAVCOM 7's crew file from the
  first officer's terminal, the Armory's panel only from the security desk, the reactor's safety controller from the
  reactor gauges, navigation from the comms relay. With it, the step-8 pick that waited: hand-written weak points for
  the Meridian's private terminals (the security desk, the ledger, Voss's terminal), and "Your own ship: freely, except
  the sealed ones and private terminals".
- **The rules** (`src/sealed.js`): `sealed: yes` and `Trusts:` lines in a computer's file (`COMPUTER` in
  `public/world-text.js`). A sealed computer refuses its own keyboard everywhere (`useComputer`, `openDoorPanel`,
  `openLogon`, `computerForPlace`, a door's actions and look through `tellSealed`), and `hop` refuses it from an
  untrusted node before any time passes. From a trusted node `openLogon` (with `from` and `fromName`) opens it
  straight in: `session.trusted` is what the line gives, `session.rights` what the session may do (the line's
  rights on a sealed computer, or on one that isn't the player's and whose password isn't known; null otherwise).
  `contentOf` applies `withRights`; a door panel needs the door; a part a line names (the crew file) is kept to
  that machine on any computer (`partOpen`). A sealed door panel's door drops out of other computers' door rows
  (`without`, from `controlsFor`).
- **Things for written computers** (`src/terminals.js`): a written computer whose thing isn't drawn in its room has
  the game stand one there on a free square (`computer: id`), so a file alone puts a terminal aboard.
- **On screen:** `through` on the first screen ("Reached through the security desk, which it trusts: from there it
  lets you work the door."), a log line saying the same, the map's `sealed`/`trusted` nodes (double red box,
  SEALED, TRUSTED in green, a tooltip naming what it answers to), and NAVCOM's Crew folder as `Crew (sealed)` with
  "Sealed: it opens only from the first officer's terminal." (an empty folder was hidden, so it never showed).
- **Content (my drafts):** `meridian_first_officer` (Chart Room; first tried in the Officers' Cabins, which had no
  free square), `meridian_security_desk` (Aft Holds, the chief of security's post room), `meridian_ledger` (Long
  Mess, the quartermaster's), all moderate, private and hardened with written weak points; `meridian_armory_panel`,
  `meridian_reactor_safety` and `meridian_nav_core`, sealed; the plot table trusts Voss's terminal with the crew
  file. The systems file has a door to The Armory, the plot table's line without navigation, and two Network lines
  (the security desk to the Armory's door, the navigation core to the comms relay).
- **Power:** the navigation core first had a systems line of its own for its navigation control. The loads count each
  computer line ("computers 2 each"), so at rest 82 against 100 and under way 112: cameras and comms let go weren't
  enough and the lights would have gone everywhere during every jump. The core works through two programs instead
  (Lock and Unlock the navigation, trusted to the relay), and the power is as it was.
- **Calls of mine:** the Armory starts unlocked and holds nothing yet; the private terminals' owners are written by
  name, not by post; plugging in aboard the captain's own ship was never seen as tampering, so the words that said
  it would be now follow `plugSeen` (`reach.seen` for the rig's page).
- **Tests:** `test/sealed.test.js` (7: the trust line and the files, the seal from the keyboard and from an untrusted
  hop, rights by where you came from (the core from the table and from the relay, the safety controller's scram), the
  crew file, the private terminals and their weak points, the Armory through the security desk, the checker); six
  older tests changed for the new content; 1,163 in all, `check-story` clean.
- **Screens** on a test copy at 1400 and 810 wide: the first officer's terminal stood in the Chart Room and its
  logon; the plot table over the network with the map's marks and the Crew folder sealed; the plot table reached from
  Voss's terminal with the crew file open and the line on its first screen; the Armory's panel from the security desk,
  locked from there; the folded rig's map at 810.

## Step 10, the story knows (built 2026-11-13, untried)

- Asked as "Yed, step 10". The plan page's step 10: scenes and people's asks that can ask what's on the rig, give
  parts and programs, react to what the player did (a door recoded, a camera looped, a log line struck, a system got
  into over the network), plant a weak point or seal a system; the checker checks it all; the Story board gets pages
  for programs, parts and the new computers.
- **The words** (`src/story-rig.js`, read through `src/scene-text.js`): conditions `rig program|loaded|part|link|
  tool`, `computer <id> in|hacked|network|trusted|sealed|password`, `recoded <room> [at <place>]`; effects `* rig
  program|part|tool`, `* weak <computer> password|service|session [hours]`, `* seal`, `* unseal`, played through
  `storyCommand` so scenes, talks and asks share them. The checker names an unknown program, part, tool, link,
  computer or state, a session's hours on anything but a session, and a missing reason.
- **The record:** `noteGotIn` (from `openSession` past a logon, and `gotIn`) keeps `in`, `hacked`, `network`,
  `trusted` on `game.computers[id]` and puts `got_into_<id>` on the record for a written computer that isn't
  the player's; the devices add `recoded_<place>_<room>`, `looped_a_camera_at_<place>`,
  `blinded_a_camera_at_<place>` and `struck_from_the_ships_log`. `factsLeft` knows them all (`hackFacts`), and
  the facts the written computers' programs leave (`computerFacts`), so a scene can wait on `navigation_locked`.
- **The seal at run time:** `game.sealed[id]` beats the file (`sealedNow`). The sealed doors' rows moved from
  `controlsFor` to `controlsView` (each control keeps its computer's `ref`; `doorBlocked` with the game), which
  also stops the Ship menu, with no ref, from working a sealed door, as it could since step 9.
- **Talks and asks** can switch a system and hand over a password now (`playWorldStep` in `src/talks.js`, and
  `playSteps` in `src/requests.js`); a systems line in a talk used to stop it with an error.
- **Content (my drafts, marked):** Sorel's talk: "Ask him about your rig" (a cable jack or a short radio, and MAPPER
  if the rig hasn't got it) and "Ask whether anyone noticed the ship's log" after a struck line;
  `request_navigation_locked`: the helm officer asks when the navigation's been locked from its core, and a yes
  unlocks it.
- **The Story board:** Programs and Rig parts pages (`PROGRAM`, `RIG_PART` in `public/world-text.js`; the board
  reads each folder by the spec, saves only what the game's own parser takes, and reads the folder again at once);
  each page has its about box (the spec's lines, kinds and places from lists), what it does or is, its numbers
  (read-only), a board's sockets, where a part comes from and what making it takes, and the computers a program is
  copied off and the market that sells it. A computer's page says hardened or sealed and has Weak points and Trusts
  boxes. Two part files had two lines reordered to read back exactly. The computer page's Logs box was a story clock
  box, whose buttons need a story; it's a plain box now.
- **Tests:** `test/story-rig.test.js` (7: the words and the checker, the rig asked and given, a way in planted and a
  computer sealed and opened, the record of deeds, Sorel's MAPPER and the helm officer's ask, the Ship menu and the
  Armory, the board's pages and a save into a copy); `test/board.test.js` for the two kinds; 1,170 in all.
- **Screens** on a test copy at 1400 and 810 wide: the board's picker, KNOCK and GHOST with its "found on", the about
  editor for a program, the yard board's sockets, the optical reader's recipe, the Armory panel's Trusts box.
- **All ten steps of the plan are built.**
