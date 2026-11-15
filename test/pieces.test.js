// The catalogue of the bought packs' pieces (src/pieces.js): how pictures are gathered into pieces, where each is
// sorted and which are ticked to begin with, and the plain-text file that keeps the owner's ticks. It plays on a
// made-up pack in a temporary folder, with pictures that are only a size, so the real packs and the real file are
// never touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLACES, catalogue, licensedDir, packPieces, parsePieces, pieceKey, piecesFile, piecesProblems, pretty, setPieces, sortOut, writePieces } from "../src/pieces.js";

// A picture file that says how big it is and nothing else: all the catalogue reads of one.
function png(w, h) {
  const file = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(file, 0);
  file.writeUInt32BE(13, 8);
  file.write("IHDR", 12, "ascii");
  file.writeUInt32BE(w, 16);
  file.writeUInt32BE(h, 20);
  return file;
}

const PACK = {
  "isospace/IsoSpace_Level.png": [1024, 1024], "isospace/IsoSpace_Assets.png": [1024, 1024], "isospace/IsoSpace_Doors.png": [1024, 1024],
  "interiors/@Pixel_Salvaje.png": [400, 400],
  "interiors/Chairs/Chair_4_A_Tile.png": [128, 128], "interiors/Chairs/Chair_4_B_Tile.png": [128, 128], "interiors/Chairs/Chair_4_C_Tile.png": [128, 128], "interiors/Chairs/Chair_4_D_Tile.png": [128, 128],
  "interiors/Chairs/Chair_2_A_Tile.png": [128, 128],
  "interiors/Kitchen/Fridge.png": [128, 128], "interiors/Kitchen/Fridge/Fridge_Open.png": [128, 128], "interiors/Kitchen/Fridge/Fridge_Doors/Door_1.png": [64, 64],
  "interiors/Kitchen/Fidge_Red.png": [128, 128], "interiors/Kitchen/Fridge_Red_Doors/Door_1.png": [64, 64],
  "interiors/Kitchen/Oven.png": [128, 128], "interiors/Kitchen/Oven_Doors/Oven_Door_1.png": [64, 64],
  "interiors/Kitchen/Pot.png": [32, 32], "interiors/Kitchen/Pot_Full.png": [32, 32],
  "interiors/Kitchen/Kitchen Furnitures Colors/Kitchen_Furniture_Black/Unit_1.png": [128, 128], "interiors/Kitchen/Kitchen Furnitures Colors/Kitchen_Furniture_Black/Unit_2.png": [128, 128],
  "interiors/Kitchen/Kitchen Furnitures Colors/Kitchen_Furniture_Pink/Unit_1.png": [128, 128],
  "interiors/Doors/Door_6_Blue.png": [640, 128],
  "interiors/Books/Books_Title.png": [438, 400], "interiors/Books/Book_Small_Blue.png": [128, 128], "interiors/Books/Ring_Binder_Dark.png": [32, 32],
  "interiors/Floor_Wall_Tiles_128/Floor_128_Black.png": [128, 128], "interiors/Floor_Wall_Tiles_128/Wall_L_128_Black.png": [128, 128], "interiors/Floor_Wall_Tiles_128/Wall_R_128_Black.png": [128, 128],
  "interiors/Floor_Wall_Tiles_128/Floor_128_Love.png": [128, 128], "interiors/Floor_Wall_Tiles_128/Wall_Bath_1(128).png": [128, 128], "interiors/Floor_Wall_Tiles_128/Wall_Bath_2(128).png": [128, 128],
  "interiors/Floor_Wall_Tiles_64/Floor_64_Black.png": [64, 64],
  "interiors/Japanese_Room/Japanese_Cup.png": [32, 32], "interiors/Japanese_Room/Japanese_Door/Door_1.png": [128, 128], "interiors/Japanese_Room/Japanese_Door_Animation(Light)/Door_1.png": [128, 128],
  "interiors/Lab/Camera_1_Ani.png": [256, 256], "interiors/Lab/Pipe_Corner.png": [64, 64],
  "interiors/Clocks/Grandfather_Clock_Ani.png": [512, 256],
  "interiors/Office/Office_Metallic_Closet_Ani/Metallic_Closet_Base.png": [128, 128], "interiors/Office/Office_Metallic_Closet_Ani/Metallic_Closet_Door.png": [128, 128],
  "interiors/Mystery/Odd_Thing.png": [16, 16],
};

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pieces-test-"));
function makePack(files = PACK) {
  const dir = fs.mkdtempSync(path.join(folder, "pack-"));
  for (const [file, [w, h]] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), png(w, h));
  }
  return dir;
}
// Every test gets a file of its own, and the made-up pack unless it brings another.
let files = 0;
function setUp(pack = PACK) {
  process.env.GAME_LICENSED_DIR = makePack(pack);
  process.env.GAME_PIECES_FILE = path.join(folder, `pieces-${(files += 1)}.txt`);
  return process.env.GAME_PIECES_FILE;
}
const byId = (list) => new Map(list.map((piece) => [piece.id, piece]));
test.after(() => fs.rmSync(folder, { recursive: true, force: true }));

test("a picture's name says what piece it's of, whatever side, state or frame it is", () => {
  const same = (names, key) => { for (const name of names) assert.equal(pieceKey(name), key, name); };
  same(["Chair_4_A_Tile.png", "Chair_4_B_Tile.png", "Chair_4_D_Tile.png"], "Chair_4");
  same(["Board_Empty.png", "Board_Full.png"], "Board");
  same(["TrashBin_Closed.png", "TrashBin_Open.png"], "TrashBin");
  same(["Macbook_1_Tile_Ani_3.png", "Macbook_1_Closed_Tile.png"], "Macbook_1");
  same(["Night_Table_Tile(Drawer_1).png", "Night_Table_Tile.png"], "Night_Table");
  same(["3D_Printer_Cup.png", "3D_Printer_Empty.png"], "3D_Printer");
  same(["Camera_1_Ani.png"], "Camera_1");
  same(["Japanese_Door_Animation(Light)"], "Japanese_Door");
  // A letter in the middle is a different thing, not a side of one.
  assert.notEqual(pieceKey("Bed_A_4.png"), pieceKey("Bed_B_4.png"));
  // A cup is only a state of the printer.
  assert.equal(pieceKey("Japanese_Cup.png"), "Japanese_Cup");
});

test("what the pack calls something reads as words", () => {
  assert.equal(pretty("LavaLamp_Ani"), "Lava lamp");
  assert.equal(pretty("StairRailing_2"), "Stair railing 2");
  assert.equal(pretty("Grey(Plinth)"), "Grey plinth");
  assert.equal(pretty("Japanese_Door_Animation"), "Japanese door");
});

test("steel, screens and plain working things are ticked to begin with, and what belongs in a house isn't", () => {
  assert.deepEqual(sortOut("Lab", "Pipe_Corner"), { place: "walls", on: true });
  assert.deepEqual(sortOut("Lab", "Welder_Machine"), { place: "engineering", on: true });
  assert.deepEqual(sortOut("Computer", "OldPC"), { place: "bridge", on: true });
  assert.deepEqual(sortOut("Chairs", "Chair_4"), { place: "mess", on: true });
  assert.deepEqual(sortOut("Chairs", "Chair_2"), { place: "quarters", on: false });
  assert.deepEqual(sortOut("Japanese_Room", "Japanese_Vase"), { place: "quarters", on: false });
  assert.deepEqual(sortOut("Consoles", "Gameboy"), { place: "odds", on: false });
  assert.deepEqual(sortOut("Bathroom", "Bath_Ani"), { place: "heads", on: false });
  assert.deepEqual(sortOut("Bathroom", "WC_Ani"), { place: "heads", on: true });
  assert.deepEqual(sortOut("Wall_Decoration", "Poster_6"), { place: "walls", on: true });
  assert.deepEqual(sortOut("Wall_Decoration", "Poster_17"), { place: "walls", on: false });
  assert.deepEqual(sortOut("Floor_Wall_Tiles_128", "Floor_DarkBlue"), { place: "floors", on: true });
  assert.deepEqual(sortOut("Floor_Wall_Tiles_128", "Floor_Love"), { place: "floors", on: false });
  assert.deepEqual(sortOut("Floor_Wall_Tiles_128", "Wall_Grey(Plinth)"), { place: "walls", on: true });
  // A floor and a wall of the same name are judged apart.
  assert.equal(sortOut("Floor_Wall_Tiles_128", "Floor_Sea").on, false);
  assert.equal(sortOut("Floor_Wall_Tiles_128", "Wall_Sea").on, true);
  // A folder the game has never seen is left out until someone ticks it.
  assert.deepEqual(sortOut("Mystery", "Odd_Thing"), { place: "odds", on: false });
  for (const [folderName, key] of [["Lab", "Tools"], ["Kitchen", "Oven"], ["Mystery", "Odd_Thing"]]) assert.ok(PLACES.some((place) => place.id === sortOut(folderName, key).place));
});

test("the first pack's three sheets are cut into its floors, walls, stairs, doors and furniture", () => {
  setUp();
  const first = packPieces().filter((piece) => piece.pack === "isospace");
  assert.equal(first.length, 47);
  assert.ok(first.every((piece) => piece.on));
  assert.equal(first.filter((piece) => piece.place === "floors").length, 13);
  const pieces = byId(first);
  assert.deepEqual(pieces.get("isospace/floor-dark-1").pictures, [{ file: "isospace/IsoSpace_Level.png", x: 0, y: 0, w: 128, h: 128 }]);
  assert.deepEqual(pieces.get("isospace/floor-light-1").pictures[0], { file: "isospace/IsoSpace_Level.png", x: 0, y: 512, w: 128, h: 128 });
  // A wall is drawn running both ways; a door is sixteen frames each way.
  assert.equal(pieces.get("isospace/wall-dark-1").pictures.length, 2);
  assert.equal(pieces.get("isospace/door-dark").pictures.length, 32);
  assert.equal(pieces.get("isospace/door-light").pictures[0].y, 512);
  assert.equal(pieces.get("isospace/console").pictures[0].file, "isospace/IsoSpace_Assets.png");
  // No square of a sheet is in two pieces.
  const seen = new Set();
  for (const piece of first) for (const picture of piece.pictures) {
    const key = `${picture.file}|${picture.x}|${picture.y}`;
    assert.ok(!seen.has(key), key);
    seen.add(key);
  }
});

test("the second pack's files are gathered into pieces by their names and folders", () => {
  setUp();
  const pieces = byId(packPieces());
  const files = (id) => pieces.get(id).pictures.map((picture) => picture.file.replace("interiors/", ""));
  // A chair's four sides are one chair; one that has only one side is still a chair.
  assert.equal(pieces.get("interiors/Chairs/Chair_4").pictures.length, 4);
  assert.equal(pieces.get("interiors/Chairs/Chair_4").name, "Plastic chair, blue");
  assert.equal(pieces.get("interiors/Chairs/Chair_2").pictures.length, 1);
  // A thing and the folder of its doors are one piece, the whole thing first.
  assert.deepEqual(files("interiors/Kitchen/Fridge"), ["Kitchen/Fridge.png", "Kitchen/Fridge/Fridge_Open.png", "Kitchen/Fridge/Fridge_Doors/Door_1.png"]);
  assert.deepEqual(files("interiors/Kitchen/Oven"), ["Kitchen/Oven.png", "Kitchen/Oven_Doors/Oven_Door_1.png"]);
  // The red fridge's doors are the red fridge's, though the pack spells them differently.
  assert.deepEqual(files("interiors/Kitchen/Fidge_Red"), ["Kitchen/Fidge_Red.png", "Kitchen/Fridge_Red_Doors/Door_1.png"]);
  assert.deepEqual(files("interiors/Kitchen/Pot"), ["Kitchen/Pot.png", "Kitchen/Pot_Full.png"]);
  // A folder of sets is a piece a set.
  assert.equal(pieces.get("interiors/Kitchen/Kitchen_Furniture_Black").pictures.length, 2);
  assert.equal(pieces.get("interiors/Kitchen/Kitchen_Furniture_Black").name, "Kitchen units, black");
  assert.equal(pieces.get("interiors/Kitchen/Kitchen_Furniture_Black").on, true);
  assert.equal(pieces.get("interiors/Kitchen/Kitchen_Furniture_Pink").on, false);
  // A folder with nothing of the same name beside it is a piece of its own, under the folder's name.
  assert.equal(pieces.get("interiors/Office/Office_Metallic_Closet_Ani").pictures.length, 2);
  assert.equal(pieces.get("interiors/Office/Office_Metallic_Closet_Ani").name, "Steel locker");
  // Two folders of the same door are one door, and the cup beside them isn't part of it.
  assert.equal(pieces.get("interiors/Japanese_Room/Japanese_Door").pictures.length, 2);
  assert.equal(pieces.get("interiors/Japanese_Room/Japanese_Cup").pictures.length, 1);
  // A wall's left and right pictures are one wall, and so are the bathroom's two numbered ones.
  assert.equal(pieces.get("interiors/Floor_Wall_Tiles_128/Wall_Black").pictures.length, 2);
  assert.equal(pieces.get("interiors/Floor_Wall_Tiles_128/Wall_Bath").pictures.length, 2);
  assert.equal(pieces.get("interiors/Floor_Wall_Tiles_128/Wall_Bath").name, "Wall, pale aqua");
  assert.equal(pieces.get("interiors/Floor_Wall_Tiles_128/Floor_Love").name, "Floor, love");
  // Names made from the pack's own.
  assert.equal(pieces.get("interiors/Books/Ring_Binder_Dark").name, "Ring binder, dark");
  assert.equal(pieces.get("interiors/Books/Book_Small_Blue").name, "Small book, blue");
  assert.equal(pieces.get("interiors/Doors/Door_6_Blue").name, "House door, blue");
  assert.equal(pieces.get("interiors/Mystery/Odd_Thing").name, "Odd thing");
  // What isn't a piece: the pack's own advertising, title cards, and the same tiles at sizes the game doesn't use.
  const all = [...pieces.values()].flatMap((piece) => piece.pictures.map((picture) => picture.file));
  for (const left of ["@Pixel_Salvaje", "Books_Title", "Floor_Wall_Tiles_64"]) assert.ok(!all.some((file) => file.includes(left)), left);
  // Every other picture of the pack is in exactly one piece.
  const wanted = Object.keys(PACK).filter((file) => file.startsWith("interiors/") && !/@Pixel|_Title|Tiles_64/.test(file));
  assert.deepEqual([...new Set(all.filter((file) => file.startsWith("interiors/")))].sort(), wanted.sort());
  for (const piece of pieces.values()) for (const picture of piece.pictures) assert.ok(picture.w > 0 && picture.h > 0, picture.file);
});

test("a file that's several pictures side by side counts as each of them", () => {
  setUp();
  const pieces = byId(packPieces());
  // A door's five frames in a strip.
  const door = pieces.get("interiors/Doors/Door_6_Blue").pictures;
  assert.deepEqual(door.map((picture) => [picture.x, picture.y, picture.w, picture.h]), [[0, 0, 128, 128], [128, 0, 128, 128], [256, 0, 128, 128], [384, 0, 128, 128], [512, 0, 128, 128]]);
  assert.ok(door.every((picture) => picture.file === "interiors/Doors/Door_6_Blue.png"));
  // A book seen sixteen ways, four across and four down.
  const book = pieces.get("interiors/Books/Book_Small_Blue").pictures;
  assert.equal(book.length, 16);
  assert.deepEqual([book[5].x, book[5].y, book[5].w, book[5].h], [32, 32, 32, 32]);
  assert.equal(pieces.get("interiors/Lab/Camera_1").pictures.length, 16);
  assert.equal(pieces.get("interiors/Lab/Camera_1").pictures[15].x, 192);
  // The clock's sheet has room for eight and holds seven.
  assert.equal(pieces.get("interiors/Clocks/Grandfather_Clock").pictures.length, 7);
  // A picture that's one picture has no square of its own.
  assert.deepEqual(pieces.get("interiors/Lab/Pipe_Corner").pictures, [{ file: "interiors/Lab/Pipe_Corner.png", w: 64, h: 64 }]);
});

test("the catalogue is in the places' order, and until a tick is changed nothing is written", () => {
  const file = setUp();
  const all = catalogue();
  assert.equal(all.saved, false);
  assert.deepEqual(all.packs, { isospace: true, interiors: true });
  assert.deepEqual(all.places.map((place) => place.id), PLACES.map((place) => place.id));
  assert.ok(all.pieces.every((piece) => piece.guessed === true && !piece.missing));
  const order = all.pieces.map((piece) => PLACES.findIndex((place) => place.id === piece.place));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const mess = all.pieces.filter((piece) => piece.place === "mess").map((piece) => piece.name);
  assert.deepEqual(mess, [...mess].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })));
  assert.equal(new Set(all.pieces.map((piece) => piece.id)).size, all.pieces.length);
  assert.ok(!fs.existsSync(file));
  assert.deepEqual(piecesProblems(), []);
});

test("a changed tick writes the whole catalogue out in plain words, and it reads back the same", () => {
  const file = setUp();
  const before = catalogue();
  const chair = before.pieces.find((piece) => piece.id === "interiors/Chairs/Chair_4");
  const result = setPieces([{ id: chair.id, on: false }]);
  assert.deepEqual(result, { on: before.pieces.filter((piece) => piece.on).length - 1, of: before.pieces.length });
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^The pieces of the two pixel-art packs/);
  assert.match(text, /\nMess and galley\n/);
  assert.match(text, /\n- off: Plastic chair, blue \[interiors\/Chairs\/Chair_4\]\n/);
  assert.match(text, /\n- on: Dark floor, plain plating \[isospace\/floor-dark-1\]\n/);
  const after = catalogue();
  assert.equal(after.saved, true);
  assert.deepEqual(after.problems, []);
  assert.ok(after.pieces.every((piece) => piece.guessed === false));
  assert.equal(byId(after.pieces).get(chair.id).on, false);
  // Nothing else moved.
  const plain = (list) => list.map((piece) => [piece.id, piece.name, piece.place, piece.id === chair.id ? null : piece.on]);
  assert.deepEqual(plain(after.pieces), plain(before.pieces));
  // The file's words are the catalogue, exactly.
  const { listed, problems } = parsePieces(text);
  assert.deepEqual(problems, []);
  assert.deepEqual([...listed.values()], after.pieces.map((piece) => ({ id: piece.id, name: piece.name, place: piece.place, on: piece.on })));
  assert.equal(writePieces(after.pieces), text);
});

test("a piece can be moved to another place, and ticked in the same go", () => {
  setUp();
  setPieces([{ id: "interiors/Lab/Pipe_Corner", place: "engineering" }, { id: "interiors/Mystery/Odd_Thing", place: "stores", on: true }]);
  const pieces = byId(catalogue().pieces);
  assert.equal(pieces.get("interiors/Lab/Pipe_Corner").place, "engineering");
  assert.equal(pieces.get("interiors/Lab/Pipe_Corner").on, true);
  assert.deepEqual([pieces.get("interiors/Mystery/Odd_Thing").place, pieces.get("interiors/Mystery/Odd_Thing").on], ["stores", true]);
});

test("what can't be done is refused, and nothing is written", () => {
  const file = setUp();
  assert.throws(() => setPieces([]), /Nothing to change/);
  assert.throws(() => setPieces(null), /Nothing to change/);
  assert.throws(() => setPieces([{ id: "interiors/Chairs/Chair_99", on: true }]), /isn't in the packs/);
  assert.throws(() => setPieces([{ id: "interiors/Chairs/Chair_4", on: false }, { id: "interiors/Lab/Pipe_Corner", place: "the moon" }]), /places a piece can belong/);
  assert.ok(!fs.existsSync(file));
  assert.equal(byId(catalogue().pieces).get("interiors/Chairs/Chair_4").on, true);
});

test("once the file is there it wins: a line changed by hand is how the piece is", () => {
  const file = setUp();
  setPieces([{ id: "interiors/Chairs/Chair_4", on: true }]);
  let text = fs.readFileSync(file, "utf8");
  // Renamed, left out and moved under another place, all by hand; a line for a piece this computer's packs don't have.
  text = text.replace("\n- on: Plastic chair, blue [interiors/Chairs/Chair_4]", "");
  text = text.replace("\nMedbay\n", "\nMedbay\n- OFF :  Waiting-room chair   [interiors/Chairs/Chair_4]\n- on: A thing from a newer pack [interiors/Lab/Not_Here_Yet]\n");
  assert.ok(text.includes("Waiting-room chair"), "the made-up pack has something under Medbay to put the line by");
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"));
  const all = catalogue();
  assert.deepEqual(all.problems, []);
  const chair = byId(all.pieces).get("interiors/Chairs/Chair_4");
  assert.deepEqual([chair.name, chair.place, chair.on, chair.pictures.length], ["Waiting-room chair", "medbay", false, 4]);
  const gone = byId(all.pieces).get("interiors/Lab/Not_Here_Yet");
  assert.deepEqual([gone.name, gone.place, gone.on, gone.missing, gone.pictures.length, gone.pack], ["A thing from a newer pack", "medbay", true, true, 0, "interiors"]);
  // Another change from the window keeps both.
  setPieces([{ id: "interiors/Lab/Pipe_Corner", on: false }]);
  const again = byId(catalogue().pieces);
  assert.equal(again.get("interiors/Chairs/Chair_4").name, "Waiting-room chair");
  assert.equal(again.get("interiors/Lab/Not_Here_Yet").missing, true);
  assert.equal(again.get("interiors/Lab/Pipe_Corner").on, false);
});

test("a piece the file doesn't have yet gets the game's first guess", () => {
  const file = setUp();
  setPieces([{ id: "interiors/Chairs/Chair_4", on: false }]);
  const without = fs.readFileSync(file, "utf8").split("\n").filter((line) => !line.includes("[interiors/Lab/Pipe_Corner]")).join("\n");
  fs.writeFileSync(file, without);
  const pipe = byId(catalogue().pieces).get("interiors/Lab/Pipe_Corner");
  assert.deepEqual([pipe.place, pipe.on, pipe.guessed], ["walls", true, true]);
});

test("lines of the file that can't be read are named with their line, and the rest still reads", () => {
  const file = setUp();
  fs.writeFileSync(file, [
    "A few words of my own at the top.",
    "- on: Before any place [interiors/Lab/Pipe_Corner]",
    "",
    "Bridge and command",
    "- on: Plastic chair, blue [interiors/Chairs/Chair_4]",
    "- maybe: Wooden chair [interiors/Chairs/Chair_2]",
    "- off: Plastic chair again [interiors/Chairs/Chair_4]",
    "Somewhere that isn't a place",
    "QUARTERS",
    "- off: Wooden chair [interiors/Chairs/Chair_2]",
  ].join("\n"));
  const problems = piecesProblems();
  assert.equal(problems.length, 4);
  assert.match(problems[0], /line 2: this piece comes before any place's name/);
  assert.match(problems[1], /line 6: this line isn't "- on: a name \[where it is\]"/);
  assert.match(problems[2], /line 7: "interiors\/Chairs\/Chair_4" is listed twice/);
  assert.match(problems[3], /line 8: "Somewhere that isn't a place" isn't a place's name or a piece/);
  const pieces = byId(catalogue().pieces);
  assert.deepEqual([pieces.get("interiors/Chairs/Chair_4").place, pieces.get("interiors/Chairs/Chair_4").on], ["bridge", true]);
  assert.deepEqual([pieces.get("interiors/Chairs/Chair_2").place, pieces.get("interiors/Chairs/Chair_2").on], ["quarters", false]);
});

test("without the packs there's nothing to show, and a file that's there still reads", () => {
  const file = setUp({});
  const none = catalogue();
  assert.deepEqual(none.packs, { isospace: false, interiors: false });
  assert.deepEqual(none.pieces, []);
  assert.throws(() => setPieces([{ id: "isospace/console", on: false }]), /isn't in the packs/);
  fs.writeFileSync(file, "Bridge and command\n- on: Control console [isospace/console]\n- off: Old beige computer [interiors/Computer/OldPC]\n");
  const listed = catalogue();
  assert.deepEqual(listed.pieces.map((piece) => [piece.id, piece.pack, piece.on, piece.missing, piece.pictures.length]), [["isospace/console", "isospace", true, true, 0], ["interiors/Computer/OldPC", "interiors", false, true, 0]]);
  assert.deepEqual(piecesProblems(), []);
  // One pack without the other.
  setUp(Object.fromEntries(Object.entries(PACK).filter(([name]) => name.startsWith("isospace/"))));
  assert.deepEqual(catalogue().packs, { isospace: true, interiors: false });
  assert.equal(catalogue().pieces.length, 47);
});

test("left to themselves, the catalogue reads licensed/ and keeps its ticks in world/pieces.txt", () => {
  const { GAME_LICENSED_DIR, GAME_PIECES_FILE } = process.env;
  delete process.env.GAME_LICENSED_DIR;
  delete process.env.GAME_PIECES_FILE;
  try {
    assert.equal(path.basename(licensedDir()), "licensed");
    assert.deepEqual(piecesFile().split(path.sep).slice(-2), ["world", "pieces.txt"]);
  } finally {
    process.env.GAME_LICENSED_DIR = GAME_LICENSED_DIR;
    process.env.GAME_PIECES_FILE = GAME_PIECES_FILE;
  }
});
