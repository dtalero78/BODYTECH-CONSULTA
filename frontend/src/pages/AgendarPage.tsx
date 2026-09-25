import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import apiService from '../services/api.service';
import { SelectorCupos, fechaLarga, type DiaCupos } from '../components/agenda/SelectorCupos';

// /agendar/:token — el afiliado nuevo de MyBodytech agenda su consulta virtual
// de fisioterapia con la Unidad Médica Virtual. Llega por el botón del WhatsApp
// de bienvenida. Mismo selector que /reprogramar, con la marca Bodytech (sin
// Trepsi) y los cupos de TODO el equipo UMV: el afiliado elige la hora y la
// plataforma le asigna el profesional.

const ACCENT = '#18181b';

interface Cita {
  fecha: string;
  hora: string;
  reprogramarId: string;
}

function Check() {
  return (
    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
      <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

function CitaAgendada({ cita, titulo }: { cita: Cita; titulo: string }) {
  return (
    <div className="text-center space-y-3">
      <Check />
      <h2 className="text-lg font-semibold text-gray-800">{titulo}</h2>
      <p className="text-gray-600">
        Tu consulta virtual de fisioterapia es el <strong>{fechaLarga(cita.fecha)}</strong> a las{' '}
        <strong>{cita.hora}</strong>.
      </p>
      <p className="text-sm text-gray-500">
        Te enviaremos por WhatsApp el enlace para entrar a la videollamada.
      </p>
      <a
        href={`/reprogramar/${cita.reprogramarId}`}
        className="inline-block mt-2 text-sm font-medium underline"
        style={{ color: ACCENT }}
      >
        Necesito otro horario
      </a>
    </div>
  );
}

export function AgendarPage() {
  const { token } = useParams<{ token: string }>();
  const [nombre, setNombre] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaCupos[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [yaAgendada, setYaAgendada] = useState<Cita | null>(null);
  const [done, setDone] = useState<Cita | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    const info = await apiService.getAgendaInfo(token).catch(() => null);
    if (!info) {
      setNoEncontrada(true);
      return;
    }
    setNombre(info.primerNombre);
    if (info.estado === 'agendada' && info.cita) {
      setYaAgendada(info.cita);
      return;
    }
    const h = await apiService.getAgendaHorarios(token).catch(() => null);
    setDias(h?.dias ?? []);
  }, [token]);

  useEffect(() => {
    cargar().finally(() => setLoading(false));
  }, [cargar]);

  const agendar = async (fecha: string, hora: string) => {
    if (!token || submitting) return;
    setError(null);
    setSubmitting(hora);
    try {
      const res = await apiService.agendarConsulta(token, fecha, hora);
      setDone({ fecha: res.fecha, hora: res.hora, reprogramarId: res.reprogramarId });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === 'YA_AGENDADA') {
        await cargar();
        return;
      }
      setError(data?.message || 'No pudimos agendar tu consulta. Intenta con otro horario.');
      // El cupo se pudo ocupar mientras elegía: se recarga la lista.
      await cargar();
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-figtree">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-6">
          <img src="/logoNegro.png" alt="Bodytech" className="h-16 mx-auto mb-5 object-contain" />
          <h1 className="text-xl font-bold text-gray-800">Agenda tu consulta virtual</h1>
          <p className="text-sm text-gray-500 mt-1">Fisioterapia · Unidad Médica Virtual</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: ACCENT }} />
          </div>
        ) : done ? (
          <CitaAgendada cita={done} titulo="¡Consulta agendada!" />
        ) : yaAgendada ? (
          <CitaAgendada cita={yaAgendada} titulo="Tu consulta ya está agendada" />
        ) : noEncontrada ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            No encontramos tu orden. Verifica el enlace o escríbenos por WhatsApp.
          </div>
        ) : dias.length === 0 ? (
          <p className="text-gray-600 text-center py-6">
            En este momento no hay horarios disponibles. Te contactaremos para agendar tu consulta.
          </p>
        ) : (
          <>
            <p className="text-gray-600 text-center mb-5">
              {nombre ? `Hola ${nombre}, ` : ''}elige el día y la hora de tu consulta. Dura menos de 15
              minutos.
            </p>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
                {error}
              </div>
            )}

            <SelectorCupos dias={dias} accent={ACCENT} submitting={submitting} onElegir={agendar} />
          </>
        )}
      </div>
    </div>
  );
}

export default AgendarPage;
