ALMAGEST EXPLORER'S IN GODOT
============================

This folder is the Godot view of the game: what's seen and clicked, being moved to Godot a step at
a time, while the game's rules stay where they are (src/, in JavaScript). Steps 1 to 4 of seven are
here: the room of the game being played, with everyone aboard, the doors, the light and the dark,
fires and the clock, fights fought in the room, and the story and talks over it.

TO OPEN IT
Double-click start-godot.bat in the game's folder (the one above this). It fetches Godot 4.3 the
first time and opens the view. The README there says what to try ("The Godot view").

WHAT'S HERE
- project.godot, main.tscn: the project and its one scene.
- scripts/main.gd: the window, the clock, walking, and what the game is asked and told.
- scripts/link.gd: the line to the game (server.js, the same program the browser view talks to).
- scripts/fight.gd: a fight in the room, with its orders, its notes and its two sides.
- scripts/story.gd: the story and talks, on panes by people's heads, and the quest in the corner.
- scripts/deck_art.gd, deck_view.gd, overlay.gd, figure.gd and the scripts they use: the drawing.
- scripts/pal.gd and the panes, the Keelworks desktop and style_test.tscn: the style test of the
  console look, approved before this, which the later steps are built from.
- fonts/: Cascadia Mono, free to ship with a game (its licence is fonts/OFL-LICENSE.txt).

WHAT ISN'T, AND MUSTN'T BE
The two bought pixel-art packs. They're read from the game's "licensed" folder each time and are
never copied in here: their licence forbids giving the files away, and Godot would copy any picture
it found in this folder. A test fails if one ever turns up (test/godot-as-drawn.test.js).
