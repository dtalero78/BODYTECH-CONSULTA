// ============================================================================
// pdf.service — Run 6
//
// Convierte un string HTML (renderizado por `historia-clinica-html.ts`) en un
// Buffer PDF usando puppeteer-core + Chromium del sistema.
//
// Por qué `puppeteer-core` y NO `puppeteer`:
//   - La imagen final corre en `node:20-alpine`. El paquete `puppeteer` bundled
//     descarga un Chromium linkeado a glibc — Alpine usa musl libc, así que el
//     binario crashea al arrancar. `puppeteer-core` no descarga nada y deja
//     que apuntemos al `/usr/bin/chromium-browser` que el Dockerfile instaló.
//
// Por qué los args de launch:
//   - `--no-sandbox` / `--disable-setuid-sandbox`: Chromium dentro de un
//     contenedor sin user namespaces no puede crear su propio sandbox.
//   - `--disable-dev-shm-usage`: en Docker `/dev/shm` es 64 MB por defecto,
//     Chromium lo llena y crashea con "Page crashed".
//   - `--single-process`: crítico para Alpine — sin esto, el browser cuelga
//     al hacer fork porque musl maneja signal handling distinto.
//   - `--no-zygote` / `--disable-gpu`: estándar para headless en contenedor.
// ============================================================================

import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

async function htmlToPdf(html: string): Promise<Buffer> {
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
    // Nota: puppeteer-core >=24 removió `networkidle0`/`networkidle2` del type
    // de `setContent.waitUntil`. Para preservar la semántica del spec ("esperar
    // a que la red quede en idle"), hacemos setContent con `load` y luego
    // `waitForNetworkIdle` por separado. El HTML que produce
    // `historia-clinica-html.ts` tiene estilos inline embebidos (sin recursos
    // externos), así que esto se resuelve inmediatamente en práctica.
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });

    // `page.pdf()` en puppeteer >=22 retorna `Uint8Array`. Normalizamos a Buffer
    // para que Express pueda hacer `res.end(...)` y `Content-Length` cuadre.
    return Buffer.from(pdfBuffer);
  } finally {
    // `try/finally` garantiza que cerramos el browser aunque `setContent` o
    // `page.pdf()` lancen — si no, dejamos un proceso Chromium colgado por
    // generación, lo que tumba al servidor en minutos.
    await browser.close();
  }
}

export const pdfService = { htmlToPdf };

export default pdfService;
