import { useState } from 'react';
import axios from 'axios';
import { camelCampo, tieneValor } from './completitud';
import type { MedicalHistoryFull } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// ============================================================================
// Llenado rápido — "Niega todos", "Todo normal". El botón está en
// `LlenadoRapido.tsx`; acá la lógica.
//
// El médico corporativo reportó que en una jornada solo alcanzó a llenar UNA
// historia: son ~77 campos repartidos en 16 ventanas, y la mayoría de pacientes
// sanos tienen las mismas respuestas (niega síntomas, niega antecedentes,
// revisión por sistemas normal). Un botón las pone todas de una.
//
// Por qué un botón y no valores por defecto: en una historia clínica "No" y
// "nadie lo preguntó" no son lo mismo (la hoja de valoraciones deja en blanco un
// antecedente sin responder por esa razón). Con el botón, el "Niega" lo afirma
// el médico con un clic; con un default, lo afirmaría el formulario.
//
// Solo toca campos VACÍOS: nunca pisa lo que el médico ya escribió o marcó.
// ============================================================================

/** De `{ campo: valor }`, deja solo los campos que en la historia siguen vacíos. */
export function soloVacios(
  data: MedicalHistoryFull | null,
  valores: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(valores).filter(([campo]) => !tieneValor(data?.[camelCampo(campo)]))
  );
}

/**
 * Guarda varios campos a la vez. El valor local se actualiza SOLO con lo que el
 * servidor confirmó: si se actualizara antes, un fallo dejaría en pantalla un
 * "Niega" que no quedó en la historia.
 */
export function useLlenarVarios(
  historiaId: string | undefined,
  onPatchLocal: (field: string, value: unknown) => void
) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function llenar(valores: Record<string, unknown>): Promise<void> {
    const campos = Object.entries(valores);
    if (!historiaId || guardando || campos.length === 0) return;
    setGuardando(true);
    setError(null);
    const resultados = await Promise.allSettled(
      campos.map(([field, value]) =>
        axios.patch(`${API_BASE_URL}/api/video/medical-history/${historiaId}/field`, { field, value })
      )
    );
    let fallidos = 0;
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') onPatchLocal(campos[i][0], campos[i][1]);
      else fallidos++;
    });
    if (fallidos > 0) {
      setError(
        fallidos === campos.length
          ? 'No se pudo guardar. Revisa la conexión e intenta de nuevo.'
          : `Faltaron ${fallidos} de ${campos.length} por guardar. Intenta de nuevo.`
      );
    }
    setGuardando(false);
  }

  return { llenar, guardando, error };
}
