// A fight in the room, in real time (src/live-fight.js keeps its rules). The room draws it: the fighters stand in it
// with their health over their heads, and shots fly between them. This keeps the fight's own clock, which asks the
// server to go on several times a second while it runs, and draws the orders window, the notes of what happened, the
// two sides in the room's panel, and how it ended. It starts stopped, Space stops and starts it, and it can stop by
// itself each time the player's ready to act. A simulated fight, and a fight in a story view without the room, stay
// in the fight window (public/fight.js).

import { api, el } from "./dom.js";
import { isoLook } from "./iso.js";

// How often the fight is asked to go on while it runs, and the most time one ask can cover, in milliseconds.
const TICK = 120;
const LONGEST = 500;
// As src/live-fight.js: how fast people walk in a fight, in tiles a second, and a square's width in tiles.
const SPEED = 3.6;
const WIDTH = 0.5;
const STOP_KEY = "meridian-fight-stop";

const lf = {
  id: null,
  paused: true,
  // Why it's stopped: it starts that way, the player stopped it, or it stopped itself because they're ready.
  heldFor: "start",
  stopWhenReady: false,
  picking: null,
  notes: [],
  fx: [],
  shown: new Map(),
  you: null,
  ending: null,
  asking: null,
  refused: null,
  inflight: false,
  lastTick: 0,
  message: null,
  drawn: { layer: "", roster: "" },
};
try {
  lf.stopWhenReady = localStorage.getItem(STOP_KEY) === "yes";
} catch {
  // Not remembered: it doesn't stop by itself until the box is ticked.
}

let app;

export function initLive(hooks) {
  app = hooks;
  setInterval(pump, TICK);
}

const combat = () => app?.ui.game?.combat ?? null;
// A fight being fought in the room right now, or one that's just ended there and hasn't been left yet.
export const liveOn = () => Boolean(combat()?.live) || Boolean(lf.ending);
export const liveRunning = () => Boolean(combat()?.live) && !lf.paused && !lf.ending;

// Whether a fight belongs in the room: one there already, or one just started while the room's on screen. A simulation
// stays in its window, and so does a fight the room couldn't take.
export function fightInRoom(c = combat()) {
  if (!c || c.training) return false;
  if (c.live) return true;
  return app.roomShown() && c.round <= 1 && lf.refused !== c.id;
}

// A fight that's just started, with the room on screen, moves into it.
export function bringIntoRoom() {
  const c = combat();
  if (!c || c.live || !fightInRoom(c) || lf.asking === c.id) return;
  lf.asking = c.id;
  api("/api/combat", { action: "live" }).then((reply) => {
    app.ui.game = reply.game;
    app.render();
  }).catch(() => {
    lf.refused = c.id;
    app.render();
  });
}

// A new fight starts stopped, with what started it as the first note.
function keepUp() {
  const c = combat();
  if (!c?.live || c.id === lf.id) return;
  Object.assign(lf, { id: c.id, paused: true, heldFor: "start", picking: null, notes: [], fx: [], ending: null, message: null, you: null, battle: c.battle?.title ?? null, drawn: { layer: "", roster: "" } });
  lf.shown.clear();
  if (c.opening) note(c.opening, "bad");
}

// ---- The clock ---------------------------------------------------------------------------------------------------

function setPaused(paused, why = "you") {
  if (lf.ending || !combat()?.live) return;
  lf.paused = paused;
  lf.heldFor = paused ? why : null;
  lf.lastTick = performance.now();
  redraw();
}
export const togglePause = () => setPaused(!lf.paused);

function pump() {
  const c = combat();
  const now = performance.now();
  if (!c?.live || lf.paused || lf.ending || document.visibilityState !== "visible" || app.ui.sideOpen) {
    lf.lastTick = now;
    return;
  }
  if (lf.inflight) return;
  const ms = Math.min(LONGEST, now - (lf.lastTick || now));
  lf.lastTick = now;
  send({ action: "tick", ms, stopWhenReady: lf.stopWhenReady });
}

async function send(body) {
  lf.inflight = true;
  let reply;
  try {
    reply = await api("/api/combat", body);
  } catch (err) {
    lf.inflight = false;
    lf.message = err.message;
    redraw();
    return false;
  } finally {
    lf.inflight = false;
  }
  lf.message = null;
  const { outcome } = reply;
  if (outcome.over) {
    app.ui.game = reply.game;
    lf.ending = outcome;
    played(outcome.events ?? []);
    lf.paused = true;
    lf.picking = null;
    app.render();
    return true;
  }
  if (!app.ui.game) return false;
  app.ui.game.combat = reply.combat;
  app.ui.game.hp = reply.you.hp;
  app.ui.game.energy = reply.you.energy;
  played(outcome.events ?? []);
  if (outcome.ready) {
    lf.paused = true;
    lf.heldFor = "ready";
  }
  app.renderStatus();
  redraw();
  return true;
}

// An order: it's kept while the fight's stopped, and one given while it's waiting on the player sets it going again.
function order(body) {
  if (lf.ending || !combat()?.live) return;
  lf.picking = null;
  send(body).then((ok) => {
    if (ok && lf.paused && lf.heldFor === "ready") setPaused(false);
  });
  redraw();
}

// ---- What happened -------------------------------------------------------------------------------------------------

// While it's fought, the four newest. Once it's over, enough for everything its end has to say: after a battle, who's
// taken to the brig, what's broken, a fire, a breach and what it cost (src/aftermath.js).
function note(text, tone = "") {
  lf.notes.push({ text, tone });
  const most = lf.ending ? 10 : 4;
  while (lf.notes.length > most) lf.notes.shift();
}

const rangedKey = (key) => (key === "you" ? combat()?.live?.you.reach : combat()?.live?.fighters[key]?.reach) !== "melee";

// In a battle, with twenty people fighting across a deck, the notes keep to what concerns the player: what they do and
// what's done to them, who goes down, and the battle's own lines. The rest is still seen over the room.
const worthNoting = (event) => !combat()?.battle || event.by === "you" || event.on === "you" || event.down || event.battle || Boolean(event.note);

// Each thing that happened goes in the notes, and what can be seen of it over the room: a shot, a swing, a number.
function played(events) {
  for (const event of events) {
    // A hit says where it landed, and someone down how they are: out cold, or unable to stand.
    const text = event.where ? `${event.text} (${event.where})` : event.down && event.math ? `${event.text} (${event.math})` : event.text;
    if (event.text && worthNoting(event)) note(text, event.tone === "good" ? "good" : event.tone === "bad" ? "bad" : event.tone === "dim" ? "dim" : event.tone === "info" ? "info" : "");
    else if (event.note) note(event.note, "dim");
    if (event.by && event.on && event.by !== event.on && (event.damage || event.missed)) {
      lf.fx.push(rangedKey(event.by) ? { kind: "shot", from: event.by, to: event.on, hit: !event.missed, t: 0, life: 0.26 } : { kind: "swing", from: event.by, to: event.on, t: 0, life: 0.3 });
      const shooter = event.by === "you" ? lf.you : lf.shown.get(event.by);
      const target = event.on === "you" ? lf.you : lf.shown.get(event.on);
      if (shooter && target) face(shooter, target.x - shooter.x, target.y - shooter.y);
    }
    if (event.on && event.damage) lf.fx.push({ kind: "float", key: event.on, text: `-${event.damage}`, color: event.on === "you" || isAlly(event.on) ? "#ff8f7f" : "#ffe9a8", big: /critical/.test(event.math ?? ""), t: 0, life: 1.2 });
    else if (event.on && event.missed) lf.fx.push({ kind: "float", key: event.on, text: event.cover ? "cover" : "miss", color: "#aeb6b0", t: 0, life: 1.1 });
    else if (event.on && event.gained > 1) lf.fx.push({ kind: "float", key: event.on, text: `+${event.gained}`, color: "#9df5b4", t: 0, life: 1.1 });
    else if (event.on && event.refused) lf.fx.push({ kind: "float", key: event.on, text: "no", color: "#aeb6b0", t: 0, life: 1.1 });
  }
}
const isAlly = (key) => Boolean(combat()?.allies.some((one) => one.key === key));

// ---- What the room draws -------------------------------------------------------------------------------------------

function face(shown, dx, dy) {
  const across = dx * WIDTH - dy;
  const along = dx * WIDTH + dy;
  if (Math.abs(across) > 0.002) shown.flip = across < 0;
  if (Math.abs(along) > 0.002) shown.back = along < 0;
}
// Someone drawn walks towards where the fight has them, as fast as they could, and a jump is a jump.
function glide(shown, goal, dt) {
  const dx = goal.x - shown.x;
  const dy = goal.y - shown.y;
  const far = Math.hypot(dx * WIDTH, dy);
  if (far > 3) {
    shown.x = goal.x;
    shown.y = goal.y;
    shown.walking = false;
    return;
  }
  const step = Math.min(far, SPEED * 1.4 * dt);
  shown.walking = step > 0.0005;
  if (!shown.walking) return;
  shown.x += (dx / far) * step;
  shown.y += (dy / far) * step;
  shown.step += step * 10;
  face(shown, dx, dy);
}

// Where the player is drawn while the fight's in the room.
let youDrawnAt = 0;
export function liveYouSpot() {
  const live = combat()?.live;
  if (!live) return lf.you ? { x: lf.you.x, y: lf.you.y } : null;
  const now = performance.now();
  const dt = youDrawnAt ? Math.min(0.1, (now - youDrawnAt) / 1000) : 0;
  youDrawnAt = now;
  if (!lf.you) lf.you = { x: live.you.x, y: live.you.y, step: 0, flip: false, back: false };
  glide(lf.you, live.you, dt);
  return { x: lf.you.x, y: lf.you.y };
}

// Everyone else in the fight, for the room to draw among the people and things in it, each where they've got to.
export function liveFighters(dt) {
  const c = combat();
  if (!c?.live) return [];
  for (const one of lf.fx) one.t += dt;
  lf.fx = lf.fx.filter((one) => one.t < one.life);
  const list = [];
  for (const [side, fighters] of [["ally", c.allies], ["enemy", c.enemies]]) {
    for (const fighter of fighters) {
      const place = c.live.fighters[fighter.key];
      if (!place) continue;
      let shown = lf.shown.get(fighter.key);
      if (!shown) {
        shown = { x: place.x, y: place.y, step: 0, flip: false, back: false, fade: 1 };
        const you = c.live.you;
        face(shown, you.x - place.x, you.y - place.y);
        lf.shown.set(fighter.key, shown);
      }
      glide(shown, place, dt);
      if (fighter.out) shown.fade = Math.max(0, shown.fade - dt / 1.2);
      if (shown.fade <= 0) continue;
      list.push({ key: fighter.key, side, x: shown.x, y: shown.y, color: fighter.color, person: place.person, down: fighter.hp <= 0, fade: shown.fade, flip: shown.flip, back: shown.back, walking: shown.walking, step: shown.step, ring: ringFor(fighter, side) });
    }
  }
  return list;
}
// The people in the room who are in the fight, so they're drawn once, as fighters.
export const liveHidden = () => new Set(Object.values(combat()?.live?.fighters ?? {}).map((one) => one.person).filter(Boolean));

function ringFor(fighter, side) {
  if (fighter.hp <= 0) return null;
  if (fighter.out) return "rgba(170,180,172,.5)";
  if (side === "ally") return "rgba(142,197,255,.75)";
  const aimed = combat()?.live?.you.target === fighter.key;
  return aimed || lf.picking ? "rgba(255,170,140,.98)" : "rgba(255,125,105,.6)";
}

const pickedAction = () => (lf.picking ? combat()?.actions.find((one) => key(one) === lf.picking) ?? null : null);
const key = (action) => `${action.action.type}:${action.action.id ?? ""}`;

// The odds on hitting or talking someone from where the player stands now: through cover a little less, and nothing
// at all where there's no line of fire or they're out of reach.
function oddsOn(enemyKey, action) {
  const c = combat();
  const sight = c.live.sight[enemyKey];
  const target = action?.targets?.[enemyKey];
  if (!action || !target || !sight) return null;
  if (target.disabled) return { text: target.why, off: true };
  if (action.oddsLabel === "WORKS") return sight.heard ? { text: `WORKS ${target.odds}%` } : { text: "too far to hear you", off: true };
  const reach = action.action.type === "ability" && !["overcharged_shot", "foresight"].includes(action.action.id) ? sight.shot : sight;
  if (!reach.ok) return { text: reach.why, off: true };
  return { text: `HIT ${reach.cover ? Math.max(5, target.odds - 15) : target.odds}%${reach.cover ? " · cover" : ""}` };
}

// What goes over the fighters, on top of everything: health, how soon they're ready, cover, names, the odds, and the
// shots and numbers flying.
export function liveOverlay({ ctx, at, unit, chip, hover }) {
  const c = combat();
  if (!c?.live) return;
  lf.at = at;
  const live = c.live;
  const point = (x, y, z = 0) => at((x + 0.5) * WIDTH, y + 0.5, z);
  const youShown = lf.you ?? live.you;
  const spots = { you: youShown };
  for (const [k, shown] of lf.shown) spots[k] = shown;
  // Where the player's walking to.
  if (live.you.to) {
    const [gx, gy] = point(live.you.to.x, live.you.to.y);
    ctx.strokeStyle = "rgba(214,255,226,.85)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(gx, gy, unit * 0.2, unit * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Who the player's going for.
  if (live.you.target && spots[live.you.target] && c.you.hp > 0) {
    const [ax, ay] = point(youShown.x, youShown.y);
    const [bx, by] = point(spots[live.you.target].x, spots[live.you.target].y);
    ctx.save();
    ctx.strokeStyle = "rgba(255,150,130,.5)";
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay - unit * 0.55);
    ctx.lineTo(bx, by - unit * 0.55);
    ctx.stroke();
    ctx.restore();
  }
  for (const one of lf.fx) {
    if (one.kind === "float") continue;
    const from = spots[one.from];
    const to = spots[one.to];
    if (!from || !to) continue;
    const [x0, y0] = point(from.x, from.y);
    let [x1, y1] = point(to.x, to.y);
    const left = 1 - one.t / one.life;
    ctx.globalAlpha = left;
    if (one.kind === "shot") {
      if (!one.hit) {
        const length = Math.hypot(x1 - x0, y1 - y0) || 1;
        x1 += ((x1 - x0) / length) * unit;
        y1 += ((y1 - y0) / length) * unit;
      }
      ctx.strokeStyle = one.from === "you" || isAlly(one.from) ? "#e6ffe9" : "#ffc29a";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - unit * 0.55);
      ctx.lineTo(x1, y1 - unit * 0.55);
      ctx.stroke();
      ctx.fillStyle = one.hit ? "#fff2c8" : "#9fb0a6";
      ctx.beginPath();
      ctx.arc(x1, y1 - unit * 0.55, 2 + (1 - left) * 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#ffd8b0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x1, y1 - unit * 0.5, unit * 0.18 * (1.4 - left), -2.2, -0.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const action = pickedAction();
  const attack = c.actions.find((one) => one.action.type === "attack");
  const marks = [{ key: "you", name: null, hp: c.you.hp, maxHp: c.you.maxHp, ready: live.you.ready, covered: live.you.covered, ally: true, x: youShown.x, y: youShown.y }];
  for (const fighter of [...c.allies, ...c.enemies]) {
    const place = live.fighters[fighter.key];
    const shown = lf.shown.get(fighter.key);
    if (!place || !shown || shown.fade <= 0) continue;
    marks.push({ key: fighter.key, name: fighter.name, hp: fighter.hp, maxHp: fighter.maxHp, ready: place.ready, covered: place.covered, ally: place.side === "us", down: fighter.hp <= 0, out: Boolean(fighter.out), x: shown.x, y: shown.y, fade: shown.fade });
  }
  // Names that would sit on each other step up out of the way, the nearest the front first.
  marks.sort((a, b) => (b.x * WIDTH + b.y) - (a.x * WIDTH + a.y));
  const placed = [];
  for (const mark of marks) {
    const [x, y] = point(mark.x, mark.y);
    const wanted = !mark.ally && !mark.down && !mark.out && (lf.picking || hover === `fighter:${mark.key}`) ? oddsOn(mark.key, action ?? attack) : null;
    const tall = (mark.name ? 17 : 0) + (mark.down || mark.out ? 0 : 11) + (wanted ? 17 : 0);
    let top = y - unit * (mark.down ? 0.3 : 0.96);
    // As wide as the name on it, measured the way the room draws it, so names side by side step out of each other's way.
    ctx.font = `700 11px "Cascadia Mono", Consolas, monospace`;
    const half = mark.name ? Math.max(26, ctx.measureText(mark.down ? `${mark.name}: down` : mark.name).width / 2 + 7) : 26;
    for (let i = 0; i < 30 && placed.some((box) => box.x0 < x + half && box.x1 > x - half && box.y0 < top && box.y1 > top - tall); i += 1) top -= 4;
    placed.push({ x0: x - half, x1: x + half, y0: top - tall, y1: top });
    ctx.globalAlpha = mark.fade ?? 1;
    let above = top;
    if (mark.name) above = chip(ctx, mark.down ? `${mark.name}: down` : mark.name, x, top, mark.down ? "#9aa59d" : mark.ally ? "#bfe1ff" : "#ffb4a4").y;
    if (!mark.down && !mark.out) {
      const wide = 36;
      const bx = Math.round(x - wide / 2);
      const by = above - 6;
      ctx.fillStyle = "rgba(4,6,5,.82)";
      ctx.fillRect(bx - 1, by - 5, wide + 2, 10);
      ctx.fillStyle = mark.ally ? "#8df5ac" : "#ff8f7f";
      ctx.fillRect(bx, by, Math.round((wide * Math.max(0, mark.hp)) / mark.maxHp), 4);
      // How soon they're ready to act again, filling up.
      ctx.fillStyle = "#f2c14e";
      ctx.fillRect(bx, by - 4, Math.round(wide * mark.ready), 2);
      if (mark.covered) {
        ctx.fillStyle = "rgba(4,6,5,.82)";
        ctx.fillRect(bx + wide + 1, by - 2, 8, 8);
        ctx.fillStyle = "#8ec5ff";
        ctx.beginPath();
        ctx.arc(bx + wide + 5, by + 2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      above = by - 6;
    }
    if (wanted) chip(ctx, wanted.text, x, above, wanted.off ? "#aeb6b0" : "#f2c14e", { background: "rgba(20,14,2,.9)" });
    ctx.globalAlpha = 1;
  }
  ctx.font = `700 13px "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const one of lf.fx) {
    if (one.kind !== "float" || !spots[one.key]) continue;
    const [x, y] = point(spots[one.key].x, spots[one.key].y);
    const rise = (one.t / one.life) * 28;
    ctx.globalAlpha = Math.min(1, (1 - one.t / one.life) * 1.6);
    ctx.font = `700 ${one.big ? 17 : 13}px "Cascadia Mono", Consolas, monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(3,4,3,.9)";
    ctx.strokeText(one.text, x, y - unit * 1.32 - rise);
    ctx.fillStyle = one.color;
    ctx.fillText(one.text, x, y - unit * 1.32 - rise);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}

// A click in the room during the fight: on one of the other side, to go for them, or do what's being aimed; on the
// floor, to walk there. Nothing else in the room can be used until it's over. Says whether it was the fight's.
export function liveClick(hit) {
  const c = combat();
  if (!c?.live || lf.ending) return false;
  if (c.hp <= 0) return true;
  if (hit?.kind === "fighter") {
    const enemy = c.enemies.find((one) => one.key === hit.fighter && one.hp > 0 && !one.out);
    if (!enemy) return true;
    const action = pickedAction();
    order(action ? { ...action.action, target: enemy.key } : { type: "attack", target: enemy.key });
    return true;
  }
  if (lf.picking) {
    lf.picking = null;
    redraw();
    return true;
  }
  // Anywhere else in the room is somewhere to walk to: the floor, or beside whoever or whatever's there.
  const spot = hit?.kind === "floor" ? hit : hit?.person ?? hit?.thing ?? hit?.exit ?? null;
  if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) order({ type: "move", x: spot.x, y: spot.y });
  return true;
}

// ---- The windows -------------------------------------------------------------------------------------------------

const RESULT_TITLES = { victory: "Victory", defeat: "Defeat", fled: "You got away", talked: "It's over", surrendered: "You gave up" };
const RESULT_TONES = { victory: "good", defeat: "bad", fled: "info", talked: "good", surrendered: "warn" };
const BATTLE_TITLES = { victory: "The battle's won", talked: "The battle's won", defeat: "You went down" };

function chosen(action) {
  const c = combat();
  if (action.disabled || lf.ending || c.hp <= 0) return;
  if (!action.targets) {
    order(action.action);
    return;
  }
  const foes = c.enemies.filter((one) => one.hp > 0 && !one.out);
  if (foes.length === 1) order({ ...action.action, target: foes[0].key });
  else {
    lf.picking = lf.picking === key(action) ? null : key(action);
    redraw();
  }
}

function hint() {
  const c = combat();
  if (c.hp <= 0) return "You're down.";
  if (lf.picking) return "Now click one of them in the room, or in the list.";
  if (lf.paused) return lf.heldFor === "ready" ? "You're ready. Give an order, or press Space to go on." : "Stopped. Give your orders: click the floor to walk, one of them to go for them. Space goes on.";
  return "Click the floor to walk, one of them to go for them. Space stops it.";
}

// The orders, in a low bar along the bottom of the room so the fight can be seen above it. What each does is its
// tooltip, as with the menus.
function ordersWindow() {
  const c = combat();
  const live = c.live;
  const queued = live.you.queued ? `${live.you.queued.type}:${live.you.queued.id ?? ""}` : null;
  const numbered = ["attack", "talk", "other"].flatMap((group) => c.actions.filter((one) => (one.group ?? "other") === group));
  return el("section", { class: "check-window live-orders", "data-theme": "green", "aria-label": "Your orders" },
    el("header", { class: "check-title" }, el("span", { class: "check-name" }, "Your orders"), el("span", { class: "check-skill" }, lf.paused ? "stopped" : "running")),
    el("div", { class: "options live-options" }, numbered.map((action, i) => el("button", {
      class: `${lf.picking === key(action) || queued === key(action) ? "on" : ""}`,
      "data-choice": String(i + 1),
      "data-order": key(action),
      disabled: Boolean(action.disabled) || c.hp <= 0,
      title: action.disabled ? action.why : action.detail ?? "",
      onclick: (event) => {
        event.stopPropagation();
        chosen(action);
      },
    }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, action.label)))),
    lf.message && el("div", { class: "live-message" }, lf.message),
    el("div", { class: "live-controls" },
      el("span", { class: "live-hint" }, hint()),
      el("button", { class: "live-go", id: "live-go", onclick: (event) => {
        event.stopPropagation();
        togglePause();
      } }, lf.paused ? "Go on (Space)" : "Stop (Space)"),
      el("label", { class: "live-check", for: "live-stop" }, el("input", { type: "checkbox", id: "live-stop", ...(lf.stopWhenReady ? { checked: true } : {}), onchange: (event) => {
        lf.stopWhenReady = event.target.checked;
        try {
          localStorage.setItem(STOP_KEY, lf.stopWhenReady ? "yes" : "no");
        } catch {
          // It still works until the page is closed.
        }
        // Space goes back to the clock.
        event.target.blur();
      } }), "Stop when I'm ready to act")));
}

// A fight a written scene was waiting on goes on with the story; any other is over, and its line is in the story.
function endingWindow() {
  const result = lf.ending;
  const back = () => {
    lf.ending = null;
    app.render();
  };
  // A battle's ending says what it cost in its summary, so it doesn't list everyone who was in it.
  const battle = Boolean(result.battle);
  const choices = app.ui.game?.storyWaiting
    ? [["Continue the story", () => {
      lf.ending = null;
      app.sendChat({ event: "continue" });
    }, "the story picks it up from here"], ["Look around first", back]]
    : [["Back to the room", back]];
  return el("section", { class: "check-window live-orders live-ending", "data-theme": RESULT_TONES[result.result] === "bad" ? "red" : "green", "aria-label": "How the fight ended" },
    el("header", { class: "check-title" }, el("span", { class: "check-name" }, battle ? BATTLE_TITLES[result.result] ?? "It's over" : RESULT_TITLES[result.result] ?? "It's over")),
    el("div", { class: "live-summary" }, result.summary, result.math && el("span", { class: "log-math" }, ` (${result.math})`)),
    battle ? null : (result.followers ?? []).map((one) => el("div", { class: "live-summary small" }, `${one.name}: ${one.down ? "knocked out" : `${one.hp}/${one.maxHp} health`}`)),
    el("div", { class: "options live-options" }, choices.map(([label, run, detail], i) => el("button", {
      "data-choice": String(i + 1),
      onclick: (event) => {
        event.stopPropagation();
        run();
      },
    }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label), detail && el("span", { class: "option-detail" }, detail)))));
}

function notesNode() {
  // A battle goes by its own name.
  const name = combat()?.battle?.title ?? lf.battle ?? "Fight";
  return el("div", { class: "live-notes", "aria-live": "polite" },
    el("div", { class: "live-banner" }, lf.ending ? `${lf.battle ? "The battle" : "The fight"}'s over` : lf.paused ? `${name} · stopped` : `${name} · running`),
    lf.notes.map((one, i) => el("div", { class: `live-note ${one.tone}${i < lf.notes.length - 1 ? " old" : ""}` }, one.text)));
}

// What goes over the room while the fight's on: the notes in its top left, and the orders or how it ended in its
// bottom left.
export function liveLayerNode() {
  if (!liveOn()) return null;
  keepUp();
  return el("div", { class: "live-layer", id: "live-layer" }, notesNode(), lf.ending ? endingWindow() : combat()?.live ? ordersWindow() : null);
}

// The two sides, in the room's panel, in place of what's in the room: a click on one of the other side goes for them.
export function liveRosterNode() {
  const c = combat();
  if (!c?.live) return null;
  const live = c.live;
  const row = (one, side) => {
    const lost = one.hp <= 0 || Boolean(one.out);
    const parts = [
      el("span", { class: "walk-here-badge", style: `--speaker:${one.color ?? (side === "enemy" ? "#ff8f7f" : "#8ec5ff")}` }, one.name[0].toUpperCase()),
      el("span", { class: "live-who" }, one.name),
      el("span", { class: "live-count" }, `${Math.max(0, one.hp)}/${one.maxHp}`),
      el("span", { class: `live-bar ${side === "enemy" ? "them" : "us"}` }, el("b", { style: `width:${Math.round((Math.max(0, one.hp) / one.maxHp) * 100)}%` })),
      el("span", { class: "live-sub", title: (one.wounds ?? []).join(", ") }, [one.hp <= 0 ? "down" : one.out ? "out of it" : null, (side === "you" ? live.you.covered : live.fighters[one.key]?.covered) && !lost ? "in cover" : null, ...(one.wounds ?? []), side === "you" ? `energy ${c.you.energy}/${c.you.maxEnergy}` : null].filter(Boolean).join(" · ")),
    ];
    if (side !== "enemy") return el("div", { class: `live-row${lost ? " lost" : ""}` }, parts);
    return el("button", {
      class: `live-row${lost ? " lost" : ""}${live.you.target === one.key ? " aimed" : ""}`,
      disabled: lost || c.hp <= 0,
      "data-fighter": one.key,
      onclick: () => liveClick({ kind: "fighter", fighter: one.key }),
    }, parts);
  };
  // In a battle there are too many of them to list: the nearest still fighting, and how the rest stand.
  const standing = c.enemies.filter((one) => one.hp > 0 && !one.out && live.fighters[one.key]);
  const far = (one) => Math.hypot((live.fighters[one.key].x - live.you.x) * WIDTH, live.fighters[one.key].y - live.you.y);
  const shownFoes = c.battle ? [...standing].sort((a, b) => far(a) - far(b)).slice(0, BATTLE_ROWS) : c.enemies;
  const rest = c.battle ? [
    standing.length > BATTLE_ROWS ? `${standing.length - BATTLE_ROWS} more further off` : null,
    c.enemies.filter((one) => one.hp <= 0).length ? `${c.enemies.filter((one) => one.hp <= 0).length} down` : null,
    c.enemies.filter((one) => one.hp > 0 && one.out).length ? `${c.enemies.filter((one) => one.hp > 0 && one.out).length} out of it` : null,
  ].filter(Boolean).join(" · ") : "";
  return el("div", { class: "live-roster", id: "live-roster" },
    el("div", { class: "walk-here-head" }, el("span", {}, "With you"), el("span", {}, String(1 + c.allies.filter((one) => one.hp > 0).length))),
    row({ key: "you", name: c.you.name, hp: c.you.hp, maxHp: c.you.maxHp, color: "#b4f0be", wounds: c.you.wounds }, "you"),
    c.allies.map((one) => row(one, "ally")),
    el("div", { class: "walk-here-head" }, el("span", {}, "Against you"), el("span", {}, String(standing.length))),
    shownFoes.map((one) => row(one, "enemy")),
    rest && el("div", { class: "live-rest" }, rest));
}
// How many of the other side a battle's list shows by name: the nearest.
const BATTLE_ROWS = 6;

// The camera keeps the player above the bar of orders.
export function liveSettled() {
  const bar = document.querySelector("#live-layer .live-orders");
  if (bar) isoLook({ bottom: bar.offsetHeight + 12 });
}

// Only what's changed is drawn again, so a button doesn't go from under a click.
function redraw() {
  const layer = document.getElementById("live-layer");
  if (layer) {
    const fresh = liveLayerNode();
    const said = fresh?.outerHTML ?? "";
    if (said !== lf.drawn.layer) {
      lf.drawn.layer = said;
      if (fresh) layer.replaceWith(fresh);
      else layer.remove();
      liveSettled();
    }
  }
  const roster = document.getElementById("live-roster");
  if (roster) {
    const fresh = liveRosterNode();
    const said = fresh?.outerHTML ?? "";
    if (said !== lf.drawn.roster && fresh) {
      lf.drawn.roster = said;
      roster.replaceWith(fresh);
    }
  }
}

// A fight in the room while the story's in another view: it can only be fought there.
export function liveElsewhereNode() {
  const c = combat();
  if (!c?.live || app.roomShown()) return null;
  return el("div", { class: "fight-overlay", id: "fight" }, el("div", { class: "fight-window", role: "dialog", "aria-label": "Fight", tabindex: "-1" },
    el("div", { class: "fight-title" }, el("span", {}, "Combat")),
    el("div", { class: "fight-result" },
      el("div", {}, "This fight is happening in the room. It's fought in the Isometric view."),
      el("div", { class: "options" }, el("button", { onclick: () => app.showRoom() }, el("span", { class: "option-label" }, "Show the room"))))));
}

// The keys, while the fight's in the room: Space stops and starts it, a number gives that order, Esc lets go of an
// order waiting for someone to be aimed at. Says whether the key was the fight's.
export function liveKey(event) {
  if (!liveOn()) return false;
  if (event.key === " ") {
    event.preventDefault();
    if (!event.repeat && !lf.ending) togglePause();
    return true;
  }
  if (event.key === "Escape" && lf.picking) {
    event.preventDefault();
    lf.picking = null;
    redraw();
    return true;
  }
  if (/^[0-9]$/.test(event.key)) {
    const button = document.querySelector(`#live-layer [data-choice="${event.key === "0" ? "10" : event.key}"]`);
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
    }
    return true;
  }
  return false;
}

// A different game was loaded, so whatever was on screen no longer applies.
export function resetLive() {
  Object.assign(lf, { id: null, paused: true, heldFor: "start", picking: null, notes: [], fx: [], ending: null, asking: null, refused: null, message: null, you: null, drawn: { layer: "", roster: "" } });
  lf.shown.clear();
}

// For checking the page: what's going on.
window.liveFight = {
  state: lf,
  setPaused,
  order,
  combat: () => combat(),
  // Where a square is on the screen, as the room last drew it.
  screenOf: (x, y) => {
    const canvas = document.querySelector("#walk-frame canvas");
    if (!canvas || !lf.at) return null;
    const box = canvas.getBoundingClientRect();
    const scale = box.width / (canvas.clientWidth || box.width);
    const [cx, cy] = lf.at((x + 0.5) * WIDTH, y + 0.5);
    return { x: box.left + cx * scale, y: box.top + cy * scale };
  },
};
