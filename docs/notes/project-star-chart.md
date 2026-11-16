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
