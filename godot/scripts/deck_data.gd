## Asks the game what's on the Meridian's decks. The game's rules stay in JavaScript: Godot runs the game's own reader
## once, as a hidden Node program (tools/godot-decks.mjs), and reads its answer. That program opens no port and reads no
## save, so the game itself can be open and played at the same time.
class_name DeckData
extends RefCounted


## The game's folder: this project is the folder "godot" inside it.
static func game_folder() -> String:
	return ProjectSettings.globalize_path("res://").path_join("..").simplify_path()


## Runs the reader and gives back its answer: { ok: true, decks, ... }, or { ok: false, error } in plain words.
## It takes about a second, so it's run on a thread of its own (main.gd).
static func read() -> Dictionary:
	var helper := game_folder().path_join("tools/godot-decks.mjs")
	if not FileAccess.file_exists(helper):
		return {"ok": false, "error": "The game's own reader isn't where it should be:\n%s\nThis window has to be opened from the game's folder, with start-godot.bat." % helper}
	# Its answer comes as a file in Godot's own folder for this program, read and thrown away at once.
	var out_file := OS.get_user_data_dir().path_join("decks-%d.json" % OS.get_process_id())
	var said: Array = []
	var code := OS.execute("node", [helper, "--out=" + out_file], said, true)
	if code == -1:
		return {"ok": false, "error": "Node.js wasn't found, and the game's rules need it.\nIt's the same program start-game.bat uses: get the LTS version from https://nodejs.org and try again."}
	var text := FileAccess.get_file_as_string(out_file) if FileAccess.file_exists(out_file) else ""
	if FileAccess.file_exists(out_file):
		DirAccess.remove_absolute(out_file)
	var answer: Variant = JSON.parse_string(text) if text != "" else null
	if typeof(answer) != TYPE_DICTIONARY:
		return {"ok": false, "error": "The game's reader gave no answer.\n%s" % "\n".join(PackedStringArray(said)).strip_edges().left(600)}
	if not answer.get("ok", false):
		return {"ok": false, "error": "The game couldn't read its decks:\n%s" % str(answer.get("error", "it didn't say why"))}
	return answer
