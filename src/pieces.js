// The catalogue of pieces: every picture in the bought pixel-art packs (licensed/, see public/pixel-art.js), gathered
// into pieces, sorted by where each belongs on a ship, and marked as going on the ship or not. It's step 1 of the map's
// rework (docs/notes/project-pixel-art.md): the Map editor's Pieces window shows it (public/pieces.js), and the owner
// ticks what they want. Nothing on the decks reads it yet. These aren't the furniture pieces of public/furniture.js,
// which the decks are made of today: step 2 of the rework is what turns ticked pieces here into furniture there.
//
// A piece is one thing, however many pictures the pack has of it: a chair's four sides, a door's frames as it opens,
// a cabinet and its drawers. The packs name their pictures in a few regular ways, and the pieces are worked out from
// those names (pieceKey), so a newer version of a pack sorts itself the same way.
//
// What's on the ship is kept in world/pieces.txt, in plain words, once anything has been changed: a line a piece,
// under the name of the place it belongs. Until then, and for any piece the file doesn't have, the first ticks are
// the game's own guess at what suits the ship (sortOut). The packs themselves are never in the repository: without
// them the file still reads, and the pieces it lists simply have no pictures.

import fs from "node:fs";
import path from "node:path";
import { projectDir, worldDir } from "./paths.js";
import { addChecker } from "./room-hooks.js";

// Worked out each time, so the tests can point the game at copies.
export const licensedDir = () => process.env.GAME_LICENSED_DIR || path.join(projectDir, "licensed");
export const piecesFile = () => process.env.GAME_PIECES_FILE || path.join(worldDir, "pieces.txt");

// Where a piece belongs on a ship, in the order the window lists them.
export const PLACES = [
  { id: "bridge", name: "Bridge and command" },
  { id: "quarters", name: "Quarters" },
  { id: "mess", name: "Mess and galley" },
  { id: "medbay", name: "Medbay" },
  { id: "engineering", name: "Engineering and workshop" },
  { id: "stores", name: "Stores and cargo" },
  { id: "heads", name: "Heads and laundry" },
  { id: "passages", name: "Passages, doors and stairs" },
  { id: "garden", name: "Garden" },
  { id: "walls", name: "Walls and what hangs on them" },
  { id: "floors", name: "Floors" },
  { id: "small", name: "Small things" },
  { id: "odds", name: "Odds and ends" },
];
const PLACE_IDS = new Set(PLACES.map((place) => place.id));
const PLACE_BY_NAME = new Map(PLACES.map((place) => [place.name.toLowerCase(), place.id]));
export const PACKS = { isospace: "Isometric Space Station", interiors: "Isometric Interiors" };

// ---- The first pack: three sheets of 128-pixel cells, named here since the sheets name nothing --------------------

const cells = (sheet, list) => list.map(([cx, cy]) => ({ file: `isospace/${sheet}`, x: cx * 128, y: cy * 128, w: 128, h: 128 }));
const row = (cy, from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, cy]);
function firstPack() {
  const level = "IsoSpace_Level.png";
  const assets = "IsoSpace_Assets.png";
  const doors = "IsoSpace_Doors.png";
  const out = [];
  const add = (slug, name, place, pictures) => out.push({ id: `isospace/${slug}`, pack: "isospace", name, place, on: true, pictures });
  const darkFloors = ["plain plating", "mesh", "panels", "panels with fittings", "hatch", "vents", "grille", "wide grille"];
  darkFloors.forEach((name, i) => add(`floor-dark-${i + 1}`, `Dark floor, ${name}`, "floors", cells(level, [[i, 0]])));
  const lightFloors = ["polished", "panels", "grille", "wide grille", "panels with a vent"];
  lightFloors.forEach((name, i) => add(`floor-light-${i + 1}`, `Light floor, ${name}`, "floors", cells(level, [[i, 4]])));
  for (const [look, top] of [["dark", 0], ["light", 4]]) {
    const Look = look === "dark" ? "Dark" : "Light";
    for (let i = 0; i < 3; i += 1) add(`wall-${look}-${i + 1}`, `${Look} wall, panel ${i + 1}`, "walls", cells(level, [[i, top + 1], [5 + i, top + 1]]));
    add(`low-wall-${look}`, `${Look} low wall`, "walls", cells(level, [[0, top + 2], [1, top + 2]]));
    add(`wall-corner-${look}`, `${Look} wall corner`, "walls", cells(level, [[2, top + 2]]));
    add(`pillar-${look}`, `${Look} pillar`, "walls", cells(level, [[3, top + 2]]));
    add(`stairs-${look}`, `${Look} stairs`, "passages", cells(level, [[0, top + 3], [2, top + 3]]));
    add(`stair-rail-${look}`, `${Look} stair rail`, "passages", cells(level, [[1, top + 3], [3, top + 3]]));
    add(`door-${look}`, `${Look} sliding door`, "passages", cells(doors, [...row(top, 0, 7), ...row(top + 1, 0, 7), ...row(top + 2, 0, 7), ...row(top + 3, 0, 7)]));
  }
  const things = [
    [0, 0, "chart-table", "Chart table with a lit top", "bridge"], [1, 0, "drums", "Stack of drums", "stores"], [2, 0, "cases", "Pile of cases", "stores"],
    [3, 0, "crate-dark", "Big crate, dark", "stores"], [4, 0, "bunk", "Bunk, two beds", "quarters"], [5, 0, "terminal", "Terminal desk", "bridge"],
    [6, 0, "pump", "Pump unit", "engineering"], [7, 0, "rack-dark", "Server rack, dark", "engineering"], [0, 1, "pod", "Medical pod", "medbay"],
    [1, 1, "padded-chair", "Padded chair", "bridge"], [2, 1, "sofa", "Sofa, grey", "quarters"], [3, 1, "tank", "Tank with a lit core", "engineering"],
    [4, 1, "locker-light", "Locker, light", "quarters"], [5, 1, "crate-light", "Big crate, light", "stores"], [6, 1, "cooler", "Cooler cabinet", "mess"],
    [7, 1, "console", "Control console", "bridge"],
  ];
  for (const [cx, cy, slug, name, place] of things) add(slug, name, place, cells(assets, [[cx, cy]]));
  return out;
}

// ---- The second pack: a picture a file, in a folder for each kind of room -------------------------------------------

// Folders that hold nothing of their own: the same floors and walls at sizes the game doesn't draw at.
const SKIPPED = new Set(["Floor_Wall_Tiles_32", "Floor_Wall_Tiles_64"]);
// Inside these, each folder is a set of its own, not the parts of one thing.
const SETS = new Set(["Kitchen/Kitchen Furnitures Colors"]);
// Folders whose name doesn't say what they're part of (the pack spells the red fridge "Fidge").
const PART_OF = { "Kitchen/Fridge_Red_Doors": "Fidge_Red" };
// Files that are several pictures side by side: something seen from every side, or the frames of its moving. Each is
// so many across and so many down, all the same size, and counts as that many pictures (fewer where the last squares
// are empty).
const SHEETS = [
  { of: /^Books\/Book_(Big|Small)_\w+\.png$/i, across: 4, down: 4 },
  { of: /^Cleaning_Robot_Ani\/Cleaning_Robot_Ani\.png$/i, across: 16, down: 1 },
  { of: /^Clocks\/Grandfather_Clock_Ani\.png$/i, across: 4, down: 2, frames: 7 },
  { of: /^Doors\/Door_\d+_\w+\.png$/i, across: 5, down: 1 },
  { of: /^Lab\/(3D_Printer_\w+|Camera_1_Ani|Door_Lab|Oscilator_Machine)\.png$/i, across: 4, down: 4 },
  { of: /^Lab\/Server_1\.png$/i, across: 2, down: 2 },
];

// What piece a picture is of, from its file's name: the name without what only says which picture of it this is (a
// side A to E, an open or closed state, a frame of its moving, a drawer, the word Tile).
export function pieceKey(file) {
  let stem = file.replace(/\.png$/i, "").replace(/\([^)]*\)/g, "").trim();
  for (let i = 0; i < 4; i += 1) {
    stem = stem
      .replace(/_Tile$/i, "")
      .replace(/_Tile_Ani_\d+$/i, "")
      .replace(/_Ani(mation)?(_\d+)?$/i, "")
      .replace(/_(Closed|Close|Open|Off|On|Empty|Full|Base)$/i, "")
      .replace(/(Printer)_Cup$/i, "$1")
      .replace(/_[A-E]$/, "");
  }
  return stem;
}

// What the pack calls something, as words: "LavaLamp_Ani" is "Lava lamp".
export function pretty(key) {
  const words = key
    .replace(/\(([^)]*)\)/g, " $1")
    .replace(/_Ani(mation)?(?=_|$)/gi, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

// Names for the pieces looked at when the pack was first sorted; the rest are called what the pack calls them.
const NAMES = {
  "Chairs/Chair_4": "Plastic chair, blue", "Chairs/GChair_9": "Padded swivel chair", "Chairs/Basic_Office_Chair": "Office chair", "Chairs/Office_Main_Chair": "Big swivel chair",
  "Chairs/Chair_2": "Wooden chair", "Chairs/Chair_3": "Ladder-back chair", "Chairs/Chair_5": "Dining chair, red seat", "Chairs/Chair_6": "Plastic garden chair", "Chairs/Chair_7": "Plastic chair, purple", "Chairs/Kitchen_Stool": "Stool",
  "Tables/Office_Kitchen_Table": "Steel table", "Tables/Table_Corridor": "Narrow bench table", "Tables/Table_10": "Square table", "Tables/Table_11": "Long table", "Tables/Table_12": "Oval table", "Tables/Table_13": "Round table",
  "Tables/Table_14": "Table with a cloth", "Tables/Kitchen_Table": "Trestle table", "Tables/Drawing_Table": "Drafting table",
  "Desks/Desk_1": "Wooden desk", "Desks/Desk_2": "Metal-legged desk", "Desks/Desk_3": "Workbench", "Desks/Office_Main_Table_Desk": "Black glass desk", "Desks/Office_Normal_Table_Ani": "Desk with steel drawers",
  "Lab/3D_Printer": "3D printer", "Lab/Ac_Big_1": "Air unit, small", "Lab/Ac_Big_2": "Air unit, standing", "Lab/Cable_Horizontal_1": "Cables along a wall", "Lab/Cable_Horizontal_2": "Cables along a wall, in a tray", "Lab/Cable_Vertical": "Cables up a wall",
  "Lab/Camera_1": "Security camera, turning", "Lab/Camera_2": "Dome camera", "Lab/Door_Lab": "Sliding glass door", "Lab/Oscilator_Machine": "Test instrument", "Lab/Pipe_Corner": "Pipe, corner", "Lab/Pipe_Horizontal": "Pipe along a wall",
  "Lab/Pipe_Horizontal_Box": "Pipe with a junction box", "Lab/Pipe_Vertical": "Pipe up a wall", "Lab/Plastic_Box_1": "Parts bin, blue", "Lab/Plastic_Box_2": "Parts bin with a lid", "Lab/Printer_Filament": "Spools on a spindle", "Lab/Screen_Small": "Small wall screen",
  "Lab/Server_1": "Server rack, four sides", "Lab/Server_2": "Server cabinet", "Lab/Server_3": "Small server", "Lab/Switch": "Wall switch", "Lab/Tool_Box": "Tool box", "Lab/Tools": "Tools on a rack", "Lab/Tools_Electric": "Circuit board", "Lab/VoltageMeter": "Voltage meter", "Lab/Welder_Machine": "Welder",
  "Office/AC": "Air unit on a wall", "Office/Board": "Whiteboard", "Office/Carton_Box": "Cardboard box", "Office/Copy_Machine_Dark_Ani": "Copy machine, dark", "Office/Copy_Machine_White_Ani": "Copy machine, white", "Office/Corkboard_1": "Corkboard, pale frame",
  "Office/Corkboard_2": "Corkboard, wooden frame", "Office/Document_Shredder_Ani": "Shredder", "Office/Fire_Extinguisher": "Fire extinguisher", "Office/Glass_Wall": "Glass wall", "Office/Long_Rack": "Vent grille", "Office/Medical_Kit_Ani": "Medical kit on a wall",
  "Office/Office_Metallic_Closet_Ani": "Steel locker", "Office/Office_Wood_Closet_Ani": "Wooden cupboard", "Office/Office_Partition": "Partition", "Office/Rack": "Wire shelving", "Office/Rumba_Robot": "Cleaning robot", "Office/Tv": "Wall screen",
  "Office/Water_Dispenser_Ani": "Water dispenser", "Office/White_Box": "White box", "Office/Projector_Stand": "Tripod stool", "Office/Trash": "Bin", "Office/Trash_Square": "Square bin",
  "Office/Printer_Ani": "Printer", "Office/Projector_Ani": "Projector", "Office/Projector_Screen_Ani": "Projector screen",
  "Computer/BendedScreen": "Curved screen", "Computer/MacBook_Ani": "Laptop", "Computer/NewImac": "Flat computer", "Computer/NewKeyboard": "Keyboard and mouse", "Computer/OldImac": "Old rounded computer",
  "Computer/OldKeyboard": "Old keyboard", "Computer/OldPC": "Old beige computer", "Computer/PcTower": "Computer tower", "Computer/RotationScreen": "Screen on a stand", "Computer/Vertical_Screen": "Tall screen", "Computer/WacomTablet": "Drawing tablet",
  "Bathroom/Bath_Ani": "Bathtub", "Bathroom/Bath_Carpet": "Bath mat", "Bathroom/Bath_window": "Shuttered window", "Bathroom/Hanger": "Coat hooks", "Bathroom/WC_Ani": "Toilet", "Bathroom/WC_Tap_Ani": "Washbasin on a cabinet", "Bathroom/Wc_Furniture": "Bathroom cabinet",
  "Bathroom/Tap_Shower": "Shower fittings", "Bathroom/Tap_Wall": "Wall tap", "Bathroom/Shower_Bin": "Bin with a lid",
  "Kitchen/Fridge": "Fridge", "Kitchen/Fidge_Red": "Fridge, red", "Kitchen/Ketel_7": "Kettle", "Kitchen/Kitchen": "Kitchen counter with drawers", "Kitchen/Kitchen_Tiles": "Wall tiles", "Kitchen/Oven": "Stove with an oven", "Kitchen/Pot": "Cooking pot", "Kitchen/Rack": "Vent grille, small",
  "Kitchen/Shelf": "Wall shelf", "Kitchen/Stoves": "Hob", "Kitchen/TrashBin": "Pedal bin", "Kitchen/Wall_Protection": "Splashback", "Kitchen/CoffeMachine_Red": "Coffee machine", "Kitchen/DishWasher": "Dishwasher", "Kitchen/WashingMachine": "Washing machine",
  "Living Roon/AirCC": "Air unit on a wall, long", "Living Roon/Speaker_6": "Speaker", "Bedroom/Bed_A_4": "Bare mattress", "Bedroom/Bed_B_4": "Unmade bed", "Bedroom/Bed_C_4": "Mattress with a blanket", "Bedroom/Night_Table": "Bedside drawers, orange",
  "Lamps/LavaLamp_Ani": "Lava lamp", "Doors/Office_Glass_Door_Ani": "Glass door", "Clocks/Wall_Clock_Ani": "Wall clock", "Clocks/Grandfather_Clock": "Grandfather clock", "Televisions_TV/BigTv_Ani": "Big wall screen, lit",
  "Televisions_TV/Tv_DVD_Ani": "Screen with a player under it", "Cleaning_Robot_Ani/Cleaning_Robot": "Cleaning robot, turning", "Japanese_Room/Japanese_Door": "Japanese sliding door",
  "Bedroom/Bed_D_4": "Wooden bed, cream blanket", "Bedroom/Bed_E_4": "Wooden bed, wine blanket", "Bedroom/Bed_F_4": "Wooden bed, green blanket", "Bedroom/Bed_G_4": "Wooden bed, navy blanket", "Bedroom/Bed_H_4": "Wooden bed, patchwork quilt",
  "Bedroom/Bed_I_4": "Wooden bed, red blanket and pillow", "Bedroom/Bed_J_4": "Low wooden bed, navy blanket", "Bedroom/Bed_K_4": "Wooden bed, checked blanket", "Bedroom/Bed_L_4": "Slatted wooden bed", "Bedroom/Bed_M_4": "Low wooden bed, checked blanket",
  "Bedroom/Pillow_9": "Rumpled blanket", "Bedroom/Pillow_10": "Pillow, pale green", "Bedroom/Pillow_11": "Pillow, cream", "Bedroom/Pillow_12": "Long pillow, white",
  "Sofa/Pillow_10": "Cushions, brown and cream", "Sofa/Pillow_11": "Cushions, teal", "Sofa/Pillow_12": "Cushion, teal pattern", "Sofa/Sofa_1": "Armchair, teal", "Sofa/Sofa_2": "Sofa, teal", "Sofa/Sofa_3": "Sofa, beige", "Sofa/Sofa_4": "Sofa, yellow",
  "Lamps/Lamp_7": "Wall lamp, cream shade", "Lamps/Lamp_8": "Desk lamp, orange", "Lamps/Lamp_9": "Table lamp, pleated shade", "Lamps/Lamp_10": "Standing lamp on a tripod", "Lamps/Lamp_11": "Desk lamp, green shade", "Lamps/Lamp_Modern": "Strip light on a wall",
  "Living Roon/shelving_6": "Wall shelf, orange", "Living Roon/shelving_7": "Cupboard with shelves, orange", "Living Roon/SmallTable_5": "Low table, orange", "Living Roon/Book_8": "Thick book, green",
  "Japanese_Room/Clothes_Case": "Laundry basket, wire", "Japanese_Room/Carton_Box": "Cardboard box, grey", "Kitchen/Clothes_Basket": "Laundry basket", "Kitchen/Box_2": "Taped cardboard box",
  "Kitchen/Bottle_12": "Bottle, green", "Kitchen/Glass_1": "Glass", "Kitchen/Glass_2": "Tumbler, dark", "Kitchen/Mug_15": "Mug, dark red", "Kitchen/Mug_Green": "Mug, green", "Kitchen/Mug_Red": "Mug, red", "Kitchen/Kitchen_Soap": "Detergent bottle",
  "Kitchen/Rag": "Dish cloth", "Kitchen/Soap": "Carton of soap", "Kitchen/Dish": "Plate", "Kitchen/TeaPot": "Teapot", "Kitchen/Cola": "Cola bottle", "Kitchen/Cereals": "Box of cereal", "Kitchen/Wine": "Wine bottle", "Kitchen/Soda_Can": "Drinks can",
  "Office/Photos_1": "Photos pinned up", "Office/Photos_2": "Photos and notes pinned up",
  "Wall_Decoration/Poster_1": "Sign with an arrow", "Wall_Decoration/Poster_2": "Chart on paper", "Wall_Decoration/Poster_3": "Board with a bar chart", "Wall_Decoration/Poster_4": "Flow chart", "Wall_Decoration/Poster_5": "Notice with charts",
  "Wall_Decoration/Poster_6": "Hazard sign, yellow", "Wall_Decoration/Poster_16": "Poster, game symbols", "Wall_Decoration/Poster_17": "Poster, doughnut", "Wall_Decoration/Poster_Fire": "Fire point sign", "Wall_Decoration/Poster_Map_6": "Map on a wall",
  "Wall_Decoration/Poster_Medical": "Medical sign", "Wall_Decoration/Picture_Cat": "Portrait of a cat", "Wall_Decoration/Picture_Modern_1": "Framed print, yellow and blue", "Wall_Decoration/Picture_Modern_2": "Framed print, green and red",
  "Floor_Wall_Tiles_128/Floor_Bath_1": "Floor, small white tiles", "Floor_Wall_Tiles_128/Floor_Bath_2": "Floor, grey mosaic", "Floor_Wall_Tiles_128/Floor_Black": "Floor, black tiles", "Floor_Wall_Tiles_128/Floor_BlueLight": "Floor, pale blue tiles",
  "Floor_Wall_Tiles_128/Floor_BlueSea": "Floor, teal tiles", "Floor_Wall_Tiles_128/Floor_Bone": "Floor, pale stone tiles", "Floor_Wall_Tiles_128/Floor_BrokenWhite": "Floor, plain cream", "Floor_Wall_Tiles_128/Floor_CheckBoardBig": "Floor, black and white check",
  "Floor_Wall_Tiles_128/Floor_Concrete": "Floor, grey tiles", "Floor_Wall_Tiles_128/Floor_DarkBlue": "Floor, dark mottled teal", "Floor_Wall_Tiles_128/Floor_Old": "Floor, cracked flagstones", "Floor_Wall_Tiles_128/Floor_Serious": "Floor, plain grey",
  "Floor_Wall_Tiles_128/Floor_Stone": "Floor, grey stone blocks", "Floor_Wall_Tiles_128/Floor_White": "Floor, big pale tiles", "Floor_Wall_Tiles_128/Floor_WhiteCheck": "Floor, white grid tiles",
  "Floor_Wall_Tiles_128/Wall_ArmyGreen": "Wall, dark olive", "Floor_Wall_Tiles_128/Wall_Bath": "Wall, pale aqua", "Floor_Wall_Tiles_128/Wall_Black": "Wall, black", "Floor_Wall_Tiles_128/Wall_BlueLight": "Wall, pale blue-grey",
  "Floor_Wall_Tiles_128/Wall_BlueSea": "Wall, teal panels", "Floor_Wall_Tiles_128/Wall_BrokenWhite": "Wall, off-white", "Floor_Wall_Tiles_128/Wall_Concrete": "Wall, grey plates", "Floor_Wall_Tiles_128/Wall_Dark": "Wall, near black",
  "Floor_Wall_Tiles_128/Wall_DarkBlue": "Wall, dark teal", "Floor_Wall_Tiles_128/Wall_Grey(Plinth)": "Wall, grey with a skirting", "Floor_Wall_Tiles_128/Wall_Sea": "Wall, pale teal", "Floor_Wall_Tiles_128/Wall_Serious": "Wall, slate",
  "Floor_Wall_Tiles_128/Wall_Stone": "Wall, dark and battered", "Floor_Wall_Tiles_128/Wall_WhiteCheck": "Wall, white tiles", "Floor_Wall_Tiles_128/Wall_Old": "Wall, peeling plaster",
};

// Where a piece of the second pack belongs and whether it suits the ship, by its folder and what it's called. A first
// guess, for the owner to change: steel, screens, pipes and plain working things are on, and what belongs in a house
// (wood, bright paint, ornaments, toys) is off.
const SHIP_FLOORS = new Set(["Bath_1", "Bath_2", "Black", "BlueLight", "BlueSea", "Bone", "BrokenWhite", "CheckBoardBig", "Concrete", "DarkBlue", "Old", "Serious", "Stone", "White", "WhiteCheck"]);
const SHIP_WALLS = new Set(["ArmyGreen", "Bath", "Black", "BlueLight", "BlueSea", "Bone", "BrokenWhite", "Concrete", "Dark", "DarkBlue", "Grey", "Grey(Plinth)", "Sea", "Serious", "Stone", "White", "WhiteCheck"]);
export function sortOut(folder, key) {
  const is = (pattern) => pattern.test(key);
  switch (folder) {
    case "Bathroom": return { place: "heads", on: !is(/^(Bath$|Bath_Ani|Bath_window|Bath_Carpet|Duck)/i) };
    case "Bedroom": return { place: "quarters", on: is(/^(Bed_[ABC]_|Pillow|Night_Table)/i) };
    case "Books": return { place: "small", on: true };
    case "Carpets": return { place: "quarters", on: false };
    case "Cat_Ani": return { place: "odds", on: false };
    case "Chairs":
      if (is(/^Chair_4|Kitchen_Stool/i)) return { place: "mess", on: true };
      if (is(/^(GChair|Basic_Office|Office_Main)/i)) return { place: "bridge", on: true };
      if (is(/^Chair_6/i)) return { place: "garden", on: true };
      return { place: "quarters", on: false };
    case "Cleaning_Robot_Ani": return { place: "passages", on: true };
    case "Clocks": return { place: "walls", on: !is(/Grandfather/i) };
    case "Computer": return { place: "bridge", on: true };
    case "Consoles": return { place: "odds", on: false };
    case "Desks":
      if (is(/^Desk_3/i)) return { place: "engineering", on: true };
      return { place: "bridge", on: !is(/^Desk_1/i) };
    case "Doors": return { place: "passages", on: is(/Glass/i) };
    case "Japanese_Room":
      if (is(/^Clothes_Case/i)) return { place: "heads", on: true };
      if (is(/^Carton_Box/i)) return { place: "stores", on: true };
      return { place: "quarters", on: false };
    case "Kitchen":
      if (is(/Furniture/i)) return { place: "mess", on: is(/Black|White/i) };
      if (is(/^(Kitchen_Tiles|Wall_Protection|Rack|Shelf)$/i)) return { place: "walls", on: true };
      if (is(/^(Washing_?Machine|Clothes_Basket)/i)) return { place: "heads", on: true };
      if (is(/^Box_2/i)) return { place: "stores", on: true };
      if (is(/^(Kitchen_Window|Painting|Kitchen_Rug|Fidge_Red|Wine|Cereals|Cola)/i)) return { place: "mess", on: false };
      return { place: "mess", on: true };
    case "Lab":
      if (is(/^(Cable|Pipe|Switch|Camera|Screen_Small|Ac_Big_1)/i)) return { place: "walls", on: true };
      if (is(/^Door/i)) return { place: "passages", on: true };
      if (is(/^Microscope/i)) return { place: "medbay", on: true };
      if (is(/^Plastic_Box/i)) return { place: "stores", on: true };
      return { place: "engineering", on: true };
    case "Lamps": return { place: "quarters", on: !is(/Lava|^Lamp_(9|10)$/i) };
    case "Living Roon":
      if (is(/^(AirCC|shelving_6)/i)) return { place: "walls", on: true };
      if (is(/^Book/i)) return { place: "small", on: true };
      return { place: "quarters", on: true };
    case "Office":
      if (is(/^(AC|Board|Corkboard|Glass_Wall|Long_Rack|Photos|Tv|Fire_Extinguisher)/i)) return { place: "walls", on: true };
      if (is(/^Diploma/i)) return { place: "walls", on: false };
      if (is(/^Medical_Kit/i)) return { place: "medbay", on: true };
      if (is(/^(Carton_Box|White_Box|Rack)/i)) return { place: "stores", on: true };
      if (is(/^Office_Metallic_Closet/i)) return { place: "quarters", on: true };
      if (is(/^(Office_Wood_Closet|Office_Partition|Projector|Copy_Machine|Document_Shredder)/i)) return { place: "bridge", on: false };
      if (is(/^Rumba/i)) return { place: "passages", on: true };
      if (is(/^Water_Dispenser/i)) return { place: "mess", on: true };
      if (is(/^(Printer|Telephone)/i)) return { place: "bridge", on: true };
      return { place: "small", on: true };
    case "Plants": return { place: "garden", on: true };
    case "Present": return { place: "odds", on: false };
    case "Sofa": return { place: "quarters", on: !is(/^Sofa_4/i) };
    case "StairCase": return { place: "passages", on: false };
    case "Tables":
      if (is(/^Drawing/i)) return { place: "engineering", on: true };
      return { place: "mess", on: !is(/^(Kitchen_Table|Table_14)/i) };
    case "Televisions_TV": return { place: "walls", on: true };
    case "Wall_Decoration": return { place: "walls", on: is(/^Poster_([1-6]|Map_6|Fire|Medical)$/i) };
    case "Windows": return { place: "walls", on: false };
    case "Floor_Wall_Tiles_128": {
      const wall = /^Wall/i.test(key);
      const name = key.replace(/^(Floor|Wall)_/i, "");
      return { place: wall ? "walls" : "floors", on: (wall ? SHIP_WALLS : SHIP_FLOORS).has(name) };
    }
    default: return { place: "odds", on: false };
  }
}

// What a piece of the second pack is called.
function nameOf(folder, key) {
  const own = NAMES[`${folder}/${key}`];
  if (own) return own;
  if (folder === "Floor_Wall_Tiles_128") {
    const tile = key.match(/^(Floor|Wall)_(.*)$/i);
    if (tile) return `${tile[1][0].toUpperCase()}${tile[1].slice(1).toLowerCase()}, ${pretty(tile[2]).toLowerCase()}`;
  }
  const set = key.match(/^Kitchen_Furniture_(.*)$/i);
  if (set) return `Kitchen units, ${pretty(set[1]).toLowerCase()}`;
  const door = folder === "Doors" && key.match(/^Door_\d+_(.*)$/i);
  if (door) return `House door, ${pretty(door[1]).toLowerCase()}`;
  const book = key.match(/^Book_(Small|Big)_(.*)$/i);
  if (book) return `${pretty(book[1])} book, ${pretty(book[2]).toLowerCase()}`;
  // "Towel_Blue" is "Towel, blue".
  const coloured = key.match(/^(.+)_((?:Light|Bright|Dark)?(?:Blue|Red|Green|Yellow|Orange|Purple|Grey|Pink|Black|White|Beige|Brown)|Dark)$/);
  if (coloured) return `${pretty(coloured[1])}, ${pretty(coloured[2]).toLowerCase()}`;
  return pretty(key);
}

// The pictures a file holds: itself, or each square of a sheet.
function picturesIn(root, file) {
  const inPack = path.relative(root, file).split(path.sep).join("/");
  const size = sizeOf(file);
  const sheet = SHEETS.find((one) => one.of.test(inPack));
  if (!sheet || !size.w) return [{ file: `interiors/${inPack}`, ...size }];
  const w = Math.floor(size.w / sheet.across);
  const h = Math.floor(size.h / sheet.down);
  return Array.from({ length: sheet.frames ?? sheet.across * sheet.down }, (_, i) => ({ file: `interiors/${inPack}`, x: (i % sheet.across) * w, y: Math.floor(i / sheet.across) * h, w, h }));
}

// A PNG's size, from its first bytes.
function sizeOf(file) {
  try {
    const head = Buffer.alloc(24);
    const handle = fs.openSync(file, "r");
    fs.readSync(handle, head, 0, 24, 0);
    fs.closeSync(handle);
    return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
  } catch {
    return { w: 0, h: 0 };
  }
}

const natural = (a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
// A folder's entries in order: by name without ".png", so that "Pot" comes before "Pot_Full", a thing before its
// states.
const byName = (a, b) => natural(a.name.replace(/\.png$/i, ""), b.name.replace(/\.png$/i, ""));
// Every picture under a folder: its own first, then those of the folders inside it.
function pngsIn(dir) {
  const inside = fs.readdirSync(dir, { withFileTypes: true }).sort(byName);
  return [
    ...inside.filter((entry) => !entry.isDirectory() && /\.png$/i.test(entry.name)).map((entry) => path.join(dir, entry.name)),
    ...inside.filter((entry) => entry.isDirectory()).flatMap((entry) => pngsIn(path.join(dir, entry.name))),
  ];
}

function secondPack(root) {
  if (!fs.existsSync(root)) return [];
  const groups = new Map();
  const put = (folder, key, file) => {
    const id = `interiors/${folder}/${key}`;
    if (!groups.has(id)) groups.set(id, { id, folder, key, files: [] });
    groups.get(id).files.push(file);
  };
  const slim = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort(byName)) {
    if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
    const folder = entry.name;
    const dir = path.join(root, folder);
    const inside = fs.readdirSync(dir, { withFileTypes: true }).sort(byName);
    // The pictures lying in the folder itself: a piece for each thing they name. They come first in their piece, so
    // the whole thing is what the catalogue shows, before its drawers and doors.
    for (const one of inside) {
      if (one.isDirectory() || !/\.png$/i.test(one.name) || /_Title\.png$/i.test(one.name)) continue;
      if (folder === "Floor_Wall_Tiles_128") {
        // A wall comes as a left and a right picture; they're one wall. (The bathroom's two are numbered instead.)
        const tile = one.name.replace(/\.png$/i, "").replace(/\(128\)/, "").replace(/^Wall_[LR]_128_/i, "Wall_").replace(/^Floor_128_/i, "Floor_").replace(/^Wall_Bath_\d+$/i, "Wall_Bath");
        put(folder, tile, path.join(dir, one.name));
      } else put(folder, pieceKey(one.name), path.join(dir, one.name));
    }
    // A folder inside it is one thing with its frames, its drawers or its doors: part of the piece its name starts
    // with, if there is one, else a piece of its own. A folder of sets is a piece for each set.
    const known = () => [...groups.values()].filter((group) => group.folder === folder).map((group) => group.key);
    for (const one of inside) {
      if (!one.isDirectory()) continue;
      const sub = path.join(dir, one.name);
      if (SETS.has(`${folder}/${one.name}`)) {
        for (const set of fs.readdirSync(sub, { withFileTypes: true }).sort(byName)) {
          if (set.isDirectory()) for (const file of pngsIn(path.join(sub, set.name))) put(folder, set.name, file);
        }
        continue;
      }
      const whole = pieceKey(one.name);
      const owner = PART_OF[`${folder}/${one.name}`]
        ?? known().filter((key) => slim(key).length >= 4 && slim(whole).startsWith(slim(key))).sort((a, b) => b.length - a.length)[0];
      for (const file of pngsIn(sub)) put(folder, owner ?? one.name, file);
    }
  }
  return [...groups.values()].map((group) => {
    const sorted = sortOut(group.folder, group.key);
    return {
      id: group.id,
      pack: "interiors",
      name: nameOf(group.folder, group.key),
      place: sorted.place,
      on: sorted.on,
      pictures: group.files.flatMap((file) => picturesIn(root, file)),
    };
  });
}

// Every piece the packs in the folder have, with the game's own first guess at where each belongs and whether it goes
// on the ship.
export function packPieces() {
  const dir = licensedDir();
  const first = fs.existsSync(path.join(dir, "isospace", "IsoSpace_Level.png")) ? firstPack() : [];
  return [...first, ...secondPack(path.join(dir, "interiors"))];
}

// ---- The owner's ticks, in plain words ------------------------------------------------------------------------------

const TOP = [
  "The pieces of the two pixel-art packs, and which of them go on the ship.",
  "",
  "How this file works",
  "- Under each place's name there's a line a piece: \"on\" if it goes on the ship or \"off\" if it doesn't, what it's called, and in square brackets where its pictures are in the packs.",
  "- You can change \"on\" to \"off\" or back, move a line under another place's name, and change what a piece is called. Leave what's in the square brackets as it is: that's how the game finds the pictures.",
  "- The Map editor's Pieces window changes this file as well, a click at a time.",
  "- A piece that isn't in here yet gets the game's own first guess.",
];

// Reads the file's words: the pieces it lists, each with its place, its name and whether it's on the ship, and the
// lines it couldn't read.
export function parsePieces(text) {
  const listed = new Map();
  const problems = [];
  let place = null;
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (PLACE_BY_NAME.has(line.toLowerCase())) {
      place = PLACE_BY_NAME.get(line.toLowerCase());
      return;
    }
    const piece = line.match(/^-\s*(on|off)\s*:\s*(.*?)\s*\[([^\]]+)\]\s*$/i);
    if (piece) {
      const id = piece[3].trim();
      if (!place) problems.push(`world/pieces.txt, line ${index + 1}: this piece comes before any place's name, so it isn't under one.`);
      else if (listed.has(id)) problems.push(`world/pieces.txt, line ${index + 1}: "${id}" is listed twice; the first line counts.`);
      else listed.set(id, { id, name: piece[2].trim(), place, on: piece[1].toLowerCase() === "on" });
      return;
    }
    // Anything else before the first place is the file's own explanation.
    if (place && line.startsWith("-")) problems.push(`world/pieces.txt, line ${index + 1}: this line isn't "- on: a name [where it is]" or "- off: a name [where it is]".`);
    else if (place) problems.push(`world/pieces.txt, line ${index + 1}: "${line.slice(0, 40)}" isn't a place's name or a piece.`);
  });
  return { listed, problems };
}

export function writePieces(pieces) {
  const lines = [...TOP];
  for (const place of PLACES) {
    const here = pieces.filter((piece) => piece.place === place.id);
    if (!here.length) continue;
    lines.push("", place.name);
    for (const piece of here) lines.push(`- ${piece.on ? "on" : "off"}: ${piece.name.replace(/[\[\]]/g, "")} [${piece.id}]`);
  }
  return `${lines.join("\n")}\n`;
}

function readFile() {
  const file = piecesFile();
  if (!fs.existsSync(file)) return { listed: new Map(), problems: [], saved: false };
  return { ...parsePieces(fs.readFileSync(file, "utf8")), saved: true };
}

// The catalogue as the window shows it: every piece of the packs, as the file has it where it has it, and the pieces
// the file lists that the packs in the folder don't have (they keep their line and have no picture).
export function catalogue() {
  const { listed, problems, saved } = readFile();
  const fromPacks = packPieces();
  const seen = new Set();
  const pieces = fromPacks.map((piece) => {
    seen.add(piece.id);
    const own = listed.get(piece.id);
    return { ...piece, name: own?.name || piece.name, place: own?.place ?? piece.place, on: own ? own.on : piece.on, guessed: !own };
  });
  for (const own of listed.values()) {
    if (!seen.has(own.id)) pieces.push({ ...own, pack: own.id.split("/")[0], pictures: [], guessed: false, missing: true });
  }
  const order = new Map(PLACES.map((place, i) => [place.id, i]));
  pieces.sort((a, b) => order.get(a.place) - order.get(b.place) || natural(a.name, b.name) || natural(a.id, b.id));
  return {
    places: PLACES,
    packs: Object.fromEntries(Object.keys(PACKS).map((pack) => [pack, fromPacks.some((piece) => piece.pack === pack)])),
    packNames: PACKS,
    pieces,
    saved,
    problems,
  };
}

// What the window changed: each { id } with on (true or false), place (a place's id) or both. The whole catalogue is
// written out, so every piece has its line from then on.
export function setPieces(changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("Nothing to change.");
  const now = catalogue();
  const byId = new Map(now.pieces.map((piece) => [piece.id, piece]));
  for (const change of changes) {
    const piece = byId.get(String(change?.id ?? ""));
    if (!piece) throw new Error("That piece isn't in the packs.");
    if (change.place !== undefined && !PLACE_IDS.has(change.place)) throw new Error("That isn't one of the places a piece can belong.");
  }
  for (const change of changes) {
    const piece = byId.get(String(change.id));
    if (change.on !== undefined) piece.on = Boolean(change.on);
    if (change.place !== undefined) piece.place = change.place;
  }
  fs.writeFileSync(piecesFile(), writePieces(now.pieces));
  return { on: now.pieces.filter((piece) => piece.on).length, of: now.pieces.length };
}

// For npm run check-story: lines of the file the game can't read. A piece the packs here don't have isn't a problem:
// the packs are only on the owner's computer.
export function piecesProblems() {
  return readFile().problems;
}
addChecker(piecesProblems);
