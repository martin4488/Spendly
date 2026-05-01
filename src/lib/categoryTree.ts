import { Category } from '@/types';

export interface CatNode extends Category {
  children: CatNode[];
}

export interface FlatEntry {
  cat: CatNode;
  ancestors: CatNode[];
}

export function buildTree(flat: Category[]): CatNode[] {
  const map = new Map<string, CatNode>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CatNode[] = [];
  flat.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id)!.children.push(map.get(c.id)!);
    else if (!c.parent_id) roots.push(map.get(c.id)!);
  });
  return roots;
}

export function flattenTree(nodes: CatNode[], ancestors: CatNode[] = []): FlatEntry[] {
  const out: FlatEntry[] = [];
  // Iterative-ish: avoid creating spread arrays + intermediate flatMaps for hot paths
  function walk(ns: CatNode[], anc: CatNode[]) {
    for (const n of ns) {
      out.push({ cat: n, ancestors: anc });
      if (n.children.length) walk(n.children, anc.concat(n));
    }
  }
  walk(nodes, ancestors);
  return out;
}

export function allDescendantIds(node: CatNode): string[] {
  const ids: string[] = [];
  function walk(n: CatNode) {
    ids.push(n.id);
    for (const c of n.children) walk(c);
  }
  walk(node);
  return ids;
}

/** Build a Map<id, Category> from a flat list — O(1) lookups everywhere. */
export function indexById<T extends { id: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of list) m.set(item.id, item);
  return m;
}
