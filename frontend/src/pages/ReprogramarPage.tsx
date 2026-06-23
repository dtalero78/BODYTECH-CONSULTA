import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import apiService from '../services/api.service';

const ACCENT = '#1f3a8a';

const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Mediodía UTC para obtener el día de la semana correcto sin TZ.
function isoToDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
}

function chip(iso: string): { dow: string; dnum: string; mon: string } {
  const dt = isoToDate(iso);
  const d = iso.slice(8, 10);
  const mo = Number(iso.slice(5, 7));
  if (!dt) return { dow: iso, dnum: d, mon: '' };
  return { dow: DIAS_CORTO[dt.getUTCDay()], dnum: String(Number(d)), mon: MESES_CORTO[mo - 1] };
}

function fechaLarga(iso: string): string {
  const dt = isoToDate(iso);
  if (!dt) return iso;
  const d = Number(iso.slice(8, 10));
  const mo = Number(iso.slice(5, 7));
  return `${DIAS_LARGO[dt.getUTCDay()]} ${d} de ${MESES_LARGO[mo - 1]}`;
}

interface DiaCupos {
  fecha: string;
  horarios: string[];
}

export function ReprogramarPage() {
  const { id } = useParams<{ id: string }>();
  const [nombre, setNombre] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaCupos[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null); // hora en curso
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ fecha: string; hora: string } | null>(null);

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
        if (info) setNombre(info.primerNombre);
        const ds = horarios?.dias ?? [];
        setDias(ds);
        setSelectedDay(ds[0]?.fecha ?? null);
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
      setError(
        err?.response?.data?.error ||
          'No pudimos reprogramar tu cita. Intenta con otro horario o contáctanos.'
      );
    } finally {
      setSubmitting(null);
    }
  };

  const diaSel = dias.find((d) => d.fecha === selectedDay) ?? null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-figtree">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-6">
          <img src="/trepsiLogo.png" alt="Trepsi" className="h-24 w-auto mx-auto mb-4" />
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

            {/* Selector de día */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Día</p>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
              {dias.map((d) => {
                const c = chip(d.fecha);
                const active = d.fecha === selectedDay;
                return (
                  <button
                    key={d.fecha}
                    onClick={() => setSelectedDay(d.fecha)}
                    className="shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-md border text-sm transition-colors"
                    style={
                      active
                        ? { background: ACCENT, borderColor: ACCENT, color: '#fff' }
                        : { background: '#fff', borderColor: '#e4e4e7', color: '#3f3f46' }
                    }
                  >
                    <span className="text-[11px] leading-none mb-0.5 opacity-80">{c.dow}</span>
                    <span className="text-lg font-semibold leading-none">{c.dnum}</span>
                    <span className="text-[10px] leading-none mt-0.5 opacity-80">{c.mon}</span>
                  </button>
                );
              })}
            </div>

            {/* Selector de hora */}
            {diaSel && (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Hora · {fechaLarga(diaSel.fecha)}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {diaSel.horarios.map((h) => {
                    const busy = submitting === h;
                    return (
                      <button
                        key={h}
                        onClick={() => reprogramar(diaSel.fecha, h)}
                        disabled={submitting !== null}
                        className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md text-[14px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> : h}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

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
