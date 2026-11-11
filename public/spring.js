// The menus scroll with no scroll bar, and at the top or the bottom they run on a little past the end and spring back,
// the way a phone's lists do. Inside a menu the wheel's scrolling is done here rather than by the browser, which can't
// go past the end: the page scrolls as far as it can, and what's left over moves the menu's contents themselves, held
// back harder the further they go, until the wheel rests and they come back. Nothing here changes what's in a menu.

// Where it works, by id: the rail of menu buttons down the right edge, and the open menu.
const ZONES = ["rail", "side"];
// Where a zone's own scrolling part is, when the wheel turns over a part of it that doesn't scroll (the menu's title).
const MAIN = { side: ".menu-body" };
// Kept when a zone is drawn again, since the page puts nobody back in their place on it: the rail.
const KEEP = new Set(["rail"]);
// How far past the end the contents can go, at most, in pixels (less on a short menu), and how much harder the wheel
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

const states = new Map(); // a scrolling part's key → how it's moving
const wired = new WeakSet();
const kept = new Map(); // a kept zone's id → where it was scrolled to
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

// The part that scrolls under the mouse, inside a zone. A box someone types in keeps the browser's own scrolling.
function scrollerFor(target, zone) {
  for (let node = target; node && node !== zone.parentElement; node = node.parentElement) {
    if (node.nodeType !== 1) continue;
    if (scrollsDown(node)) return /^(TEXTAREA|SELECT|INPUT)$/.test(node.tagName) ? null : node;
  }
  const main = MAIN[zone.id] && zone.querySelector(MAIN[zone.id]);
  return main && scrollsDown(main) ? main : null;
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
  const key = keyOf(box);
  let s = states.get(key);
  if (s && s.box !== box) s.box = box;
  if (!s) {
    s = { key, box, x: box.scrollTop, v: 0, goal: box.scrollTop, written: box.scrollTop, max: 0, rest: 0, t: 0, frame: 0 };
    states.set(key, s);
  }
  // At rest, it starts from wherever it's been scrolled to since, by the keyboard or by the page.
  if (!s.frame) {
    s.x = s.goal = s.written = box.scrollTop;
    s.v = 0;
  }
  s.max = Math.max(0, box.scrollHeight - box.clientHeight);
  return s;
}

function onWheel(event) {
  if (event.ctrlKey || event.defaultPrevented) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
  const box = scrollerFor(event.target, event.currentTarget);
  if (!box) return;
  event.preventDefault();
  const s = stateFor(box);
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? box.clientHeight * 0.9 : 1;
  let delta = event.deltaY * unit;
  if ((s.goal < 0 && delta < 0) || (s.goal > s.max && delta > 0)) delta *= PAST;
  const reach = still() ? 0 : roomOf(box) * 2.5;
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
  s.written = box.scrollTop;
  const over = s.x < 0 ? s.x : s.x > max ? s.x - max : 0;
  const shown = Math.round(-band(over, roomOf(box)) * 10) / 10;
  if (shown) {
    box.classList.add("springing");
    box.style.setProperty("--spring", `${shown}px`);
  } else if (box.classList.contains("springing")) {
    box.classList.remove("springing");
    box.style.removeProperty("--spring");
  }
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
    // Moved by something else meanwhile (the keyboard, the page): it goes on from there.
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
    return;
  }
  paint(s);
  s.frame = requestAnimationFrame((later) => step(s, later));
}

// Every zone gets the wheel's handler, whenever the page draws one afresh; a part caught mid-spring carries on in the
// new one; and the rail stays where it was scrolled to.
function wire() {
  for (const id of ZONES) {
    const zone = document.getElementById(id);
    if (!zone || wired.has(zone)) continue;
    wired.add(zone);
    zone.addEventListener("wheel", onWheel, { passive: false });
    if (KEEP.has(id)) {
      if (kept.has(id) && !states.get(`#${id}`)?.frame) zone.scrollTop = kept.get(id);
      zone.addEventListener("scroll", () => kept.set(id, zone.scrollTop), { passive: true });
    }
  }
  for (const s of states.values()) {
    if (s.box.isConnected || !s.frame) continue;
    const again = findByKey(s.key);
    if (!again) continue;
    s.box = again;
    paint(s);
  }
}

new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });
wire();
