import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiService from '../services/api.service';

type Franja = 'manana' | 'tarde';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function fechaLegible(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  // Mediodía UTC para obtener el día de la semana correcto sin TZ.
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
  return `${DIAS[dt.getUTCDay()]} ${Number(d)} de ${MESES[Number(mo) - 1]}`;
}

export function ReprogramarPage() {
  const { id } = useParams<{ id: string }>();
  const [nombre, setNombre] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [submitting, setSubmitting] = useState<Franja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ fecha: string; hora: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiService
      .getReprogramarInfo(id)
      .then((info) => {
        if (!cancelled) setNombre(info.primerNombre);
      })
      .catch(() => {
        if (!cancelled) setError('No encontramos tu cita. Verifica el enlace o contáctanos.');
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reprogramar = async (franja: Franja) => {
    if (!id || submitting) return;
    setError(null);
    setSubmitting(franja);
    try {
      const res = await apiService.reprogramarCita(id, franja);
      setDone({ fecha: res.fecha, hora: res.hora });
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          'No pudimos reprogramar tu cita. Intenta de nuevo o contáctanos.'
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-figtree">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <img src="/bodyLogo.jpg" alt="Bodytech" className="h-12 w-auto mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-800">Reprogramar cita</h1>
        </div>

        {loadingInfo ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : done ? (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800">¡Cita reprogramada!</h2>
            <p className="text-gray-600">
              Tu nueva cita quedó para el <strong>{fechaLegible(done.fecha)}</strong> a las{' '}
              <strong>{done.hora}</strong>.
            </p>
            <p className="text-sm text-gray-400">Recibirás la confirmación por WhatsApp.</p>
          </div>
        ) : (
          <>
            <p className="text-gray-600 text-center mb-6">
              {nombre ? `Hola ${nombre}, ` : ''}elige en qué franja del próximo día hábil quieres tu
              cita:
            </p>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => reprogramar('manana')}
                disabled={submitting !== null}
                className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold disabled:opacity-50 transition-colors"
              >
                {submitting === 'manana' ? 'Buscando cupo…' : '☀️  En la mañana'}
              </button>
              <button
                onClick={() => reprogramar('tarde')}
                disabled={submitting !== null}
                className="w-full flex items-center justify-center gap-2 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold disabled:opacity-50 transition-colors"
              >
                {submitting === 'tarde' ? 'Buscando cupo…' : '🌆  En la tarde'}
              </button>
            </div>

            <p className="text-xs text-gray-400 text-center mt-6">
              Se asignará el primer cupo disponible con tu mismo profesional.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ReprogramarPage;
