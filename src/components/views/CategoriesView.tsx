'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getMonthRange, CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { Category } from '@/types';
import { Plus, X, FolderPlus, GripVertical, ArrowLeft } from 'lucide-react';
import SwipeableRow from '@/components/SwipeableRow';
import CategoryIcon from '@/components/ui/CategoryIcon';
import { getIconComponent } from '@/lib/iconMap';

import { CatNode, buildTree } from '@/lib/categoryTree';
import { invalidateCategories } from '@/lib/categoryCache';
import { deriveChildColor } from '@/lib/colorUtils';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm';
import OfflineState from '@/components/ui/OfflineState';

interface DragState {
  type: 'root';
  index: number;
  startY: number;
  currentY: number;
  itemHeight: number;
}

export default function CategoriesView({ user, onBack }: { user: User; onBack?: () => void }) {
  const [flatCats, setFlatCats] = useState<Category[]>([]);
  const [roots, setRoots] = useState<CatNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [spending, setSpending] = useState<Record<string, number>>({});

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('package');
  const [color, setColor] = useState('#22c55e');
  const [saving, setSaving] = useState(false);

  // Drag (root level only)
  const dragRef = useRef<DragState | null>(null);
  const [dragActive, setDragActive] = useState<DragState | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true); setLoading(false); return;
    }
    setOffline(false);
    setLoading(true);
    const monthRange = getMonthRange();
    const [{ data: cats, error }, { data: expenses }] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', user.id).neq('deleted', true).neq('hidden', true).order('position').order('created_at'),
      supabase.from('expenses').select('amount, category_id').eq('user_id', user.id).gte('date', monthRange.start).lte('date', monthRange.end),
    ]);
    if (error) { setOffline(true); setLoading(false); return; }
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
      Promise.all(updates.map(u => supabase.from('categories').update({ position: u.position }).eq('id', u.id)))
        .then(() => invalidateCategories());
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
    // touchmove must be non-passive because we call preventDefault to suppress page scroll while dragging
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [roots]);

  // ── Form ──────────────────────────────────────────────────────────────────
  function openForm(category?: Category, asChildOf?: string) {
    if (category) {
      setEditingId(category.id); setName(category.name); setIcon(category.icon); setColor(category.color); setParentId(category.parent_id ?? null);
    } else {
      setEditingId(null); setName(''); setParentId(asChildOf || null);
      if (asChildOf) {
        const parent = flatCats.find(c => c.id === asChildOf);
        setIcon(parent?.icon || 'package');
        const siblingCount = flatCats.filter(c => c.parent_id === asChildOf).length;
        setColor(parent ? deriveChildColor(parent.color, siblingCount) : CATEGORY_COLORS[0]);
      } else {
        setIcon('package');
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
        const prevCat = flatCats.find(c => c.id === editingId);
        const colorChanged = prevCat && prevCat.color !== color;
        const iconChanged = prevCat && prevCat.icon !== icon;

        await supabase.from('categories').update(data).eq('id', editingId);

        if (colorChanged) await cascadeColors(editingId, color, flatCats);
        if (iconChanged) await cascadeIcons(editingId, icon, flatCats);
      } else {
        await supabase.from('categories').insert({ ...data, position: 999 });
      }
      invalidateCategories();
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  // ── Cascade with batched updates ──
  // Old version did a network call PER descendant; this batches per-color into a single UPDATE.
  async function cascadeColors(parentIdLocal: string, parentColor: string, allCats: Category[]) {
    // Group descendants by the new color they should receive
    const updates: { id: string; color: string }[] = [];
    function walk(pid: string, color: string) {
      const children = allCats.filter(c => c.parent_id === pid);
      children.forEach((child, idx) => {
        const newColor = deriveChildColor(color, idx);
        updates.push({ id: child.id, color: newColor });
        walk(child.id, newColor);
      });
    }
    walk(parentIdLocal, parentColor);
    if (updates.length === 0) return;

    // Group by color so we can send one UPDATE per distinct color (typically 1–3 round trips total
    // instead of one per descendant)
    const byColor = new Map<string, string[]>();
    for (const u of updates) {
      let arr = byColor.get(u.color);
      if (!arr) { arr = []; byColor.set(u.color, arr); }
      arr.push(u.id);
    }
    await Promise.all(
      Array.from(byColor.entries()).map(([col, ids]) =>
        supabase.from('categories').update({ color: col }).in('id', ids)
      )
    );
  }

  async function cascadeIcons(parentIdLocal: string, icon: string, allCats: Category[]) {
    const ids: string[] = [];
    function walk(pid: string) {
      const children = allCats.filter(c => c.parent_id === pid);
      for (const c of children) { ids.push(c.id); walk(c.id); }
    }
    walk(parentIdLocal);
    if (ids.length === 0) return;
    // Single UPDATE for all descendants → 1 round trip instead of N
    await supabase.from('categories').update({ icon }).in('id', ids);
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog('¿Eliminar esta categoría? Los gastos asociados se conservan.'))) return;
    const { error } = await supabase.from('categories').update({ deleted: true }).eq('id', id);
    if (error) { toast('No se pudo eliminar la categoría. Reintentá.'); return; }
    invalidateCategories();
    loadData();
  }

  function totalSpend(node: CatNode): number {
    return (spending[node.id] || 0) + node.children.reduce((s, c) => s + totalSpend(c), 0);
  }

  function renderChildren(nodes: CatNode[], depth: number) {
    if (nodes.length === 0) return null;
    return (
      <div className="bg-dark-800">
        {nodes.map((node, idx) => {
          const isLast = idx === nodes.length - 1;
          const indent = depth * 14 + 20;
          return (
            <div key={node.id}>
              <SwipeableRow onTap={() => openForm(node)} onDelete={() => handleDelete(node.id)}>
                <div className="relative bg-dark-800 select-none">
                  <div className="flex items-center">
                    <div className="pl-3 pr-1 py-3 text-dark-600 touch-none flex-shrink-0 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()}>
                      <GripVertical size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`flex items-center gap-2.5 pr-3.5 py-2.5 ${!isLast || node.children.length > 0 ? 'border-b border-dark-700/20' : ''}`}
                        style={{ paddingLeft: `${indent}px` }}>
                        <div className="text-dark-500 text-xs">└</div>
                        <CategoryIcon icon={node.icon} color={node.color} size={28} rounded="md" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-dark-200">{node.name}</p>
                        </div>
                        {depth < 2 && (
                          <button onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); openForm(undefined, node.id); }}
                            className="p-2 text-dark-400 hover:text-dark-200 flex-shrink-0">
                            <FolderPlus size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </SwipeableRow>
              {node.children.length > 0 && renderChildren(node.children, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  if (offline) return <OfflineState onRetry={loadData} onBack={onBack} />;

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-1 text-dark-300 -ml-1"><ArrowLeft size={20} /></button>
          )}
          <h1 className="text-xl font-bold">Categorías</h1>
        </div>
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
            const isBeingDragged = dragActive?.index === gi;
            return (
              <div key={cat.id} data-root={gi}
                className={`rounded-xl overflow-hidden transition-all duration-150 ${isBeingDragged ? 'opacity-70 scale-[1.02] shadow-2xl shadow-black/40 z-10 relative' : ''}`}>
                <SwipeableRow onTap={() => openForm(cat)} onDelete={() => handleDelete(cat.id)}>
                  <div className="relative bg-dark-800 select-none">
                    <div className="flex items-center">
                      <div onTouchStart={(e) => onRootDragStart(e, gi)} className="pl-3 pr-1 py-3 text-dark-600 touch-none flex-shrink-0 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()}>
                        <GripVertical size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="p-3.5 pr-3">
                          <div className="flex items-center gap-3">
                            <CategoryIcon icon={cat.icon} color={cat.color} size={36} rounded="lg" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{cat.name}</p>
                            </div>
                            <button onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); openForm(undefined, cat.id); }}
                              className="p-2 text-dark-400 hover:text-dark-200 flex-shrink-0">
                              <FolderPlus size={15} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SwipeableRow>
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
                {grandparent && <><CategoryIcon icon={grandparent.icon} color={grandparent.color} size={16} rounded="md" /><span>{grandparent.name}</span><span>›</span></>}
                {parent && <><CategoryIcon icon={parent.icon} color={parent.color} size={16} rounded="md" /><span>{parent.name}</span></>}
                <span>›</span><span className="text-dark-300">nueva</span>
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto px-5 pb-28">
            <div className="flex items-center gap-4 py-5">
              <CategoryIcon icon={icon} color={color} size={64} rounded="full" iconSize={30} />
              <input
                type="text" placeholder="Nombre de categoría" value={name}
                onChange={(e) => setName(e.target.value)} autoFocus={showForm}
                className="flex-1 text-lg font-semibold bg-transparent focus:outline-none border-b border-dark-700 pb-2 placeholder:text-dark-500 min-h-[28px]"
              />
            </div>

            <div className="mb-5">
              {parentId ? (
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
                {CATEGORY_ICONS.map((ic) => {
                  const IconComp = getIconComponent(ic);
                  return (
                    <button key={ic} onClick={() => setIcon(ic)}
                      className={`aspect-square rounded-xl flex items-center justify-center transition-all ${icon === ic ? 'bg-dark-600 ring-2 ring-brand-500' : 'bg-dark-800 hover:bg-dark-700'}`}>
                      <IconComp size={20} color={icon === ic ? 'white' : '#94a3b8'} strokeWidth={1.8} />
                    </button>
                  );
                })}
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
