import { useState } from 'react';
import { Contact } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField, SelectField, PhoneField } from '../fields';
import { edadEfectiva } from '../edad';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';


interface CorpIdentificacionTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

const GRUPO_SANGUINEO_OPTS: ReadonlyArray<DropdownOption> = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
].map((v) => ({ value: v, label: v }));

// Mismas opciones que el panel de consulta estándar (t1 · Identidad), porque
// comparten la columna `genero_biologico`. Además de figurar en la plantilla,
// este campo decide si se muestran los antecedentes ginecobstétricos.
const SEXO_OPTS: ReadonlyArray<DropdownOption> = [
  'Femenino', 'Masculino', 'Indeterminado',
].map((v) => ({ value: v, label: v }));

const TIPO_CONSULTA_OPTS: ReadonlyArray<DropdownOption> = [
  'Primera vez',
  'Control',
].map((v) => ({ value: v, label: v }));

const EPS_OPTS: ReadonlyArray<DropdownOption> = [
  'Sura', 'Sanitas', 'Nueva EPS', 'Compensar', 'Famisanar', 'Salud Total',
  'Coomeva', 'Cafesalud', 'Particular',
].map((v) => ({ value: v, label: v }));

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpIdentificacionTab({ historiaId, data, onPatchLocal }: CorpIdentificacionTabProps) {
  const [open, setOpen] = useState(false);

  const fechaNac = data?.fechaNacimiento as string | Date | null | undefined;
  // Si la ficha del afiliado ya trae la edad, se respeta; si no, se deriva de la
  // fecha de nacimiento que se diligencie aquí.
  const edadCalc = edadEfectiva(data);
  const vals = [
    data?.mcDireccion,
    data?.email,
    data?.generoBiologico,
    data?.grupoSanguineo,
    data?.ocupacion,
    data?.eps,
    fechaNac,
    data?.telefonoResidencia,
  ];
  const filled = vals.filter(isFilled).length;
  const state = filled === 0 ? 'empty' : filled === vals.length ? 'complete' : 'partial';
  const subtitle =
    filled === 0
      ? 'Sin información'
      : state === 'complete'
        ? `${data?.eps || '—'} · RH ${data?.grupoSanguineo || '—'}`
        : `${filled} de ${vals.length} campos completos`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Contact size={16} />}
        title="Identificación"
        subtitle={subtitle}
        state={state}
        span2
        completionPct={Math.round((filled / vals.length) * 100)}
        onEdit={() => setOpen(true)}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        crumb="Identificación"
        title="Datos de identificación"
        icon={<Contact size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        {/* 3 columnas en pantallas anchas: los 8 campos caben sin scroll */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          <div className="md:col-span-2 xl:col-span-3">
            <TextField
              historiaId={historiaId}
              field="mc_direccion"
              initialValue={data?.mcDireccion}
              onSaved={onPatchLocal}
              label="Dirección"
              placeholder="Dirección de residencia"
            />
          </div>
          <TextField
            historiaId={historiaId}
            field="email"
            initialValue={data?.email}
            onSaved={onPatchLocal}
            label="Correo"
            type="email"
            placeholder="correo@ejemplo.com"
          />
          <SelectField
            historiaId={historiaId}
            field="genero_biologico"
            initialValue={data?.generoBiologico}
            onSaved={onPatchLocal}
            label="Sexo"
            options={SEXO_OPTS}
            placeholder="Seleccionar..."
            // Actualiza el cache local de inmediato para que los antecedentes
            // ginecobstétricos aparezcan sin esperar el debounce del auto-save.
            onChange={(val) => onPatchLocal('genero_biologico', val)}
          />
          <SelectField
            historiaId={historiaId}
            field="grupo_sanguineo"
            initialValue={data?.grupoSanguineo}
            onSaved={onPatchLocal}
            label="RH (grupo sanguíneo)"
            options={GRUPO_SANGUINEO_OPTS}
          />
          <TextField
            historiaId={historiaId}
            field="fecha_nacimiento"
            initialValue={
              fechaNac instanceof Date
                ? fechaNac.toISOString().split('T')[0]
                : typeof fechaNac === 'string' && fechaNac
                  ? fechaNac.split('T')[0]
                  : ''
            }
            onSaved={onPatchLocal}
            label="Fecha de nacimiento"
            type="date"
          />
          {/* Alimenta la FC predicha (Tanaka) del examen físico. */}
          <Calculated
            label="Edad"
            value={edadCalc ?? '—'}
            unit={edadCalc !== null ? 'años' : 'requiere fecha de nacimiento'}
          />
          <TextField
            historiaId={historiaId}
            field="ocupacion"
            initialValue={data?.ocupacion}
            onSaved={onPatchLocal}
            label="Ocupación"
            placeholder="Ej. Analista de nómina"
          />
          <SelectField
            historiaId={historiaId}
            field="eps"
            initialValue={data?.eps}
            onSaved={onPatchLocal}
            label="EPS"
            options={EPS_OPTS}
            searchable
          />
          <PhoneField
            historiaId={historiaId}
            field="telefono_residencia"
            initialValue={data?.telefonoResidencia}
            onSaved={onPatchLocal}
            label="Teléfono"
            dialCode="+57"
            placeholder="300 123 4567"
          />
          <SelectField
            historiaId={historiaId}
            field="tipo_consulta"
            initialValue={data?.tipoConsulta}
            onSaved={onPatchLocal}
            label="Tipo de consulta"
            options={TIPO_CONSULTA_OPTS}
            placeholder="Seleccionar..."
          />
        </div>
      </Modal>
    </div>
  );
}
