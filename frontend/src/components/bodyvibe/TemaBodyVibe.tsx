// ============================================================================
// TemaBodyVibe — aplica la apariencia configurada, y la retira durante una
// videollamada.
//
// Decisión 07, la mitad que más importa: en el panel médico solo se permite
// apariencia, y **todo lo inyectado se apaga mientras hay una llamada activa**.
//
// Ese panel comparte pantalla con la consulta en vivo. Si la apariencia cambia
// justo cuando alguien está atendiendo, en el mejor de los casos distrae y en
// el peor deja un dato clínico peor de leer que el original. Mientras dura la
// llamada, el médico ve el panel tal como viene de fábrica; la personalización
// vuelve sola al colgar.
//
// El interruptor general también manda acá: si BodyVibeTech está apagado, la
// plataforma queda exactamente como está hoy, apariencia incluida.
// ============================================================================

import { useEffect, useState } from 'react';
import bodyvibeService from '../../services/bodyvibe.service';

/**
 * Cuántas videollamadas hay montadas ahora mismo. Es un contador y no un
 * booleano porque durante una transición pueden convivir dos brevemente; con un
 * booleano, la que se desmonta apagaría la bandera de la que sigue viva.
 */
let llamadasActivas = 0;
const suscriptores = new Set<(enLlamada: boolean) => void>();

function avisar() {
  const enLlamada = llamadasActivas > 0;
  suscriptores.forEach((f) => f(enLlamada));
}

/** Lo llama `VideoRoom` al montarse y al desmontarse. */
export function marcarLlamadaActiva(activa: boolean): void {
  llamadasActivas = Math.max(0, llamadasActivas + (activa ? 1 : -1));
  avisar();
}

export function hayLlamadaActiva(): boolean {
  return llamadasActivas > 0;
}

const DENSIDAD_ESCALA: Record<string, string> = {
  compacta: '0.92',
  normal: '1',
  amplia: '1.08',
};

/**
 * Monta esto una sola vez, dentro del router. No pinta nada: solo escribe (o
 * borra) variables CSS en la raíz del documento.
 */
export function TemaBodyVibe() {
  const [enLlamada, setEnLlamada] = useState(hayLlamadaActiva());
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  const [densidad, setDensidad] = useState<string>('normal');

  // Suscripción al estado de llamada.
  useEffect(() => {
    suscriptores.add(setEnLlamada);
    return () => {
      suscriptores.delete(setEnLlamada);
    };
  }, []);

  // Carga de la apariencia vigente. Si algo falla —o BodyVibeTech está
  // apagado— no se aplica nada y la plataforma se ve como siempre. El silencio
  // es el comportamiento correcto: la apariencia nunca debe ser un motivo por
  // el que la plataforma no cargue.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const estado = await bodyvibeService.estado();
        if (!vivo || !estado.activo) return;

        const tema = await bodyvibeService.tema();
        if (!vivo) return;

        const paleta = tema.paletas.find((p) => p.id === tema.paleta);
        if (paleta) setTokens(paleta.tokens);
        setDensidad(tema.densidad);
      } catch {
        /* Sin apariencia configurada, la de fábrica. */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;

    // Durante la llamada se retira TODO lo aplicado. No se atenúa ni se deja a
    // medias: el panel vuelve a ser exactamente el de fábrica.
    if (enLlamada || !tokens) {
      raiz.removeAttribute('data-bv-densidad');
      raiz.style.removeProperty('--bv-escala');
      // Solo se limpian las variables que este componente escribió; el resto
      // de las variables de la plataforma no se toca.
      for (const nombre of Object.keys(tokens ?? {})) raiz.style.removeProperty(nombre);
      return;
    }

    for (const [nombre, valor] of Object.entries(tokens)) {
      raiz.style.setProperty(nombre, valor);
    }
    raiz.setAttribute('data-bv-densidad', densidad);
    raiz.style.setProperty('--bv-escala', DENSIDAD_ESCALA[densidad] ?? '1');
  }, [enLlamada, tokens, densidad]);

  return null;
}

export default TemaBodyVibe;
