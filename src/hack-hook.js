// Who opens a computer's logon when a check asks for hacking (step 3 of the hacking rework: hacking has no check
// window). src/computers.js says who, and src/checks.js asks; this file reads nothing, so neither waits on the other
// to load.
let handler = null;

export function setHackHandler(fn) {
  handler = fn;
}

export const hackHandler = () => handler;
