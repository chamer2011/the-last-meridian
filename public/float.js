// The windows that float over the room, the skill check's and the computer's: pulled aside with the mouse they follow
// it, and let go they slide back, the way the panes in the room do; and a thin line runs from each to whatever it's
// about in the room, a part, a door, a person or a console, the way the panes point at their people and things.

const NS = "http://www.w3.org/2000/svg";
const zoom = () => Number(document.documentElement.style.zoom) || 1;
// Taking hold of a window anywhere but these, which are for clicking.
const SKIPS = "button, a, input, textarea, select, label, summary, details, [data-lore]";

// Where something is on the screen, and how to keep it clear of a window, from the walk view, which knows the room. Set
// once, when the page loads.
let markPoint = () => null;
let keepClear = () => {};
export function aimWith(finder, clearer = () => {}) {
  markPoint = finder;
  keepClear = clearer;
}

// ---- Pulling a window aside -----------------------------------------------------------------

// The pull is kept here by the window's id, not on the window, so a redraw in the middle of it carries on.
let active = null;

export function pullable(node) {
  const id = node.id;
  node.addEventListener("pointerdown", (event) => pressed(event, id));
  // A pull ends with a click the browser sends anyway, and that click mustn't press anything.
  node.addEventListener("click", (event) => {
    if (!node.dataset.swallow) return;
    delete node.dataset.swallow;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  if (active?.id === id && active.moved) {
    node.classList.add("dragging");
    node.style.transform = `translate(${active.dx}px, ${active.dy}px)`;
  }
  return node;
}

function pressed(event, id) {
  if (event.button !== 0 || active || event.target.closest(SKIPS)) return;
  // No text gets selected by a pull, and the keyboard stays where it was.
  event.preventDefault();
  active = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false, dx: 0, dy: 0 };
  document.addEventListener("pointermove", moved);
  document.addEventListener("pointerup", released);
  document.addEventListener("pointercancel", released);
}

function moved(event) {
  if (!active || event.pointerId !== active.pointer) return;
  const dx = (event.clientX - active.x) / zoom();
  const dy = (event.clientY - active.y) / zoom();
  // A hand that wobbles while clicking isn't pulling.
  if (!active.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    active.moved = true;
  }
  active.dx = dx;
  active.dy = dy;
  const node = document.getElementById(active.id);
  if (!node) return;
  node.classList.remove("springing");
  node.classList.add("dragging");
  node.style.transform = `translate(${dx}px, ${dy}px)`;
  aimLeaders();
}

function released(event) {
  if (!active || event.pointerId !== active.pointer) return;
  const was = active;
  active = null;
  document.removeEventListener("pointermove", moved);
  document.removeEventListener("pointerup", released);
  document.removeEventListener("pointercancel", released);
  if (!was.moved) return;
  const node = document.getElementById(was.id);
  if (!node) return;
  node.dataset.swallow = "1";
  setTimeout(() => delete node.dataset.swallow, 60);
  node.classList.remove("dragging");
  node.classList.add("springing");
  node.style.transform = "";
  setTimeout(() => node.classList.remove("springing"), 360);
}

// ---- The line to what it's about ----------------------------------------------------------------

// A line from the window's corner nearest the thing to a dot on the thing, in the window's colour. It's drawn again
// every frame while there's one to draw, so it follows the thing as people walk and the view moves, and the window as
// it's pulled aside and slides back. Nothing's drawn when the thing isn't in view, or is under the window.
export function leaderNode(target) {
  if (!target) return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "float-leader");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.target = target;
  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("r", "2.5");
  svg.append(document.createElementNS(NS, "line"), dot);
  startAiming();
  return svg;
}

let aiming = false;
function startAiming() {
  if (aiming) return;
  aiming = true;
  const frame = () => {
    if (!document.querySelector(".float-leader")) {
      aiming = false;
      keepClear(null);
      return;
    }
    aimLeaders();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function aimLeaders() {
  let kept = false;
  for (const svg of document.querySelectorAll(".float-leader")) {
    const layer = svg.parentElement;
    const win = layer?.querySelector(".check-window");
    // Where the window rests, not where it's been pulled to: the room keeps the thing clear of that.
    if (win && !kept) {
      const base = layer.getBoundingClientRect();
      const z = zoom();
      keepClear(svg.dataset.target, { left: base.left + win.offsetLeft * z, top: base.top + win.offsetTop * z, right: base.left + (win.offsetLeft + win.offsetWidth) * z, bottom: base.top + (win.offsetTop + win.offsetHeight) * z });
      kept = true;
    }
    const point = win ? markPoint(svg.dataset.target) : null;
    if (!point) {
      svg.classList.remove("shown");
      continue;
    }
    const z = zoom();
    const base = layer.getBoundingClientRect();
    const box = win.getBoundingClientRect();
    // In the layer's own measure.
    const p = { x: (point.x - base.left) / z, y: (point.y - base.top) / z };
    const r = { left: (box.left - base.left) / z, top: (box.top - base.top) / z, right: (box.right - base.left) / z, bottom: (box.bottom - base.top) / z };
    if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) {
      svg.classList.remove("shown");
      continue;
    }
    const cx = p.x < (r.left + r.right) / 2 ? r.left : r.right;
    const cy = p.y < r.top ? r.top : p.y > r.bottom ? r.bottom : p.y - r.top < (r.bottom - r.top) / 2 ? r.top : r.bottom;
    const [line, dot] = svg.children;
    line.setAttribute("x1", String(cx));
    line.setAttribute("y1", String(cy));
    line.setAttribute("x2", String(p.x));
    line.setAttribute("y2", String(p.y));
    dot.setAttribute("cx", String(p.x));
    dot.setAttribute("cy", String(p.y));
    svg.style.setProperty("--c", getComputedStyle(win).getPropertyValue("--c"));
    svg.classList.add("shown");
  }
}
