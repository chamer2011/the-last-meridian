# The hacking rework (2026-11-13): designed on example pages, planned, steps 1 to 5 built

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
