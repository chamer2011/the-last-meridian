// Checks every written scene in world/scenes and every story in world/stories, and says what's wrong, in plain
// words, with the line.
//   npm run check-story
// It reads the files and changes nothing. The game doesn't need to be running. Another scenes folder can be
// named after the command, for checking scenes kept somewhere else.

import { allStoryProblems, SCENES_DIR } from "./scenes.js";

const dir = process.argv[2] ?? SCENES_DIR;
const { count, requests, stories, computers, systems, logistics, command, health, battles, drawn, problems, fleet } = allStoryProblems(dir);
if (!problems.length) {
  console.log(`All ${count} ${count === 1 ? "scene is" : "scenes are"} sound (${requests} of them ${requests === 1 ? "a request" : "requests"}), and so are the notes of ${stories} stories, the ${computers} computers, the systems of ${systems} places, the logistics of ${logistics} ${logistics === 1 ? "place" : "places"}, the chain of command of ${command} ${command === 1 ? "place" : "places"}, the wounds, the bodies and the health of ${health} ${health === 1 ? "place" : "places"}, the ${battles} ${battles === 1 ? "battle" : "battles"} and the ${drawn} ${drawn === 1 ? "map" : "maps"} drawn in Tiled.`);
} else {
  console.log(`${problems.length} ${problems.length === 1 ? "problem" : "problems"} in ${dir}, world\\stories, world\\computers, world\\systems, world\\logistics, world\\command, world\\health, world\\battles and world\\maps:\n`);
  for (const problem of problems) console.log(`- ${problem}`);
  console.log("\nFix these and run it again. The how-tos are world\\scenes\\_how-to-write-a-scene.txt, world\\stories\\_how-to-write-a-story.txt, world\\health\\_how-to-write-health.txt, world\\battles\\_how-to-write-a-battle.txt and world\\maps\\_how-to-draw-rooms-in-tiled.txt.");
}

// Not problems: the fleet is a thing of the past, and these are the files that still speak of it, to rework in time.
const list = (ids) => (ids.length ? ids.join(", ") : "none");
console.log(`\nThe fleet, which the game no longer has:
- Set aside, in world\\stories\\_set-aside.txt, because they stand on a ship that's gone or on the main story that was taken out (${fleet.setAside.length}): ${list(fleet.setAside)}
- Stories whose clock still changes other ships or the Choir's pursuit, which the game lets go (${fleet.otherShips.length}): ${list(fleet.otherShips)}
- Stories whose words still speak of the fleet (${fleet.stories.length}): ${list(fleet.stories)}
- Scenes (${fleet.scenes.length}): ${list(fleet.scenes)}
- Places (${fleet.places.length}): ${list(fleet.places)}
- People (${fleet.people.length}): ${list(fleet.people)}`);

if (problems.length) process.exit(1);
