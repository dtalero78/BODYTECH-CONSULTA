// ============================================================================
// DigitalizarView — Pantallazo de "Citas asignadas" de MyBodytech → lista de
// afiliados que abren su ficha en MyBodytech con un clic.
//
// Lo que reemplaza: la coordinación copiaba cédula por cédula a un Excel y la
// pegaba en el buscador de MyBodytech para ver si la persona estaba activa o
// ya tenía cita. Acá se pega el pantallazo (Ctrl+V en cualquier parte de la
// pantalla), la plataforma lee las filas, y cada clic abre la ficha de esa
// cédula en una pestaña de MyBodytech al lado. Si está activa o inactiva lo
// sigue mirando la persona: la integración que lo diría sola no está aprobada.
//
// Cada pantallazo lo leen dos modelos y se cruzan (ver digitalizar-ocr en el
// backend). Donde no coinciden, la fila dice "Verificar cédula" con la otra
// lectura al lado: con un dígito cambiado el clic abriría la ficha de otra
// persona.
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ScanText,
  ClipboardPaste,
  ImagePlus,
  ExternalLink,
  Pencil,
  X,
  RefreshCw,
  Loader2,
  Check,
  Search,
} from 'lucide-react';
import digitalizarService, { CambiosCita, CitaDigitalizada } from '../../services/digitalizar.service';
import authService from '../../services/auth.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, CTA_PRIMARY, Pill } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

type Filtro = 'todas' | 'sinRevisar' | 'revisadas' | 'dudosas';

interface Edicion {
  id: number;
  numeroId: string;
  nombre: string;
  telefono: string;
}

const hoyISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ddmm = (fecha: string): string => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

const horaDe = (isoTs: string): string =>
  new Date(isoTs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

// ----------------------------------------------------------------------------
// Preparar la imagen
//
// El servicio de lectura reduce cualquier imagen hasta que su lado corto mida
// 768 px. Un pantallazo de pantalla completa (1920×1080) queda en 1365×768 y la
// cédula, en letra chica, pierde dígitos: con un fotograma real se leyeron mal
// 3 de 10. Por eso la imagen se parte en franjas de 700 px de alto, que llegan
// sin reducir. Las franjas se solapan para que la fila que queda cortada en el
// borde de una salga entera en la siguiente; el backend junta las lecturas.
// ----------------------------------------------------------------------------

const ANCHO_MAX = 2000;
const CALIDAD = 0.9;
/** Por debajo de 768 px el servicio de lectura no reduce la franja. */
const ALTO_FRANJA = 700;
const SOLAPE = 0.2;

function cargarImagen(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

async function prepararImagen(file: Blob): Promise<string[]> {
  const img = await cargarImagen(file);
  const escala = Math.min(1, ANCHO_MAX / img.width);
  const w = Math.round(img.width * escala);
  const h = Math.round(img.height * escala);

  const dibujar = (y: number, alto: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la imagen.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, alto);
    ctx.drawImage(img, 0, y / escala, img.width, alto / escala, 0, 0, w, alto);
    return canvas.toDataURL('image/jpeg', CALIDAD);
  };

  if (h <= ALTO_FRANJA) return [dibujar(0, h)];
  const franjas: string[] = [];
  const paso = Math.round(ALTO_FRANJA * (1 - SOLAPE));
  for (let y = 0; ; y += paso) {
    franjas.push(dibujar(y, Math.min(ALTO_FRANJA, h - y)));
    if (y + ALTO_FRANJA >= h) break;
  }
  return franjas;
}

// ----------------------------------------------------------------------------

export function DigitalizarView({ showToast }: Props) {
  const [fecha, setFecha] = useState(hoyISO);
  const [citas, setCitas] = useState<CitaDigitalizada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ actual: number; total: number } | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const ocupado = useRef(false);
  const inputArchivo = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setCitas(await digitalizarService.listar(fecha));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Un request por pantallazo (con sus franjas); recarga la lista al final. */
  const procesar = useCallback(
    async (files: File[]) => {
      if (ocupado.current) {
        showToast({ type: 'error', message: 'Todavía se está leyendo el pantallazo anterior.' });
        return;
      }
      ocupado.current = true;
      let nuevas = 0;
      let porVerificar = 0;
      let descartadas = 0;
      let fallos = 0;
      let ultimoError = '';
      try {
        for (let i = 0; i < files.length; i++) {
          setProgreso({ actual: i + 1, total: files.length });
          try {
            const r = await digitalizarService.leer(await prepararImagen(files[i]), fecha);
            nuevas += r.nuevas;
            porVerificar += r.porVerificar;
            descartadas += r.descartadas;
          } catch (e) {
            fallos++;
            ultimoError = e instanceof Error ? e.message : 'Error';
          }
        }
      } finally {
        ocupado.current = false;
        setProgreso(null);
      }
      await cargar();

      if (fallos > 0 && nuevas === 0) {
        showToast({ type: 'error', message: ultimoError });
        return;
      }
      const partes = [
        nuevas === 0
          ? 'No había afiliados nuevos en el pantallazo.'
          : `${plural(nuevas, 'afiliado nuevo', 'afiliados nuevos')}.`,
      ];
      if (porVerificar > 0) partes.push(`${plural(porVerificar, 'cédula', 'cédulas')} por verificar.`);
      if (descartadas > 0) {
        partes.push(`${plural(descartadas, 'fila no se pudo leer', 'filas no se pudieron leer')}.`);
      }
      if (fallos > 0) partes.push(`${plural(fallos, 'pantallazo falló', 'pantallazos fallaron')}: ${ultimoError}`);
      showToast({ type: fallos > 0 ? 'error' : 'success', message: partes.join(' ') });
    },
    [fecha, cargar, showToast],
  );

  // Ctrl+V en cualquier parte de la vista. Si lo pegado no es una imagen se
  // deja pasar: puede ser texto que se está pegando en la búsqueda.
  useEffect(() => {
    function alPegar(e: ClipboardEvent) {
      const imagenes = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (imagenes.length === 0) return;
      e.preventDefault();
      void procesar(imagenes);
    }
    window.addEventListener('paste', alPegar);
    return () => window.removeEventListener('paste', alPegar);
  }, [procesar]);

  function soltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    const imagenes = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (imagenes.length > 0) void procesar(imagenes);
  }

  /**
   * Abre la ficha en MyBodytech. Pestaña con nombre y SIN `noopener`, a
   * propósito: así todas las fichas caen en la misma pestaña de MyBodytech al
   * lado, en vez de abrir una nueva por cada clic — con `noopener` el
   * navegador no puede reusar una pestaña por su nombre. MyBodytech es el
   * software de Bodytech, no un sitio de terceros.
   */
  function abrir(c: CitaDigitalizada) {
    window.open(c.urlMyBodytech, 'mybodytech');
    if (c.revisadoEn) return;
    const yo = authService.getUser()?.email ?? null;
    const ahora = new Date().toISOString();
    setCitas((cs) => cs.map((x) => (x.id === c.id ? { ...x, revisadoEn: ahora, revisadoPor: yo } : x)));
    digitalizarService.marcarRevisada(c.id).catch(() => cargar());
  }

  /** Guardar sin cambios también sirve: confirma que lo leído está bien. */
  async function guardarEdicion() {
    if (!edicion) return;
    const original = citas.find((c) => c.id === edicion.id);
    if (!original) return;
    const cambios: CambiosCita = {};
    if (edicion.numeroId.trim() !== original.numeroId) cambios.numeroId = edicion.numeroId.trim();
    if (edicion.nombre.trim() !== original.nombre) cambios.nombre = edicion.nombre.trim();
    if (edicion.telefono.trim() !== (original.telefono ?? '')) cambios.telefono = edicion.telefono.trim() || null;
    if (Object.keys(cambios).length === 0) {
      if (original.dudas.length === 0) {
        setEdicion(null);
        return;
      }
      cambios.confirmar = true;
    }
    try {
      await digitalizarService.editar(edicion.id, cambios);
      setEdicion(null);
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function quitar(c: CitaDigitalizada) {
    if (!window.confirm(`¿Quitar a ${c.nombre} de la lista?`)) return;
    try {
      await digitalizarService.eliminar(c.id);
      setCitas((cs) => cs.filter((x) => x.id !== c.id));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return citas.filter((c) => {
      if (filtro === 'sinRevisar' && c.revisadoEn) return false;
      if (filtro === 'revisadas' && !c.revisadoEn) return false;
      if (filtro === 'dudosas' && !c.dudas.includes('numeroId')) return false;
      if (!q) return true;
      return c.nombre.toLowerCase().includes(q) || c.numeroId.includes(q);
    });
  }, [citas, filtro, busqueda]);

  const revisadas = citas.filter((c) => c.revisadoEn).length;
  const dudosas = citas.filter((c) => c.dudas.includes('numeroId')).length;
  const repetidas = citas.filter((c) => c.vecesAntes > 0).length;

  const filtros: Array<[Filtro, string]> = [
    ['todas', `Todas · ${citas.length}`],
    ['sinRevisar', `Sin revisar · ${citas.length - revisadas}`],
    ['revisadas', `Revisadas · ${revisadas}`],
  ];
  if (dudosas > 0 || filtro === 'dudosas') filtros.push(['dudosas', `Cédula por verificar · ${dudosas}`]);

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <ScanText className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Digitalizar citas de MyBodytech</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={`w-[13px] h-[13px] ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={() => inputArchivo.current?.click()}
            disabled={progreso !== null}
            className={`${CTA_PRIMARY} disabled:opacity-60`}
            style={{ background: '#1f3a8a' }}
          >
            <ImagePlus className="w-[14px] h-[14px]" />
            Subir pantallazo
          </button>
          <input
            ref={inputArchivo}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) void procesar(files);
            }}
          />
        </div>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-5 max-w-[74ch] leading-relaxed">
        Toma un pantallazo de «Citas asignadas» en MyBodytech y pégalo acá con Ctrl+V. La plataforma
        lee cada afiliado; con un clic en la fila se abre su ficha en MyBodytech, en una pestaña al
        lado, para revisar si está activo.
      </div>

      {/* Zona para pegar / soltar */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={soltar}
        className={`mb-5 rounded-lg border-2 border-dashed flex items-center justify-center gap-3 text-center transition-colors ${
          citas.length === 0 && !cargando ? 'py-14' : 'py-5'
        } ${arrastrando ? 'border-[#1f3a8a] bg-[#eef2ff]' : 'border-zinc-300 bg-white'}`}
      >
        {progreso ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-700">
            <Loader2 className="w-4 h-4 animate-spin text-[#1f3a8a]" />
            Leyendo pantallazo{progreso.total > 1 && ` ${progreso.actual} de ${progreso.total}`}…
            <span className="text-zinc-400">(unos 20 segundos cada uno)</span>
          </div>
        ) : (
          <>
            <ClipboardPaste className="w-5 h-5 text-zinc-400 shrink-0" />
            <div className="text-left">
              <div className="text-[13px] font-medium text-zinc-700">
                Pega el pantallazo (Ctrl+V) o arrástralo aquí
              </div>
              <div className="text-[11.5px] text-zinc-400">
                Se cargan en el día {ddmm(fecha)}. Puedes pegar varios: el mismo afiliado no se repite.
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={SECTION_LABEL}>Día</span>
        <input
          type="date"
          aria-label="Día"
          value={fecha}
          onChange={(e) => e.target.value && setFecha(e.target.value)}
          className="h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] bg-white text-zinc-800"
        />
        {fecha !== hoyISO() && (
          <button
            onClick={() => setFecha(hoyISO())}
            className="h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-50"
          >
            Hoy
          </button>
        )}
        <div className="flex items-center rounded-md border border-zinc-300 overflow-hidden ml-2">
          {filtros.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`h-[28px] px-2.5 text-[12px] border-r border-zinc-300 last:border-r-0 ${
                filtro === k
                  ? 'bg-[#eef2ff] text-[#1e3a8a] font-medium'
                  : k === 'dudosas'
                    ? 'bg-white text-amber-700 hover:bg-amber-50'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {repetidas > 0 && (
          <span className="text-[12px] text-zinc-500 ml-1">{plural(repetidas, 'repetida', 'repetidas')}</span>
        )}
        <div className="relative ml-auto">
          <Search className="w-[13px] h-[13px] text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar nombre o cédula"
            className="h-[30px] w-56 pl-8 pr-3 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-[12.5px] text-red-800">
          {error}
        </div>
      )}

      <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {['Hora', 'Afiliado', 'Teléfono', 'Sede', 'Modalidad', 'Estado', 'Revisada', ''].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-left whitespace-nowrap ${SECTION_LABEL}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && !cargando && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">
                  {citas.length === 0
                    ? `Todavía no hay afiliados cargados el ${ddmm(fecha)}. Pega un pantallazo para empezar.`
                    : 'Ningún afiliado coincide con el filtro.'}
                </td>
              </tr>
            )}
            {visibles.map((c) => {
              const editando = edicion?.id === c.id;
              const dudaDoc = c.dudas.includes('numeroId');
              const dudaTel = c.dudas.includes('telefono');
              const lecturasDoc = [c.numeroId, ...(c.alternativas.numeroId ?? [])];
              return (
                <tr
                  key={c.id}
                  onClick={editando ? undefined : () => abrir(c)}
                  title={editando ? undefined : 'Abrir la ficha en MyBodytech'}
                  className={`border-b border-zinc-100 last:border-0 align-top ${
                    editando ? 'bg-[#eef2ff]/40' : 'cursor-pointer hover:bg-zinc-50/60'
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-700 tabular-nums" style={{ fontFamily: FONT_MONO }}>
                    {c.hora ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {editando ? (
                      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={edicion.nombre}
                          onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                          aria-label="Nombre"
                          className={INPUT}
                        />
                        <input
                          value={edicion.numeroId}
                          onChange={(e) => setEdicion({ ...edicion, numeroId: e.target.value })}
                          aria-label="Cédula"
                          className={`${INPUT} w-36`}
                          style={{ fontFamily: FONT_MONO }}
                        />
                        {lecturasDoc.length > 1 && (
                          <div className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                            Lecturas:
                            {lecturasDoc.map((l) => (
                              <button
                                key={l}
                                type="button"
                                onClick={() => setEdicion({ ...edicion, numeroId: l })}
                                className={`px-1.5 py-0.5 rounded border ${
                                  edicion.numeroId === l
                                    ? 'border-[#1f3a8a] bg-[#eef2ff] text-[#1e3a8a]'
                                    : 'border-zinc-300 bg-white hover:bg-zinc-50'
                                }`}
                                style={{ fontFamily: FONT_MONO }}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={c.revisadoEn ? 'text-zinc-600' : 'text-zinc-900 font-medium'}>
                            {c.nombre}
                          </span>
                          {dudaDoc && (
                            <span title="Las dos lecturas del pantallazo no coincidieron. Compárala con el pantallazo y corrígela con el lápiz antes de abrir la ficha.">
                              <Pill variant="warn">Verificar cédula</Pill>
                            </span>
                          )}
                          {c.vecesAntes > 0 && (
                            <span
                              title={`Ya salió ${plural(c.vecesAntes, 'día', 'días')} antes${
                                c.ultimaVezAntes ? ` — la última vez el ${ddmm(c.ultimaVezAntes)}` : ''
                              }`}
                            >
                              <Pill variant="mute">Repetida</Pill>
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-zinc-500" style={{ fontFamily: FONT_MONO }}>
                          <span className={dudaDoc ? 'text-amber-700' : ''}>CC {c.numeroId}</span>
                          {dudaDoc && c.alternativas.numeroId && (
                            <span className="text-amber-700"> · o {c.alternativas.numeroId.join(' · ')}</span>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                    {editando ? (
                      <input
                        value={edicion.telefono}
                        onChange={(e) => setEdicion({ ...edicion, telefono: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Teléfono"
                        className={`${INPUT} w-32`}
                        style={{ fontFamily: FONT_MONO }}
                      />
                    ) : c.telefono ? (
                      <span
                        className={dudaTel ? 'text-amber-700' : ''}
                        title={
                          dudaTel
                            ? `Verifica el teléfono${
                                c.alternativas.telefono ? ` — también se leyó ${c.alternativas.telefono.join(', ')}` : ''
                              }`
                            : undefined
                        }
                      >
                        {c.telefono}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 whitespace-nowrap">{c.sedeMbt ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-600 capitalize">{c.modalidad ?? '—'}</td>
                  <td className="px-3 py-2">
                    {c.estadoMbt?.toLowerCase().startsWith('finaliz') ? (
                      <Pill variant="ok">Finalizado</Pill>
                    ) : (
                      <Pill variant="mute">Por atender</Pill>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] whitespace-nowrap">
                    {c.revisadoEn ? (
                      <span
                        className="inline-flex items-center gap-1 text-green-700"
                        title={c.revisadoPor ? `Revisada por ${c.revisadoPor}` : undefined}
                      >
                        <Check className="w-[13px] h-[13px]" />
                        {horaDe(c.revisadoEn)}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {editando ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={guardarEdicion}
                          className="h-[26px] px-2.5 rounded-md text-[11.5px] font-medium text-white"
                          style={{ background: '#1f3a8a' }}
                        >
                          {c.dudas.length > 0 ? 'Confirmar' : 'Guardar'}
                        </button>
                        <button
                          onClick={() => setEdicion(null)}
                          className="h-[26px] px-2 text-[11.5px] text-zinc-500 hover:text-zinc-800"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={() => abrir(c)}
                          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 mr-1 border border-zinc-300 rounded-md text-[11.5px] text-zinc-700 hover:bg-zinc-50"
                        >
                          <ExternalLink className="w-[12px] h-[12px]" />
                          MyBodytech
                        </button>
                        <button
                          onClick={() =>
                            setEdicion({
                              id: c.id,
                              numeroId: c.numeroId,
                              nombre: c.nombre,
                              telefono: c.telefono ?? '',
                            })
                          }
                          title={dudaDoc ? 'Verificar la cédula' : 'Corregir lo que se leyó mal'}
                          aria-label={`Corregir ${c.nombre}`}
                          className={`p-1 rounded hover:bg-zinc-100 ${
                            dudaDoc ? 'text-amber-600 hover:text-amber-800' : 'text-zinc-400 hover:text-zinc-800'
                          }`}
                        >
                          <Pencil className="w-[13px] h-[13px]" />
                        </button>
                        <button
                          onClick={() => quitar(c)}
                          title="Quitar de la lista"
                          aria-label={`Quitar ${c.nombre}`}
                          className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <X className="w-[14px] h-[14px]" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-zinc-400 mt-3 max-w-[74ch] leading-relaxed">
        Cada pantallazo se lee dos veces y se comparan las lecturas. «Verificar cédula» quiere decir que
        no coincidieron: compárala con el pantallazo y corrígela o confírmala con el lápiz antes de abrir
        la ficha — con un dígito cambiado se abre la de otra persona. «Repetida» quiere decir que esa
        cédula ya se había cargado otro día.
      </p>
    </div>
  );
}

const INPUT =
  'h-[28px] px-2 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]';
