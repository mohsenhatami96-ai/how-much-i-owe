/* Hash routing and back-stack helpers for How Much I Owe. */

export function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/p\/([^/?]+)(?:\/e\/([^/?]+))?/);
  if (!m) return { name: 'home' };
  return m[2]
    ? { name: 'entry', pid: decodeURIComponent(m[1]), eid: decodeURIComponent(m[2]) }
    : { name: 'person', id: decodeURIComponent(m[1]) };
}

export const personHash = (pid) => '#/p/' + encodeURIComponent(pid);
export const entryHash = (pid, eid) => personHash(pid) + '/e/' + encodeURIComponent(eid);

/* In-app navigation stack, so "Back" uses history.back() when it would land on the parent page. */
const navStack = [location.hash || '#/'];

export function onHashNav() {
  const h = location.hash || '#/';
  if (navStack.length >= 2 && navStack[navStack.length - 2] === h) navStack.pop();
  else navStack.push(h);
}

export function goBack(parent) {
  if (navStack.length >= 2 && navStack[navStack.length - 2] === parent) history.back();
  else location.hash = parent;
}
