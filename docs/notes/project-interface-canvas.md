# project-interface-canvas

*The owner remodelled the game's right side on a Claude design canvas, chosen 2026-11-09 over an in-game editor; they picked idea C, What's here floating over the room, without Things, with the menus as a strip, built the same day*

On 2026-11-09 the owner asked to remodel the interface, "especially the one on the right" (the What's here panel with People, Things, Systems and Ways out, and the menu rail beside it), in "a special app". I offered an Arrange-the-screen mode built into the game (my pick) or Claude's design canvas, and they chose "Design canvas".

The canvas is https://claude.ai/artifact/4GMM6VFaFHHK7zUhq3de6v (private). It has four boards at 1440×900: `Main.dc.html` "Now: the screen as it is" (a faithful redraw from an empty test game, with the room as an uploaded picture), `OneColumn.dc.html` "A: one column" (the menus as five tabs on top of a single column holding the room's contents), `MenusOnTop.dc.html` "B: menus along the top" (dropdowns in the top bar, and the panel as console windows by kind: blue people, gold things, teal systems, violet ways out), and `Floating.dc.html` "C: floating over the room" (a see-through bracketed pane over a full-width room, the menus as a 60px icon strip with fly-outs). Each board has Tweaks levers (colours green/amber/blue/white, text size, widths, scanlines, side), and A to C have working buttons in Play. The source is in the session scratchpad's `canvas-interface/` folder.

**What they chose:** on the same day they said "You can integrate C but without the things subcategory". Their only change on the canvas was deleting idea C's help line at the bottom right, and nothing on the other boards (they tried the Tweaks levers on the first board: the panel at 200 wide, the rail at 112). It was built the same day: the strip of menu groups ([project-menus](project-menus.md)) and What's here floating over the room, without Things and without the isometric help line ([project-walk-around](project-walk-around.md)). Untried by them.

**Why:** they judge by seeing and want to shape the screen with their own hands.

**How to apply:** the canvas stays as a place to try more changes to the screen. If they edit it again, read it again (canvas.json, every board, and any notes or drawings they add; their edits win over mine), say what will change in the game, and build it into `public/walk.js`, `public/app.js` and `public/style.css`, checked at about 810 and 1400 wide. Related: [project-menus](project-menus.md) (their earlier choices for the menus: groups, folds, no explaining lines).
