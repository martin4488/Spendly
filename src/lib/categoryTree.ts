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
  return nodes.flatMap(n => [{ cat: n, ancestors }, ...flattenTree(n.children, [...ancestors, n])]);
}

export function allDescendantIds(node: CatNode): string[] {
  return [node.id, ...node.children.flatMap(allDescendantIds)];
}
