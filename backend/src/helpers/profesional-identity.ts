// ============================================================================
// resolveProfesionalIdentity — Deriva la identidad de profesional (médico/coach)
// del request, para el torniquete de jornada.
//
// Prioriza la sesión RBAC (email+contraseña): sólo médico/coach con `codigo`
// vinculado cuentan como profesional rastreable. Si no hay sesión, cae al token
// legacy (code+sede) que inyecta optionalAuthMiddleware. Retorna null si el
// requester no es un profesional (paciente sin token, o coordinador/admin/etc.).
//
// La identidad SIEMPRE se deriva del token en el server, nunca del body → no se
// puede suplantar a otro coach.
// ============================================================================

import { Request } from 'express';
import { getSession } from '../middleware/rbac.middleware';

export interface ProfesionalIdentity {
  codigo: string;
  sedeId: string;
  rol: 'medico' | 'coach' | null;
}

export function resolveProfesionalIdentity(req: Request): ProfesionalIdentity | null {
  const session = getSession(req);
  if (session) {
    if ((session.role === 'medico' || session.role === 'coach') && session.codigo) {
      const sedeId =
        Array.isArray(session.sedes) && session.sedes.length > 0 ? session.sedes[0] : 'bsl';
      return { codigo: session.codigo, sedeId, rol: session.role };
    }
    return null; // logueado pero no es un profesional que ficha (coordinador/admin/…)
  }
  // Legacy token (code+sede) inyectado por optionalAuthMiddleware / sedeMiddleware.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medicoCode = (req as any).medicoCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeId = (req as any).sedeId;
  if (typeof medicoCode === 'string' && medicoCode.length > 0) {
    return {
      codigo: medicoCode,
      sedeId: typeof sedeId === 'string' && sedeId.length > 0 ? sedeId : 'bsl',
      rol: null,
    };
  }
  return null;
}
