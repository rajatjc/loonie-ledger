import type { Transfer } from "./api";

/** The newest version of every transfer seen on the live stream, by id. */
export type Live = Record<string, Transfer>;

/** Overlays live updates on a fetched list, adds new matching transfers, newest first. */
export function merge(list: Transfer[], live: Live, include: (t: Transfer) => boolean): Transfer[] {
  const byId = new Map(list.map((t) => [t.id, t]));
  for (const t of Object.values(live)) {
    const known = byId.get(t.id);
    if (known ? Date.parse(t.updatedAt) >= Date.parse(known.updatedAt) : include(t)) byId.set(t.id, t);
  }
  return [...byId.values()].filter(include).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
