# project-last-meridian

*The Last Meridian, the user's sci-fi AI text RPG, and the look and references they've asked for*

The user's game in D:\Test IA is The Last Meridian, a sci-fi text RPG with an AI game master. They asked for a Star Trek, Star Wars and Battlestar Galactica feel, in an original universe.

Style references they've given:
- Console or terminal look for the interface.
- Owlcat games (Pathfinder, Rogue Trader) for reading the story: speakers with their own look, highlighted lore, and visible consequences of choices.
- "Hyperlane Explorer" for deep character creation. On 2026-10-30 I searched and couldn't find a game by that name, so the creator was built from their description. Ask them about it rather than assuming what it is.

How they want it to work:
- The story is the main reading zone. Menus are secondary, slide over it, and are all one size.
- Fights have their own popup window over the story, with both sides in console art and followers on either side when the story allows it.
- Anything mechanical (fights, stats, character records) lives in local files and runs without API calls. The AI writes the story and can add to those files.

Status on 2026-11-01: a real-API test, about 20 cents with their OK, confirmed fights, character files, saving and reloading, and switching models. In a scene the user played, Opus 5.5 wrote consequences and tagged choices correctly but ignored the @Name speech format, in a save whose older scene didn't use it. A per-message format reminder was added after the last real call, so it has never run against real Claude. The game now also works out speakers by itself. Sonnet and a real Ollama model haven't been run.

Costs: the user asked to cut them on 2026-11-01, and the game now records every real call in data/usage.jsonl, so read that before estimating. Deliberately skipped as not worth the risk: trimming the rules and tool text (about 3%), sending narration through a tool (about 1 cent on some turns, and changes how text reaches the screen), and keep-alive calls (about 10%, but it calls the API while they're idle). Lower thinking and cheaper models are left for them to choose, because those trade quality for money.

Status on 2026-11-01, after an overnight run the user asked for: skill check windows (their reference was a picture of cyan hacker consoles), a much bigger world, a Leads menu, Easy/Normal/Hard fights and 30 bug fixes are all in the game. Normal is my choice of default, chosen between today's numbers and a balance report's Hard table, and the user hasn't played it yet. They've played real turns on the windows and the bigger world, but real Claude hasn't run the bug fixes, the difficulty setting, or read_mystery. Overnight notes are in MORNING-SUMMARY.md.

Allowance: eight background agents plus a long main conversation used a full 5-hour Pro window in about 90 minutes, and about 13% of the week. Plan big jobs in fewer agents, and merge finished work early, because the limit cuts everything off without warning.

The user plays the real game while I work, in the installed app since 2026-11-01 (see [project-app](project-app.md)) or in the Browser pane. A changed autosave may be their own progress, so check before treating it as damage, and never restore over it.

On Opus 5.5, story text written before a tool call can come back hidden. That's why the prompt asks for tools first, and why start_combat carries its own lead-in.

**Why:** these say what the user wants the game to feel like, which the code doesn't record.

**How to apply:** check new interface work against these references. See [user-no-coding-experience](user-no-coding-experience.md) for how to explain changes. The user has a real Anthropic API key saved in the game, and tests must not spend it without asking, because it's their money.
