// The Godot view's menus, as the game's side sees them: a thread of its own builds each menu with the page's own code
// (src/godot-pages-worker.js) and this hands it what Godot asks and gives Godot back what it answers. The thread is
// started the first time a menu is asked for, so a game Godot never opens a menu in never has one.

import { Worker } from "node:worker_threads";

let worker = null;
let asked = 0;
const waiting = new Map();
const LONGEST = 30000;

function fail(why) {
  for (const { reject, timer } of waiting.values()) {
    clearTimeout(timer);
    reject(new Error(why));
  }
  waiting.clear();
  worker = null;
}

function start(port) {
  const thread = new Worker(new URL("./godot-pages-worker.js", import.meta.url), { workerData: { port } });
  thread.unref();
  thread.on("message", ({ n, reply }) => {
    const one = waiting.get(n);
    if (!one) return;
    waiting.delete(n);
    clearTimeout(one.timer);
    if (reply?.error) one.reject(new Error(reply.error));
    else one.resolve(reply);
  });
  thread.on("error", (err) => fail(`The menus couldn't be made: ${err.message}`));
  thread.on("exit", () => { if (worker === thread) fail("The menus stopped."); });
  return thread;
}

// ask is { op: "open", menu } | { op: "look" } | { op: "click", id, of } | { op: "input", id, of, value } | { op: "rail" }.
export function askPages(port, ask) {
  worker ??= start(port);
  return new Promise((resolve, reject) => {
    asked += 1;
    const n = asked;
    const timer = setTimeout(() => {
      waiting.delete(n);
      reject(new Error("The menu took too long to answer."));
    }, LONGEST);
    waiting.set(n, { resolve, reject, timer });
    worker.postMessage({ n, ask });
  });
}
