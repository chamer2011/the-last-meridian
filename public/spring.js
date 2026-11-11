// Everything that scrolls does it with no scroll bar, and at the top or the bottom it runs on a little past the end and
// springs back, the way a phone's lists do: the menus, the story, the talks, the checks, the computers, What's here,
// the quest log, the inventory, the Story board, every window. The wheel's scrolling is done here rather than by the
// browser, which can't go past the end: the page scrolls as far as it can, and what's left over moves the contents
// themselves, held back harder the further they go, until the wheel rests and they come back. Nothing here changes
// what's in a window.

// Where a window's own scrolling part is, when the wheel turns over a part of it that doesn't scroll (the menu's title).
const MAIN = { side: ".menu-body" };
// Kept when it's drawn again, since the page puts nobody back in their place on it: the rail of menu buttons.
const KEEP = ["rail"];
// How far past the end the contents can go, at most, in pixels (less on a short window), and how much harder the wheel
// pulls once they're past it.
const STRETCH = 150;
const PAST = 0.5;
// How much a wheel's line or page is, for a mouse that counts in those.
const LINE = 40;
// How long the wheel has to rest before the contents come back, in seconds. It's counted in the spring's own time, so a
// busy or hidden page that draws fewer frames still shows the contents going past the end before they come back.
const REST = 0.11;
// The longest step the spring takes in one frame, in seconds.
const FRAME = 0.034;
// How quickly the scrolling catches up with the wheel, and how quickly the contents come back once it rests. Both are
// springs damped so they settle without going past where they're going.
const FOLLOW = 24;
const RETURN = 12;

const states = new Map(); // a scrolling part's key → how it's moving, while it moves
const wired = new WeakSet();
const kept = new Map(); // a kept part's id → where it was scrolled to
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// How far the contents show past the end for how far the wheel has taken them: the further, the harder it pulls back.
function band(over, room) {
  const far = Math.abs(over);
  return Math.sign(over) * (1 - 1 / ((far * 0.55) / room + 1)) * room;
}

function roomOf(box) {
  return Math.max(24, Math.min(STRETCH, box.clientHeight / 2.5));
}

function scrollsDown(box) {
  if (box.scrollHeight <= box.clientHeight + 1) return false;
  const y = getComputedStyle(box).overflowY;
  return y === "auto" || y === "scroll" || y === "overlay";
}

// How the contents go past the end: moved, when they're pieces of their own, or pushed along by the part's own padding
// when it holds its words straight (the file on the Story board), since words alone can't be moved. Moving is the
// lighter of the two, since nothing has to be laid out again. Neither, for someone who's asked for less motion.
function howItStretches(box) {
  if (still()) return null;
  for (const node of box.childNodes) if (node.nodeType === 3 && node.textContent.trim()) return "pad";
  return "move";
}

// The part that scrolls under the mouse: the innermost one that has more than it shows. A box someone types in keeps
// the browser's own scrolling, and so does anything that took the wheel for itself (the room's zoom).
function scrollerFor(target) {
  for (let node = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.nodeType !== 1) continue;
    if (scrollsDown(node)) return /^(TEXTAREA|SELECT|INPUT)$/.test(node.tagName) ? null : node;
  }
  for (const [id, part] of Object.entries(MAIN)) {
    const zone = document.getElementById(id);
    if (!zone?.contains(target)) continue;
    const main = zone.querySelector(part);
    if (main && scrollsDown(main)) return main;
  }
  return null;
}

// A name for a scrolling part that finds it again when the page draws it afresh.
function keyOf(box) {
  if (box.id) return `#${box.id}`;
  let holder = box.parentElement;
  while (holder && !holder.id) holder = holder.parentElement;
  const tag = box.tagName.toLowerCase() + [...box.classList].filter((c) => c !== "springing").map((c) => `.${CSS.escape(c)}`).join("");
  const selector = holder ? `#${CSS.escape(holder.id)} ${tag}` : tag;
  const index = [...document.querySelectorAll(selector)].indexOf(box);
  return `${selector}|${Math.max(0, index)}`;
}

function findByKey(key) {
  if (!key.includes("|")) return document.querySelector(key);
  const [selector, index] = key.split("|");
  return document.querySelectorAll(selector)[Number(index)] ?? null;
}

function stateFor(box) {
  for (const s of states.values()) if (s.box === box) return measure(s);
  const s = { key: keyOf(box), box, x: box.scrollTop, v: 0, goal: box.scrollTop, written: box.scrollTop, max: 0, rest: 0, t: 0, frame: 0, stretch: howItStretches(box), pad: null };
  states.set(s.key, s);
  return measure(s);
}

function measure(s) {
  if (s.x >= 0 && s.x <= s.max) s.max = Math.max(0, s.box.scrollHeight - s.box.clientHeight);
  else s.max = Math.max(s.max, 0);
  return s;
}

function onWheel(event) {
  if (event.ctrlKey || event.shiftKey || event.defaultPrevented) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
  const box = scrollerFor(event.target);
  if (!box) return;
  event.preventDefault();
  const s = stateFor(box);
  if (!s.frame) s.max = Math.max(0, box.scrollHeight - box.clientHeight);
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? box.clientHeight * 0.9 : 1;
  let delta = event.deltaY * unit;
  if ((s.goal < 0 && delta < 0) || (s.goal > s.max && delta > 0)) delta *= PAST;
  const reach = s.stretch ? roomOf(box) * 2.5 : 0;
  s.goal = clamp(s.goal + delta, -reach, s.max + reach);
  s.rest = 0;
  if (!s.frame) {
    s.t = performance.now();
    s.frame = requestAnimationFrame((now) => step(s, now));
  }
}

function paint(s) {
  const { box, max } = s;
  box.scrollTop = clamp(s.x, 0, max);
  const over = s.x < 0 ? s.x : s.x > max ? s.x - max : 0;
  const shown = Math.round(-band(over, roomOf(box)) * 10) / 10;
  if (s.stretch === "pad") pad(s, shown);
  else move(box, shown);
  s.written = box.scrollTop;
}

function move(box, shown) {
  if (shown) {
    box.classList.add("springing");
    box.style.setProperty("--spring", `${shown}px`);
  } else if (box.classList.contains("springing")) {
    box.classList.remove("springing");
    box.style.removeProperty("--spring");
  }
}

// The words pushed down by more padding at the top, or up by more at the bottom and scrolling into it.
function pad(s, shown) {
  const { box } = s;
  if (shown && !s.pad) {
    const style = getComputedStyle(box);
    s.pad = { top: box.style.paddingTop, bottom: box.style.paddingBottom, baseTop: parseFloat(style.paddingTop) || 0, baseBottom: parseFloat(style.paddingBottom) || 0 };
  }
  if (!s.pad) return;
  box.style.paddingTop = shown > 0 ? `${s.pad.baseTop + shown}px` : s.pad.top;
  box.style.paddingBottom = shown < 0 ? `${s.pad.baseBottom - shown}px` : s.pad.bottom;
  if (shown < 0) box.scrollTop = s.max - shown;
  if (!shown) s.pad = null;
}

// One step of a spring damped just enough not to go past its goal, worked out exactly, so a long frame can't set it
// shaking.
function spring(s, w, dt) {
  const off = s.x - s.goal;
  const fade = Math.exp(-w * dt);
  const lead = s.v + w * off;
  s.x = s.goal + (off + lead * dt) * fade;
  s.v = (s.v - w * lead * dt) * fade;
}

function step(s, now) {
  s.frame = 0;
  if (!s.box.isConnected) {
    const again = findByKey(s.key);
    if (!again) return states.delete(s.key);
    s.box = again;
  }
  const box = s.box;
  const dt = clamp((now - s.t) / 1000, 0.001, FRAME);
  s.t = now;
  // While nothing's past the end the page can say how far it scrolls; once something is, that's measured as it was.
  if (s.x >= 0 && s.x <= s.max) {
    s.max = Math.max(0, box.scrollHeight - box.clientHeight);
    // Moved by something else meanwhile (the keyboard, the page following the story): it goes on from there.
    if (Math.abs(box.scrollTop - s.written) > 2) {
      s.x = s.goal = box.scrollTop;
      s.v = 0;
    }
  }
  s.rest += dt;
  const resting = s.rest > REST;
  if (resting) s.goal = clamp(s.goal, 0, s.max);
  const back = resting && (s.x < 0 || s.x > s.max);
  spring(s, back ? RETURN : FOLLOW, dt);
  if (resting && Math.abs(s.goal - s.x) < 0.4 && Math.abs(s.v) < 30) {
    s.x = s.goal;
    s.v = 0;
    paint(s);
    states.delete(s.key);
    return;
  }
  paint(s);
  s.frame = requestAnimationFrame((later) => step(s, later));
}

// A part caught mid-spring when the page draws it afresh carries on in the new one, and the rail stays where it was
// scrolled to.
function redrawn() {
  for (const id of KEEP) {
    const part = document.getElementById(id);
    if (!part || wired.has(part)) continue;
    wired.add(part);
    if (kept.has(id) && !states.get(`#${id}`)) part.scrollTop = kept.get(id);
    part.addEventListener("scroll", () => kept.set(id, part.scrollTop), { passive: true });
  }
  for (const s of states.values()) {
    if (s.box.isConnected) continue;
    const again = findByKey(s.key);
    if (!again) continue;
    s.box = again;
    paint(s);
  }
}

// After every other handler, so the room's zoom and anything else that takes the wheel go first.
document.addEventListener("wheel", onWheel, { passive: false });
new MutationObserver(redrawn).observe(document.documentElement, { childList: true, subtree: true });
redrawn();
