import { useEffect } from 'react';

/**
 * Le pregunta al profesional si de verdad quiere salir cuando cierra la pestaña
 * con la consulta sin cerrar.
 *
 * Entre 1 y 5 consultas por día se atienden y quedan en PENDIENTE (5 de 49 el
 * 1-oct-2026): el coach entra a la sala, atiende, y cierra la pestaña sin
 * apretar el botón que marca la cita como atendida — "Finalizar y guardar" en
 * el panel de nutrición, "Salir" en la videollamada, "Finalizar consulta" en el
 * corporativo. La transcripción automática llena los datos pero NO cierra la
 * cita, así que desde afuera la consulta parece no haber ocurrido y el afiliado
 * le vuelve a aparecer al coach al día siguiente.
 *
 * El texto del diálogo lo pone el navegador y no se puede cambiar; lo único que
 * se puede hacer es pedirlo. `activo` en false no registra nada, para no
 * molestar a quien abre una pantalla y la cierra sin tocar nada.
 */
export function useAvisoAlCerrar(activo: boolean): void {
  useEffect(() => {
    if (!activo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [activo]);
}
