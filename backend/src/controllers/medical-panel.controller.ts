import { Request, Response } from 'express';
import medicalPanelService, { OrdenCreateInput, OrdenUpdateInput } from '../services/medical-panel.service';

class MedicalPanelController {
  /**
   * Obtiene estadísticas del día para un médico
   */
  async getDailyStats(req: Request, res: Response): Promise<void> {
    try {
      const { medicoCode } = req.params;

      if (!medicoCode) {
        res.status(400).json({ error: 'Código de médico requerido' });
        return;
      }

      const stats = await medicalPanelService.getDailyStats(medicoCode);
      res.json(stats);
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ error: 'Error obteniendo estadísticas del día' });
    }
  }

  /**
   * Obtiene lista paginada de pacientes pendientes del día
   */
  async getPendingPatients(req: Request, res: Response): Promise<void> {
    try {
      const { medicoCode } = req.params;
      const page = parseInt(req.query.page as string) || 0;
      const pageSize = parseInt(req.query.pageSize as string) || 10;

      if (!medicoCode) {
        res.status(400).json({ error: 'Código de médico requerido' });
        return;
      }

      const result = await medicalPanelService.getPendingPatients(medicoCode, page, pageSize);
      res.json(result);
    } catch (error) {
      console.error('Error obteniendo pacientes pendientes:', error);
      res.status(500).json({ error: 'Error obteniendo lista de pacientes' });
    }
  }

  /**
   * Busca un paciente por documento de identidad
   */
  async searchPatientByDocument(req: Request, res: Response): Promise<void> {
    try {
      const { documento } = req.params;

      if (!documento) {
        res.status(400).json({ error: 'Documento de identidad o celular requerido' });
        return;
      }

      const patient = await medicalPanelService.searchPatientByDocument(documento);

      if (!patient) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json(patient);
    } catch (error) {
      console.error('Error buscando paciente:', error);
      res.status(500).json({ error: 'Error buscando paciente' });
    }
  }

  /**
   * Marca un paciente como "No Contesta"
   */
  async markAsNoAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { patientId } = req.params;

      if (!patientId) {
        res.status(400).json({ error: 'ID de paciente requerido' });
        return;
      }

      const updated = await medicalPanelService.markPatientAsNoAnswer(patientId);

      if (!updated) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json({ success: true, message: 'Paciente marcado como "No Contesta"' });
    } catch (error) {
      console.error('Error marcando paciente:', error);
      res.status(500).json({ error: 'Error actualizando estado del paciente' });
    }
  }

  /**
   * Obtiene detalles completos de un paciente
   */
  async getPatientDetails(req: Request, res: Response): Promise<void> {
    try {
      const { documento } = req.params;

      if (!documento) {
        res.status(400).json({ error: 'Documento de identidad requerido' });
        return;
      }

      const patientDetails = await medicalPanelService.getPatientDetails(documento);

      if (!patientDetails) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json(patientDetails);
    } catch (error) {
      console.error('Error obteniendo detalles del paciente:', error);
      res.status(500).json({ error: 'Error obteniendo detalles del paciente' });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD de Órdenes
  // ---------------------------------------------------------------------------

  /**
   * GET /ordenes — lista órdenes con filtros opcionales
   */
  async listOrdenes(req: Request, res: Response): Promise<void> {
    try {
      const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : 0;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 20;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const status = req.query.status as string | undefined;
      const medico = req.query.medico as string | undefined;
      const q = req.query.q as string | undefined;

      const result = await medicalPanelService.listOrdenes({
        page,
        limit,
        from,
        to,
        status,
        medico,
        q,
      });

      res.json(result);
    } catch (error) {
      console.error('Error listando órdenes:', error);
      res.status(500).json({ error: 'Error listando órdenes' });
    }
  }

  /**
   * POST /ordenes — crea una nueva orden
   */
  async createOrden(req: Request, res: Response): Promise<void> {
    try {
      const {
        primerNombre,
        primerApellido,
        numeroId,
        celular,
        medico,
        segundoNombre,
        segundoApellido,
        empresa,
        codEmpresa,
        tipoExamen,
        examenes,
        fechaAtencion,
        horaAtencion,
        ciudad,
      } = req.body as Partial<OrdenCreateInput>;

      if (!primerNombre || !primerApellido || !numeroId || !celular || !medico) {
        res.status(400).json({
          error: 'Campos requeridos: primerNombre, primerApellido, numeroId, celular, medico',
        });
        return;
      }

      if (!fechaAtencion || !horaAtencion) {
        res.status(400).json({
          error: 'Campos requeridos: fechaAtencion (YYYY-MM-DD) y horaAtencion (HH:MM)',
        });
        return;
      }

      const orden = await medicalPanelService.createOrden({
        primerNombre,
        primerApellido,
        numeroId,
        celular,
        medico,
        segundoNombre,
        segundoApellido,
        empresa,
        codEmpresa,
        tipoExamen,
        examenes,
        fechaAtencion,
        horaAtencion,
        ciudad,
      });

      res.status(201).json({ success: true, orden });
    } catch (error) {
      console.error('Error creando orden:', error);
      res.status(500).json({ error: 'Error creando orden' });
    }
  }

  /**
   * PATCH /ordenes/:id — actualiza campos de una orden existente
   */
  async updateOrden(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'ID de orden requerido' });
        return;
      }

      const fields = req.body as OrdenUpdateInput;

      const updated = await medicalPanelService.updateOrden(id, fields);

      if (!updated) {
        res.status(404).json({ error: 'Orden no encontrada' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error actualizando orden:', error);
      res.status(500).json({ error: 'Error actualizando orden' });
    }
  }

  /**
   * DELETE /ordenes/:id — elimina una orden
   */
  async deleteOrden(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'ID de orden requerido' });
        return;
      }

      const deleted = await medicalPanelService.deleteOrden(id);

      if (!deleted) {
        res.status(404).json({ error: 'Orden no encontrada' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error eliminando orden:', error);
      res.status(500).json({ error: 'Error eliminando orden' });
    }
  }
}

export default new MedicalPanelController();
