'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Eye, EyeOff, Mail, Lock, ArrowRight, UserPlus, LogIn } from 'lucide-react';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
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
      if (isLogin) {
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 page-transition">
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">💸</div>
        <h1 className="text-3xl font-bold tracking-tight">Spendly</h1>
        <p className="text-dark-400 mt-2 text-sm">Controlá tus gastos, dominá tu plata</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm">
        {/* Toggle */}
        <div className="flex bg-dark-800 rounded-xl p-1 mb-6">
          <button
            onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              isLogin ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'
            }`}
          >
            <LogIn size={16} /> Entrar
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              !isLogin ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'
            }`}
          >
            <UserPlus size={16} /> Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="relative">
            <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
            <input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-11 pr-11 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dark-400"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
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
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-dark-600 text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {isLogin ? 'Entrar' : 'Crear cuenta'}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {!isLogin && (
          <p className="text-dark-500 text-xs text-center mt-4">
            La contraseña debe tener al menos 6 caracteres
          </p>
        )}
      </div>
    </div>
  );
}
