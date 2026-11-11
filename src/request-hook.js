// How a written scene, a conversation or a computer's program starts a request, or turns a kind of request off or on
// again: * request medicine, * request medicine off, * request medicine on. src/requests.js says how, since what plays
// the scenes can't import it (it reads the scenes itself). It imports nothing.

let handler = () => [];

// src/requests.js tells it what to do.
export const tellStoryRequests = (fn) => {
  handler = fn;
};

// A line of the written story: { request: kind, turn: "on" | "off" | null, reason }. Gives what the player should hear.
export const storyRequest = (game, step) => handler(game, step) ?? [];

// What ? request <kind> can ask about how a request stands: someone has it to ask, it's taken on (or handed on), how it
// last ended, it's been turned off, or nothing's ever come of it.
export const REQUEST_STATES = ["asked", "taken", "done", "failed", "refused", "gone", "off", "none"];
