"""Builds one room of a deck drawn in Tiled out of a modular 3D kit, in Blender, and renders it at the game's angle.

A test of the pre-rendered look (docs/notes/project-tiled.md). It changes nothing in the game.

Run it with Blender, from anywhere:

  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P tools/blender-room.py -- --out bridge.png
  ... the same, then -- --kit quaternius --out bridge.png

Options after the "--":
  --map   the deck's .tmj file            (world/maps/meridian/deck1.tmj)
  --room  the id of a Room on it           (bridge)
  --kit   which kit: kenney or quaternius  (kenney); KITS below says how each is built
  --out   the picture to write             (needed)
  --blend also save the scene as a .blend file, to open in Blender
  --tint  paint Kenney's kit navy grey, or give Quaternius's its plain grey trim in place of its red

The map is read by the game's own reader, src/tiled.js, through Node, so the room is exactly the one the game plays.

How the game's map becomes pieces:
- Blender's unit is one Tiled tile (128 by 64 pixels on screen), about a metre in the game, where people stand about
  1.7 high. The game's squares are half a tile across and a whole tile deep, so anything a square wide is a kit piece
  squeezed to half.
- Floor plates go on every square of the room that isn't wall; a door's square gets one too. A kit whose plates are
  bigger than a tile lays them whole where they fit, and smaller where they don't.
- Walls go along every edge between the room's floor and a wall or door square, facing the floor, with a door piece
  where the square behind is a door. A wall that steps one square at a time, as the bow does, becomes one straight
  slanted wall through the middle of the steps.
- Walls between the camera and the room are cut low, by the game's own rule (public/iso.js: a wall with the room's
  floor behind it, from the camera's side). Every other wall stands as high as its kit says (KITS).
- Machines drawn in a row on the plan ([====]) become a bank of consoles. Things the room's file names are matched by
  their words to a piece (each kit's things); a thing nothing matches is a crate, and the script says so. A kit can
  borrow a piece it hasn't got from Kenney's, painted navy grey.
- People aren't built: the game draws them.

The camera: the game draws a point (x, y, z) at ((x - y) / 2, (x + y) / 4 - z / 2) tiles (project in public/iso.js),
which is 2:1 on the floor but shorter upwards than a true camera from that angle would see. So the camera is a true
orthographic one, 30 degrees down and 45 round, and the whole room is squashed upwards by sqrt(2/3) to make up for it:
heights here are the game's own, and a tile comes out 128 by 64 pixels.
"""

import json
import math
import os
import subprocess
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# The game's numbers (public/iso.js).
WALL_HEIGHT = 1.7
CUT_WALL_HEIGHT = 0.24
TILE_PIXELS = 128  # a tile's width on screen; its height is half that
UPWARDS = math.sqrt(2 / 3)  # how much shorter the game draws heights than a true camera from its angle would

LOW_THICK = 0.3  # how thick a slanted wall cut low is

# How each kit is built. Every size is in the kit's own units, and tiles is how many tiles one of them is.
# - floor: the plate for whole tiles, floor_size its width, floor_top how high its top is, floor_blocks the sizes in
#   tiles it's laid at, largest first (each a whole plate squeezed to fit); half_floor the plate for half a tile.
# - wall, window, door, wide_door: the pieces along the outline (door None: a gap). Each is turned by wall_turn degrees
#   and moved by wall_shift so that it runs along x with the side that faces the room at y = 0, and its body behind.
#   wall_length is how long one is; wall_height how high it should stand in the game's units (None: as high as the kit
#   made it, kit_wall_height); core_inset how far a wall's top block keeps back from the room's side.
# - consoles: the pieces a row of machine squares is made of, one every console_every tiles. prop_scale: how much
#   bigger than the kit made it a piece of furniture stands. Furniture faces the kit's -y.
# - things: a thing's name, matched by its words, to its piece; the first match wins. A piece can be ("kenney", name,
#   scale), borrowed from Kenney's kit and painted navy grey. crate stands for a thing nothing matches, post for a post.
KITS = {
    # Kenney's Space Station Kit: chunky and small (a door is 0.7 high), on a grid of 1. Its walls are stretched to the
    # game's height and its furniture scaled up, or the game's people would tower over both.
    "kenney": {
        "folder": os.path.join(ROOT, "art", "kenney-space-station-kit", "glb"),
        "files": ".glb",
        "tiles": 1.0,
        "floor": "floor-panel", "floor_size": 1.0, "floor_top": 0.3, "floor_blocks": [1], "half_floor": "floor",
        "wall": "wall", "window": "wall-window", "door": "wall-door", "wide_door": "wall-door-wide",
        "wall_turn": 0, "wall_shift": (0.0, -0.15), "wall_length": 1.0, "kit_wall_height": 1.0, "wall_height": WALL_HEIGHT,
        "core_inset": 0.15, "low_color": (0.36, 0.37, 0.48, 1.0), "tint_low_color": (0.2, 0.24, 0.3, 1.0),
        "consoles": ["computer-wide", "computer-screen"], "console_every": 0.9, "prop_scale": 1.3,
        "crate": "container", "post": "wall-pillar",
        "things": [
            (("viewport", "window", "porthole"), "window"),
            (("chair", "seat", "bench", "stool"), "chair-armrest-headrest"),
            (("plot", "chart table", "map table", "holo"), "table-display-planet"),
            (("locker", "cabinet", "wardrobe", "footlocker"), "container-tall"),
            (("repeater", "screen", "display", "monitor"), "computer-screen"),
            (("console", "terminal", "computer", "station"), "computer"),
            (("tray", "chip", "desk"), "table-display-small"),
            (("table",), "table"),
            (("crate", "box", "barrel", "container"), "container"),
            (("bed", "bunk", "cot"), "bed-single"),
        ],
    },
    # Quaternius's Modular Sci-Fi MegaKit (the free part): real size, a metre to a unit, so a unit is a tile. Its floor
    # plates and walls are 4 metres, its walls 3 high (the game's are 1.7), and it has no chairs, tables or lockers.
    "quaternius": {
        "folder": os.path.join(ROOT, "art", "quaternius-scifi-megakit", "gltf"),
        "files": ".gltf",
        "tiles": 1.0,
        "floor": "Platform_Metal", "floor_size": 4.0, "floor_top": 0.0, "floor_blocks": [4, 2, 1], "half_floor": "Platform_Metal",
        "wall": "WallBand_Straight", "window": "WallWindow_Straight", "door": None, "wide_door": None,
        "wall_turn": 90, "wall_shift": (0.0, 2.0), "wall_length": 4.0, "kit_wall_height": 3.0, "wall_height": None,
        "core_inset": 0.02, "low_color": (0.05, 0.053, 0.06, 1.0), "tint_low_color": (0.04, 0.05, 0.07, 1.0),
        # --tint gives it the plain grey trim it comes with in place of its red (its blue one turns everything blue).
        "tint_swap": {"T_Trim_02_BaseColor_Red.png": "T_Trim_02_BaseColor.png", "T_Trim_01_BaseColor_Red.png": "T_Trim_01_BaseColor.png"},
        "consoles": ["Prop_Computer"], "console_every": 1.0, "prop_scale": 1.0,
        "crate": "Prop_Crate4", "post": "Column_Simple",
        "things": [
            (("viewport", "window", "porthole"), "window"),
            (("chair", "seat", "bench", "stool"), ("kenney", "chair-armrest-headrest", 2.0)),
            (("plot", "chart table", "map table", "holo"), ("kenney", "table-display-planet", 2.4)),
            (("locker", "cabinet", "wardrobe", "footlocker"), ("kenney", "container-tall", 2.0)),
            (("repeater", "screen", "display", "monitor", "console", "terminal", "computer", "station"), "Prop_Computer"),
            (("tray", "chip", "desk"), "Prop_ItemHolder"),
            (("table",), ("kenney", "table", 2.0)),
            (("crate", "box", "barrel", "container"), "Prop_Crate4"),
            (("bed", "bunk", "cot"), ("kenney", "bed-single", 2.0)),
        ],
    },
}

MACHINE_MARKS = set("[]=()")
WALL_MARKS = {"#"}
DOOR_MARKS = {"+"}
POST_MARKS = {"|"}
EMPTY_MARKS = {" ", "*", "'"}  # nothing, and the stars outside


def options():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    found = {
        "map": os.path.join(ROOT, "world", "maps", "meridian", "deck1.tmj"),
        "room": "bridge",
        "kit": "kenney",
        "out": None,
        "blend": None,
        "tint": False,
    }
    i = 0
    while i < len(args):
        key = args[i].lstrip("-")
        if key == "tint":
            found["tint"] = True
            i += 1
            continue
        if key not in found or i + 1 >= len(args):
            sys.exit(f"blender-room: I don't know the option {args[i]}")
        found[key] = args[i + 1]
        i += 2
    if not found["out"]:
        sys.exit("blender-room: say where the picture goes, with --out file.png")
    if found["kit"] not in KITS:
        sys.exit(f"blender-room: I don't know the kit {found['kit']}; there are {', '.join(KITS)}")
    return found


# ---- The map, read by the game's own reader ------------------------------------------------------------------

READER = """
import { pathToFileURL } from "node:url";
const [tiled, file] = process.argv.slice(1);
const { readMapFile, roomFromMap } = await import(pathToFileURL(tiled).href);
const { level, problems } = roomFromMap(readMapFile(file));
process.stdout.write(JSON.stringify({ level, problems }));
"""


def read_level(map_file):
    tiled = os.path.join(ROOT, "src", "tiled.js")
    run = subprocess.run(["node", "--input-type=module", "-e", READER, tiled, map_file], capture_output=True, text=True, encoding="utf-8")
    if run.returncode != 0:
        sys.exit(f"blender-room: the game couldn't read {map_file}:\n{run.stderr}")
    found = json.loads(run.stdout)
    for problem in found["problems"]:
        print(f"blender-room: the map says: {problem}")
    return found["level"]


class Room:
    """The plan around one room, with what each square is."""

    def __init__(self, level, room_id):
        self.plan = level["plan"]
        self.rows = len(self.plan)
        self.cols = max(len(row) for row in self.plan)
        areas = level.get("areas", [])
        self.area = next((a for a in areas if a["id"] == room_id), None)
        if not self.area:
            sys.exit(f"blender-room: there's no room {room_id} on this map; there are {', '.join(a['id'] for a in areas)}")
        self.floor_marks = set(level.get("floor", "."))
        self.standing = set(level.get("people", {})) | set(level.get("things", {})) | set(level.get("exits", {})) | {"@"}
        # The smallest room drawn over a square is the one it belongs to, as in the game.
        self.owner = {}
        for a in sorted(areas, key=lambda a: a["w"] * a["h"], reverse=True):
            for y in range(a["y"], a["y"] + a["h"]):
                for x in range(a["x"], a["x"] + a["w"]):
                    self.owner[(x, y)] = a["id"]
        self.things = []
        for mark, fields in level.get("things", {}).items():
            spot = self.find(mark)
            if spot and self.mine(*spot):
                self.things.append({"mark": mark, "name": fields.get("name", mark), "at": spot})

    def mark(self, x, y):
        if 0 <= y < self.rows and 0 <= x < len(self.plan[y]):
            return self.plan[y][x]
        return " "

    def find(self, mark):
        for y, row in enumerate(self.plan):
            x = row.find(mark)
            if x >= 0:
                return (x, y)
        return None

    def kind(self, x, y):
        m = self.mark(x, y)
        if m in WALL_MARKS:
            return "wall"
        if m in DOOR_MARKS:
            return "door"
        if m in EMPTY_MARKS:
            return "empty"
        if m in MACHINE_MARKS:
            return "machine"
        if m in POST_MARKS:
            return "post"
        return "floor"  # floor, and anyone or anything standing on it

    def mine(self, x, y):
        return self.owner.get((x, y)) == self.area["id"]

    def open(self, x, y):
        """A square of this room that isn't wall: floor, a machine or a post."""
        return self.kind(x, y) in ("floor", "machine", "post") and self.mine(x, y)

    def solid(self, x, y):
        return self.kind(x, y) in ("wall", "door")

    def edge(self, x, y):
        """What the room's floor stops at: a wall, a door, or nothing at all, where the map leaves a gap in the hull."""
        return self.kind(x, y) in ("wall", "door", "empty")

    def see_through(self, x, y):
        return self.kind(x, y) in ("floor", "machine", "post")

    def cut(self, x, y):
        """The game cuts a wall low when there's floor behind it from the camera's side (hides in public/iso.js)."""
        return self.see_through(x, y - 1) or self.see_through(x - 1, y) or self.see_through(x - 1, y - 1)

    def squares(self):
        a = self.area
        for y in range(a["y"] - 1, a["y"] + a["h"] + 1):
            for x in range(a["x"] - 1, a["x"] + a["w"] + 1):
                yield x, y


# ---- Walls: the room's outline, traced and smoothed --------------------------------------------------------------
# Points are in tiles: a square (x, y) runs from x/2 to (x+1)/2 across and from y to y+1 down. An edge keeps the room's
# floor on one side; its normal points from the floor into the wall.


def edges_of(room):
    edges = []
    for x, y in room.squares():
        if not room.open(x, y):
            continue
        left, right, top, bottom = x / 2, (x + 1) / 2, y, y + 1
        if room.edge(x + 1, y):
            edges.append(((right, bottom), (right, top)))
        if room.edge(x, y + 1):
            edges.append(((left, bottom), (right, bottom)))
        if room.edge(x - 1, y):
            edges.append(((left, top), (left, bottom)))
        if room.edge(x, y - 1):
            edges.append(((right, top), (left, top)))
    return edges


def direction(a, b):
    d = Vector((b[0] - a[0], b[1] - a[1]))
    return d.normalized() if d.length else d


def normal_of(u):
    return Vector((-u.y, u.x))


def chains_of(edges):
    """Joins the edges end to end into outlines."""
    starting = {}
    for e in edges:
        starting.setdefault(e[0], []).append(e)
    used = set()
    ends = {e[1] for e in edges}
    chains = []
    firsts = [e for e in edges if e[0] not in ends] + edges
    for first in firsts:
        if first in used:
            continue
        chain = [first]
        used.add(first)
        while True:
            last = chain[-1]
            nexts = [e for e in starting.get(last[1], []) if e not in used]
            if not nexts:
                break
            u = direction(*last)
            # Where two outlines touch at a corner, turn into the wall, which keeps them apart.
            nexts.sort(key=lambda e: -direction(*e).dot(normal_of(u)))
            chain.append(nexts[0])
            used.add(nexts[0])
        chains.append(chain)
    return chains


def merged(chain):
    """Straight runs as one edge."""
    out = []
    for a, b in chain:
        if out and direction(*out[-1]) == direction(a, b) and out[-1][1] == a:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    if len(out) > 1 and out[-1][1] == out[0][0] and direction(*out[-1]) == direction(*out[0]):
        out[0] = (out[-1][0], out[0][1])
        out.pop()
    return out


def length(e):
    return (Vector(e[1]) - Vector(e[0])).length


def smoothed(chain, longest_step=1.01, fewest=5):
    """A wall that zigzags in short steps between two directions becomes one slanted wall through their middles."""
    out = []
    i = 0
    n = len(chain)
    while i < n:
        j = i
        if length(chain[i]) <= longest_step:
            d0 = direction(*chain[i])
            d1 = direction(*chain[i + 1]) if i + 1 < n else None
            if d1 is not None and abs(d0.dot(d1)) < 1e-6:
                j = i + 1
                while j + 1 < n and length(chain[j + 1]) <= longest_step and direction(*chain[j + 1]) == (d0 if (j + 1 - i) % 2 == 0 else d1) and chain[j][1] == chain[j + 1][0]:
                    j += 1
        if j - i + 1 >= fewest:
            first, last = chain[i], chain[j]
            mid_first = tuple((Vector(first[0]) + Vector(first[1])) / 2)
            mid_last = tuple((Vector(last[0]) + Vector(last[1])) / 2)
            out.append((first[0], mid_first))
            out.append((mid_first, mid_last, "slant"))
            out.append((mid_last, last[1]))
            i = j + 1
        else:
            out.append(chain[i])
            i += 1
    return out


# ---- Blender ---------------------------------------------------------------------------------------------------


def blender_point(p, z=0.0):
    """Tiles across become Blender's x, tiles down its -y, so the room isn't mirrored."""
    return Vector((p[0], -p[1], z))


def blender_dir(u):
    return Vector((u.x, -u.y, 0.0))


class Kit:
    def __init__(self, name, tint):
        self.name = name
        self.spec = KITS[name]
        self.folder = self.spec["folder"]
        self.pieces = {}
        self.library = bpy.data.collections.new("Kit " + name)
        bpy.context.scene.collection.children.link(self.library)
        self.tint = tint
        self.lender = None

    def borrowed(self, kit_name):
        """Kenney's kit, painted navy grey all over, for a piece this kit hasn't got."""
        if self.lender is None:
            self.lender = Kit(kit_name, "all")
        return self.lender

    def piece(self, name):
        """One mesh for each of the kit's files, in the kit's own units."""
        if name in self.pieces:
            return self.pieces[name]
        path = os.path.join(self.folder, name + self.spec["files"])
        if not os.path.exists(path):
            sys.exit(f"blender-room: the kit has no {name}{self.spec['files']} in {self.folder}")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == "MESH"]
        for o in meshes:
            o.data = o.data.copy()
            o.data.transform(o.matrix_world)
            o.parent = None
            o.matrix_world.identity()
        main = meshes[0]
        main_name = main.name
        others = [o.name for o in new if o.name != main_name]
        if len(meshes) > 1:
            with bpy.context.temp_override(active_object=main, selected_editable_objects=meshes, selected_objects=meshes):
                bpy.ops.object.join()
        for other in others:
            if other in bpy.data.objects:
                bpy.data.objects.remove(bpy.data.objects[other])
        for c in main.users_collection:
            c.objects.unlink(main)
        self.library.objects.link(main)
        main.name = "kit:" + name
        if self.tint:
            for slot in main.material_slots:
                if not slot.material:
                    continue
                if self.spec.get("tint_swap"):
                    swap_textures(slot.material, self.spec["tint_swap"], self.folder)
                else:
                    navy(slot.material, keep_strong=self.tint != "all")
        self.pieces[name] = main
        return main

    def wall(self, name):
        """A piece that stands along the outline, turned and moved so it runs along x with the room's side at y = 0."""
        key = "wall:" + name
        if key in self.pieces:
            return self.pieces[key]
        src = self.piece(name)
        obj = src.copy()
        obj.data = src.data.copy()
        turn = math.radians(self.spec["wall_turn"])
        c, s = math.cos(turn), math.sin(turn)
        dx, dy = self.spec["wall_shift"]
        for v in obj.data.vertices:
            x, y = v.co.x, v.co.y
            v.co.x, v.co.y = c * x - s * y + dx, s * x + c * y + dy
        obj.name = "kit:" + key
        self.library.objects.link(obj)
        self.pieces[key] = obj
        return obj

    def furniture(self, name):
        """A piece of furniture, its footprint centred and its feet at 0."""
        key = "furniture:" + name
        if key in self.pieces:
            return self.pieces[key]
        src = self.piece(name)
        obj = src.copy()
        obj.data = src.data.copy()
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        zs = [v.co.z for v in obj.data.vertices]
        shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
        for v in obj.data.vertices:
            v.co -= shift
        obj.name = "kit:" + key
        self.library.objects.link(obj)
        self.pieces[key] = obj
        return obj


def swap_textures(material, swaps, folder):
    """Puts another of the kit's own pictures in place of one a material uses: its plain trim for its red, say."""
    if not material.node_tree:
        return
    for node in material.node_tree.nodes:
        image = getattr(node, "image", None)
        if image and os.path.basename(image.filepath) in swaps:
            new = os.path.join(folder, swaps[os.path.basename(image.filepath)])
            node.image = bpy.data.images.load(new, check_existing=True)


def navy(material, keep_strong=True):
    """Paints the kit's colours over in the Meridian's navy grey: its lavender greys, and, unless told to keep them,
    its strong colours too."""
    if not material.node_tree:
        return
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf or not bsdf.inputs["Base Color"].links:
        return
    source = bsdf.inputs["Base Color"].links[0].from_socket
    hue = nodes.new("ShaderNodeHueSaturation")
    hue.inputs["Saturation"].default_value = 0.3
    hue.inputs["Value"].default_value = 0.55
    tint = nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs[7].default_value = (0.66, 0.78, 0.98, 1.0)
    links.new(source, hue.inputs["Color"])
    links.new(hue.outputs["Color"], tint.inputs[6])
    if not keep_strong:
        links.new(tint.outputs[2], bsdf.inputs["Base Color"])
        return
    # Only the kit's greys are painted over: its strong colours, the screens and lights, stay as they are.
    hsv = nodes.new("ShaderNodeSeparateColor")
    hsv.mode = "HSV"
    links.new(source, hsv.inputs["Color"])
    less = nodes.new("ShaderNodeMath")
    less.operation = "SUBTRACT"
    less.inputs[1].default_value = 0.5  # saturation of the linear colours: the kit's lavender is about 0.41
    links.new(hsv.outputs[1], less.inputs[0])
    more = nodes.new("ShaderNodeMath")
    more.operation = "MULTIPLY"
    more.use_clamp = True
    more.inputs[1].default_value = 4.0
    links.new(less.outputs[0], more.inputs[0])
    keep = nodes.new("ShaderNodeMix")
    keep.data_type = "RGBA"
    links.new(more.outputs[0], keep.inputs["Factor"])
    links.new(tint.outputs[2], keep.inputs[6])
    links.new(source, keep.inputs[7])
    links.new(keep.outputs[2], bsdf.inputs["Base Color"])


class Builder:
    def __init__(self, room, kit):
        self.room = room
        self.kit = kit
        self.scene = bpy.context.scene
        self.root = bpy.data.objects.new("Room", None)
        self.scene.collection.objects.link(self.root)
        # The game draws heights shorter than a true camera would see them: squash the room to match.
        self.root.scale = (1.0, 1.0, UPWARDS)
        self.count = {}
        self.notes = []
        self.core = self.make_core()

    def place(self, piece, at, angle=0.0, scale=(1.0, 1.0, 1.0)):
        obj = piece.copy()  # shares the mesh
        self.scene.collection.objects.link(obj)
        obj.parent = self.root
        obj.location = at
        obj.rotation_mode = "XYZ"  # the glTF importer leaves its pieces turning by quaternion, which ignores this
        obj.rotation_euler = (0.0, 0.0, angle)
        obj.scale = scale
        name = piece.name.split(":")[-1]
        self.count[name] = self.count.get(name, 0) + 1
        return obj

    # -- floor --
    def floors(self):
        spec = self.kit.spec
        plate = self.kit.piece(spec["floor"])
        half_plate = self.kit.piece(spec["half_floor"])
        plate_tiles = spec["floor_size"] * spec["tiles"]  # how many tiles across one plate is, as the kit made it
        z = -spec["floor_top"] * spec["tiles"]
        r = self.room
        tiles = {}
        for x, y in r.squares():
            if r.open(x, y) or (r.kind(x, y) == "door" and self.next_to_room(x, y)):
                tiles.setdefault((x // 2, y), set()).add(x % 2)
        whole = {t for t, halves in tiles.items() if len(halves) == 2}
        covered = set()
        # The biggest plates first, on a grid of their own size so their pattern lines up, then smaller ones.
        for size in spec["floor_blocks"]:
            for tx, ty in sorted(whole - covered, key=lambda t: (t[1], t[0])):
                if (tx, ty) in covered or tx % size or ty % size:
                    continue
                block = [(tx + i, ty + j) for i in range(size) for j in range(size)]
                if all(t in whole and t not in covered for t in block):
                    covered.update(block)
                    k = size / plate_tiles
                    self.place(plate, Vector((tx + size / 2, -(ty + size / 2), z)), scale=(k, k, spec["tiles"]))
        k = 1 / plate_tiles
        for (tx, ty), halves in tiles.items():
            if len(halves) == 1:
                half = next(iter(halves))
                self.place(half_plate, Vector((tx + 0.25 + half * 0.5, -(ty + 0.5), z)), scale=(k / 2, k, spec["tiles"]))

    def next_to_room(self, x, y):
        return any(self.room.open(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))

    # -- walls --
    def behind(self, p, n):
        """The wall square just behind a point on the outline."""
        q = Vector(p) + n * 0.2
        return (math.floor(q.x * 2), math.floor(q.y))

    def walls(self, windows_near):
        outlines = [smoothed(merged(c)) for c in chains_of(edges_of(self.room))]
        slanted_squares = set()
        segments = []
        for outline in outlines:
            for seg in outline:
                a, b = Vector(seg[0]), Vector(seg[1])
                if (b - a).length < 1e-6:
                    continue
                segments.append((a, b, len(seg) > 2))
        # Windows go on the wall nearest a viewport, a few tiles either side of the point nearest it.
        window_spans = []
        for spot in windows_near:
            best = None
            for k, (a, b, _) in enumerate(segments):
                u = (b - a).normalized()
                s = max(0.0, min((b - a).length, (spot - a).dot(u)))
                d = (a + u * s - spot).length
                if best is None or d < best[0] - 1e-6:
                    best = (d, k, s)
            if best:
                window_spans.append((best[1], best[2] - 3.5, best[2] + 3.5))
        for k, (a, b, slanted) in enumerate(segments):
            u = (b - a).normalized()
            n = normal_of(u)
            total = (b - a).length
            # What's behind each stretch of the wall: wall or door, high or cut. A slanted wall is cut or not as a
            # whole, by which way it faces: the game's rule, a wall with the floor behind it from the camera's side.
            slant_low = n.x > 0.3 or n.y > 0.3
            step = 0.25
            runs = []
            s = 0.0
            while s < total - 1e-6:
                e = min(total, s + step)
                sq = self.behind(a + u * ((s + e) / 2), n)
                if slanted:
                    slanted_squares.add(sq)
                kind = "door" if self.room.kind(*sq) == "door" else "wall"
                low = slant_low if slanted else self.room.cut(*sq)
                if runs and runs[-1][0] == (kind, low):
                    runs[-1][2] = e
                else:
                    runs.append([(kind, low), s, e])
                s = e
            spec = self.kit.spec
            piece_tiles = spec["wall_length"] * spec["tiles"]  # how long one wall piece is, as the kit made it
            for (kind, low), s0, s1 in runs:
                run = s1 - s0
                if low:
                    # A wall cut low is a plain block, as in the game: a kit's panels look wrong this short (Kenney's
                    # have posts at their ends, like the teeth of a comb). The squares behind a straight wall get
                    # theirs in cores(); a slanted one is a strip along its line, and a door is a gap.
                    if slanted and kind != "door":
                        mid = a + u * ((s0 + s1) / 2)
                        at = blender_point(mid) + blender_dir(n) * (LOW_THICK / 2)
                        du = blender_dir(u)
                        self.place(self.core, at, math.atan2(du.y, du.x), (run, LOW_THICK, CUT_WALL_HEIGHT))
                    continue
                if kind == "door":
                    name = spec["wide_door"] if run >= 1.5 else spec["door"]
                    pieces = [(s0, s1, name)] if name else []
                else:
                    count = max(1, round(run / piece_tiles))
                    each = run / count
                    pieces = []
                    for i in range(count):
                        p0, p1 = s0 + i * each, s0 + (i + 1) * each
                        mid = (p0 + p1) / 2
                        window = any(kk == k and lo <= mid <= hi for kk, lo, hi in window_spans)
                        pieces.append((p0, p1, spec["window"] if window else spec["wall"]))
                for p0, p1, name in pieces:
                    # Each piece runs along x with its room side at y = 0 (Kit.wall), so it stands on the outline.
                    mid = a + u * ((p0 + p1) / 2)
                    du = blender_dir(u)
                    angle = math.atan2(du.y, du.x)
                    self.place(self.kit.wall(name), blender_point(mid), angle, ((p1 - p0) / piece_tiles, spec["tiles"], self.wall_rise()))
        self.slanted = slanted_squares
        self.segment_count = (len(segments), sum(1 for s in segments if s[2]))

    def wall_rise(self):
        """How much a wall piece is stretched upwards: to the game's height, or as the kit made it."""
        spec = self.kit.spec
        return spec["wall_height"] / spec["kit_wall_height"] if spec["wall_height"] else spec["tiles"]

    def high_wall(self):
        """How high a wall that isn't cut low stands, in the game's units."""
        return self.wall_rise() * self.kit.spec["kit_wall_height"]

    def make_core(self):
        """A plain block, one unit each way with its feet at 0, in the colour of a wall's top."""
        mat = bpy.data.materials.new("Wall top")
        mat.diffuse_color = self.kit.spec["tint_low_color" if self.kit.tint else "low_color"]
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = mat.diffuse_color
        bsdf.inputs["Roughness"].default_value = 0.8
        mesh = bpy.data.meshes.new("core")
        s = 0.5
        verts = [(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0), (-s, -s, 1), (s, -s, 1), (s, s, 1), (-s, s, 1)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh.from_pydata(verts, [], faces)
        mesh.materials.append(mat)
        core = bpy.data.objects.new("kit:core", mesh)
        self.kit.library.objects.link(core)
        return core

    def cores(self):
        """Every wall square gets a block inside it: a wall cut low is just that, and a high wall gets a top, since
        the kit's walls are thin panels."""
        core = self.core
        r = self.room
        inset = self.kit.spec["core_inset"]
        for x, y in r.squares():
            if r.kind(x, y) != "wall" or (x, y) in self.slanted:
                continue
            near = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and r.open(x + dx, y + dy)]
            if not near and not any(r.solid(x + dx, y + dy) and self.next_to_room(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                continue
            # A high wall's block is pulled back from any side the room's floor is on, where a panel stands.
            low = r.cut(x, y)
            x0, x1, y0, y1 = x / 2, (x + 1) / 2, y, y + 1
            if not low:
                if r.open(x - 1, y):
                    x0 += inset
                if r.open(x + 1, y):
                    x1 -= inset
                if r.open(x, y - 1):
                    y0 += inset
                if r.open(x, y + 1):
                    y1 -= inset
            if x1 - x0 < 0.02 or y1 - y0 < 0.02:
                continue
            high = CUT_WALL_HEIGHT if low else self.high_wall() - 0.03
            self.place(core, Vector(((x0 + x1) / 2, -(y0 + y1) / 2, 0)), 0.0, (x1 - x0, y1 - y0, high))

    # -- machines and things --
    def consoles(self, facing_y):
        r = self.room
        a = r.area
        for y in range(a["y"], a["y"] + a["h"]):
            x = a["x"]
            while x < a["x"] + a["w"]:
                if r.kind(x, y) == "machine" and r.mine(x, y):
                    start = x
                    while x < a["x"] + a["w"] and r.kind(x, y) == "machine" and r.mine(x, y):
                        x += 1
                    left, right = start / 2, x / 2
                    run = right - left
                    spec = self.kit.spec
                    count = max(1, round(run / spec["console_every"]))
                    each = run / count
                    # The kit's screens face its -y; turn them to face the side the operators sit on.
                    angle = 0.0 if facing_y(y) > 0 else math.pi
                    for i in range(count):
                        name = spec["consoles"][i % len(spec["consoles"])]
                        cx = left + each * (i + 0.5)
                        self.place(self.kit.furniture(name), blender_point((cx, y + 0.5)), angle, (spec["prop_scale"],) * 3)
                else:
                    x += 1

    def things_and_windows(self):
        windows = []
        placed = []
        for thing in self.room.things:
            words = thing["name"].lower()
            piece = next((p for keys, p in self.kit.spec["things"] if any(k in words for k in keys)), None)
            x, y = thing["at"]
            spot = Vector(((x + 0.5) / 2, y + 0.5))
            if piece == "window":
                windows.append(spot)
                self.notes.append(f"{thing['name']}: windows in the nearest wall")
                continue
            if not piece:
                piece = self.kit.spec["crate"]
                self.notes.append(f"{thing['name']}: nothing in the kit matched, so it's a crate")
            elif isinstance(piece, tuple):
                self.notes.append(f"{thing['name']}: {piece[1]}, borrowed from the {piece[0]} kit")
            else:
                self.notes.append(f"{thing['name']}: {piece}")
            placed.append((thing, piece, spot))
        return windows, placed

    def away_from_wall(self, square, reach=3):
        """Which way is away from the nearest wall, within a few squares; none if it stands free."""
        x, y = square
        best = None
        for dx, dy, size in ((1, 0, 0.5), (-1, 0, 0.5), (0, 1, 1.0), (0, -1, 1.0)):
            for k in range(1, reach + 1):
                if self.room.solid(x + dx * k, y + dy * k):
                    if best is None or k * size < best[0]:
                        best = (k * size, Vector((-dx, -dy)))
                    break
        return best[1] if best and best[0] <= 1.0 else None

    def put_things(self, placed, viewport):
        for thing, piece, spot in placed:
            if isinstance(piece, tuple):
                lender, name, scale = piece
                obj = self.kit.borrowed(lender).furniture(name)
            else:
                name, scale = piece, self.kit.spec["prop_scale"]
                obj = self.kit.furniture(name)
            # A seat faces the viewport, if the room has one; anything else faces away from a wall it stands by,
            # or the camera if it stands free.
            if name.startswith("chair") and viewport is not None:
                d = viewport - spot
            else:
                d = self.away_from_wall(thing["at"]) or Vector((0, 1))
            d = blender_dir(d.normalized())
            angle = math.atan2(d.y, d.x) + math.pi / 2  # the kits' furniture faces their -y
            self.place(obj, blender_point(spot), angle, (scale,) * 3)

    def posts(self):
        r = self.room
        spots = [(x, y) for x, y in r.squares() if r.kind(x, y) == "post" and r.mine(x, y)]
        if not spots:
            return
        post = self.kit.furniture(self.kit.spec["post"])
        height = max(v.co.z for v in post.data.vertices) or 1.0
        for x, y in spots:
            self.place(post, blender_point(((x + 0.5) / 2, y + 0.5)), 0.0, (0.45, 0.9, self.high_wall() / height))


def light_and_camera(builder, out, tint):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Even light")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.57, 0.62, 1.0)
    bg.inputs["Strength"].default_value = 0.75
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 1.8
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(35), 0.0, math.radians(-20))
    scene.collection.objects.link(sun)

    # A true orthographic camera from the game's angle: 30 degrees down, looking up the map's x and y together.
    across = Vector((1, -1, 0)).normalized()
    back = across * math.cos(math.radians(30)) + Vector((0, 0, 1)) * math.sin(math.radians(30))
    forward = -back
    right = forward.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(forward)
    bpy.context.view_layer.update()
    rs, us = [], []
    for obj in builder.root.children:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            rs.append(p.dot(right))
            us.append(p.dot(up))
    per_unit = TILE_PIXELS / math.sqrt(2)  # a tile's diagonal is sqrt(2) units and 128 pixels
    pad = 24
    width = math.ceil((max(rs) - min(rs)) * per_unit) + pad * 2
    height = math.ceil((max(us) - min(us)) * per_unit) + pad * 2
    middle = right * ((max(rs) + min(rs)) / 2) + up * ((max(us) + min(us)) / 2)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(width, height) / per_unit
    cam.data.clip_end = 1000
    cam.location = middle + back * 200
    cam.rotation_euler = forward.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = os.path.abspath(out)
    return width, height


def main():
    opts = options()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    level = read_level(os.path.abspath(opts["map"]))
    room = Room(level, opts["room"])
    kit = Kit(opts["kit"], opts["tint"])
    builder = Builder(room, kit)

    windows, placed = builder.things_and_windows()
    viewport = windows[0] if windows else None

    def facing_y(y):
        # Consoles face away from the viewport, toward whoever works them; with none, toward the camera.
        return 1 if viewport is None or y + 0.5 >= viewport.y else -1

    builder.floors()
    builder.walls(windows)
    builder.cores()
    builder.consoles(facing_y)
    builder.put_things(placed, viewport)
    builder.posts()
    for one in (kit, kit.lender):
        if one:
            one.library.hide_render = True
            one.library.hide_viewport = True

    width, height = light_and_camera(builder, opts["out"], opts["tint"])
    print(f"blender-room: {room.area['name']} ({opts['room']}), {width} by {height} pixels")
    print(f"blender-room: {builder.segment_count[0]} stretches of wall, {builder.segment_count[1]} of them slanted")
    for name, n in sorted(builder.count.items()):
        print(f"blender-room:   {n} x {name}")
    for note in builder.notes:
        print(f"blender-room: {note}")
    if opts["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]))
    bpy.ops.render.render(write_still=True)
    print(f"blender-room: wrote {os.path.abspath(opts['out'])}")


main()
