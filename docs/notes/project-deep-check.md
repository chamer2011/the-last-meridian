# The deep check of 2026-11-11 and 12

The owner asked: "Could you check all of the new system and make sure they work well together. Do a deep dive of the
game". This is what was done, what it found, what was fixed and what was left. None of it has been played by the owner.

## How it was checked

- **Whole games over the real server.** A scratch script played about forty games of 9 to 40 days, each on its own
  port and data folder, as a captain, an engine hand, an orderly, a marine, a porter, a dock hand, a field hand and a
  runner, in four styles: a bit of everything, a tyrant (half rations, the council held, people moved about), a brawler
  (attacking, robbing and carrying people) and a sleeper (waiting for weeks). After every step it looked for states
  that should never be: numbers that aren't whole, someone in two posts, a request asked by the dead, someone carried
  who isn't in the room, a save that doesn't load back the same.
- **The mutiny played every way,** by a script on the rules themselves: all the captain's answers to the delegation
  (22 ways through, in rounds and in the room), a month after each, then the same from below (join, stay out, warn) and
  a captain who stepped down being given the chair back.
- **On screen,** in the browser pane at about 1400 and 814 wide: losing a fight and waking in the medbay, a request
  from asking to the quest log, the registry printout, the top bar, the delegation over the room with its choices, a
  fight in the room with its hits and wounds, the Command menu during a mutiny, the Ship menu's medbay and Repair Bay,
  and carrying someone and putting them down.
- **Tests.** `test/deep-dive.test.js` keeps each finding from coming back (15 tests). The whole suite was run on a
  clean copy of the repository with only this work on top, since another session was working in the same folder.

## What it found and fixed

First round (commit e0222f7):

- **The clock stopped for good** when someone was put on a job nobody starts the game in (the guards): their made-up
  day had a step with no place in it. Every later tick failed. This was the worst of it.
- The player's body was made from scratch every time one of their numbers was read, dozens of times a blow.
- A cook waiting for the garden to grow counted as "errands left waiting", so the deck chief was warned on day 11 and
  relieved on day 14 of every game.
- Someone lying where they fell, or dead, could be attacked or robbed, and still had something to ask.
- A porter visiting the Meridian was asked for a word with a boss on another ship.
- A rest left health as 14.039513401015725; the top bar's HURT didn't count wounds; nothing said you were bleeding.
- Everyone's stock lines called any player "Captain", started without a capital, and said what a sleeper was doing.
- The server hid its own mistakes as ordinary refusals; it now prints where they happened.

Second round:

- **A scene's choices sometimes never came up.** An answer that led straight to more choices left only the reply on
  screen, because the page drew the choices only once the words were all written and nothing drew it again when they
  were (`public/popups.js`, the pen's `draw`). It had been so since the choices moved off the bottom window on
  2026-11-06; earlier screen checks wrote words all at once, so they never saw it.
- **Someone with a file vanished the moment they died,** while a nurse came for a body that wasn't there
  (`peopleAboard` in `src/life.js`). They lie under a blanket now, like anyone.
- **Dying while carried** was "where they fell", and left the player carrying nobody that could be seen. It's "in your
  arms" now, or "on the way to help" in a nurse's (`causeWords` in `src/death.js`).
- **A dead asker went on asking.** A request taken on kept its dead asker when nobody took their post, and they spoke
  its last line days later. It passes to the new holder, or ends as **Over** (`endWithNobody` in `src/requests.js`).
- **The delegation lost its leader** if things eased while the captain hadn't answered: "Step down" and "Throw them
  out" then happened to nobody. Whoever speaks for them is kept while the scene is open (`commandSceneOpen`).
- When the chair changes hands or someone's arrested, the line saying so now comes before the line about who got
  their old post.
- A player who lost a fight before ever walking a step wasn't carried to the medbay (`wakeInMedbay`).
- Six older tests failed by luck now and then (a follower knocked down, a leg broken while running
  away, a wound seen to in the medbay before a test counted it, in two tests, and a mess hand made up, in two tests,
  with something already wrong under their new artificial limb). They can't any more.

## Found and left

- **The medbay handles a long wait in one piece.** `advanceMedbay` looks once at the time the wait ends, so seventy
  days in one go and seventy single days don't treat and release people at the same moments, and now and then the
  medicine used differs enough that whoever has the chair buys differently. `test/anyone.test.js`'s "a year of it...
  comes out the same however it's cut up" fails about one run in ten because of it: 3 of 11 runs of the whole suite with
  this work in, none of 3 without it, 1 of 22 on its own; and when only its last part is repeated, the two ships part 3
  or 4 times in 40 on copies from before this work and after alike, so what it catches is older than this work. A body seed that shows it by day 4: 3271021635, with
  the docker's game and seed 21. It's the health system's to settle: step the medbay through a long wait the way the
  logistics are stepped, or keep the test to waits cut the same way.
- On a ship left starving, the deck chief is relieved once over "errands left waiting", because the tech sent for
  parts stands at empty shuttle stores; then the first officer decides it isn't the post's doing. That's the rule
  working as written, but it reads as blame for something nobody could carry.
- A post emptied while there's no first officer stays empty until the captain fills it from the Command menu.
- During the delegation the quest tracker reads "The Beacon: Talk to Lieutenant Kara Tarrow", since a scene with no
  quest of its own is shown under the main one.
- At about 814 wide the fight's log lines briefly cover the fighters' name tags when the fight is at the top left.
- A click on someone down in What's here walks over and then says "They can't talk just now", which stays at the top
  of the room until something else is said. Their right-click menu has what can be done.
- The thirteen written crew talks address any player as "Captain": the owner's to branch.
- **Give up** in a fight costs only stress now that no game master answers it. An Energy Cell used at full energy is
  wasted. "The Meridian is out of medicine" and "There's medicine again" can come the same day under another captain.
- Four of the long games stopped because their server stopped answering while many ran at once; each ran to the end
  when played again alone, with nothing in the server's own output, so it looks like the load and not the game.

## How the work was kept apart from the other session's

Both sessions edited `src/walk.js`, `src/rules.js`, `src/medbay.js` and `server.js` at once. A patch of single hunks
with no context lines put a few inserted lines five lines too low when the other session's hunks were left out, which
broke thirteen tests in the clean copy and nothing in the shared folder. What works: copy whole files to a clean
worktree at the latest commit once every hunk in them is this session's, take the other session's hunks back out by
their context where they aren't, run the suite there, and stage exactly those files' contents.
