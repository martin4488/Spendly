'use client';

import { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { exportToCSV } from '@/lib/utils';
import { LogOut, Download, Mail, Shield, ExternalLink } from 'lucide-react';

export default function SettingsView({ user }: { user: User }) {
  const [exporting, setExporting] = useState(false);

  async function handleExportAll() {
    setExporting(true);
    try {
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*, category:categories(name)')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (expenses && expenses.length > 0) {
        const data = expenses.map(e => ({
          Fecha: e.date,
          Descripción: e.description,
          Categoría: (e as any).category?.name || 'Sin categoría',
          Monto: e.amount,
          Notas: e.notes || '',
          Recurrente: e.is_recurring ? 'Sí' : 'No',
        }));
        exportToCSV(data, 'spendly-todos-los-gastos');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  async function handleLogout() {
    if (confirm('¿Cerrar sesión?')) {
      await supabase.auth.signOut();
    }
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <h1 className="text-xl font-bold mb-5">Configuración</h1>

      {/* Account */}
      <div className="bg-dark-800 rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-dark-300 mb-3">Tu cuenta</h3>
        <div className="flex items-center gap-3">
          <div className="bg-brand-600/20 p-2.5 rounded-lg">
            <Mail size={18} className="text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-medium">{user.email}</p>
            <p className="text-xs text-dark-400">Cuenta verificada</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-dark-800 rounded-xl overflow-hidden mb-4">
        <h3 className="text-sm font-semibold text-dark-300 px-4 pt-4 pb-2">Datos</h3>

        <button
          onClick={handleExportAll}
          disabled={exporting}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-dark-700/50 transition-colors"
        >
          <Download size={18} className="text-dark-400" />
          <div className="text-left flex-1">
            <p className="text-sm font-medium">Exportar todos los gastos</p>
            <p className="text-xs text-dark-400">Descargar CSV con todo el historial</p>
          </div>
          {exporting && <div className="w-4 h-4 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />}
        </button>
      </div>

      {/* Info */}
      <div className="bg-dark-800 rounded-xl overflow-hidden mb-4">
        <h3 className="text-sm font-semibold text-dark-300 px-4 pt-4 pb-2">Info</h3>

        <div className="flex items-center gap-3 px-4 py-3.5">
          <Shield size={18} className="text-dark-400" />
          <div className="text-left flex-1">
            <p className="text-sm font-medium">Tus datos son privados</p>
            <p className="text-xs text-dark-400">Solo vos podés ver tu información</p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="text-lg">💸</div>
          <div className="text-left flex-1">
            <p className="text-sm font-medium">Spendly v1.0</p>
            <p className="text-xs text-dark-400">Hecho con ❤️</p>
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-dark-800 hover:bg-dark-700 rounded-xl p-4 flex items-center gap-3 text-red-400 transition-colors"
      >
        <LogOut size={18} />
        <span className="text-sm font-medium">Cerrar sesión</span>
      </button>
    </div>
  );
}
