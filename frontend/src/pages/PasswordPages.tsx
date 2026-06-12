import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import authService from '../services/auth.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

const CARD =
  'bg-white rounded-xl shadow-sm border border-zinc-200 w-full max-w-sm p-8';
const WRAP =
  'min-h-screen bg-zinc-50 flex items-center justify-center p-4 text-zinc-900';
const INPUT =
  'w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] focus:outline-none focus:border-blue-700';
const LABEL =
  'block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5';
const BTN =
  'w-full py-2.5 text-white rounded-md text-[13px] font-medium disabled:opacity-50 transition-colors';
const wrapStyle = {
  fontFamily: FONT_INTER,
  backgroundImage: 'radial-gradient(rgba(24,24,27,0.025) 1px, transparent 1px)',
  backgroundSize: '3px 3px',
};

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await authService.forgotPassword(email.trim());
    } catch {
      // El endpoint responde 200 siempre; aún si falla la red, mostramos el
      // mensaje neutro para no filtrar nada.
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <div className={WRAP} style={wrapStyle}>
      <div className={CARD} style={{ fontFamily: FONT_INTER }}>
        <div className="mb-7 text-center">
          <img src="/logoNegro.png" alt="Bodytech" className="h-12 mx-auto mb-4 object-contain" />
          <h1 className="text-[22px] font-semibold tracking-tight">¿Olvidaste tu contraseña?</h1>
          <p className="text-[13px] text-zinc-500 mt-1">Te enviamos un enlace para restablecerla</p>
        </div>

        {sent ? (
          <div className="text-center">
            <p className="text-[13px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-4">
              Si el correo corresponde a una cuenta activa, te enviamos un enlace para restablecer
              tu contraseña. Revisa tu bandeja (y spam).
            </p>
            <Link to="/login" className="text-[13px] text-blue-700 mt-4 inline-block">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={LABEL}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                autoFocus
                className={INPUT}
              />
            </div>
            <button type="submit" disabled={loading} className={BTN} style={{ background: '#1f3a8a' }}>
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </button>
            <Link to="/login" className="text-[13px] text-zinc-500 block text-center">
              Volver a iniciar sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authService.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.response?.data?.error;
      setError(
        code === 'INVALID_TOKEN'
          ? 'El enlace es inválido o expiró. Solicita uno nuevo.'
          : 'No se pudo restablecer la contraseña. Intenta de nuevo.'
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className={WRAP} style={wrapStyle}>
        <div className={`${CARD} text-center`} style={{ fontFamily: FONT_INTER }}>
          <h1 className="text-[18px] font-semibold">Enlace inválido</h1>
          <p className="text-[13px] text-zinc-500 mt-2">
            Falta el token de restablecimiento.
          </p>
          <Link to="/forgot-password" className="text-[13px] text-blue-700 mt-4 inline-block">
            Solicitar uno nuevo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={WRAP} style={wrapStyle}>
      <div className={CARD} style={{ fontFamily: FONT_INTER }}>
        <div className="mb-7 text-center">
          <img src="/logoNegro.png" alt="Bodytech" className="h-12 mx-auto mb-4 object-contain" />
          <h1 className="text-[22px] font-semibold tracking-tight">Nueva contraseña</h1>
        </div>

        {done ? (
          <p className="text-[13px] text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-4 text-center">
            Contraseña actualizada. Redirigiendo al login…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={LABEL}>Nueva contraseña (mín. 8)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Confirmar contraseña</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={INPUT}
              />
            </div>
            {error && (
              <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading} className={BTN} style={{ background: '#1f3a8a' }}>
              {loading ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
