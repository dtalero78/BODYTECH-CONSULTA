import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import authService, { registroErrorMessage, type FichaRegistro } from '../services/auth.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

/**
 * Registro del profesional.
 *
 * ── Por qué vive acá y no en la app que crea la cuenta ──────────────────────
 * bodytech.app es la puerta única de las tres apps hermanas: es la URL que la
 * gente tiene guardada y a la que llega cuando no puede entrar. Una pantalla de
 * registro en otro dominio sería una que nadie encuentra.
 *
 * La CUENTA, en cambio, se crea en ACC (Composición Corporal): su tabla
 * `usuarios`, su JWT_SECRET, su rol `fisioterapeuta`. El backend de acá solo
 * reenvía. Cuando termina, se entra por el mismo handoff SSO que usa el login
 * para las apps hermanas.
 *
 * ── Por qué tres pasos y no un formulario ───────────────────────────────────
 * El paso de confirmación existe porque la cédula la teclea alguien parado en
 * una sede, muchas veces desde el celular: un dígito cambiado trae la ficha de
 * OTRA persona, y sin ver el nombre no hay forma de notarlo hasta que la cuenta
 * ya está creada con el nombre equivocado — firmando valoraciones.
 */

/** Lado del cuadrado al que se reduce la foto antes de mandarla. */
const LADO_FOTO = 512;

/**
 * Tope del JPEG resultante.
 *
 * La foto viaja como data URL DENTRO del JSON, y base64 infla ~33%. 90 KB de
 * imagen son ~120 KB de payload, que entra cómodo en el límite de 1 MB que el
 * backend le abre a esta ruta. El bucle de calidad de abajo baja la compresión
 * hasta llegar acá en vez de rechazar la foto: quien está registrándose no
 * tiene por qué saber recomprimir una imagen.
 */
const MAX_FOTO_BYTES = 90 * 1024;

type Paso = 'cedula' | 'confirmar' | 'datos';

export function RegistroPage() {
  const [paso, setPaso] = useState<Paso>('cedula');
  const [documento, setDocumento] = useState('');
  const [ficha, setFicha] = useState<FichaRegistro | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [foto, setFoto] = useState<string | null>(null);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = documento.replace(/[.\s-]/g, '');
    if (!limpio) {
      setError('Escribí tu número de cédula.');
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const encontrada = await authService.registroBuscar(limpio);
      setFicha(encontrada);
      setPaso('confirmar');
    } catch (err) {
      setError(registroErrorMessage(err));
    } finally {
      setCargando(false);
    }
  }

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Se limpia el input para que volver a elegir el MISMO archivo dispare el
    // change de nuevo (si no, el navegador lo considera "sin cambios").
    e.target.value = '';
    if (!archivo) return;

    setError(null);
    try {
      setFoto(await reducirAJpeg(archivo));
    } catch {
      setError(
        'No se pudo leer esa imagen. Si es una foto de iPhone en formato HEIC, ' +
        'compartila como JPG o sacala de nuevo desde acá.',
      );
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!ficha) return;

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== password2) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    if (!foto) {
      setError('Agregá una foto para tu perfil.');
      return;
    }

    setCargando(true);
    setError(null);
    try {
      const { token, redirectUrl } = await authService.registroCrear({
        documento: ficha.documento,
        email: email.trim(),
        password,
        foto,
      });
      // Mismo handoff que el login hacia una app hermana: el token viaja en el
      // FRAGMENTO, que no llega al servidor ni queda en los logs, y el /sso de
      // ACC lo consume y lo borra del historial.
      window.location.href = `${redirectUrl}#t=${encodeURIComponent(token)}`;
    } catch (err) {
      setError(registroErrorMessage(err));
      setCargando(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 text-zinc-900"
      style={{
        fontFamily: FONT_INTER,
        backgroundImage: 'radial-gradient(rgba(24,24,27,0.025) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 w-full max-w-sm p-8">
        <div className="mb-7 text-center">
          <img src="/logoNegro.png" alt="Bodytech" className="h-12 mx-auto mb-4 object-contain" />
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">Crear mi cuenta</h1>
          <p className="text-[13px] text-zinc-500 mt-1">
            {paso === 'cedula' && 'Programa de Composición Corporal'}
            {paso === 'confirmar' && 'Confirmá que estos datos son tuyos'}
            {paso === 'datos' && 'Con esto vas a entrar a la plataforma'}
          </p>
        </div>

        <Pasos actual={paso} />

        {/* ── Paso 1: la cédula ───────────────────────────────────────── */}
        {paso === 'cedula' && (
          <form onSubmit={buscar} className="space-y-4">
            <div>
              <Etiqueta>Número de cédula</Etiqueta>
              <input
                // `inputMode` numérico y no `type="number"`: en el celular abre
                // el teclado de números igual, pero sin las flechitas ni el
                // scroll que cambia el valor sin querer.
                type="text"
                inputMode="numeric"
                value={documento}
                onChange={(ev) => setDocumento(ev.target.value)}
                placeholder="1020304050"
                autoFocus
                autoComplete="off"
                className={CAMPO}
              />
              <p className="text-[12px] text-zinc-500 mt-1.5">
                La buscamos en el directorio de profesionales de Bodytech.
              </p>
            </div>

            {error && <Aviso>{error}</Aviso>}

            <button type="submit" disabled={cargando} className={BOTON}>
              {cargando ? 'Buscando…' : 'Continuar'}
            </button>

            <Link
              to="/login"
              className="block text-center text-[13px] text-zinc-500 hover:text-zinc-700"
            >
              Ya tengo cuenta
            </Link>
          </form>
        )}

        {/* ── Paso 2: la ficha del directorio ─────────────────────────── */}
        {paso === 'confirmar' && ficha && (
          <div className="space-y-4">
            <div className="border border-zinc-200 rounded-md divide-y divide-zinc-100">
              <Dato titulo="Nombre" valor={ficha.nombre} destacado />
              <Dato titulo="Cédula" valor={ficha.documento} />
              <Dato titulo="Cargo" valor={ficha.cargo} />
              <Dato
                titulo={ficha.sedes.length === 1 ? 'Sede' : 'Sedes'}
                valor={ficha.sedes.map((s) => s.nombre).join(' · ')}
              />
            </div>

            <p className="text-[12px] text-zinc-500">
              Si algo de esto no está bien, es lo que Recursos Humanos tiene registrado.
              Avisales antes de crear la cuenta.
            </p>

            <button type="button" onClick={() => setPaso('datos')} className={BOTON}>
              Sí, soy yo
            </button>

            <button
              type="button"
              onClick={() => {
                setFicha(null);
                setError(null);
                setPaso('cedula');
              }}
              className="w-full py-2.5 rounded-md text-[13px] font-medium text-zinc-600 border border-zinc-200 hover:bg-zinc-50 transition-colors"
            >
              No soy yo, cambiar la cédula
            </button>
          </div>
        )}

        {/* ── Paso 3: correo, contraseña y foto ───────────────────────── */}
        {paso === 'datos' && ficha && (
          <form onSubmit={crear} className="space-y-4">
            <div className="text-[12.5px] text-zinc-500 -mt-1">
              Creando la cuenta de <span className="font-medium text-zinc-800">{ficha.nombre}</span>.
            </div>

            <div>
              <Etiqueta>Correo</Etiqueta>
              <input
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="tu@correo.com"
                autoFocus
                autoComplete="email"
                className={CAMPO}
              />
              <p className="text-[12px] text-zinc-500 mt-1.5">Con este correo vas a entrar.</p>
            </div>

            <div>
              <Etiqueta>Contraseña</Etiqueta>
              <input
                type="password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                className={CAMPO}
              />
            </div>

            <div>
              <Etiqueta>Repetí la contraseña</Etiqueta>
              <input
                type="password"
                value={password2}
                onChange={(ev) => setPassword2(ev.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className={CAMPO}
              />
            </div>

            <div>
              <Etiqueta>Foto</Etiqueta>
              <div className="flex items-center gap-3">
                <span className="w-14 h-14 shrink-0 rounded-full overflow-hidden bg-zinc-100 border border-zinc-200 flex items-center justify-center">
                  {foto ? (
                    <img src={foto} alt="Tu foto" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[11px] text-zinc-400">Sin foto</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => inputFoto.current?.click()}
                  className="flex-1 py-2 rounded-md text-[13px] font-medium text-zinc-700 border border-zinc-200 hover:bg-zinc-50 transition-colors"
                >
                  {foto ? 'Cambiar la foto' : 'Tomar o elegir una foto'}
                </button>
              </div>
              {/*
                `capture="user"` abre la cámara frontal directo en el celular,
                que es donde va a pasar esto: el fisioterapeuta se registra en la
                sede, no sentado frente a un computador con fotos guardadas.
                En escritorio el atributo se ignora y abre el explorador.
              */}
              <input
                ref={inputFoto}
                type="file"
                accept="image/*"
                capture="user"
                onChange={elegirFoto}
                className="hidden"
              />
            </div>

            {error && <Aviso>{error}</Aviso>}

            <button type="submit" disabled={cargando} className={BOTON}>
              {cargando ? 'Creando la cuenta…' : 'Crear mi cuenta y entrar'}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setPaso('confirmar');
              }}
              className="block w-full text-center text-[13px] text-zinc-500 hover:text-zinc-700"
            >
              Volver
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Piezas de la pantalla ────────────────────────────────────────────────────

const CAMPO =
  'w-full px-3 py-2.5 border border-zinc-200 rounded-md text-[13px] focus:outline-none focus:border-[#1f3a8a] focus:ring-[3px] focus:ring-[rgba(31,58,138,0.15)]';

const BOTON =
  'w-full py-2.5 text-white rounded-md text-[13px] font-medium disabled:opacity-50 transition-colors bg-[#1f3a8a]';

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1.5">
      {children}
    </label>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
      {children}
    </p>
  );
}

function Dato({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-zinc-400">{titulo}</div>
      <div className={`${destacado ? 'text-[15px] font-semibold' : 'text-[13px]'} text-zinc-900 mt-0.5`}>
        {valor || '—'}
      </div>
    </div>
  );
}

/** Tres puntos que dicen en cuál de los pasos va. */
function Pasos({ actual }: { actual: Paso }) {
  const orden: Paso[] = ['cedula', 'confirmar', 'datos'];
  const i = orden.indexOf(actual);
  return (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {orden.map((p, n) => (
        <span
          key={p}
          className={`h-1.5 rounded-full transition-all ${
            n === i ? 'w-6 bg-[#1f3a8a]' : n < i ? 'w-1.5 bg-[#1f3a8a]' : 'w-1.5 bg-zinc-200'
          }`}
        />
      ))}
    </div>
  );
}

// ── Foto ─────────────────────────────────────────────────────────────────────

/**
 * Foto del celular → JPEG cuadrado de 512 px, como data URL.
 *
 * Se reduce en el NAVEGADOR y no en el servidor por tres razones concretas:
 *
 *   1. Una foto de celular moderna pesa 3-6 MB. Mandarla entera por una red de
 *      sede —que es donde va a pasar esto— tarda lo suficiente como para que la
 *      persona crea que se colgó y le dé al botón otra vez.
 *   2. Así la foto entra en un campo JSON y no hace falta multipart ni multer
 *      en el proxy: un camino menos que mantener en dos apps.
 *   3. El navegador ya sabe decodificar lo que sabe mostrar, HEIC de iPhone
 *      incluido en Safari. El canvas escupe JPEG, así que el problema de
 *      formatos se resuelve del lado del que sube.
 *
 * El recorte es cuadrado y centrado porque el destino es un avatar circular:
 * mandar la foto completa y recortarla al pintar deja la cara fuera del círculo
 * en las fotos verticales, que son todas las de celular.
 */
async function reducirAJpeg(archivo: File): Promise<string> {
  const bitmap = await cargarImagen(archivo);

  const lado = Math.min(bitmap.width, bitmap.height);
  const x = (bitmap.width - lado) / 2;
  const y = (bitmap.height - lado) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = LADO_FOTO;
  canvas.height = LADO_FOTO;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sin canvas');
  ctx.drawImage(bitmap, x, y, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);

  // Se baja la calidad hasta entrar en el tope en vez de rechazar la foto:
  // quien se está registrando no tiene por qué saber recomprimir una imagen.
  // A 512 px, 0.5 sigue viéndose bien en un avatar de 30 px.
  for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', calidad);
    if (bytesDeDataUrl(dataUrl) <= MAX_FOTO_BYTES) return dataUrl;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

/**
 * Decodifica el archivo. `createImageBitmap` respeta la orientación EXIF, que
 * es lo que evita que las fotos verticales de iPhone lleguen acostadas; el
 * `<img>` es el respaldo para navegadores que no lo tengan.
 */
async function cargarImagen(archivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch {
      // Cae al <img>.
    }
  }

  const url = URL.createObjectURL(archivo);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagen ilegible'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Cuánto pesa de verdad un data URL base64, sin el prefijo ni el relleno. */
function bytesDeDataUrl(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - relleno;
}
