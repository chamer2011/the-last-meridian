# project-hands-on

On 2026-11-11, after the ten health steps, the owner asked: "What would be the what to make the game more interactive with the systems already there and how to expand them/ possible new systems. Propose me 6-7 solutions". Seven were proposed, with two numbers from the game as it was (of 357 things in the rooms, 6 had a written result and 7 were stores; 14 of about 320 people had written talks): (1) do the crew's jobs yourself, (2) give every object a use, (3) ask people real questions and ask them to do things, (4) emergencies in the rooms, (5) what's yours and what isn't, (6) real trade, (7) salvage runs. My pick was 1 first, then 4. They answered, word for word: **"Do them all, plan each one of them and implement it"**. So all seven are built, in that order, each as a first version, without waiting for their test between them. Every rule and number below is mine and unconfirmed; none of it has been tried by them.

The rules that still hold for all of it: no AI, everything by clicking, nothing from another game, the fights as they are (no action points, grids or aimed shots), nothing from nothing where it can be helped, plain-text files with the checker for what the owner may want to rewrite, and the written stories' words left alone.

## How they plug in

`src/room-hooks.js` is a small registry the room's code (`src/walk.js`) asks: what can be done to this person (`addPersonActs`), what this thing does (`addThingActs`), what can be done in this room (`addRoomActs`), and the orders that carry those out (`addOrder`, reached through `/api/walk` like carry and give). The page (`public/walk.js`) shows whatever comes back: a person's `acts` in their window and right-click menu, a thing's `actions` in its Actions window, and the room's `acts` under **You can**. Each feature lives in its own file and registers itself; `src/walk.js` only imports the files.

## 1. The crew's jobs by hand (`src/hands.js`)

- **Work here.** In a room with a machine that needs someone (the galley, the garden), **You can** offers the work: "Cook a pot (1 hour)", "Tend the beds (2 hours)". The player already counted as its worker just by standing in the room; now it's an action that passes the time at work, says what came of it, practises the job's skill, and tires like work. It makes nothing from nothing: the machine runs one go with the player as its worker, at their skill's speed, and needs what it always needs (power, something to cook, room in the kettle).
- **Treat someone.** On someone hurt, **Treat** (their window and right-click menu): with a medkit, their worst wound a medkit can see to is dressed or splinted, the medkit is used up, twenty minutes go by and they remember it. In a medbay, on a patient waiting, **Treat them yourself** does the medbay's own treatment with its doses, in its minutes over the player's Medicine.
- **Piecework.** Crew aboard are paid by the piece for real work at their own job, a quarter of a shift's pay each, six pieces a day at most: a go at their job's machine, a repair by their own hands, a patient treated, a crate carried into a store an errand keeps up while it's under its mark. The eight-hour **shift** stays as it was for anyone who'd rather skip it.
- Left for later: helping to build a limb, standing a watch as a guard or an ensign, jobs at the other places.

## 2. A use for every object (`src/uses.js`, `world/uses.txt`)

- A thing does something by what it's called, from a plain-text list of uses and the words that mean each: **sleep** (bunk, bed, cot, hammock), **sit** (chair, bench, stool: wait an hour), **eat** (kettle, mess table: a sitting from the kettle while there's one, once a sitting, a little stress off), **wash or drink** (tap, basin, shower), **read** (board, notice, ledger, list: its words kept in What you know), **stash** (locker, chest, cabinet: a small grid of its own to leave things in), and **a quiet moment** (shrine, bell, instrument, game: stress off, once a day). A line in the file can name one thing at one place and give it a use, or none.
- A thing with a written result, an item to pick up, a computer, a store or a part keeps what it does; the use is added beside it.
- `npm run check-story` reads the file. Left for later: a Story board page for it, mending gear, the player's own hunger.

## 3. Questions and asks for everyone (`src/asks.js`, lines in `world/rooms.json`)

- Anyone without written lines answers a standard set of questions from what the game knows: what they do, how the work's going, where someone is (the officers, and whoever a quest of the player's waits on), what the talk aboard is, and how they are. The sentences are stock lines with the facts filled in, for the owner to rewrite.
- **Come with me**, on anyone's right-click menu and in a stock talk: they walk with the player, room to room and deck to deck, for two hours or until told **That's all**. They say no asleep, on an errand or a call, hurt, or thinking too little of the player (an officer's loyalty under 40, a stranger who isn't friendly); the captain's own crew and the player's own boss's people say yes. Someone with the player who has a fight of their own in their file fights beside them.
- **Go to the medbay**, to someone hurt and on their feet aboard: they go now, not in the morning.
- Left for later: carrying things for the player, help with checks, written talks gaining the same questions.

## 4. Emergencies in the rooms (`src/emergencies.js`, `world/emergencies.txt`)

- **Fire.** Starts now and then where there's heat (the galley, engineering, the generator), more often with something broken there, or when the story says. It grows by the quarter hour, burns whoever stays, uses up the room's air, breaks the parts in it, and spreads through doors that aren't shut. It's fought by hand (**Fight the fire**, a go at a time, quicker with skill, at the risk of a burn), starved by shutting the room's air off from a computer, or kept in by locking its doors; the place's engineers come by themselves and take longer. The alarm rings while it burns.
- **A breach.** A hull plate goes: the room's air drains, people leave it, and it's patched by hand or by the engineers with a parts crate.
- **A brawl.** On short rations with low morale, two people in the mess come to blows: the player can talk them down (a check), step in (a fight), or leave it to the guards; whoever's hurt is hurt.
- The picture shows it (a glow in the room, a tag in What's here), and the story says where. Left for later: fire off the Meridian, smoke, damage to stores.

## 5. What's yours and what isn't (`src/law.js`, `world/law/<place>.txt`)

- A place's file says whose each store and each restricted room is: posts and jobs, the captain always. Taking from a store that isn't the player's, or being in a room that's closed to them, matters only when it's **seen**: by someone awake in the room, or by a camera that works, with the lights on.
- Seen taking: what was taken is known, the witness remembers it, standing with the place's holder drops, and the guards come: aboard, the things go back and the player does a day in the brig for a second time in a week; at a port, a fine. Seen in a closed room: told to leave, and escorted out if they stay.
- Unseen, nothing happens. The dark, people's hours, and the cameras' power decide it. The captain aboard their own ship owns all of it.
- Left for later: a Stealth check to take things under someone's eyes, fences, disguises.

## 6. Real trade (`src/trade.js`, changes in `src/logistics.js` and `src/ship.js`)

- The shuttle stores stop filling from nothing. At a dock, they're restocked from the port, a crate at a time, paid from **the ship's purse** at the port's price, which takes it from what the port has; in open space nothing comes. A switch on the Ship menu holds the restocking.
- **The purse** is the ship's own money (the levy the chair already drew, 60 a day), for any captain, beside the player's own credits.
- **Cargo.** Each port offers contracts made from what the ports are short of: so many crates to another port by a day, for a fee paid on arrival into the purse. They ride in the cargo hold, which has only so much room.
- **Passengers.** People at a port pay passage to another: they eat at the sittings on the way.
- Left for later: haggling, smuggling and customs, trade for other lives than the captain's.

## 7. Salvage runs (`src/salvage.js`, a wreck as a place of its own)

- A dead ship off the Graveyard, reached by the shuttle from there: dark, airless, its doors jammed. The player's air is a suit's bottle, which runs down on the clock (Space still stops it), and their load is what they can carry.
- Power is brought back at a junction box to open a door, a console is hacked, lockers are opened and parts stripped with tools and time, and what's carried back to the shuttle comes home. Out of air, the shuttle crew haul the player out and what they carried is lost.
- Sometimes something's still aboard.
- Left for later: more wrecks, wrecks made up for each game, taking crew along to carry.

## Status

| # | What | State |
|---|------|-------|
| 0 | The plug-in points | built (`src/room-hooks.js`, and insertions in `src/walk.js`, `public/walk.js`, `server.js`, `src/rules.js`) |
| 1 | The crew's jobs by hand | built: `src/hands.js`, `treatByHand` and `treatableByHand` in `src/medbay.js`, `test/hands.test.js` (5 tests). Checked on a test copy at 1400 and 810 wide: Cook a pot under You can, its line in the story and the hour on the clock, Treat with your medkit on a hurt cook's right-click menu and what came of it. Not seen on screen: Treat them yourself in the medbay, and the piecework lines (the tests play both) |
| 2 | A use for every object | built: `src/uses.js`, `world/uses.txt`, `addMapWork` and `addChecker` in `src/room-hooks.js`, `test/uses.test.js` (7 tests). What changed from the plan: the things in the rooms turned out to be story props (the sack under a rack is somebody's, the warm bedrolls are people's homes), so the words are conservative, 24 things have a line of their own, and the Meridian's stash, basins, tea urn and quiet bench are things the file stands in the rooms. Eating aboard takes a real sitting out of the kettle. Checked on a test copy at 1400 and 810 wide: a mess table's right-click menu (Look, Eat here, no dead Use), the meal's line, the half hour and the stress, and the Sitting rota read with today's sittings. Not seen on screen: sleeping in the bunk, the footlocker's grid, the basins and the bench (the tests play them) |
| 3 | Questions and asks | planned |
| 4 | Emergencies | planned |
| 5 | What's yours | planned |
| 6 | Real trade | planned |
| 7 | Salvage runs | planned |

## Working notes

- Another session ("Walk-around prototype on the Meridian") had uncommitted bug fixes in fifteen shared files when this began, so every change of mine to a shared file is an insertion kept in a script (scratch: `inserts/*.cjs`, applied by `hands-shared.cjs`), which can also apply the same insertions to the last commit's version of a file, so that only my lines are staged.
