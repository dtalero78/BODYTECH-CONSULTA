/**
 * ¿La cita que mandó Trepsi respeta las reglas que acordamos?
 *
 * Toda esta semana la respuesta se sacó a mano, cruzando cada `POST
 * /appointments` contra la última lista de horarios que le habíamos dado. El
 * monitor lo muestra solo si alguien lo calcula, así que vive acá: funciones
 * puras, sin base de datos, para poder fijarlas con tests.
 *
 * La regla de fondo es una sola: **la hora agendada tiene que salir de la
 * lista que le dimos.** De ahí salieron las citas sobre horas ocupadas y las
 * de fuera de la jornada del coach.
 */

export interface Cumplimiento {
  /** Qué se está mirando, en castellano. */
  regla: string;
  /** `true` cumple, `false` no cumple, `null` no se pudo determinar. */
  cumple: boolean | null;
  /** La evidencia, para que no haya que creerle al veredicto. */
  detalle: string;
}

/** La hora de una `fechaAtencion` ISO, en Colombia (UTC-5 fijo, no hay DST). */
export function horaColombiaDe(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso ?? '')) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const cot = new Date(ts - 5 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(cot.getUTCHours())}:${p2(cot.getUTCMinutes())}`;
}

/**
 * La cita creada, contra la última lista que le dimos a Trepsi para ese
 * profesional y ese día.
 *
 * `ofrecidos === null` significa que nunca nos preguntó por ese profesional y
 * ese día: eso NO es "no se pudo determinar", es un incumplimiento claro —
 * agendó sin mirar la disponibilidad.
 */
export function cumpleHoraOfrecida(
  fechaAtencionIso: string,
  ofrecidos: string[] | null
): Cumplimiento {
  const regla = 'La hora agendada salió de la lista que le dimos';
  const hora = horaColombiaDe(fechaAtencionIso);
  if (hora === null) {
    return { regla, cumple: null, detalle: 'La fecha enviada no se pudo leer.' };
  }
  if (ofrecidos === null) {
    return {
      regla,
      cumple: false,
      detalle: `Nunca nos consultó los horarios de ese profesional para ese día antes de agendar las ${hora}.`,
    };
  }
  if (ofrecidos.length === 0) {
    return {
      regla,
      cumple: false,
      detalle: `Le respondimos que ese día NO tenía ningún cupo, y agendó las ${hora} igual.`,
    };
  }
  if (ofrecidos.includes(hora)) {
    return { regla, cumple: true, detalle: `Las ${hora} estaban en la lista que le dimos.` };
  }
  return {
    regla,
    cumple: false,
    detalle: `Las ${hora} NO estaban en la lista que le dimos (${ofrecidos.join(', ')}).`,
  };
}

/**
 * Cuando un día viene sin cupos, ¿le ofrecimos el siguiente que sí tiene?
 *
 * Es la regla de NUESTRO lado: decir "no hay" y nada más deja a su app sin qué
 * mostrarle al paciente, y de ahí salen las citas inventadas.
 */
export function cumpleProximoDisponible(respuesta: unknown): Cumplimiento | null {
  const regla = 'Un día sin cupos ofrece el siguiente día disponible';
  const r = (respuesta ?? {}) as Record<string, unknown>;
  const horarios = r.horariosDisponibles;
  if (!Array.isArray(horarios) || horarios.length > 0) return null; // no aplica
  const proximo = r.proximoDisponible as { fecha?: string; horariosDisponibles?: string[] } | null;
  if (proximo && proximo.fecha) {
    const n = proximo.horariosDisponibles?.length ?? 0;
    return { regla, cumple: true, detalle: `Se le ofreció el ${proximo.fecha} con ${n} hora(s).` };
  }
  return {
    regla,
    cumple: false,
    detalle: 'Se le respondió que no hay cupos ese día, sin ofrecerle ninguna alternativa.',
  };
}
