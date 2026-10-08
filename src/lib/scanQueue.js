// Lets the phone's bottom "Scan" button hand photos to the Receipts screen.
let pending = null;
const listeners = new Set();
export function queueFiles(files) {
  pending = files;
  listeners.forEach((fn) => fn());
}
export function takeFiles() {
  const f = pending;
  pending = null;
  return f;
}
export function onFiles(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
