# project-interactions

On 2026-11-12 the owner asked, word for word: "How would you design the interactions to look more like the game Wrath of the Rightous from Owlcat while keeping the style of the game?"

## The answer, as given

Taking only the conventions most games of this kind share, and none of Owlcat's art, icons, layouts, names or words (the project's rule is that nothing from another game goes in), seven ideas in the game's own console look:

1. **Pointing at things:** a pointer that shows what a left click will do (walk, talk, use, open, attack in red, a door, pick up), the left click doing it and the right click keeping the full menu; outlines on things and doors on hover. Hovering already rings people and names them.
2. **Seeing everything at once:** a **Show all** button in the room panel (and holding Tab) naming every person, thing, door and way out for a few seconds; things on the floor glint.
3. **Talks:** keeping the pane by the head (their pick), with answers that say more: a check's odds, what an answer gives or costs or ends, answers that can't be picked shown greyed with why, questions already asked dimmed. Choice tags already exist (`[persuasion moderate]` shows the odds, `[anything]` a label chip).
4. **Big moments with no one speaking:** a "ship's log" page over the room, with a header drawn in the game's console characters and the same labelled answers.
5. **Fights**, on the same rules: rings under you and your target, a line to whoever you're about to attack, hit chance and damage on hover from the rules as they are, a log whose lines open to show the roll, more ways to pause by itself.
6. **Words that explain themselves:** underlined terms with short explanations from a plain text file.
7. **Smaller touches:** **Take all**, and short lines over people's heads as you pass.

Left out: party control, a turn-based mode (they chose real time with pause and turned down Fallout's action points and grids), anything that changes the numbers. I recommended 1, 2 and 3 first.

They asked "What would the 4 look like?", were shown an inline mock-up (the prisoners' decision on a log page over the dimmed Long Mess, with a drawing of the brig's cells, the narration, and answers labelled "nothing changes", "morale +2 · council +3", "fewer aboard · morale +2 when docked", a check with its odds and a greyed answer with its reason, the last two made up for the picture), and said **"Do it"**.

## Idea 4, as built (2026-11-12): pages of the ship's log

**What the owner sees.** The end of the opening battle and Tarrow's question about the prisoners come up as a page over the room: a green bar (**Ship's log · day 1, 08:00** and **The clock is stopped**), a drawing in the game's own characters beside the title and the line under it (the Meridian side on; the brig's two cells), all of the words at once in the story's typeface, and the answers with their labels as chips ([NOTHING CHANGES], [MORALE +2] [COUNCIL +3], [FEWER ABOARD] [MORALE +2 WHEN DOCKED]), or **Close** when there's nothing to decide. Numbers pick, Esc closes a page with nothing to decide, and it pulls aside and slides back. The clock stops while it's open ("Stopped while the log is open" by the clock), and the notes and the small quest tracker step aside. In a talk, once answered, the page shows what's said to the answer and what it did (the notes' lines: what's done with the prisoners, "Taken on: ..."), then only Close. A closed page stays closed after a reload (the browser's own storage, the last twenty). A scene's page steps aside while a talk is open.

**Not built from the mock-up:** answers greyed with a reason (that's idea 3), and the made-up check and trial answers.

**The files.** `world/drawings/<name>.txt` (`brig`, `meridian`, my drafts; `_how-to-draw.txt`; at most 8 lines of 32 characters, lines starting // are notes); a part's `PAGE: title | under` and `DRAWING: name` lines (how-to: PAGES OF THE SHIP'S LOG in the scene how-to); `opening_captain.txt`'s `held` and `woke` and `request_prisoners.txt`'s ask use them, the ask rewritten as narration and Tarrow's line, its answers tagged.

**The code.** `src/drawings.js` (`drawingOf`, `drawingNames`, `drawingProblems` for check-story, `GAME_DRAWINGS_DIR`); `src/scene-text.js` reads the two lines; `pageOf` in `src/scenes.js` (title, under, the drawing's lines, the time), carried with the part's words (`emit` with `page`), which `server.js` keeps as a record entry of its own (never run on from the words before); `sceneProblems` names an unknown drawing or one without a page; `src/talks.js` puts the page on the talk (`talk.page`, and `done` once a request hands back, instead of showing the usual conversation's choices), passed by `talkView`. `public/logpage.js` draws it (`shipLogNode`, pullable, its own keys ahead of the room's); `public/popups.js` draws a scene's page from the newest narration when it has one, in place of the caption, the pane and the answers, and leaves its words out of the pieces; `public/talk.js` draws a talk's page (`#ship-log-talk`); `public/walk.js` holds the clock; the styles are in `public/style.css` (`.ship-log`, which needed `pointer-events: auto`, since the popups' layer lets clicks through to the room).

**Tested.** `test/logpage.test.js` (4 tests: the lines and their problems; the drawings, cut to size, and too big said so; the battle's end carrying its page; the prisoners' question as a page, done once answered, with what the answer did). On screen at 1400 and 810 on a test copy: the battle's page, closing it with the button and with 1, the notes and tracker coming back, the page staying closed after a reload, Tarrow's question as a page and her answer with what it did. Another session was building a map editor in the same folder at the time; this was tested in a clean copy at the last commit with only these files, and only these files were committed (server.js with only its own change).
