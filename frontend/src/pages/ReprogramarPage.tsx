import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import apiService from '../services/api.service';
import { SelectorCupos, fechaLarga, type DiaCupos } from '../components/agenda/SelectorCupos';

const ACCENT = '#1f3a8a';

export function ReprogramarPage() {
  const { id } = useParams<{ id: string }>();
  const [nombre, setNombre] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaCupos[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null); // hora en curso
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ fecha: string; hora: string } | null>(null);
  // Cuando el afiliado ya agotó su cupo de auto-reprogramaciones, la página
  // muestra el aviso en vez del selector: elegir un horario para que el
  // servidor lo rechace después es peor experiencia que decirlo de entrada.
  const [sinCupo, setSinCupo] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      apiService.getReprogramarInfo(id).catch(() => null),
      apiService.getReprogramarHorarios(id).catch(() => null),
    ])
      .then(([info, horarios]) => {
        if (cancelled) return;
        if (!info && !horarios) {
          setError('No encontramos tu cita. Verifica el enlace o contáctanos.');
          return;
        }
        if (info) {
          setNombre(info.primerNombre);
          if (info.puedeReprogramar === false) setSinCupo(true);
        }
        const ds = horarios?.dias ?? [];
        setDias(ds);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reprogramar = async (fecha: string, hora: string) => {
    if (!id || submitting) return;
    setError(null);
    setSubmitting(hora);
    try {
      const res = await apiService.reprogramarCita(id, fecha, hora);
      setDone({ fecha: res.fecha, hora: res.hora });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === 'LIMITE_REPROGRAMACIONES') {
        setSinCupo(true);
        return;
      }
      setError(
        data?.message ||
          data?.error ||
          'No pudimos reprogramar tu cita. Intenta con otro horario o contáctanos.'
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-figtree">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-6">
          <img src="/trepsiLogo.png" alt="Trepsi" className="max-w-full w-auto h-auto mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-800">Reprogramar cita</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: ACCENT }} />
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
              Tu nueva cita quedó para el <strong>{fechaLarga(done.fecha)}</strong> a las{' '}
              <strong>{done.hora}</strong>.
            </p>
            <p className="text-sm text-gray-400">Recibirás la confirmación por WhatsApp.</p>
          </div>
        ) : sinCupo ? (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800">
              Esta cita ya no se puede reprogramar en línea
            </h2>
            <p className="text-gray-600">
              Ya la moviste el máximo de veces permitido. Escríbenos por WhatsApp y con gusto te
              ayudamos a reagendarla.
            </p>
            <a
              href="https://wa.me/5716284820"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-5 py-2.5 rounded-lg text-white font-medium"
              style={{ backgroundColor: '#25D366' }}
            >
              Escribir por WhatsApp
            </a>
          </div>
        ) : error && dias.length === 0 ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </div>
        ) : dias.length === 0 ? (
          <p className="text-gray-600 text-center py-6">
            No hay cupos disponibles con tu profesional en los próximos días. Te contactaremos para
            reagendar.
          </p>
        ) : (
          <>
            <p className="text-gray-600 text-center mb-5">
              {nombre ? `Hola ${nombre}, ` : ''}elige el día y la hora para tu cita con tu mismo
              profesional:
            </p>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
                {error}
              </div>
            )}

            <SelectorCupos dias={dias} accent={ACCENT} submitting={submitting} onElegir={reprogramar} />

            <p className="text-xs text-gray-400 text-center mt-6">
              Los horarios mostrados son los cupos libres de tu mismo profesional.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ReprogramarPage;
