import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import authService, { homePathForRole, passwordLoginErrorMessage } from '../services/auth.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

/**
 * Login unificado (RBAC) — email + contraseña + "recordarme". Al autenticar,
 * redirige según el rol (homePathForRole). Es la única puerta de entrada;
 * las páginas viejas de login redirigen aquí.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const user = authService.getUser();
    if (user) navigate(homePathForRole(user.role), { replace: true });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Ingresa tu email y contraseña.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await authService.passwordLogin(email.trim(), password, remember);
      navigate(homePathForRole(user.role), { replace: true });
    } catch (err) {
      setError(passwordLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const focusRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#1f3a8a';
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,58,138,0.15)';
  };
  const blurRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#e4e4e7';
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <div
      className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 text-zinc-900"
      style={{
        fontFamily: FONT_INTER,
        backgroundImage: 'radial-gradient(rgba(24,24,27,0.025) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <div
        className="bg-white rounded-xl shadow-sm border border-zinc-200 w-full max-w-sm p-8"
        style={{ fontFamily: FONT_INTER }}
      >
        <div className="mb-8 text-center">
          <img src="/logoNegro.png" alt="Bodytech" className="h-12 mx-auto mb-4 object-contain" />
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">Iniciar sesión</h1>
          <p className="text-[13px] text-zinc-500 mt-1">Plataforma de telemedicina Bodytech</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              autoFocus
              autoComplete="email"
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] focus:outline-none"
              style={{ fontFamily: FONT_INTER }}
              onFocus={focusRing}
              onBlur={blurRing}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] focus:outline-none"
              style={{ fontFamily: FONT_INTER }}
              onFocus={focusRing}
              onBlur={blurRing}
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-zinc-600 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-zinc-300"
            />
            Recordarme en este equipo
          </label>

          {error && (
            <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-white rounded-md text-[13px] font-medium disabled:opacity-50 transition-colors"
            style={{ background: '#1f3a8a' }}
          >
            {loading ? 'Verificando…' : 'Entrar'}
          </button>

          <a
            href="/forgot-password"
            className="block text-center text-[13px] text-zinc-500 hover:text-zinc-700"
          >
            ¿Olvidaste tu contraseña?
          </a>
        </form>
      </div>
    </div>
  );
}
