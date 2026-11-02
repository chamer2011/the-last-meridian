# project-optional-ai

*Their next direction, from 2026-11-02: the game playable with or without an API key, in the genre of Age of Decadence and Colony Ship, with the AI as an optional layer. The seven-step plan I proposed, and no GitHub updates until they've tested*

On 2026-11-02 they asked: "I would like for the game to be played with or with the add of an API. The idea of the game would be that it's like the game of the same genre : Age of Decadence, Colony Ship rpg, but with the optional use of AI to make the story more reactive and lived." They wanted a plan of steps first, and said: "do not implement any update to the github version, we will do the test first and then update it." It's the vision in their own note: see [project-last-meridian](project-last-meridian.md).

Status: they said "Start step 1", and step 1 went in on 2026-11-02 (backup `backups/before-written-story-2026-11-02`), committed on this computer only and not pushed anywhere, because they said no GitHub updates until it's tested. They haven't played it yet. What it is: `src/scenes.js` plays scenes from `world/scenes/` (parts with text in the game master's format, choices with `to` or `check` + `pass`/`fail`, `do` steps through `runTool`, part-level `check` and `fight` with branches, `end`, `note`); `sceneProblems` checks a file; `matchChoice` is forgiving about typing. `game.mode` is "written" or "ai", set at `/api/new` from the `story` setting (null means written until an AI is set up), and can't change afterwards. `game.lastCheck` and `game.lastFight` are how results reach the written story. `opening_captain.json` is the test scene (Voss, Sorel, Vey, Pell on the bridge; a persuasion check on Voss; consequences through note_contact, add_journal, update_quest, award_xp, shift_ideology, change_faction) and `opening.json` fits anyone else. In a written game a talk has no typing line. Typed text the scene can't answer is refused with a message and changes nothing.

Choices I made that they haven't weighed in on: the format is JSON in `world/scenes/` like the rest of `world/` (step 2 may want a friendlier text format for long passages); the one-word answers "Go on" between parts; leads say "not written out yet" rather than playing; the status bar still shows LAST TURN 0¢; the captain's opening doesn't give away the Beacon's two layers (Voss's pressed answer is her list of ships that can't keep up, not her secret).

The plan, one step at a time, each one tested by them on this computer:
1. A No AI / With AI switch and a written-story engine, with one small test scene.
2. Scene files they can edit in Notepad, with conditions and consequences, and an automatic checker for dead ends and broken links.
3. One whole story written out, The Downstairs Crew (`world/threads/crew_naomi_under_crew.json`), with all its routes. This is the real test of whether it's fun with no AI, and it gives a real word count. They decide here who writes the rest.
4. People and things with no AI: written talks for the 61 named people, stock lines for locals, written results for the 365 things you can use, and rules for the 15 closed doors.
5. The opening and act 1 of the main story, for three of the 22 lives. Stories nobody has written yet play out by themselves and arrive as news, using the story clock that's already there.
6. The AI as the layer on top: free talk and free typing. It reads the scene's notes and fits what the player does to a written outcome, or adds a small side moment, and it can't change the plot any other way. Unwritten stories stay AI-run, as they are today. This changes the AI's instructions, so the next turn reloads once, so tell them, and real AI tests need their OK.
7. Write the rest, ranked, one story at a time.

What I found that the plan rests on:
- The AI is only called at seven moments: starting the story, carrying on after a fight or check, a choice or typed action, a lead or rumor, using a thing, asking through a closed door, and a line in a talk.
- A written scene can use the same text format (`@Name:`, `> [persuasion:hard] choice`, `=>`) and the same `runTool` as the AI, so the popups, windows and rules stay as they are.
- `world/threads/` is 113,000 words, but 100,700 of those are notes for the game master, with beats, routes, checks and outcomes. Only about 10,600 are written for the player, so these are outlines, not playable text.
- My estimates, not measured: 3,000 to 6,000 words per story written out, so all 127 would be 4 to 8 novels, and a first version (act 1, 10 stories, 3 lives, talks and things) about one novel. Step 3 gives a real number.

My recommendation on who writes: they write the main story and key voices, and I draft side content for them to edit, with each scene marked draft or edited so their public note can stay honest about how much AI wrote. They haven't decided.

**Why:** they want the AI to stop being the main part of the game, and a key is the biggest barrier to feedback from strangers.

**How to apply:** nothing goes to either GitHub repository until they've tested it and said so: commit here only. Fights stay as they are, even though both reference games have grid fights, unless they reopen it. Old AI-run saves keep working with the AI. Related: [project-github](project-github.md), [project-world-engine](project-world-engine.md).
