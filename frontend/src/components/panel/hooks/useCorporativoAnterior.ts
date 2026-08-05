import axios from 'axios';
import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/** Composición corporal de la visita corporativa anterior del mismo paciente. */
export interface CorporativoAnterior {
  _id: string;
  fecha: string | null;
  mcPeso: number | null;
  mcPctGrasa: number | null;
  mcPctMusculo: number | null;
  mcGrasaVisceral: number | null;
  mcImc: number | null;
}

/**
 * Trae la visita corporativa anterior para la fila "Comparación" del examen
 * ocupacional. Devuelve `null` cuando es la primera visita del paciente (el
 * backend responde 200 con `data: null`, no es un error).
 */
export function useCorporativoAnterior(historiaId: string | undefined) {
  const query = useQuery<CorporativoAnterior | null, Error>({
    queryKey: ['corporativo-anterior', historiaId],
    queryFn: async () => {
      const res = await axios.get(
        `${API_BASE_URL}/api/video/medical-history/${historiaId}/corporativo-anterior`
      );
      if (res.data?.success) {
        return (res.data.data ?? null) as CorporativoAnterior | null;
      }
      throw new Error(res.data?.error || 'No se pudo cargar la visita anterior');
    },
    enabled: !!historiaId,
    // La visita anterior es inmutable durante la consulta actual: no hace falta
    // revalidarla mientras el médico diligencia el formulario.
    staleTime: Infinity,
    retry: 1,
  });

  return {
    anterior: query.data ?? null,
    loading: query.isLoading,
  };
}
