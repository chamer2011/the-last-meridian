// A small stand-in for the browser's page, for the Godot view's pages (src/godot-pages-worker.js). The game's menus are
// built by the page's own code (public/menus.js and the files it uses), which only ever makes elements, gives them
// classes, words and things to do when clicked, and puts them inside each other. This is just enough of a page for
// that code to run in Node: the elements are kept as a tree, nothing is laid out or drawn, and the tree is handed to
// Godot, which draws it. A click in Godot runs the element's own listener here.

class Style {
  constructor() {
    this.props = {};
  }
  setProperty(name, value) {
    this.props[name] = String(value);
  }
  getPropertyValue(name) {
    return this.props[name] ?? "";
  }
  removeProperty(name) {
    delete this.props[name];
  }
  // A style written as one line of text, as the page's code writes it: "left:12ch;top:calc(3 * var(--map-row))".
  set cssText(text) {
    this.props = {};
    for (const part of String(text).split(";")) {
      const at = part.indexOf(":");
      if (at > 0) this.props[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
  }
  get cssText() {
    return Object.entries(this.props).map(([name, value]) => `${name}:${value}`).join(";");
  }
}
// The page's code also sets one thing at a time (node.style.left = "12px", node.style.zIndex = 3): kept the same way.
const dashed = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const newStyle = () =>
  new Proxy(new Style(), {
    get: (style, name) => (typeof name !== "string" || name in style ? Reflect.get(style, name, style) : style.props[dashed(name)] ?? ""),
    set(style, name, value) {
      if (typeof name !== "string" || name in style) return Reflect.set(style, name, value, style);
      if (value === "" || value === null || value === undefined) delete style.props[dashed(name)];
      else style.props[dashed(name)] = String(value);
      return true;
    },
  });

class ClassList {
  constructor(node) {
    this.node = node;
  }
  list() {
    return this.node.className.split(/\s+/).filter(Boolean);
  }
  contains(name) {
    return this.list().includes(name);
  }
  add(...names) {
    this.node.className = [...new Set([...this.list(), ...names])].join(" ");
  }
  remove(...names) {
    this.node.className = this.list().filter((one) => !names.includes(one)).join(" ");
  }
  toggle(name, on = !this.contains(name)) {
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

// What a canvas is drawn on with, as far as the Map editor draws: filled and outlined rectangles, words, shapes of a
// few corners, and discs. Each is kept as a short list Godot can draw from: ["r", x, y, w, h, colour],
// ["o", x, y, w, h, colour, line width, dash, gap], ["t", words, x, y, colour, size, bold, across, down],
// ["p", colour, x, y, x, y, ...] and ["c", x, y, radius, colour]. Colours are #rrggbbaa.
const hexOf = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const tones = new Map();
function toneOf(css) {
  if (!tones.has(css)) {
    const text = String(css).trim();
    const parts = text.match(/^rgba?\(([^)]*)\)$/)?.[1].split(",").map(Number);
    const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    tones.set(css, parts ? `#${parts.slice(0, 3).map(hexOf).join("")}${hexOf((parts[3] ?? 1) * 255)}` : short ? `#${short.slice(1).map((one) => one + one).join("")}ff` : text.length === 7 ? `${text}ff` : text);
  }
  return tones.get(css);
}
const LETTER_WIDE = 1200 / 2048;
class Pen {
  constructor() {
    this.wipe();
  }
  // A canvas given its size again is blank, and what it's drawn with is as it was at first.
  wipe() {
    Object.assign(this, { shapes: [], runs: null, fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, font: "10px monospace", textAlign: "left", textBaseline: "alphabetic", dash: [], path: [], disc: null });
  }
  setTransform() {}
  setLineDash(dash) {
    this.dash = dash ?? [];
  }
  clearRect() {}
  get size() {
    return Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
  }
  measureText(text) {
    return { width: Math.ceil(String(text).length * LETTER_WIDE * this.size) };
  }
  // A filled rectangle that carries on from the last one of its colour along its row, or down its column, is one
  // rectangle with it: a deck is thousands of squares, and most of them are floor beside floor.
  // Only where nothing drawn since lies under the new part, which would then be drawn over it instead of under.
  fillRect(x, y, w, h) {
    const tone = toneOf(this.fillStyle);
    const clear = (run) => {
      if (this.shapes.length - run.at > 400) return false;
      for (let i = run.at + 1; i < this.shapes.length; i += 1) {
        const [, sx, sy, sw, sh] = this.shapes[i];
        if (sx < x + w && sx + sw > x && sy < y + h && sy + sh > y) return false;
      }
      return true;
    };
    const across = this.runs?.get(`${tone}|${y}|${h}`);
    if (across && across.shape[2] === y && across.shape[4] === h && Math.abs(across.shape[1] + across.shape[3] - x) < 0.01 && clear(across)) {
      across.shape[3] += w;
      return;
    }
    const down = this.runs?.get(`${tone}|${x}|${w}|down`);
    if (down && down.shape[1] === x && down.shape[3] === w && Math.abs(down.shape[2] + down.shape[4] - y) < 0.01 && clear(down)) {
      down.shape[4] += h;
      return;
    }
    const run = { shape: ["r", x, y, w, h, tone], at: this.shapes.length };
    this.shapes.push(run.shape);
    (this.runs ??= new Map()).set(`${tone}|${y}|${h}`, run);
    this.runs.set(`${tone}|${x}|${w}|down`, run);
  }
  // Anything else drawn may lie over the rectangles before it, so none of those is added to afterwards.
  put(shape) {
    this.runs = null;
    this.shapes.push(shape);
  }
  strokeRect(x, y, w, h) {
    this.put(["o", x, y, w, h, toneOf(this.strokeStyle), this.lineWidth, this.dash[0] ?? 0, this.dash[1] ?? 0]);
  }
  fillText(text, x, y) {
    this.put(["t", String(text), x, y, toneOf(this.fillStyle), this.size, /bold/.test(this.font) ? 1 : 0, this.textAlign, this.textBaseline]);
  }
  beginPath() {
    this.path = [];
    this.disc = null;
  }
  moveTo(x, y) {
    this.path.push(x, y);
  }
  lineTo(x, y) {
    this.path.push(x, y);
  }
  closePath() {}
  arc(x, y, radius) {
    this.disc = [x, y, radius];
  }
  fill() {
    if (this.disc) this.put(["c", ...this.disc, toneOf(this.fillStyle)]);
    else if (this.path.length >= 6) this.put(["p", toneOf(this.fillStyle), ...this.path]);
  }
  stroke() {}
  save() {}
  restore() {}
  drawImage() {}
}

export class Text {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
  set textContent(text) {
    this.data = String(text);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}

// Simple selectors are all the page's code ever asks for: ".class", "tag", "#id", those run together, or a few of
// them with commas between (any of them will do).
function matches(node, selector) {
  if (node.nodeType !== 1) return false;
  if (selector.includes(",")) return selector.split(",").some((one) => matches(node, one));
  const last = selector.trim().split(/\s+/).at(-1);
  const parts = last.match(/[#.]?[\w-]+/g) ?? [];
  return parts.every((part) => (part[0] === "." ? node.classList.contains(part.slice(1)) : part[0] === "#" ? node.id === part.slice(1) : node.tagName.toLowerCase() === part.toLowerCase()));
}

// A small picture written as markup (the desktop's icons are a few coloured rectangles; the network map's wires are
// lines): its shapes are kept, so Godot can draw them. Nothing else written as markup is read.
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((found) => [found[1], found[2]]));
function pictureFrom(html) {
  const node = new Element("svg");
  const head = attrsOf(html.match(/<svg([^>]*)>/)?.[1] ?? "");
  if (head.class) node.className = head.class;
  const view = (head.viewBox ?? "0 0 16 16").split(/\s+/).map(Number);
  node.shapes = { w: view[2], h: view[3], rects: [], lines: [] };
  for (const [, text] of html.matchAll(/<rect([^>]*)\/?>/g)) {
    const a = attrsOf(text);
    node.shapes.rects.push([Number(a.x ?? 0), Number(a.y ?? 0), Number(a.width ?? 0), Number(a.height ?? 0), a.fill ?? "#000"]);
  }
  for (const [, text] of html.matchAll(/<line([^>]*)\/?>/g)) {
    const a = attrsOf(text);
    node.shapes.lines.push([Number(a.x1 ?? 0), Number(a.y1 ?? 0), Number(a.x2 ?? 0), Number(a.y2 ?? 0), a.class ?? ""]);
  }
  for (const [, text] of html.matchAll(/<path([^>]*)\/?>/g)) {
    const a = attrsOf(text);
    const points = [...String(a.d ?? "").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((found) => [Number(found[1]), Number(found[2])]);
    for (let i = 1; i < points.length; i += 1) node.shapes.lines.push([...points[i - 1], ...points[i], a.class ?? ""]);
  }
  return node;
}

export class Element {
  static sizeOf = null;
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = newStyle();
    this.classList = new ClassList(this);
    this.dataset = {};
    this.id = "";
    this.scrollTop = 0;
  }
  setAttribute(name, value) {
    if (name === "style") this.style.cssText = value;
    else if (name === "id") this.id = String(value);
    else if (name === "class") this.className = String(value);
    else if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  // A list to pick from that hasn't been told its value has the one of its choices marked as picked, or its first.
  // A box for lines of words that hasn't been told its value has the words written inside it.
  get value() {
    if (this.picked !== undefined) return this.picked;
    if (this.tagName === "TEXTAREA") return this.textContent;
    if (this.tagName !== "SELECT") return undefined;
    const options = this.options;
    return (options.find((one) => one.selected) ?? options[0])?.value ?? "";
  }
  set value(value) {
    this.picked = value;
  }
  get options() {
    return this.querySelectorAll("option");
  }
  // A picture drawn by the page's code a shape at a time (the Map editor's plan of a deck): the shapes are kept, for
  // Godot to draw. Giving it its size wipes it, as on a real page.
  get width() {
    return this.wide ?? 0;
  }
  set width(value) {
    this.wide = Number(value);
    this.pen?.wipe();
  }
  get height() {
    return this.high ?? 0;
  }
  set height(value) {
    this.high = Number(value);
    this.pen?.wipe();
  }
  getContext() {
    return (this.pen ??= new Pen());
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, run) {
    (this.listeners[type] ??= []).push(run);
  }
  removeEventListener(type, run) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((one) => one !== run);
  }
  get children() {
    return this.childNodes.filter((one) => one.nodeType === 1);
  }
  // Whether it's on the page: some of the page's code draws only into what is.
  get isConnected() {
    let top = this;
    while (top.parentNode) top = top.parentNode;
    return top.tagName === "HTML";
  }
  get parentElement() {
    return this.parentNode;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  take(child) {
    const node = child instanceof Element || child instanceof Text ? child : new Text(child);
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    return node;
  }
  append(...children) {
    for (const child of children) if (child !== null && child !== undefined) this.childNodes.push(this.take(child));
  }
  appendChild(child) {
    this.append(child);
    return child;
  }
  prepend(...children) {
    this.childNodes.unshift(...children.map((child) => this.take(child)));
  }
  insertBefore(child, before) {
    const node = this.take(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return child;
  }
  removeChild(child) {
    this.childNodes = this.childNodes.filter((one) => one !== child);
    child.parentNode = null;
    return child;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  replaceChildren(...children) {
    for (const old of this.childNodes) old.parentNode = null;
    this.childNodes = [];
    this.append(...children);
  }
  replaceWith(...others) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.childNodes.indexOf(this);
    const nodes = others.map((one) => parent.take(one));
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1, ...nodes);
    this.parentNode = null;
    void at;
  }
  // Markup set on an element is kept as written; only a picture's is ever read back (content, below).
  set innerHTML(html) {
    this.html = String(html);
    this.replaceChildren();
  }
  get innerHTML() {
    return this.html ?? "";
  }
  get content() {
    const picture = pictureFrom(this.html ?? "");
    return { firstChild: picture, firstElementChild: picture };
  }
  get textContent() {
    return this.childNodes.map((one) => one.textContent).join("");
  }
  set textContent(text) {
    this.replaceChildren(String(text));
  }
  get innerText() {
    return this.textContent;
  }
  set innerText(text) {
    this.textContent = text;
  }
  matches(selector) {
    return matches(this, selector);
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && matches(node, selector)) return node;
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  // How big something is on screen is only known where whoever draws it has said how to work it out (Element.sizeOf).
  get offsetWidth() {
    return Element.sizeOf?.(this)?.w ?? 0;
  }
  get offsetHeight() {
    return Element.sizeOf?.(this)?.h ?? 0;
  }
  get offsetTop() {
    return 0;
  }
  get clientHeight() {
    return Element.sizeOf?.(this)?.h ?? 0;
  }
  select() {}
  focus() {}
  blur() {}
  // What only means something on a real screen is taken and does nothing.
  // Where the page's code has moved what's in it to: Godot is told, each time it's asked for.
  scrollTo(where) {
    if (where && typeof where === "object") this.movedTo = [Math.round(where.left ?? 0), Math.round(where.top ?? 0), (this.movedTo?.[2] ?? 0) + 1];
  }
  scrollBy() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  animate() {
    return { finished: Promise.resolve(), cancel() {} };
  }
  get scrollWidth() {
    return 0;
  }
  get scrollHeight() {
    return 0;
  }
  get clientWidth() {
    return Element.sizeOf?.(this)?.w ?? 0;
  }
  click() {
    return fire(this, "click");
  }
  scrollIntoView() {}
  dispatchEvent() {
    return true;
  }
}

// Runs an element's listeners for something Godot says was done to it, as the browser would for a click or a key in
// a box, and waits for whatever they started (an order sent to the game) to finish.
export async function fire(node, type, more = {}) {
  let stopped = false;
  const event = { type, target: node, currentTarget: node, preventDefault() {}, stopPropagation() { stopped = true; }, key: "", ...more };
  // The page's code hears a click on what was clicked and then on what it's inside, as in a browser.
  for (let at = node; at && !stopped; at = at.parentNode) {
    event.currentTarget = at;
    await Promise.all((at.listeners?.[type] ?? []).map((run) => run(event)));
  }
}

// The page itself: nothing is in it, since each menu's tree is asked for and handed straight to Godot.
export function makeDocument() {
  const all = { keydown: [] };
  const body = new Element("body");
  const head = new Element("head");
  const root = new Element("html");
  root.append(head, body);
  return {
    documentElement: root,
    head,
    body,
    activeElement: null,
    fullscreenElement: null,
    createElement: (tag) => new Element(tag),
    createElementNS: (space, tag) => new Element(tag),
    createTextNode: (text) => new Text(text),
    getElementById: (id) => root.querySelector(`#${id}`),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener: (type, run) => (all[type] ??= []).push(run),
    removeEventListener: () => {},
    // Something done to the pointer, for whatever the page's code set listening for it on the page itself. One
    // listener tripping (it's some other window's, and that window isn't there) doesn't stop the rest.
    async send(type, event) {
      const said = { type, clientX: 0, clientY: 0, pointerId: 1, button: 0, preventDefault() {}, stopPropagation() {}, ...event };
      for (const run of all[type] ?? []) {
        try {
          await run(said);
        } catch {
          // Not this listener's window.
        }
      }
    },
    // A key pressed in Godot, heard by whatever the page's code set listening on the page itself.
    async press(event) {
      let stopped = false;
      const said = { type: "keydown", target: body, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() { stopped = true; }, ...event };
      for (const run of all.keydown ?? []) {
        if (stopped) break;
        await run(said);
      }
    },
  };
}

// The points a drawn path goes through: it's moved to a point (M), goes straight to others (L), or curves to one (C).
function pathPoints(d) {
  const points = [];
  const tidy = (n) => Math.round(n * 10) / 10;
  let at = [0, 0];
  for (const [, letter, rest] of String(d).matchAll(/([MLC])([^MLCZz]*)/g)) {
    const n = (rest.match(/-?[\d.]+/g) ?? []).map(Number);
    if (letter !== "C") {
      for (let i = 0; i + 1 < n.length; i += 2) points.push((at = [n[i], n[i + 1]]));
      continue;
    }
    for (let i = 0; i + 5 < n.length; i += 6) {
      const [a, b, c, e] = [at, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]]];
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12, u = 1 - t;
        points.push([0, 1].map((k) => tidy(u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * e[k])));
      }
      at = e;
    }
  }
  return points;
}

// The tree as Godot is handed it. An element is { t: tag, c: classes, k: children } with, when it has them, id (the
// number Godot sends back when it's clicked or typed in), on (what it listens for), d (disabled), tip (its tooltip),
// st (its style, as written), v (its value), ph (what a box says while empty) and pressed. Words are plain strings.
export function describe(node, ids) {
  if (node.nodeType === 3) return node.data;
  const out = { t: node.tagName.toLowerCase() };
  if (node.className) out.c = node.className;
  const heard = Object.keys(node.listeners).filter((type) => node.listeners[type].length);
  // What the page hears clicks on from further up (a box on the Story board says it's a button and has no listener
  // of its own) can be clicked all the same.
  const button = node.attributes.role === "button" && !heard.includes("click");
  if (heard.length || button || out.t === "input" || out.t === "select" || out.t === "textarea") {
    out.id = ids.length;
    ids.push(node);
    if (heard.length || button) out.on = button ? [...heard, "click"] : heard;
  }
  if (node.attributes.label) out.label = node.attributes.label;
  if (node.attributes.rows) out.rows = Number(node.attributes.rows);
  if (node.disabled) out.d = 1;
  if (node.attributes.title) out.tip = node.attributes.title;
  const style = node.style.cssText;
  if (style) out.st = style;
  if (node.value !== undefined && node.value !== null) out.v = String(node.value);
  if (node.attributes.placeholder) out.ph = node.attributes.placeholder;
  if (node.attributes.type) out.type = node.attributes.type;
  if (node.attributes["aria-pressed"] === "true" || node.attributes["aria-selected"] === "true" || node.checked) out.pressed = 1;
  if (node.hidden) out.hidden = 1;
  if (node.shapes) out.svg = node.shapes;
  if (node.selected) out.sel = 1;
  if (node.movedTo) out.sc = node.movedTo;
  if (node.pen) out.cv = node.pen.shapes;
  // A picture drawn a line at a time (the Story board's arrows): each path as the points it goes through, a curve as
  // a dozen short lines, with its classes first, which is all Godot draws of it.
  if (out.t === "svg" && !node.shapes) {
    const lines = [], paths = [];
    const gather = (one) => {
      for (const child of one.childNodes) {
        if (child.nodeType !== 1) continue;
        const points = pathPoints(child.attributes.d ?? "");
        if (points.length > 1) paths.push([child.attributes.class ?? child.className ?? "", ...points.flat()]);
        if (child.attributes.x1 !== undefined) lines.push([Number(child.attributes.x1), Number(child.attributes.y1), Number(child.attributes.x2), Number(child.attributes.y2), child.attributes.class ?? ""]);
        gather(child);
      }
    };
    gather(node);
    if (lines.length || paths.length) out.svg = { w: 0, h: 0, rects: [], lines, paths };
    return out;
  }
  const kids = node.childNodes.map((child) => describe(child, ids)).filter((one) => one !== "");
  if (kids.length) out.k = kids;
  return out;
}
