# What changed overnight

None of this work touched your API key, so it cost no AI credit. It used up your whole 5-hour allowance, and about 14% of your weekly one.

## Skill check windows

- Each of the 25 skills now opens its own window, with its own colors and its own small game.
- Hacking looks like your picture: consoles, a server panel, a memory dump and a taskbar. You find the password before the trace finds you, and you can poke around with `ls`, `cat`, `ps` or `sudo`.
- Everything can be clicked, nothing is timed, and typos don't cost anything.
- Playing well can add up to 30% to your odds. A better-trained character gets better tools.
- To try them for free, open the **Skills** menu and press **Practice**. To skip them, go to **Settings** and choose **Skill checks: Just a roll**.

## A much bigger world

- 24 places (16 new), 12 factions (8 new), 58 people with files (40 new) and 34 enemy types (25 new).
- 38 new items and 22 new perks.
- 127 story threads, a main story with 5 acts, 52 clues and 5 endings, and 87 small fleet events.
- A new **Leads** menu shows stories you could start where you are, and what people are saying. Reading it costs nothing.
- **Ship** now has a **Set course** button for places you know.
- The game master gets notes on a place or story only when it matters, to keep turns cheap.

## Fights

Simulating thousands of fights showed they were far too easy for anyone who could fight: a fresh Marine beat even the Legendary enemies more often than not, and followers were too strong. So **Fights** in **Settings** now has three levels. Your followers stay the same at all three, and enemies change.

| Win rate against one enemy | Easy (how it was) | Normal (the new default) | Hard |
|---|---|---|---|
| New fighter against a Capable enemy | 100% | 100% | 91% |
| New fighter against a Dangerous enemy | 99% | 76% | 54% |
| New talker against a Capable enemy | 93% | 54% | 4% |
| New talker against a Dangerous enemy | 36% | 0% | 0% |
| Level 8 fighter against a Legendary boss | 100% | 4% | 8% |

Your current game is now on Normal, so fights will be harder than they were. If that doesn't feel good, switch to Easy. The difference between Normal and Hard for the Level 8 fighter is too small to mean anything: both are a near-certain loss alone, and a party can still win.

## Bugs fixed

An overnight bug hunt found 30 problems and proved them, and all of them are fixed. The ones you'd most have noticed:

- **Load destroyed the game you were playing.** It now keeps it as **Previous game**.
- **Two new games in a row lost your long game.** Same fix.
- **Reloading the page while the AI was writing** could leave the page stuck, with a fight you couldn't see.
- **Typing a number in some check windows pressed a button instead**, such as accepting the asking price while haggling.
- **Commerce couldn't be played by clicking**, because the first offer was always accepted.
- **Hacking could be beaten for free** by reading `passwd.bak` over and over.
- **A half-written save** could be silently replaced. Saves are now written safely, and a broken one is kept.
- **The hidden end-game place** could appear in your Ship menu in the first act, and now it can't.

I also fixed the contradictions I found between story files, like how many files a clerk had altered, and what one boy was called.

## What real turns have cost

From your own turns on the new version: about 3 to 4 cents a normal turn, about the same as before. One turn cost 7 cents. Coming back after more than an hour costs a one-time reload of about 33 cents, up from about 21. It will be a little more now, because the story's grown. These numbers come from the game's own record of your turns. Nothing here was run against real Claude by me.

## Not tested

- **Real Claude with the newest changes.** Your turns ran before the bug fixes and the difficulty setting, and I only tested those with a stand-in AI, because a real test would spend your money. Your next turn will reload once, because the instructions changed.
- **Whether the AI uses the new material well.** It now has places, leads and the main story's clues to draw on, but only play will show how well it uses them.
- **Other contradictions.** I only fixed the ones the writers reported, and some may remain in 127 stories. They won't break anything.

## If you want to undo it

A copy of the game from before tonight is in `backups\before-overnight-2026-11-01`, including your saves in `saves-copy`. Your current save has been converted to the new format, and the old version of the game can't read that format. To go back, you'd use the copies in `saves-copy`, and anything you've played since would be lost. Ask me if you want this done.
