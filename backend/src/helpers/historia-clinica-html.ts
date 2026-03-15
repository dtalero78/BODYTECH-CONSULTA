/**
 * Helper para generar el HTML completo de la Historia Clínica
 * Adaptado de BSL-PLATAFORMA2 para Bodytech ConsultaVideo
 */

function v(val: any, fallback = ''): string {
  if (val === null || val === undefined || val === '') return fallback;
  return String(val);
}

function fmt(val: any): string {
  if (!val) return 'No';
  const s = String(val).trim().toUpperCase();
  if (s === 'SI' || s === 'SÍ' || s === 'YES' || s === '1' || s === 'TRUE') return 'Sí';
  if (s === 'NO' || s === '0' || s === 'FALSE' || s === '') return 'No';
  return String(val);
}

function fmtFecha(fecha: any): string {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return String(fecha);
  }
}

function fmtFechaLarga(fecha: any): string {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  } catch {
    return String(fecha);
  }
}

function celda(label: string, value: any, wide = false): string {
  const cls = wide ? 'cell wide' : 'cell';
  return `<div class="${cls}"><span class="label">${label}</span><span class="value">${v(value, '—')}</span></div>`;
}

function check(val: string): string {
  return val === 'Sí' || val === 'SI' || val === 'sí' ? '☑' : '☐';
}

function buildAntecedentesHTML(f: any): string {
  if (!f) return '';
  const items = [
    { label: 'Presión Alta', val: f.presion_alta },
    { label: 'Problemas Cardíacos', val: f.problemas_cardiacos },
    { label: 'Problemas de Azúcar', val: f.problemas_azucar },
    { label: 'Enfermedad Pulmonar', val: f.enfermedad_pulmonar },
    { label: 'Enfermedad de Hígado', val: f.enfermedad_higado },
    { label: 'Dolor de Espalda', val: f.dolor_espalda },
    { label: 'Dolor de Cabeza', val: f.dolor_cabeza },
    { label: 'Ruido / Jaqueca', val: f.ruido_jaqueca },
    { label: 'Problemas de Sueño', val: f.problemas_sueno },
    { label: 'Cirugía Ocular', val: f.cirugia_ocular },
    { label: 'Cirugía Programada', val: f.cirugia_programada },
    { label: 'Condición Médica', val: f.condicion_medica },
    { label: 'Trastorno Psicológico', val: f.trastorno_psicologico },
    { label: 'Síntomas Psicológicos', val: f.sintomas_psicologicos },
    { label: 'Diagnóstico de Cáncer', val: f.diagnostico_cancer },
    { label: 'Enfermedades Laborales', val: f.enfermedades_laborales },
    { label: 'Enf. Osteomuscular', val: f.enfermedad_osteomuscular },
    { label: 'Enf. Autoinmune', val: f.enfermedad_autoinmune },
    { label: 'Hernias', val: f.hernias },
    { label: 'Varices', val: f.varices },
    { label: 'Hormigueos', val: f.hormigueos },
    { label: 'Embarazo', val: f.embarazo },
    { label: 'Hepatitis', val: f.hepatitis },
    { label: 'Fuma', val: f.fuma },
    { label: 'Consumo Licor', val: f.consumo_licor },
    { label: 'Usa Anteojos', val: f.usa_anteojos },
    { label: 'Usa Lentes de Contacto', val: f.usa_lentes_contacto },
  ];
  return items.map(i => {
    const val = fmt(i.val);
    const cls = val === 'Sí' ? 'ant-yes' : 'ant-no';
    return `<div class="ant-item ${cls}"><span class="ant-check">${check(val)}</span><span class="ant-label">${i.label}</span></div>`;
  }).join('');
}

function buildFamiliaresHTML(f: any): string {
  if (!f) return '';
  const items = [
    { label: 'Hereditarias', val: f.familia_hereditarias },
    { label: 'Genéticas', val: f.familia_geneticas },
    { label: 'Diabetes', val: f.familia_diabetes },
    { label: 'Hipertensión', val: f.familia_hipertension },
    { label: 'Infartos', val: f.familia_infartos },
    { label: 'Cáncer', val: f.familia_cancer },
    { label: 'Trastornos', val: f.familia_trastornos },
    { label: 'Infecciosas', val: f.familia_infecciosas },
  ];
  return items.map(i => {
    const val = fmt(i.val);
    const cls = val === 'Sí' ? 'ant-yes' : 'ant-no';
    return `<div class="ant-item ${cls}"><span class="ant-check">${check(val)}</span><span class="ant-label">${i.label}</span></div>`;
  }).join('');
}

function buildDatosNutricionalesHTML(datos: any): string {
  if (!datos || typeof datos !== 'object') return '';

  const labNames: Record<string, string> = {
    glucosa: 'Glucosa', hba1c: 'HbA1c', colesterolTotal: 'Colesterol Total',
    ldl: 'LDL', hdl: 'HDL', trigliceridos: 'Triglicéridos',
    hemoglobina: 'Hemoglobina', ferritina: 'Ferritina',
    vitaminaD: 'Vitamina D', vitaminaB12: 'Vitamina B12',
  };

  let html = '';

  // Datos de Atención
  const atencion = [
    { key: 'tipoConsulta', label: 'Tipo de Consulta' },
    { key: 'modalidad', label: 'Modalidad' },
    { key: 'registroProfesional', label: 'Registro Profesional' },
  ].filter(f => datos[f.key]);
  if (atencion.length > 0) {
    html += `<div class="sub-section"><h4>Datos de Atención</h4><div class="grid-3">${atencion.map(f => celda(f.label, datos[f.key])).join('')}</div></div>`;
  }

  // Enfermedad Actual
  if (datos.descripcionEnfermedad) {
    html += `<div class="sub-section"><h4>Enfermedad Actual</h4><div class="grid-2">${celda('Descripción', datos.descripcionEnfermedad, true)}</div></div>`;
  }

  // Antecedentes Adicionales
  const antAd = [
    { key: 'medicamentosActuales', label: 'Medicamentos Actuales' },
    { key: 'alergias', label: 'Alergias' },
    { key: 'cirugias', label: 'Cirugías' },
    { key: 'hospitalizaciones', label: 'Hospitalizaciones' },
  ].filter(f => datos[f.key]);
  if (antAd.length > 0) {
    html += `<div class="sub-section"><h4>Antecedentes Adicionales</h4><div class="grid-2">${antAd.map(f => celda(f.label, datos[f.key])).join('')}</div></div>`;
  }

  // Antropometría Complementaria
  const antro = [
    { key: 'pesoHabitual', label: 'Peso Habitual (kg)' },
    { key: 'porcentajeGrasa', label: '% Grasa Corporal' },
    { key: 'masaMuscular', label: 'Masa Muscular (kg)' },
    { key: 'circunferenciaCintura', label: 'Cintura (cm)' },
    { key: 'circunferenciaCadera', label: 'Cadera (cm)' },
    { key: 'relacionCinturaCadera', label: 'Rel. Cintura/Cadera' },
  ].filter(f => datos[f.key]);
  if (antro.length > 0) {
    html += `<div class="sub-section"><h4>Antropometría Complementaria</h4><div class="grid-3">${antro.map(f => celda(f.label, datos[f.key])).join('')}</div></div>`;
  }

  // Evaluación Dietética
  const dieta = [
    { key: 'recordatorio24h', label: 'Recordatorio 24 Horas', wide: true },
    { key: 'numComidasDia', label: 'Comidas/Día' },
    { key: 'consumoAgua', label: 'Consumo de Agua (L/día)' },
    { key: 'preferenciasAlimentarias', label: 'Preferencias Alimentarias', wide: true },
    { key: 'alergiasAlimentarias', label: 'Alergias Alimentarias' },
    { key: 'suplementos', label: 'Suplementos' },
    { key: 'cambiosPesoRecientes', label: 'Cambios de Peso Recientes', wide: true },
  ].filter(f => datos[f.key]);
  if (dieta.length > 0) {
    html += `<div class="sub-section"><h4>Evaluación Dietética</h4><div class="grid-2">${dieta.map(f => celda(f.label, datos[f.key], f.wide)).join('')}</div></div>`;
  }

  // Evaluación Clínica Nutricional
  const clinica = [
    { key: 'signosClinicos', label: 'Signos Clínicos', wide: true },
    { key: 'problemasDigestivos', label: 'Problemas Digestivos', wide: true },
    { key: 'masticacionDeglucion', label: 'Masticación y Deglución' },
    { key: 'observacionesNutricionales', label: 'Observaciones Nutricionales', wide: true },
  ].filter(f => datos[f.key]);
  if (clinica.length > 0) {
    html += `<div class="sub-section"><h4>Evaluación Clínica Nutricional</h4><div class="grid-2">${clinica.map(f => celda(f.label, datos[f.key], f.wide)).join('')}</div></div>`;
  }

  // Laboratorios
  const labRows: string[] = [];
  for (const [key, name] of Object.entries(labNames)) {
    const resultado = datos[`${key}Resultado`];
    if (resultado) {
      const fecha = datos[`${key}Fecha`] || '';
      labRows.push(`<tr><td>${name}</td><td>${v(resultado)}</td><td>${v(fecha)}</td></tr>`);
    }
  }
  if (labRows.length > 0) {
    html += `<div class="sub-section"><h4>Laboratorios</h4>
      <table class="data-table">
        <thead><tr><th>Examen</th><th>Resultado</th><th>Fecha</th></tr></thead>
        <tbody>${labRows.join('')}</tbody>
      </table></div>`;
  }

  // Diagnóstico Nutricional
  const dx = [
    { key: 'diagnosticoCIE10', label: 'Código CIE-10' },
    { key: 'diagnosticoNutricional', label: 'Diagnóstico Nutricional', wide: true },
  ].filter(f => datos[f.key]);
  if (dx.length > 0) {
    html += `<div class="sub-section"><h4>Diagnóstico Nutricional</h4><div class="grid-2">${dx.map(f => celda(f.label, datos[f.key], f.wide)).join('')}</div></div>`;
  }

  // Plan Nutricional
  const plan = [
    { key: 'requerimientoCalorico', label: 'Requerimiento Calórico (kcal/día)' },
    { key: 'distribucionMacronutrientes', label: 'Distribución de Macronutrientes', wide: true },
    { key: 'planAlimentario', label: 'Plan Alimentario', wide: true },
    { key: 'actividadFisicaPlan', label: 'Actividad Física Recomendada', wide: true },
    { key: 'recomendacionesNutricionales', label: 'Recomendaciones Nutricionales', wide: true },
  ].filter(f => datos[f.key]);
  if (plan.length > 0) {
    html += `<div class="sub-section"><h4>Plan Nutricional</h4><div class="grid-2">${plan.map(f => celda(f.label, datos[f.key], f.wide)).join('')}</div></div>`;
  }

  return html;
}

interface HistoriaClinicaHTMLParams {
  historia: any;
  formulario: any;
}

export function generarHTMLHistoriaClinica({ historia, formulario }: HistoriaClinicaHTMLParams): string {
  const hc = historia || {};
  const f = formulario || {};

  const nombreCompleto = [hc.primerNombre, hc.segundoNombre, hc.primerApellido, hc.segundoApellido]
    .filter(Boolean).join(' ').toUpperCase();

  const talla = v(hc.talla || f.estatura);
  const peso = v(hc.peso || f.peso);
  const imc = (talla && peso)
    ? (() => {
        const h = parseFloat(talla);
        const p = parseFloat(peso);
        const hm = h > 10 ? h / 100 : h;
        if (!isNaN(hm) && !isNaN(p) && hm > 0) return (p / (hm * hm)).toFixed(1);
        return '';
      })()
    : '';

  const conceptoClass = (() => {
    const c = v(hc.mdConceptoFinal).toUpperCase();
    if (c.includes('NO APTO')) return 'badge-no-apto';
    if (c.includes('APLAZADO')) return 'badge-aplazado';
    if (c.includes('APTO')) return 'badge-apto';
    return 'badge-pendiente';
  })();

  const datosNutri = hc.datosNutricionales
    ? (typeof hc.datosNutricionales === 'string' ? JSON.parse(hc.datosNutricionales) : hc.datosNutricionales)
    : null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Historia Clínica - ${nombreCompleto}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #111; background: #fff; }

  .page { max-width: 800px; margin: 0 auto; padding: 12px 16px; }

  .no-print { margin-bottom: 10px; text-align: right; }
  .no-print button {
    background: #1a5c8a; color: #fff; border: none; padding: 8px 20px;
    border-radius: 4px; cursor: pointer; font-size: 10pt; font-weight: bold;
  }
  .no-print button:hover { background: #154a6e; }

  .header { display: flex; align-items: center; border-bottom: 2px solid #1a5c8a; padding-bottom: 8px; margin-bottom: 10px; }
  .header-logo { flex: 0 0 auto; margin-right: 14px; }
  .header-logo img { height: 52px; width: auto; }
  .header-info { flex: 1; }
  .header-info h1 { font-size: 14pt; color: #1a5c8a; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .header-info p { font-size: 8pt; color: #555; margin-top: 2px; }
  .header-meta { flex: 0 0 auto; text-align: right; font-size: 8pt; color: #333; }
  .header-meta strong { display: block; font-size: 9pt; }

  .section { border: 1px solid #ccc; border-radius: 3px; margin-bottom: 8px; overflow: hidden; }
  .section-title {
    background: #1a5c8a; color: #fff; font-weight: bold; font-size: 9pt;
    padding: 4px 10px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .section-body { padding: 8px 10px; }

  .sub-section { padding: 4px 0; }
  .sub-section h4 { font-size: 8.5pt; color: #1a5c8a; margin-bottom: 4px; border-bottom: 1px dashed #aac; padding-bottom: 2px; }

  .data-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
  .data-table th { background: #1a5c8a; color: #fff; padding: 3px 8px; text-align: left; }
  .data-table td { border: 1px solid #ddd; padding: 3px 8px; }
  .data-table tr:nth-child(even) td { background: #f5f9fd; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .cell { display: flex; flex-direction: column; }
  .cell.wide { grid-column: span 2; }
  .label { font-size: 7.5pt; color: #666; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px; }
  .value { font-size: 9pt; color: #111; font-weight: 500; border-bottom: 1px dotted #bbb; min-height: 14px; white-space: pre-wrap; }

  .ant-grid { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 6px 0; }
  .ant-item { display: flex; align-items: center; gap: 4px; font-size: 8.5pt; min-width: 160px; }
  .ant-check { font-size: 10pt; }
  .ant-yes { color: #c0392b; font-weight: bold; }
  .ant-no { color: #555; }

  .concepto-box { display: flex; align-items: center; gap: 12px; padding: 10px; }
  .badge { display: inline-block; padding: 5px 18px; border-radius: 4px; font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .badge-apto { background: #27ae60; color: #fff; }
  .badge-no-apto { background: #c0392b; color: #fff; }
  .badge-aplazado { background: #8e44ad; color: #fff; }
  .badge-pendiente { background: #7f8c8d; color: #fff; }
  .concepto-detail { flex: 1; font-size: 9pt; }
  .concepto-detail p { margin-bottom: 3px; white-space: pre-wrap; word-break: break-word; }

  .dx-row { display: flex; gap: 12px; padding: 4px 0; font-size: 9pt; }
  .dx-code { background: #e8f0f8; color: #1a5c8a; padding: 1px 6px; border-radius: 3px; font-weight: bold; font-size: 8.5pt; flex: 0 0 auto; }

  .firma-section { display: flex; gap: 16px; align-items: flex-end; padding: 8px 0; }
  .firma-box { flex: 1; text-align: center; }
  .firma-box img { max-height: 60px; max-width: 140px; object-fit: contain; }
  .firma-line { border-top: 1px solid #333; margin-top: 4px; padding-top: 2px; font-size: 8pt; }

  .no-data { color: #888; font-style: italic; padding: 6px 0; font-size: 8.5pt; }

  @media print {
    body { font-size: 8.5pt; }
    .page { padding: 6px 10px; }
    .section { page-break-inside: avoid; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="no-print">
    <button onclick="window.print()">Imprimir / Descargar PDF</button>
  </div>

  <!-- HEADER -->
  <div class="header">
    <div class="header-logo">
      <img src="/bodytechLogo.png" alt="Bodytech">
    </div>
    <div class="header-info">
      <h1>Historia Clínica Ocupacional</h1>
      <p>Bodytech &nbsp;|&nbsp; Consulta Médica</p>
      <p>Medicina del Trabajo - Salud Ocupacional</p>
    </div>
    <div class="header-meta">
      <strong>${v(hc._id)}</strong>
      <span>Fecha: ${fmtFechaLarga(hc.fechaConsulta || hc.fechaAtencion)}</span><br>
      <span>Tipo: ${v(hc.tipoExamen, 'OCUPACIONAL')}</span><br>
      <span>Estado: <b>${v(hc.atendido, 'PENDIENTE')}</b></span>
    </div>
  </div>

  <!-- I. DATOS DEL PACIENTE -->
  <div class="section">
    <div class="section-title">I. Datos del Paciente</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Nombres completos', nombreCompleto, true)}
        ${celda('N.º Documento', hc.numeroId)}
        ${celda('Género', f.genero || '')}
        ${celda('Edad', f.edad || '')}
        ${celda('Fecha de Nacimiento', fmtFecha(f.fecha_nacimiento))}
        ${celda('Lugar de Nacimiento', f.lugar_nacimiento)}
        ${celda('Ciudad de Residencia', f.ciudad_residencia || hc.ciudad)}
        ${celda('Estado Civil', f.estado_civil)}
        ${celda('Hijos', f.hijos)}
        ${celda('Nivel Educativo', f.nivel_educativo)}
        ${celda('Profesión / Oficio', f.profesion_oficio || hc.cargo)}
        ${celda('Celular', hc.celular || f.celular)}
        ${celda('Email', hc.email || f.email, true)}
        ${celda('EPS', f.eps || '')}
        ${celda('ARL', f.arl || '')}
        ${celda('Pensiones', f.pensiones)}
      </div>
    </div>
  </div>

  <!-- II. DATOS LABORALES -->
  <div class="section">
    <div class="section-title">II. Datos Laborales</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Empresa', hc.empresa || hc.codEmpresa, true)}
        ${celda('Código Empresa', hc.codEmpresa)}
        ${celda('Cargo', hc.cargo)}
        ${celda('Tipo de Examen', hc.tipoExamen)}
        ${celda('Médico', hc.medico)}
        ${celda('Hora Atención', hc.horaAtencion)}
        ${celda('Exámenes ordenados', hc.examenes, true)}
      </div>
    </div>
  </div>

  <!-- III. DATOS ANTROPOMÉTRICOS -->
  <div class="section">
    <div class="section-title">III. Datos Antropométricos</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Talla (cm)', talla)}
        ${celda('Peso (kg)', peso)}
        ${celda('IMC', imc)}
        ${celda('Ejercicio', f.ejercicio)}
        ${celda('Fuma', fmt(f.fuma))}
        ${celda('Consumo Licor', fmt(f.consumo_licor))}
      </div>
    </div>
  </div>

  <!-- IV. ANTECEDENTES PERSONALES -->
  <div class="section">
    <div class="section-title">IV. Antecedentes Personales Patológicos</div>
    <div class="section-body">
      <div class="ant-grid">
        ${buildAntecedentesHTML(f)}
      </div>
    </div>
  </div>

  <!-- V. ANTECEDENTES FAMILIARES -->
  <div class="section">
    <div class="section-title">V. Antecedentes Familiares</div>
    <div class="section-body">
      <div class="ant-grid">
        ${buildFamiliaresHTML(f)}
      </div>
    </div>
  </div>

  <!-- VI. ANAMNESIS -->
  <div class="section">
    <div class="section-title">VI. Anamnesis</div>
    <div class="section-body">
      <div class="grid-2">
        ${celda('Motivo de Consulta', hc.motivoConsulta, true)}
        ${celda('Antecedentes Médicos (MD)', hc.mdAntecedentes, true)}
        ${celda('Observaciones para el Médico', hc.mdObsParaMiDocYa, true)}
      </div>
    </div>
  </div>

  <!-- VII. EXAMEN FÍSICO Y DIAGNÓSTICO -->
  <div class="section">
    <div class="section-title">VII. Examen Físico y Diagnóstico</div>
    <div class="section-body">
      <div class="grid-2">
        ${celda('Diagnóstico', hc.diagnostico, true)}
        ${celda('Tratamiento', hc.tratamiento, true)}
      </div>
      ${hc.mdDx1 ? `<div class="dx-row"><span class="dx-code">Dx1</span><span>${v(hc.mdDx1)}</span></div>` : ''}
      ${hc.mdDx2 ? `<div class="dx-row"><span class="dx-code">Dx2</span><span>${v(hc.mdDx2)}</span></div>` : ''}
    </div>
  </div>

  ${datosNutri && Object.keys(datosNutri).length > 0 ? `
  <!-- VIII. DATOS NUTRICIONALES -->
  <div class="section">
    <div class="section-title">VIII. Datos Nutricionales</div>
    <div class="section-body">
      <div class="grid-4">
        ${buildDatosNutricionalesHTML(datosNutri)}
      </div>
    </div>
  </div>` : ''}

  <!-- CONCEPTO MÉDICO FINAL -->
  <div class="section">
    <div class="section-title">Concepto Médico Final</div>
    <div class="section-body">
      <div class="concepto-box">
        <span class="badge ${conceptoClass}">${v(hc.mdConceptoFinal, 'PENDIENTE')}</span>
        <div class="concepto-detail">
          ${hc.mdRecomendacionesMedicasAdicionales ? `<p><strong>Recomendaciones:</strong> ${hc.mdRecomendacionesMedicasAdicionales}</p>` : ''}
          ${hc.mdObservacionesCertificado ? `<p><strong>Observaciones Certificado:</strong> ${hc.mdObservacionesCertificado}</p>` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- FIRMAS -->
  <div class="section">
    <div class="section-title">Firmas</div>
    <div class="section-body">
      <div class="firma-section">
        <div class="firma-box">
          ${f.firma ? `<img src="${f.firma}" alt="Firma paciente">` : '<div style="height:50px"></div>'}
          <div class="firma-line">
            ${nombreCompleto}<br>
            C.C. ${v(hc.numeroId)}
          </div>
        </div>
        <div class="firma-box">
          <div style="height:50px"></div>
          <div class="firma-line">
            ${v(hc.medico, 'Médico Ocupacional')}<br>
            Médico Salud Ocupacional
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="text-align:center;font-size:7.5pt;color:#aaa;margin-top:6px;border-top:1px solid #eee;padding-top:4px;">
    Documento generado el ${fmtFechaLarga(new Date())} &nbsp;|&nbsp; Bodytech ConsultaVideo &nbsp;|&nbsp; Uso exclusivo médico-laboral &nbsp;|&nbsp; ID: ${v(hc._id)}
  </div>
</div>
</body>
</html>`;
}
