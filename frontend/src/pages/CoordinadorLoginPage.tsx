import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import authService, { Sede, loginErrorMessage } from '../services/auth.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

export function CoordinadorLoginPage() {
  const navigate = useNavigate();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [codigo, setCodigo] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authService.isLoggedIn()) {
      navigate('/coordinador', { replace: true });
      return;
    }
    authService.getSedes().then(setSedes).catch(() => {});
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim() || !sedeId) {
      setError('Ingresa el código y selecciona la sede.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authService.login(codigo.trim().toUpperCase(), sedeId);
      // Cache del nombre de la sede para mostrarlo en el sidebar del Panel Coordinador.
      const sede = sedes.find((s) => s.sedeId === sedeId);
      if (sede) {
        try {
          localStorage.setItem('bsl_sede_name', sede.nombre);
        } catch {
          // ignore
        }
      }
      navigate('/coordinador', { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 text-zinc-900"
      style={{
        fontFamily: FONT_INTER,
        backgroundImage:
          'radial-gradient(rgba(24,24,27,0.025) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <div
        className="bg-white rounded-xl shadow-sm border border-zinc-200 w-full max-w-sm p-8"
        style={{ fontFamily: FONT_INTER }}
      >
        <div className="mb-8 text-center">
          <img
            src="/logoNegro.png"
            alt="Bodytech"
            className="h-12 mx-auto mb-4 object-contain"
          />
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">
            Panel Coordinador
          </h1>
          <p className="text-[13px] text-zinc-500 mt-1">
            Gestión de profesionales y horarios
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5">
              Código
            </label>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: ALEJANDRO"
              autoFocus
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] focus:outline-none"
              style={{
                fontFamily: FONT_INTER,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#1f3a8a';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,58,138,0.15)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#e4e4e7';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5">
              Sede
            </label>
            <select
              value={sedeId}
              onChange={(e) => setSedeId(e.target.value)}
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] bg-white focus:outline-none"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#1f3a8a';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,58,138,0.15)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#e4e4e7';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <option value="">Seleccionar sede…</option>
              {sedes.map((s) => (
                <option key={s.sedeId} value={s.sedeId}>
                  {s.nombre} — {s.ciudad}
                </option>
              ))}
            </select>
          </div>

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
            onMouseDown={(e) => e.currentTarget.style.setProperty('background', '#1e3a8a')}
            onMouseUp={(e) => e.currentTarget.style.setProperty('background', '#1f3a8a')}
          >
            {loading ? 'Verificando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
