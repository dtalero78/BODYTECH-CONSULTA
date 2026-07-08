// ============================================================================
// gestion-report-image.service — renderiza el tablero de gestión a PNG
// (Puppeteer, mismo patrón que pdf.service) y lo persiste en `gestion_report_image`
// para servirlo por URL pública a Twilio (header de media de la plantilla).
//
// El PNG se guarda con un token aleatorio y expira: `purgeOld()` borra los
// mayores a 24 h. La URL pública (sin auth) la sirve gestion-report-image.controller.
// ============================================================================

import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer-core';
import postgresService from './postgres.service';
import { buildReportHtml, ReportData } from '../helpers/gestion-report-html';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

class GestionReportImageService {
  /** Renderiza el tablero (ReportData) a un Buffer PNG recortado a la tarjeta. */
  async renderPng(data: ReportData): Promise<Buffer> {
    const html = buildReportHtml(data);
    const browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 680, height: 900, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      const card = await page.$('.card');
      const shot = card
        ? await card.screenshot({ type: 'png' })
        : await page.screenshot({ type: 'png', fullPage: true });
      return Buffer.from(shot);
    } finally {
      await browser.close();
    }
  }

  /** Guarda el PNG con un token aleatorio y devuelve el token (o null si falla). */
  async store(png: Buffer): Promise<string | null> {
    const token = randomBytes(18).toString('hex');
    const rows = await postgresService.query(
      `INSERT INTO gestion_report_image (token, png) VALUES ($1, $2) RETURNING token`,
      [token, png]
    );
    if (!rows || rows.length === 0) return null;
    return token;
  }

  /** Devuelve el PNG por token, o null si no existe/expiró. */
  async fetch(token: string): Promise<Buffer | null> {
    const rows = await postgresService.query(
      `SELECT png FROM gestion_report_image WHERE token = $1 LIMIT 1`,
      [token]
    );
    if (!rows || rows.length === 0) return null;
    const png = (rows[0] as { png: Buffer }).png;
    return Buffer.isBuffer(png) ? png : Buffer.from(png);
  }

  /** Borra imágenes de más de 24 h (higiene de la tabla). */
  async purgeOld(): Promise<void> {
    await postgresService.query(
      `DELETE FROM gestion_report_image WHERE created_at < NOW() - INTERVAL '24 hours'`
    );
  }
}

export default new GestionReportImageService();
