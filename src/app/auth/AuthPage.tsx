'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('¡Cuenta creada! Revisá tu email para confirmar.');
      }
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setError('Email o contraseña incorrectos');
      } else if (err.message?.includes('already registered')) {
        setError('Este email ya tiene una cuenta');
      } else {
        setError(err.message || 'Algo salió mal');
      }
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <main className="min-h-dvh flex flex-col px-7 pt-20 pb-10 page-transition">
      {/* Wordmark */}
      <div>
        <div className="inline-flex items-baseline gap-1">
          <span className="text-[34px] font-extrabold tracking-[-0.03em]">spendly</span>
          <span className="w-2 h-2 rounded-full bg-brand-500 ml-1 -translate-y-[2px] inline-block" />
        </div>
        <p className="text-dark-400 text-[15px] mt-3 leading-snug max-w-[260px]">
          Controlá tus gastos.<br/>Dominá tu plata.
        </p>
      </div>

      <div className="flex-1" />

      {/* Form */}
      <form className="space-y-7" onSubmit={handleSubmit}>
        <div>
          <label className="block font-mono text-[11px] font-semibold tracking-wider uppercase text-dark-500 mb-2">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            required
            autoComplete="email"
            className="w-full bg-transparent border-b border-white/10 focus:border-brand-500 outline-none pb-2.5 text-base placeholder:text-dark-500 transition-colors"
          />
        </div>

        <div>
          <label className="block font-mono text-[11px] font-semibold tracking-wider uppercase text-dark-500 mb-2">
            Contraseña
          </label>
          <div className="flex items-center border-b border-white/10 focus-within:border-brand-500 transition-colors">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              className="flex-1 bg-transparent outline-none pb-2.5 text-base tracking-[0.3em] placeholder:tracking-normal placeholder:text-dark-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-[13px] text-dark-400 pb-2.5 px-1"
            >
              {showPassword ? 'ocultar' : 'mostrar'}
            </button>
          </div>
        </div>

        {/* Error / Success */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-brand-500/10 border border-brand-500/20 text-brand-400 text-sm rounded-xl px-4 py-3">
            {success}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-500 text-[#08140c] font-bold text-[15px] py-4 rounded-2xl flex items-center justify-center gap-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              {isLogin ? 'Entrar' : 'Crear cuenta'}
              <span className="font-mono">→</span>
            </>
          )}
        </button>

        {/* Toggle mode */}
        <div className="text-center text-[13px] text-dark-400">
          {isLogin ? '¿Primera vez? ' : '¿Ya tenés cuenta? '}
          <button
            type="button"
            onClick={() => { setMode(isLogin ? 'signup' : 'login'); setError(''); setSuccess(''); }}
            className="text-dark-200 font-semibold border-b border-dark-400 pb-px hover:border-dark-200 transition-colors"
          >
            {isLogin ? 'Crear cuenta' : 'Entrar'}
          </button>
        </div>

        {!isLogin && (
          <p className="text-dark-500 text-xs text-center">
            La contraseña debe tener al menos 6 caracteres
          </p>
        )}
      </form>
    </main>
  );
}
