// A small drawing of each item for the inventory's grid, in console art, made to fit the squares the item takes.
// An item without one of its own gets one for its kind.

const ART = {
  sidearm: ["[##]=-"], slug_thrower: ["[#]=--"], shock_baton: ["(|===>"], focus_blade: ["--=====>"], ministry_saber: ["-|======>"],
  boarding_axe: ["---====[<"], forge_hammer: ["   _[##]", "--=|[##]"], arc_welder: ["[==]~", " ||  *"], service_rifle: ["==[##]======-"],
  needle_rifle: ["=[#]==========-"], veshti_longrifle: ["=[##]=========--"], choir_lance: ["<<==|=========*"], heavy_carbine: ["=[####]=======-", "  |__|  |/"],
  flak_vest: ["/\\__/\\", "|[==]|", "|____|"], veshti_skin: ["/\\__/\\", "|~~~~|", "|____|"],
  smugglers_coat: [" _/\\_ ", "|.||.|", "| || |", "|_||_|"], adept_robes: [" _/\\_ ", "|:||:|", "|:||:|", "/_||_\\"],
  ghostweave: [" _/\\_ ", "|.  .|", "|    |", "|_||_|"], work_suit: [" _/\\_ ", "|[]|.|", "|  | |", "|_||_|"], refugee_coat: [" _/\\_ ", "|' |'|", "|  | |", "|_/\\_|"],
  korrun_harness: [" _/==\\_ ", "|=|##|=|", "|_|__|_|"], marine_plate: [" _/==\\_ ", "|[####]|", "| |##| |", "|_|__|_|"], remnant_plate: [" _/<>\\_ ", "|[####]|", "| |##| |", "|_|__|_|"],
  medkit: ["[+]"], stim: ["-=|>"], energy_cell: ["(|)"], repair_kit: ["[##]+"], fuel_cell: ["{F}"], trauma_kit: ["[++]"], ration_pack: ["[=]"],
  calm_tabs: ["o o"], nutrient_gel: ["(~)"], emergency_patch: ["[#]"], refined_fuel: ["{FF}"],
  lockbreaker: ["o-="], forged_papers: ["[~]"], signal_scrambler: ["(((."], slicer_rig: ["[::]=o"], surgeon_lens: ["(o)"], field_scanner: ["[(o)]~"],
  tool_roll: ["{=|=|=}"], nav_slate: ["[/]"], resonance_tuner: ["~(|)~"], ledger_of_favors: ["[$]"], old_concord_medal: ["(O)"], pilot_gloves: ["<w>"],
  beacon_shard: ["<*>"], ilun_codex: ["[|||]"], choir_core: ["(@)"], data_chip: ["[::]"], quiet_token: ["(.)"], remnant_codes: ["[%]"], gate_key: ["o-+"],
  ninth_vault_index: ["[9]"], asterion_voice_recording: ["(>)"], unbound_safe_conduct: ["[s]"], wheel_marker: ["<o>"], lumen_lens: ["(*)"],
  maris_core_sample: ["[o]"], tessen_seed_vault_key: ["o-#"], rig: ["[::::]", "[_o__]"],
};
const KIND = { weapon: ["=[#]=-"], armor: ["/\\_/\\", "|[ ]|"], consumable: ["[+]"], gadget: ["[*]"], story: ["<*>"] };

export const artFor = (item) => ART[item?.id] ?? KIND[item?.type] ?? ["[?]"];
