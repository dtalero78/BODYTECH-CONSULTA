import { useEffect, useState } from 'react';
import { catalogoSedes, type SedeCatalogo } from '../../../services/directorio.service';

// Una sola petición por pestaña: el padrón casi no cambia y el médico abre
// varias historias seguidas. Si falla se olvida la promesa, para reintentar.
let cache: Promise<SedeCatalogo[]> | null = null;

/** Las sedes activas del padrón del armario, para un selector. */
export function useSedesCatalogo(): { sedes: SedeCatalogo[]; error: boolean } {
  const [sedes, setSedes] = useState<SedeCatalogo[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (!cache) {
      cache = catalogoSedes().catch((e) => {
        cache = null;
        throw e;
      });
    }
    cache
      .then((s) => {
        if (vivo) setSedes(s);
      })
      .catch(() => {
        if (vivo) setError(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  return { sedes, error };
}
