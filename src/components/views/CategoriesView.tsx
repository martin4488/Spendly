'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { Category } from '@/types';
import { Plus, Trash2, X, FolderPlus, GripVertical } from 'lucide-react';

// ── Tree node (up to 3 levels) ────────────────────────────────────────────────
interface CatNode extends Category {
  children: CatNode[];
}

function buildTree(flat: Category[]): CatNode[] {
  const map = new Map<string, CatNode>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CatNode[] = [];
  flat.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(map.get(c.id)!);
    } else if (!c.parent_id) {
      roots.push(map.get(c.id)!);
    }
  });
  return roots;
}

// ── Swipeable row ─────────────────────────────────────────────────────────────
function SwipeableCatRow({
  children, onEdit, onDelete, dragHandleProps,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const DELETE_THRESHOLD = 72;
  const SNAP_THRESHOLD = 36;

  function onTouchStart(e: React.TouchEvent) { startXRef.current = e.touches[0].clientX; setIsDragging(false); }
  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX;
    if (dx > 5) setIsDragging(true);
    if (dx > 0) setOffset(Math.min(dx, DELETE_THRESHOLD));
    else if (dx < 0 && offset > 0) setOffset(Math.max(0, offset + dx));
  }
  function onTouchEnd() { setOffset(offset > SNAP_THRESHOLD ? DELETE_THRESHOLD : 0); startXRef.current = null; }
  function handleClick() {
    if (isDragging) return;
    if (offset > 0) { setOffset(0); return; }
    onEdit();
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500" style={{ width: DELETE_THRESHOLD }}>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex flex-col items-center justify-center w-full h-full gap-1 active:bg-red-600 transition-colors">
          <Trash2 size={16} className="text-white" />
          <span className="text-[10px] text-white font-medium">Borrar</span>
        </button>
      </div>
      <div className="relative bg-dark-800 select-none"
        style={{ transform: `translateX(-${offset}px)`, transition: isDragging ? 'none' : 'transform 0.2s ease' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onClick={handleClick}>
        <div className="flex items-center">
          <div {...dragHandleProps} className="pl-3 pr-1 py-3 text-dark-600 touch-none flex-shrink-0 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()}>
            <GripVertical size={18} />
          </div>
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── Drag state ────────────────────────────────────────────────────────────────
interface DragState {
  type: 'root';
  index: number;
  startY: number;
  currentY: number;
  itemHeight: number;
}

// ── Derive child color: same hue, higher lightness, slightly lower saturation ─
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360, sNorm = s / 100, lNorm = l / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (sNorm === 0) { r = g = b = lNorm; }
  else {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    r = hue2rgb(p, q, hNorm + 1/3);
    g = hue2rgb(p, q, hNorm);
    b = hue2rgb(p, q, hNorm - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function deriveChildColor(parentHex: string, siblingCount: number): string {
  const [h, s, l] = hexToHsl(parentHex);
  // Each sibling: +12% lightness, -5% saturation, capped
  const newL = Math.min(85, l + 12 + siblingCount * 8);
  const newS = Math.max(20, s - 5 - siblingCount * 3);
  return hslToHex(h, newS, newL);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CategoriesView({ user }: { user: User }) {
  const [flatCats, setFlatCats] = useState<Category[]>([]);
  const [roots, setRoots] = useState<CatNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [spending, setSpending] = useState<Record<string, number>>({});

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📦');
  const [color, setColor] = useState('#22c55e');
  const [saving, setSaving] = useState(false);

  // Drag (root level only)
  const dragRef = useRef<DragState | null>(null);
  const [dragActive, setDragActive] = useState<DragState | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const monthRange = getMonthRange();
    const [{ data: cats }, { data: expenses }] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', user.id).eq('deleted', false).order('position').order('created_at'),
      supabase.from('expenses').select('amount, category_id').eq('user_id', user.id).gte('date', monthRange.start).lte('date', monthRange.end),
    ]);
    const spendMap: Record<string, number> = {};
    expenses?.forEach(e => { if (e.category_id) spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount); });
    setSpending(spendMap);
    const flat = cats || [];
    setFlatCats(flat);
    setRoots(buildTree(flat));
    setLoading(false);
  }

  // ── Persist order ─────────────────────────────────────────────────────────
  function scheduleSaveOrder(newRoots: CatNode[]) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const updates: { id: string; position: number }[] = [];
      function walk(nodes: CatNode[]) { nodes.forEach((n, i) => { updates.push({ id: n.id, position: i }); walk(n.children); }); }
      walk(newRoots);
      Promise.all(updates.map(u => supabase.from('categories').update({ position: u.position }).eq('id', u.id)));
    }, 600);
  }

  // ── Root drag ─────────────────────────────────────────────────────────────
  function onRootDragStart(e: React.TouchEvent, index: number) {
    const h = (e.currentTarget as HTMLElement).closest('[data-root]')?.getBoundingClientRect().height || 60;
    const state: DragState = { type: 'root', index, startY: e.touches[0].clientY, currentY: e.touches[0].clientY, itemHeight: h };
    dragRef.current = state;
    setDragActive({ ...state });
    e.stopPropagation();
  }

  function onRootDragMove(e: TouchEvent) {
    if (!dragRef.current) return;
    const dy = e.touches[0].clientY - dragRef.current.startY;
    const moved = Math.round(dy / dragRef.current.itemHeight);
    if (moved === 0) return;
    const from = dragRef.current.index;
    const to = Math.max(0, Math.min(roots.length - 1, from + moved));
    if (to === from) return;
    setRoots(prev => { const next = [...prev]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
    dragRef.current.index = to;
    dragRef.current.startY = e.touches[0].clientY;
  }

  function onRootDragEnd() {
    dragRef.current = null;
    setDragActive(null);
    setRoots(prev => { scheduleSaveOrder(prev); return prev; });
  }

  useEffect(() => {
    function onMove(e: TouchEvent) { if (!dragRef.current) return; e.preventDefault(); onRootDragMove(e); }
    function onEnd() { if (!dragRef.current) return; onRootDragEnd(); }
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
  }, [roots]);

  // ── Form ──────────────────────────────────────────────────────────────────
  function openForm(category?: Category, asChildOf?: string) {
    if (category) {
      setEditingId(category.id); setName(category.name); setIcon(category.icon); setColor(category.color); setParentId(category.parent_id ?? null);
    } else {
      setEditingId(null); setName(''); setParentId(asChildOf || null);
      if (asChildOf) {
        // Inherit parent icon, derive color
        const parent = flatCats.find(c => c.id === asChildOf);
        setIcon(parent?.icon || '📦');
        const siblingCount = flatCats.filter(c => c.parent_id === asChildOf).length;
        setColor(parent ? deriveChildColor(parent.color, siblingCount) : CATEGORY_COLORS[0]);
      } else {
        setIcon('📦');
        setColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
      }
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!name) return;
    setSaving(true);
    const data = { user_id: user.id, name, icon, color, parent_id: parentId };
    try {
      if (editingId) {
        await supabase.from('categories').update(data).eq('id', editingId);
      } else {
        await supabase.from('categories').insert({ ...data, position: 999 });
      }
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar esta categoría? Los gastos asociados se conservan.')) {
      await supabase.from('categories').update({ deleted: true }).eq('id', id);
      loadData();
    }
  }

  // ── Recursive spending sum ────────────────────────────────────────────────
  function totalSpend(node: CatNode): number {
    return (spending[node.id] || 0) + node.children.reduce((s, c) => s + totalSpend(c), 0);
  }

  // ── Recursive render of children (level 1+ = indented) ───────────────────
  function renderChildren(nodes: CatNode[], depth: number) {
    if (nodes.length === 0) return null;
    return (
      <div className="bg-dark-800">
        {nodes.map((node, idx) => {
          const spent = totalSpend(node);
          const isLast = idx === nodes.length - 1;
          const indent = depth * 14 + 20;
          return (
            <div key={node.id}>
              <SwipeableCatRow onEdit={() => openForm(node)} onDelete={() => handleDelete(node.id)}>
                <div className={`flex items-center gap-2.5 pr-3.5 py-2.5 ${!isLast || node.children.length > 0 ? 'border-b border-dark-700/20' : ''}`}
                  style={{ paddingLeft: `${indent}px` }}>
                  <div className="text-dark-500 text-xs">└</div>
                  <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: node.color }}>
                    {node.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-dark-200">{node.name}</p>
                    <p className="text-xs text-dark-400">{formatCurrency(spent)}</p>
                  </div>
                  {/* Add sub-sub only up to depth 1 (so max 3 levels total) */}
                  {depth < 2 && (
                    <button onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); openForm(undefined, node.id); }}
                      className="p-2 text-dark-400 hover:text-dark-200 flex-shrink-0">
                      <FolderPlus size={13} />
                    </button>
                  )}
                </div>
              </SwipeableCatRow>
              {node.children.length > 0 && renderChildren(node.children, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Categorías</h1>
        <button onClick={() => openForm()}
          className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20">
          <Plus size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : roots.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">📂</div>
          <p className="text-dark-300 font-medium">No tenés categorías</p>
          <p className="text-dark-500 text-sm mt-1">Crealas para organizar tus gastos</p>
          <button onClick={() => openForm()} className="mt-4 bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
            Crear primera categoría
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {roots.map((cat, gi) => {
            const spent = totalSpend(cat);
            const isBeingDragged = dragActive?.index === gi;
            return (
              <div key={cat.id} data-root={gi}
                className={`rounded-xl overflow-hidden transition-all duration-150 ${isBeingDragged ? 'opacity-70 scale-[1.02] shadow-2xl shadow-black/40 z-10 relative' : ''}`}>
                <SwipeableCatRow onEdit={() => openForm(cat)} onDelete={() => handleDelete(cat.id)}
                  dragHandleProps={{ onTouchStart: (e) => onRootDragStart(e, gi) }}>
                  <div className="p-3.5 pr-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: cat.color }}>
                        {cat.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{cat.name}</p>
                        <p className="text-xs text-dark-400">{formatCurrency(spent)} este mes</p>
                      </div>
                      <button onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); openForm(undefined, cat.id); }}
                        className="p-2 text-dark-400 hover:text-dark-200 flex-shrink-0">
                        <FolderPlus size={15} />
                      </button>
                    </div>
                  </div>
                </SwipeableCatRow>
                {cat.children.length > 0 && renderChildren(cat.children, 1)}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white"><X size={24} /></button>
            <h2 className="text-base font-bold">
              {editingId ? 'Editar categoría' : parentId ? 'Nueva subcategoría' : 'Crear categoría'}
            </h2>
            <div className="w-8" />
          </div>

          {/* Parent breadcrumb */}
          {parentId && !editingId && (() => {
            const parent = flatCats.find(c => c.id === parentId);
            const grandparent = parent?.parent_id ? flatCats.find(c => c.id === parent.parent_id) : null;
            return (
              <div className="px-5 pb-2 flex items-center gap-1.5 text-xs text-dark-400">
                {grandparent && <><span>{grandparent.icon} {grandparent.name}</span><span>›</span></>}
                {parent && <span>{parent.icon} {parent.name}</span>}
                <span>›</span><span className="text-dark-300">nueva</span>
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto px-5 pb-28">
            <div className="flex items-center gap-4 py-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0 transition-colors" style={{ backgroundColor: color }}>
                {icon}
              </div>
              <input
                type="text" placeholder="Nombre de categoría" value={name}
                onChange={(e) => setName(e.target.value)} autoFocus={showForm}
                className="flex-1 text-lg font-semibold bg-transparent focus:outline-none border-b border-dark-700 pb-2 placeholder:text-dark-500 min-h-[28px]"
              />
            </div>

            <div className="mb-5">
              {parentId ? (
                // Child: show color preview only, not editable
                <div className="flex items-center gap-3 py-2">
                  <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-dark-500">Color heredado del grupo</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Color</p>
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5" style={{ scrollbarWidth: 'none' }}>
                    {CATEGORY_COLORS.map((c) => (
                      <button key={c} onClick={() => setColor(c)}
                        className={`w-8 h-8 rounded-full flex-shrink-0 transition-all ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-900 scale-110' : ''}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div>
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Ícono</p>
              <div className="grid grid-cols-6 gap-2">
                {CATEGORY_ICONS.map((ic) => (
                  <button key={ic} onClick={() => setIcon(ic)}
                    className={`aspect-square rounded-xl flex items-center justify-center text-xl transition-all ${icon === ic ? 'bg-dark-600 ring-2 ring-brand-500' : 'bg-dark-800 hover:bg-dark-700'}`}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 bg-dark-900 border-t border-dark-800">
            <button onClick={handleSave} disabled={saving || !name}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30"
              style={{ backgroundColor: color, color: 'white' }}>
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
