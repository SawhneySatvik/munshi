// The offline store (the platform design §2): the last Home brief and stock list a member opened, kept in IndexedDB as
// the very data the page rendered from (its stored snapshots and the refs into them), with the time the server rendered
// the page. The offline view renders them read-only; nothing is written offline.
// - One session at a time. The session tag (lib/offline/tag.ts) is bound to one tenant and member by the first view
//   kept under it (the "session" record). A view is kept only if the tag the server read with the page is the tag on
//   this device now (so a page restored from history after another sign-in is never kept under the new session), and
//   only for the member the tag is bound to; it is shown only under the same tag, tenant and member.
// - Pruned on every page load and every read: no tag on this device, or another tag, deletes the store; a view opened
//   more than a day ago, or of another format, is deleted (and the offline view says that view was too old).
// - Sign-out deletes the database and every cache (wipeDevice).
// Every call is best effort: a browser without IndexedDB (or a private window refusing it) keeps nothing.
import type { StockPage } from "../ops-types";
import type { OwnerHome } from "../types";
import { tagIn } from "./tag";

export const OFFLINE_DB = "munshi-offline";
const VIEWS = "views";
const SESSION = "session";
/** The shape of a kept view; a view kept under another format is deleted (an older build's data). */
export const FORMAT = 2;
/** How long after its page was opened a kept view may be shown. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type Kind = "home" | "stock";
export type Kept = { kind: "home"; data: OwnerHome } | { kind: "stock"; data: StockPage };
export type Owner = { tenant: string; member: string; tag: string };
/** openedAt: when the server rendered the page the view was kept from. */
export type KeptView = Kept & Owner & { key: string; format: number; openedAt: string };
/** The tag's binding: the tenant and member whose views it may hold. */
export type Binding = Owner & { id: "current" };

export function keptView(kept: Kept, owner: Owner, openedAt: string): KeptView | null {
  if (!owner.tenant || !owner.member || !owner.tag || Number.isNaN(Date.parse(openedAt))) return null;
  return { ...kept, ...owner, key: `${owner.tenant}:${owner.member}:${kept.kind}`, format: FORMAT, openedAt } as KeptView;
}

export type Judged = { show: KeptView[]; drop: string[]; stale: Kind[]; wipe: boolean };

/** What the store may keep and show under this device's `tag` at `now`, given the tag's binding. */
export function judge(views: KeptView[], binding: Binding | undefined, tag: string, now: number): Judged {
  if (!tag || (binding && binding.tag !== tag)) return { show: [], drop: [], stale: [], wipe: views.length > 0 || binding !== undefined };
  const show: KeptView[] = [];
  const drop: string[] = [];
  const stale: Kind[] = [];
  for (const v of views) {
    const bound = binding !== undefined && v.tag === tag && v.tenant === binding.tenant && v.member === binding.member;
    if (v.format !== FORMAT || !bound) drop.push(v.key);
    else if (!(now - Date.parse(v.openedAt) < MAX_AGE_MS)) {
      drop.push(v.key);
      stale.push(v.kind);
    } else show.push(v);
  }
  return { show, drop, stale, wipe: false };
}

export const currentTag = () => (typeof document === "undefined" ? "" : tagIn(document.cookie));

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });

function open(): Promise<IDBDatabase> {
  const req = indexedDB.open(OFFLINE_DB, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(VIEWS, { keyPath: "key" });
    req.result.createObjectStore(SESSION, { keyPath: "id" });
  };
  return done(req);
}

async function withStores<T>(run: (views: IDBObjectStore, session: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    const tx = db.transaction([VIEWS, SESSION], "readwrite");
    const complete = new Promise<void>((ok, no) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => no(tx.error);
      tx.onabort = () => no(tx.error);
    });
    const out = await run(tx.objectStore(VIEWS), tx.objectStore(SESSION));
    await complete;
    return out;
  } finally {
    db.close();
  }
}

function deleteStore(): Promise<void> {
  return new Promise<void>((ok) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB);
    req.onsuccess = req.onerror = req.onblocked = () => ok();
  });
}

/**
 * Keeps a view, if the tag the server read with its page is this device's tag now. The first view under a tag binds it
 * to its tenant and member (and drops anything kept before); a view of anyone else under that tag empties the store.
 * Returns whether the view was kept.
 */
export async function keep(view: KeptView, tagNow = currentTag()): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !tagNow || view.tag !== tagNow) return false;
  try {
    return await withStores(async (views, session) => {
      const binding = (await done(session.get("current"))) as Binding | undefined;
      if (!binding || binding.tag !== view.tag) {
        views.clear();
        session.put({ id: "current", tag: view.tag, tenant: view.tenant, member: view.member } satisfies Binding);
      } else if (binding.tenant !== view.tenant || binding.member !== view.member) {
        views.clear();
        session.clear();
        return false;
      }
      views.put(view);
      return true;
    });
  } catch {
    return false;
  }
}

/** Prunes the store under this device's tag (see judge) and returns what may be shown, and which views were too old. */
export async function prune(tag = currentTag(), now = Date.now()): Promise<{ views: KeptView[]; stale: Kind[]; removed: boolean }> {
  if (typeof indexedDB === "undefined") return { views: [], stale: [], removed: false };
  try {
    const j = await withStores(async (views, session) => {
      const judged = judge((await done(views.getAll())) as KeptView[], (await done(session.get("current"))) as Binding | undefined, tag, now);
      for (const k of judged.drop) views.delete(k);
      return judged;
    });
    if (j.wipe) await deleteStore();
    return { views: j.show, stale: j.stale, removed: j.wipe || j.drop.length > 0 };
  } catch {
    return { views: [], stale: [], removed: false };
  }
}

export const readKept = prune;

/** On every page load: prunes the store (another session or none wipes it; old views go). */
export async function reconcile(tag = currentTag(), now = Date.now()): Promise<boolean> {
  return (await prune(tag, now)).removed;
}

/** Deletes the offline store (a signed-out page: the session may have been revoked elsewhere). */
export async function forget(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await deleteStore();
  } catch {}
}

/** Sign-out: the offline store and every cache on this device go, from the page and from the service worker. */
export async function wipeDevice(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  try {
    if (typeof indexedDB !== "undefined") jobs.push(deleteStore());
  } catch {}
  try {
    if (typeof caches !== "undefined") jobs.push(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  } catch {}
  await Promise.allSettled(jobs);
  try {
    navigator.serviceWorker?.controller?.postMessage("clear");
  } catch {}
}
