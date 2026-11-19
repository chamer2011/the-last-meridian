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

// One simple selector at a time is all the page's menus ever ask for: ".class", "tag", "#id", or those run together.
function matches(node, selector) {
  if (node.nodeType !== 1) return false;
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
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = new Style();
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
  get offsetWidth() {
    return 0;
  }
  get offsetHeight() {
    return 0;
  }
  get offsetTop() {
    return 0;
  }
  get clientHeight() {
    return 0;
  }
  focus() {}
  blur() {}
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
  };
}

// The tree as Godot is handed it. An element is { t: tag, c: classes, k: children } with, when it has them, id (the
// number Godot sends back when it's clicked or typed in), on (what it listens for), d (disabled), tip (its tooltip),
// st (its style, as written), v (its value), ph (what a box says while empty) and pressed. Words are plain strings.
export function describe(node, ids) {
  if (node.nodeType === 3) return node.data;
  const out = { t: node.tagName.toLowerCase() };
  if (node.className) out.c = node.className;
  const heard = Object.keys(node.listeners).filter((type) => node.listeners[type].length);
  if (heard.length || out.t === "input" || out.t === "select" || out.t === "textarea") {
    out.id = ids.length;
    ids.push(node);
    if (heard.length) out.on = heard;
  }
  if (node.disabled) out.d = 1;
  if (node.attributes.title) out.tip = node.attributes.title;
  const style = node.style.cssText;
  if (style) out.st = style;
  if (node.value !== undefined && node.value !== null) out.v = String(node.value);
  if (node.attributes.placeholder) out.ph = node.attributes.placeholder;
  if (node.attributes.type) out.type = node.attributes.type;
  if (node.attributes["aria-pressed"] === "true" || node.checked) out.pressed = 1;
  if (node.hidden) out.hidden = 1;
  if (node.shapes) out.svg = node.shapes;
  const kids = node.childNodes.map((child) => describe(child, ids)).filter((one) => one !== "");
  if (kids.length) out.k = kids;
  return out;
}
