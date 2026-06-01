import { useState, useEffect, useRef } from 'react';
import { X, Upload, Trash2 } from 'lucide-react';
import profesionalesService, {
  Profesional,
  ProfesionalInput,
  Rol,
} from '../../services/profesionales.service';

// Tamaño máximo de la firma en bytes (base64 ya codificado pesa ~33% más
// que el archivo original, así que limitamos el archivo crudo a ~1.5 MB
// para quedar bajo 2 MB en base64).
const MAX_FIRMA_BYTES = 1.5 * 1024 * 1024;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (p: Profesional) => void;
  // Si llega `editing`, el modal está en modo edición.
  editing: Profesional | null;
  onError: (message: string) => void;
}

const EMPTY: ProfesionalInput = {
  rol: 'medico',
  codigo: '',
  primerNombre: '',
  segundoNombre: null,
  primerApellido: '',
  segundoApellido: null,
  alias: null,
  especialidad: null,
  numeroLicencia: null,
  tipoLicencia: null,
  fechaVencimientoLicencia: null,
  tiempoConsulta: 30,
  firma: null,
  email: null,
  celular: null,
};

export function ProfesionalFormModal({ isOpen, onClose, onSaved, editing, onError }: Props) {
  const [form, setForm] = useState<ProfesionalInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setForm({
        rol: editing.rol,
        codigo: editing.codigo,
        primerNombre: editing.primerNombre,
        segundoNombre: editing.segundoNombre,
        primerApellido: editing.primerApellido,
        segundoApellido: editing.segundoApellido,
        alias: editing.alias,
        especialidad: editing.especialidad,
        numeroLicencia: editing.numeroLicencia,
        tipoLicencia: editing.tipoLicencia,
        fechaVencimientoLicencia: editing.fechaVencimientoLicencia,
        tiempoConsulta: editing.tiempoConsulta,
        firma: editing.firma,
        email: editing.email,
        celular: editing.celular,
      });
    } else {
      setForm(EMPTY);
    }
  }, [editing, isOpen]);

  async function handleFirmaUpload(file: File) {
    if (file.size > MAX_FIRMA_BYTES) {
      onError(
        `La firma pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Máximo permitido: 1.5 MB.`
      );
      return;
    }
    if (!file.type.startsWith('image/')) {
      onError('La firma debe ser una imagen (PNG, JPG, SVG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        update('firma', result);
      }
    };
    reader.onerror = () => {
      onError('No se pudo leer el archivo.');
    };
    reader.readAsDataURL(file);
  }

  if (!isOpen) return null;

  function update<K extends keyof ProfesionalInput>(key: K, value: ProfesionalInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.codigo.trim() || !form.primerNombre.trim() || !form.primerApellido.trim()) {
      onError('Código, primer nombre y primer apellido son obligatorios.');
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await profesionalesService.update(editing.id, form)
        : await profesionalesService.create(form);
      onSaved(saved);
      onClose();
    } catch (err: unknown) {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.error?.message ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.message ||
        'Error guardando profesional.';
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-800">
            {editing ? 'Editar profesional' : 'Nuevo profesional'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Rol + Código */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Rol *</label>
              <select
                value={form.rol}
                onChange={(e) => update('rol', e.target.value as Rol)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="medico">Médico</option>
                <option value="coach">Coach</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Código * <span className="text-gray-400">(único por sede)</span>
              </label>
              <input
                type="text"
                value={form.codigo}
                onChange={(e) => update('codigo', e.target.value.toUpperCase())}
                placeholder="MED-MG-001"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!!editing}
              />
              {editing && (
                <p className="text-xs text-gray-400 mt-1">El código no se puede cambiar.</p>
              )}
            </div>
          </div>

          {/* Nombres */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Primer nombre *</label>
              <input
                type="text"
                value={form.primerNombre}
                onChange={(e) => update('primerNombre', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Segundo nombre</label>
              <input
                type="text"
                value={form.segundoNombre ?? ''}
                onChange={(e) => update('segundoNombre', e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Apellidos */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Primer apellido *</label>
              <input
                type="text"
                value={form.primerApellido}
                onChange={(e) => update('primerApellido', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Segundo apellido</label>
              <input
                type="text"
                value={form.segundoApellido ?? ''}
                onChange={(e) => update('segundoApellido', e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Alias y especialidad */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Alias <span className="text-gray-400">(se muestra a afiliados)</span>
              </label>
              <input
                type="text"
                value={form.alias ?? ''}
                onChange={(e) => update('alias', e.target.value || null)}
                placeholder="Dr. Juan Pérez"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Especialidad</label>
              <input
                type="text"
                value={form.especialidad ?? ''}
                onChange={(e) => update('especialidad', e.target.value || null)}
                placeholder="Medicina general"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Licencia */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Número licencia</label>
              <input
                type="text"
                value={form.numeroLicencia ?? ''}
                onChange={(e) => update('numeroLicencia', e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Tipo licencia</label>
              <input
                type="text"
                value={form.tipoLicencia ?? ''}
                onChange={(e) => update('tipoLicencia', e.target.value || null)}
                placeholder="Profesional"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Vencimiento</label>
              <input
                type="date"
                value={form.fechaVencimientoLicencia ?? ''}
                onChange={(e) => update('fechaVencimientoLicencia', e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Tiempo consulta + contacto */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Tiempo consulta (min) *
              </label>
              <input
                type="number"
                min={5}
                max={240}
                value={form.tiempoConsulta ?? 30}
                onChange={(e) => update('tiempoConsulta', parseInt(e.target.value, 10) || 30)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email ?? ''}
                onChange={(e) => update('email', e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Celular</label>
              <input
                type="tel"
                value={form.celular ?? ''}
                onChange={(e) => update('celular', e.target.value || null)}
                placeholder="+573001234567"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Firma */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Firma <span className="text-gray-400">(PNG, JPG o SVG · máx 1.5 MB)</span>
            </label>
            {form.firma ? (
              <div className="flex items-start gap-3 border border-gray-200 rounded-lg p-3">
                <img
                  src={form.firma}
                  alt="Firma"
                  className="h-20 w-auto max-w-[200px] object-contain border border-gray-100 rounded bg-white"
                />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1.5 border border-blue-200"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Reemplazar
                  </button>
                  <button
                    type="button"
                    onClick={() => update('firma', null)}
                    className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5 border border-red-200"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Quitar firma
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-6 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:border-blue-300 flex flex-col items-center gap-2 transition-colors"
              >
                <Upload className="w-5 h-5 text-gray-400" />
                <span>Click para subir firma</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFirmaUpload(file);
                // Reset input para permitir re-subir el mismo archivo
                if (e.target) e.target.value = '';
              }}
            />
          </div>

          <div className="flex gap-3 justify-end pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
