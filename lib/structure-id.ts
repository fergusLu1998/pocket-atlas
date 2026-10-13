import type { Structure } from './structures';
const identities = new WeakMap<Structure, string>();
export function structureIdentity(s: Structure) {
  if (s.nativeId) return s.nativeId;
  let id = identities.get(s);
  if (!id) {
    const text = JSON.stringify([s.title, s.atoms]);
    let a = 2166136261,
      b = 2246822507;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 3266489909);
    }
    id = `browser:${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
    identities.set(s, id);
  }
  return id;
}
