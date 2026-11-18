## The line to the game. The game's rules stay in JavaScript and run as their own program on this computer (server.js,
## the same one the browser view talks to); everything Godot shows or does is asked of it here, over the computer's own
## loopback address, which nothing outside this computer can reach.
##
## If the game is already running (its own window is open), this joins it: both views then show the same game. If it
## isn't, Godot starts it, hidden, and stops it again when this window closes.
class_name Link
extends Node

## The game's usual port, as start-game.bat has it.
const USUAL_PORT := 3210

var port := USUAL_PORT
## The game Godot started itself, if it did: its process, so it can be stopped again.
var started := -1


func _init(on_port := 0) -> void:
	if on_port > 0:
		port = on_port
	elif OS.get_environment("PORT").is_valid_int():
		port = int(OS.get_environment("PORT"))


func address() -> String:
	return "http://localhost:%d" % port


## Asks the game something and waits for its answer: { ok, code, data, error }. ok is false when the game couldn't be
## reached at all (code 0) or refused (its own words are in error).
func ask(path: String, body: Variant = null, wait := 20.0) -> Dictionary:
	var http := HTTPRequest.new()
	http.use_threads = true
	http.timeout = wait
	add_child(http)
	var headers := PackedStringArray(["content-type: application/json"])
	var failed := OK
	if body == null:
		failed = http.request("http://127.0.0.1:%d%s" % [port, path], headers, HTTPClient.METHOD_GET)
	else:
		failed = http.request("http://127.0.0.1:%d%s" % [port, path], headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if failed != OK:
		http.queue_free()
		return {"ok": false, "code": 0, "data": null, "error": "The game couldn't be asked."}
	var got: Array = await http.request_completed
	http.queue_free()
	if int(got[0]) != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "code": 0, "data": null, "error": "The game didn't answer."}
	var code := int(got[1])
	var text: String = (got[3] as PackedByteArray).get_string_from_utf8()
	var data: Variant = JSON.parse_string(text) if text != "" else null
	if code != 200 or typeof(data) != TYPE_DICTIONARY:
		var why := "The game refused (%d)." % code
		if typeof(data) == TYPE_DICTIONARY and data.has("error"):
			why = str(data.error)
		return {"ok": false, "code": code, "data": data, "error": why}
	return {"ok": true, "code": code, "data": data, "error": ""}


## Starts the game itself, hidden, from the game's folder (this project is the folder "godot" inside it). False if
## Node.js isn't on this computer.
func start_game() -> bool:
	var server := DeckData.game_folder().path_join("server.js")
	if not FileAccess.file_exists(server):
		return false
	# So that the game knows it's this window's to stop (and no other's).
	OS.set_environment("ALMAGEST_STARTED_BY_GODOT", "1")
	OS.set_environment("PORT", str(port))
	started = OS.create_process("node", [server])
	return started > 0


## Stops the game if Godot started it: it's asked to save what's waiting and stop, and only stopped the hard way if it
## doesn't answer.
func stop_game() -> void:
	if started <= 0:
		return
	var pid := started
	started = -1
	var answer: Dictionary = await ask("/api/godot/stop", {}, 3.0)
	if answer.ok:
		# It stops by itself a moment after answering.
		for i in 20:
			if not OS.is_process_running(pid):
				return
			await get_tree().create_timer(0.05).timeout
	if OS.is_process_running(pid):
		OS.kill(pid)
