import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import dispositivoService, { type DispositivoVinculado } from '../services/dispositivo.service';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Vincula el asistente de escritorio de la consulta presencial: la placa
 * muestra un código de 8 caracteres y el médico lo escribe acá. Desde ese
 * momento la placa abre las consultas de HOY de este médico, a su nombre.
 * También lista los dispositivos vinculados para poder desvincularlos.
 */
export function VincularDispositivoModal({ isOpen, onClose }: Props) {
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [mios, setMios] = useState<DispositivoVinculado[]>([]);

  const cargar = () => {
    dispositivoService.mios().then(setMios).catch(() => setMios([]));
  };

  useEffect(() => {
    if (!isOpen) return;
    setCodigo('');
    setError(null);
    setListo(false);
    cargar();
  }, [isOpen]);

  if (!isOpen) return null;

  // Se escribe como se ve en la pantalla de la placa: "K7P4-QM2X".
  const limpio = codigo.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  const mostrado = limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;

  async function vincular() {
    setEnviando(true);
    setError(null);
    try {
      await dispositivoService.vincular(limpio);
      setListo(true);
      setCodigo('');
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function desvincular(id: number) {
    if (!window.confirm('¿Desvincular este dispositivo? Dejará de abrir consultas a su nombre.')) return;
    try {
      await dispositivoService.desvincular(id);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Vincular dispositivo</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Escriba el código que muestra la pantalla del asistente de consulta. Desde ese momento el
            dispositivo abre a su nombre las consultas que usted tiene agendadas hoy.
          </p>
          <input
            value={mostrado}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && limpio.length === 8 && !enviando && vincular()}
            placeholder="K7P4-QM2X"
            autoFocus
            className="w-full text-center text-2xl font-mono tracking-widest border border-gray-300 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {listo && <p className="text-sm text-green-700">Listo: el dispositivo ya quedó vinculado.</p>}
          <button
            onClick={vincular}
            disabled={limpio.length !== 8 || enviando}
            className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800 disabled:opacity-40"
          >
            {enviando ? 'Vinculando…' : 'Vincular'}
          </button>

          {mios.length > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Sus dispositivos</h3>
              <ul className="space-y-2">
                {mios.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {d.nombre}
                      <span className="block text-xs text-gray-400">
                        {d.ultimo_uso_en
                          ? `Último uso: ${new Date(d.ultimo_uso_en).toLocaleString('es-CO')}`
                          : `Vinculado: ${new Date(d.creado_en).toLocaleString('es-CO')}`}
                      </span>
                    </span>
                    <button onClick={() => desvincular(d.id)} className="text-red-600 hover:underline">
                      Desvincular
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
