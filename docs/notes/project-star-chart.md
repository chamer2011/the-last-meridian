# The star map moves to the bridge (2026-11-16)

- Asked as "The StarMap should be open from the bridge from the allocated computer that only the captain can use, once
  it is, the menu at the right shouldn't have it anymore. The star map in the navigation computer should look like a
  computer program. Show me exemple of the program, and do a plan of the implementation." **Nothing is built:**
  examples and a plan only.
- **The page:** https://claude.ai/artifact/GS3orhijWbFziyK5eEttDQ ("Bridge Star Chart"; its source lives only there).
  Three working example programs on an old monitor, each with the eight places a new game has charted, the ship in
  open space at (45, 12) with 6 of 12 fuel, the game's own cost bands, and the whole run: pick a place, plot, confirm,
  jump, arrive. Two boxes under the screen show how the program reacts (the navigation core is down; someone else has
  the chair).
  - **A, a window on the Navy's desktop (my pick):** "Navplot", opened from a new Charts icon on the plot table's
    NAVCOM 7 desktop: menus (Chart, Course, View), a toolbar, the chart with range rings for 1 and 2 fuel, a Course box
    (Plot course, Clear, Engage jump...), a Destination panel, a status bar, a box that asks before a jump, and Ports
    and News views.
  - **B, a full-screen program:** "Astrogation 7.3", amber characters on black, the chart exactly as today's Star Map
    draws it (`chartArt`), with F-keys along the bottom that are clicked.
  - **C, the plot table's own display:** a green line display with range rings and bearing ticks round the ship, blips
    with leader lines, and big keys down the side.
- **Their answers live in the page's database** (ArtifactData, collection `plan`, document `state`: `look` a, b or c,
  `choices` by id, `steps` ticked, `at`). It was empty when published. **Read it before building anything: their
  clicks stand over a chat "your picks".**
- **The seven choices, with my picks:**
  - `look`: a (pick), b, c.
  - `where`, which computer on the bridge: `plot` the plot table (pick), `chair` a new console at the captain's chair,
    `helm` the helm's console.
  - `who`, who can order a jump: `chair` only whoever has the chair, anyone else who gets in reads the chart (pick),
    `anyone` who gets into the computer.
  - `after`, where the player is after a jump: `aboard` still on the bridge (pick), `ashore` put ashore at once, as
    today.
  - `boat`, where the boat leaves from: `boatbay` on deck 1 (pick), `lighter` on deck 3, `both`.
  - `dark`, when the bridge's computer has no power: `hand` the helm officer can still jump her by hand from a plain
    list of ports, a fuel more and half as long again (pick), `none` no jumps until it's mended.
  - `elsewhere`, the chart away from the bridge: `none` (pick), `read` a chart to read on the ship's other terminals,
    `menu` a small map to read stays in the menu.
- **The four steps, each after their test:**
  1. The chart program on the bridge, with today's data and rules; the old Star Map stays in the menu meanwhile, so
     there's still a way ashore.
  2. Staying aboard after a jump, and the ship's boat: an hour, as the shuttle hop is today, from the bay to the port
     and from where the player arrives at the port back; anything written for arriving plays when stepping ashore.
  3. The Star Map leaves the menu, and so does the Ship menu's **Open the star map** button; `/map` says where the
     chart is; passage for anyone who isn't the captain is booked at the ports; the README.
  4. The program knows the ship: plotted by hand when the navigation's down or locked, why Engage is refused when the
     engines are down or the clamps locked, a chart only without the chair, dark without power and then their `dark`
     choice.
  Later, only if asked: routes of several jumps, rumoured places, the boat ride as a scene.
- **What was found in the code first:**
  - The map is `public/map.js` (`mapMenu`, `chartArt`, `placeDetails`, `placeTable`, `shipOrder` to `POST /api/ship`
    with `course`), `setCourse` and `jumpCost` in `src/ship.js`, `travel` in `src/rules.js`. A captain's jump moves the
    ship **and puts the captain ashore** (`game.location = destination; game.walk = null`). The hop between the ship
    and the dock she's at is free and takes an hour (`jump: false`). Anyone who isn't the captain pays a fare for
    passage (`passageCost`), even from the ship in open space, which the plan ends: passage is booked at a port.
  - Cost: `jumpBand` by `Math.hypot(dx, dy * 2)`: up to 20 is one fuel, up to 40 two, further three; the hours are
    `jumpHours` (16 at Navigation 0) times 1, 1.5 or 2; `navigationDown` adds a fuel and half the time (`byHand`);
    `jumpBlocked` is the engines down or the docking clamps locked. A good navigator sometimes saves a fuel.
  - The plot table is `world/computers/meridian_plot_table.txt`: The Bridge, `class: hard`, `yours: yes`,
    `login: captain`, `look: navcom`, `reached by: navy`, with `berths` and `news` among its logs. Its "What the player
    sees" still speaks of forty-one dots and a chalk line, from the fleet's time: my draft, to reword at step 1 with
    their say.
  - After the opening battle the nav core is always broken until the engineers mend it, so a new game's first jumps
    are by hand. If the player went down in it, the bridge's junction box is broken too and the bridge is dark. A
    broken part takes a parts crate to mend, which is why `dark: none` could leave a ship in open space with no way
    out, and why `hand` is my pick.
  - Only the captain's top bar shows FUEL. The Ship menu has Wait 1 day and Wait 3 days, an **Open the star map**
    button, and trade lines that send the player to the star map.
- **Told to them as the costs:** being on the bridge to move the ship, a walk to the boat to go ashore, a dark bridge
  meaning a dark chart, no moving the ship from ashore or without the chair, and that nothing about travel itself
  (places, fuel, hours, danger, prices) or their saves changes.
- **Beside it:** the same day another session was building the logistics rework's step 7 (the ports' real amounts) and
  had `public/map.js`, `public/ship.js`, `public/menus.js` and `src/ship.js` changed and uncommitted. Whatever it adds
  to the Star Map's places has to be carried into the program's Ports list.
- **How the page was checked:** served on this computer inside the publisher's skeleton and looked at in the browser
  pane at 1400, 800 and 400 wide. Each example was plotted, confirmed, jumped and arrived; both boxes, the Ports and
  News views and the choices were clicked; no errors in the console and no sideways scroll. The page's database was
  listed once after publishing (empty). Saving a click couldn't be tried on this computer, since only the published
  page has the database.

## Their answers, and step 1 (2026-11-16)

- **What they clicked on the page** (`plan/state`, read before building): `where: plot`, `after: aboard`, `boat: boatbay`,
  `dark: hand`, `elsewhere: none`, all my picks, and `who: anyone`, which isn't: anyone who gets into the computer can
  order a jump. `look` was left unclicked; in chat they said "A, but with a loading screen upon opening the app and make
  it full screen on the computer window. Start step 1". `look: a` was then written to the page's database for them, so
  the page says what was built.
- **Step 1 is built, untried by them.** What they see: at the plot table, a **Charts** icon on NAVCOM 7's desktop (a
  click picks it, a second opens it, like the folders; it's in the NAVCOM menu too). A loading screen for three seconds
  (NAVPLOT 7, what it reads line by line, a bar; a click skips it), then Navplot over the whole screen under the red
  RESTRICTED bar: the chart, the Course box, the Destination panel, Ports, News, Everything it holds, the menus, the
  row along the bottom. Plot course, Engage jump..., a box that asks, the ship on her way for a moment, and then, for
  the captain, ashore where she arrived, as the Star Map's Set course does. The Star map menu is untouched.
- **How it's made:**
  - `charts: yes` in a computer's file (the `COMPUTER` spec in `public/world-text.js`, `charts` in `writtenContent`).
    Only the plot table has it. `navcomView` in `src/devices.js` adds `charts` to the view, and `deviceCommand` takes
    `nav-course:<place>`.
  - `src/charts.js`: `chartView` (for every place with a spot on the star map: `fuel`, `hours`, `here`, `why`; and
    `rings`, `byHand`, `blocked`, `ashore`), `mayChart` (a session a trusted machine let in for less than the
    computer's programs gets no chart), `engageFromChart`.
  - `src/ship.js`: `shipsJumpCost` (what a jump costs the ship, whoever asks; `jumpCost` uses it for the captain) and
    `logForShip`. `src/rules.js`: `jumpShip` (the jump itself, taken out of `travel`, with `ashore` and an `underWay`
    callback). `src/systems.js`: `jumpBlocked(game, { whoever })`.
  - `public/navplot.js` draws it from the game's own state (`game.locations`, `game.ship`, `game.world.news`) with the
    server's numbers laid over each place, and keeps what's picked in `comp.chart` while the computer is open.
    `public/computer.js` has the icon, `comp.app`, the loading timer, the layer (`programNode`) and Esc.
    `public/navplot.css` is linked from `public/index.html`.
- **Calls of mine, told to them:**
  - **The plot table is the captain's alone** (`theirOwn` in `src/computers.js`). Before, every computer marked
    `yours: yes` let any player straight in as its owner, a relieved captain included, which would have made "anyone
    who gets in" mean "anyone at all". Only the computer with the chart changed; the other four are as they were.
  - A jump ordered by someone who isn't in the chair: the ship goes with them aboard, her log says "Jumped to X on an
    order from the plot table that wasn't the chair's." (a line that can be struck, like any), it costs 3 noise, which
    SENTRY notices at once on a ship's main system, and nothing else: nobody remembers it against them and no alarm
    rings. Whoever has the chair goes on buying and moving her as before.
  - The loading screen plays every time the program is opened, three seconds, as their rig's wake-up does.
  - "Full screen" is the whole of the computer's screen under the RESTRICTED bar. The bar stays because SENTRY's meter
    is in it, and the taskbar is covered.
  - The captain's own computer closes without the usual "[COMPUTER] On The plot table: read nothing." after a jump.
- **The plot table's words, rewritten at their "Yes, rewrite it" the same day.** It had two descriptions, and both
  spoke of forty-one green dots: what's read looking at it in the room (the `look` of The plot table on
  `world/maps/meridian/deck1.tmj`, which also spoke of the Beacon's bearing) and its computer's "What the player
  sees", which is on its welcome screen. The room's now says "The Navy's chart, lit from under scratched glass: a mark
  for each place you know of, and one for the Meridian. A stub of chalk sits on the rim, for the days a course has to
  be plotted by hand." The computer's says "NAVCOM 7, the ship's main system, under the scratched glass of the plot
  table. It keeps the Navy's chart and the ship's log, and it's the captain's alone. Charts, on its desktop, opens the
  chart: every place you know of, the Meridian among them, and the course you plot drawn between." Both are my drafts,
  theirs to change. Nobody is named in them, since the helm can change hands. Left as they were, and told to them: the
  thing's `use` and `used` lines on the deck, which nothing shows since Use opens the computer, and the computer's two
  files (course.txt, fleet_manifest.txt), Voss's letter and its sensor sweep, which still speak of the fleet and the
  signal. The deck was changed by swapping that one line of its file, nothing else in it; the tests' kept copy of the
  ship still has the old words, which no test reads.
- **The computer's two files and Voss's letter, rewritten at their "Yes, rewrite them" after that.** `course.txt` now
  says "The course as the bridge keeps it: where the Meridian is, where she's bound next, and how many jumps of fuel
  are left in the tank. Whoever has the helm updates it when they remember, which is most days." `fleet_manifest.txt`
  is `manifest.txt` now: "The Meridian's manifest: what's in her stores and her holds, and the day each was last
  counted. Half the entries are in Voss's hand, and hers are the ones that are right." Voss's letter: "The list is on
  the table. What we're shortest of, and the day each of them runs out if nothing changes. I'd rather you read it than
  heard it from Fenn." All my drafts. Fenn (Garrick Fenn, the journalist) is kept, since the line doesn't lean on the
  fleet; nothing says what became of the fleet, which is theirs to write. A save that had read `fleet_manifest.txt`
  finds `manifest.txt` unread, and keeps the old words in What you know. `test/computers.test.js` opens the file by its
  new name. So the bullet above is out of date on these three: what's still left as it was is the thing's `use` and
  `used` lines on the deck, and the sensor sweep program, which speaks of the signal.
- **Not in step 1:** staying aboard after a jump and the boat (step 2); the menu's removal and passage at the ports
  (step 3); a dark bridge, the helm jumping her by hand, and saying why Engage is refused before it's pressed when the
  engines are down or the clamps locked (step 4; until then the refusal comes back as a line when Engage is pressed).
- **How it was checked:** `test/charts.test.js` (6 tests) and the whole suite, 1,380 passing, in a worktree at the
  commit before it. The screens with a headless Edge driven by a scratch script over the test copy on port 3313, at
  1400 by 900 and 810 by 700: the desktop with its icon, the loading screen, the chart, a place picked, the box that
  asks, a menu open, Ports, News, Everything it holds, the ship on her way, the captain ashore afterwards, and a
  relieved captain logged in with the password ordering a jump and staying at the chart with SENTRY's meter up. No
  errors on the page. The app's own browser pane wasn't on anyone's screen, so nothing was looked at there.
- **Working beside the other session:** its unfinished ports work had the game unable to load a save in the shared
  folder ("workLine is not defined"), so the files were moved to a worktree, the shared folder's copies put back, and
  the commit brought in with a fast-forward.
