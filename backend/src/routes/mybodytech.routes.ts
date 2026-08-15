// ============================================================================
// mybodytech.routes — Integración API mybodytech <-> Bodytech Consulta.
//
// Base path:  /api/v1/integrations/mybodytech
//
// Flujo acordado (2 fases):
//   Fase 1 (entrada, mybodytech → nosotros): alta del afiliado nuevo +
//     agendamiento de la consulta (el afiliado elige el cupo de nuestra agenda).
//   Fase 2 (salida, nosotros → mybodytech): al cerrar la historia clínica se
//     envían los datos para completar el RIPS (webhook).
//
// Todos los endpoints exigen `Authorization: Bearer <MYBODYTECH_API_KEY>`
// (middleware `requireApiKey('MYBODYTECH_API_KEY', 'mybodytech')` montado en
// index.ts). Es la misma convención de la integración Trepsi.
//
// Estado: SCAFFOLD inicial. Solo `/health` está activo — existe para que
// mybodytech valide URL + token de una vez, tal como lo hace Trepsi. Los
// endpoints de negocio (GET /horarios-disponibles, GET /sedes, POST /afiliados,
// GET/DELETE /afiliados/:eventoId) se agregan cuando se cierre el contrato en
// la reunión técnica.
// ============================================================================

import { Router } from 'express';

const router = Router();

// Health check de la integración. Comparte el middleware de API Key con el
// resto de las rutas, así mybodytech verifica en un solo llamado que la URL
// es correcta Y que el token es válido.
router.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    integration: 'mybodytech',
    version: '1.0',
    timestamp: new Date().toISOString(),
  });
});

export default router;
