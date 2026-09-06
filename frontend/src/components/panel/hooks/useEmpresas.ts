import { useQuery } from '@tanstack/react-query';
import empresasService from '../../../services/empresas.service';

/**
 * Catálogo de empresas cliente para el campo "Empresa" del examen ocupacional.
 *
 * El catálogo cambia muy poco —hoy son dos— y una consulta médica dura minutos,
 * así que no tiene sentido revalidarlo mientras el médico llena el formulario.
 *
 * Si la lista no carga (la base compartida puede estar caída sin que ésta lo
 * esté) devuelve vacío: el campo queda sin opciones, pero la consulta sigue.
 */
export function useEmpresas() {
  const query = useQuery<string[], Error>({
    queryKey: ['empresas-catalogo'],
    queryFn: async () => (await empresasService.listar()).map((e) => e.nombre),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    empresas: query.data ?? [],
    cargando: query.isLoading,
  };
}
