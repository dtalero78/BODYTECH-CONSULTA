import { useMemo, useState } from 'react';
import { User, MapPin, FileText } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField } from '../fields';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

interface DatosBasicosTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

const GENERO_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Masculino', label: 'Masculino' },
  { value: 'Femenino', label: 'Femenino' },
  { value: 'Indeterminado', label: 'Indeterminado' },
];

const IDENTIDAD_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Cisgénero', label: 'Cisgénero' },
  { value: 'Transgénero', label: 'Transgénero' },
  { value: 'No binario', label: 'No binario' },
  { value: 'Otro', label: 'Otro' },
  { value: 'Prefiere no responder', label: 'Prefiere no responder' },
];

const GRUPO_SANGUINEO_OPTS: ReadonlyArray<DropdownOption> = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
].map((v) => ({ value: v, label: v }));

const COMUNIDAD_ETNICA_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Ninguna', label: 'Ninguna' },
  { value: 'Indígena', label: 'Indígena' },
  { value: 'Afrodescendiente', label: 'Afrodescendiente' },
  { value: 'Raizal', label: 'Raizal' },
  { value: 'Palenquero', label: 'Palenquero' },
  { value: 'ROM (gitano)', label: 'ROM (gitano)' },
];

const PERTENENCIA_ETNICA_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Sin pertenencia', label: 'Sin pertenencia' },
  { value: 'Comunidad indígena específica', label: 'Comunidad indígena específica' },
  { value: 'Comunidad afro específica', label: 'Comunidad afro específica' },
  { value: 'Otro', label: 'Otro' },
];

const ESTADO_CIVIL_OPTS: ReadonlyArray<DropdownOption> = [
  'Soltero(a)',
  'Casado(a)',
  'Unión libre',
  'Divorciado(a)',
  'Viudo(a)',
].map((v) => ({ value: v, label: v }));

const PAIS_OPTS: ReadonlyArray<DropdownOption> = [
  'Colombia',
  'Argentina',
  'Brasil',
  'Chile',
  'Ecuador',
  'España',
  'Estados Unidos',
  'México',
  'Panamá',
  'Perú',
  'Venezuela',
  'Otro',
].map((v) => ({ value: v, label: v }));

const MUNICIPIO_OPTS: ReadonlyArray<DropdownOption> = [
  'Bogotá D.C.',
  'Medellín',
  'Cali',
  'Barranquilla',
  'Cartagena',
  'Bucaramanga',
  'Cúcuta',
  'Pereira',
  'Manizales',
  'Ibagué',
  'Santa Marta',
  'Villavicencio',
  'Pasto',
  'Armenia',
  'Neiva',
  'Popayán',
  'Tunja',
  'Florencia',
  'Riohacha',
  'Sincelejo',
  'Yopal',
  'Quibdó',
  'Mocoa',
  'San José del Guaviare',
  'San Andrés',
  'Inírida',
  'Mitú',
  'Puerto Carreño',
  'Leticia',
  'Arauca',
  'Soledad',
  'Soacha',
  'Otro',
].map((v) => ({ value: v, label: v }));

const ZONA_TERRITORIAL_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Urbana', label: 'Urbana' },
  { value: 'Rural', label: 'Rural' },
  { value: 'Dispersa', label: 'Dispersa' },
];

const PARENTESCO_OPTS: ReadonlyArray<DropdownOption> = [
  'Padre',
  'Madre',
  'Hijo(a)',
  'Cónyuge',
  'Hermano(a)',
  'Otro',
].map((v) => ({ value: v, label: v }));

const EPS_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Sura', label: 'Sura' },
  { value: 'Sanitas', label: 'Sanitas' },
  { value: 'Nueva EPS', label: 'Nueva EPS' },
  { value: 'Compensar', label: 'Compensar' },
  { value: 'Famisanar', label: 'Famisanar' },
  { value: 'Salud Total', label: 'Salud Total' },
  { value: 'Coomeva', label: 'Coomeva' },
  { value: 'Cafesalud', label: 'Cafesalud' },
  { value: 'Particular', label: 'Particular' },
];

const TIPO_VINCULACION_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Contributivo', label: 'Contributivo' },
  { value: 'Subsidiado', label: 'Subsidiado' },
  { value: 'Especial', label: 'Especial' },
  { value: 'No asegurado', label: 'No asegurado' },
];

const CATEGORIA_DISCAPACIDAD_OPTS: ReadonlyArray<DropdownOption> = [
  { value: 'Sin discapacidad', label: 'Sin discapacidad' },
  { value: 'Física', label: 'Física' },
  { value: 'Sensorial', label: 'Sensorial' },
  { value: 'Mental', label: 'Mental' },
  { value: 'Cognitiva', label: 'Cognitiva' },
  { value: 'Múltiple', label: 'Múltiple' },
];

type ModalKey = 'identidad' | 'residencia' | 'info-basica' | null;

function calculateAge(fechaNacimiento: string | Date | null | undefined): number | null {
  if (!fechaNacimiento) return null;
  const d = new Date(fechaNacimiento as string);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function countFilled(values: ReadonlyArray<unknown>): number {
  return values.filter((v) => v !== null && v !== undefined && v !== '').length;
}

export function DatosBasicosTab({ historiaId, data, isMaxed, onPatchLocal }: DatosBasicosTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const identidadVals = [
    data?.generoBiologico,
    data?.identidadGenero,
    data?.grupoSanguineo,
    data?.fechaNacimiento,
    data?.comunidadEtnica,
    data?.pertenenciaEtnica,
    data?.estadoCivil,
  ];
  const residenciaVals = [
    data?.paisResidencia,
    data?.municipio,
    data?.zonaTerritorial,
    data?.telefonoResidencia,
    data?.contactoEmergenciaNombre,
    data?.contactoEmergenciaTelefono,
    data?.contactoEmergenciaParentesco,
  ];
  const infoBasicaVals = [
    data?.ocupacion,
    data?.eps,
    data?.tipoVinculacion,
    data?.entidadTerritorial,
    data?.categoriaDiscapacidad,
  ];

  const fechaNac = data?.fechaNacimiento as string | Date | null | undefined;
  const age = calculateAge(fechaNac ?? null);
  const fechaError = useMemo(() => {
    if (!fechaNac) return undefined;
    if (age === null) return 'Fecha inválida';
    if (age < 18) return 'El afiliado debe tener al menos 18 años';
    return undefined;
  }, [fechaNac, age]);

  const identidadFilled = countFilled(identidadVals);
  const residenciaFilled = countFilled(residenciaVals);
  const infoBasicaFilled = countFilled(infoBasicaVals);

  const identidadState =
    identidadFilled === 0 ? 'empty' : identidadFilled === identidadVals.length ? 'complete' : 'partial';
  const residenciaState =
    residenciaFilled === 0 ? 'empty' : residenciaFilled === residenciaVals.length ? 'complete' : 'partial';
  const infoState =
    infoBasicaFilled === 0 ? 'empty' : infoBasicaFilled === infoBasicaVals.length ? 'complete' : 'partial';

  const identidadSubtitle =
    identidadFilled === 0
      ? 'Sin información'
      : identidadState === 'complete'
        ? `${data?.generoBiologico || '—'} · ${data?.grupoSanguineo || '—'}${age ? ` · ${age} años` : ''}`
        : `${identidadFilled} de ${identidadVals.length} campos completos`;

  const residenciaSubtitle =
    residenciaFilled === 0
      ? 'Sin información'
      : residenciaState === 'complete'
        ? `${data?.paisResidencia || '—'} · ${data?.municipio || '—'} · ${data?.zonaTerritorial || '—'}`
        : `${residenciaFilled} de ${residenciaVals.length} campos completos`;

  const infoSubtitle =
    infoBasicaFilled === 0
      ? 'Sin información'
      : infoState === 'complete'
        ? `${data?.eps || '—'} · ${data?.tipoVinculacion || '—'}`
        : `${infoBasicaFilled} de ${infoBasicaVals.length} campos completos`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<User size={16} />}
        title="Identidad"
        subtitle={identidadSubtitle}
        state={identidadState}
        completionPct={Math.round((identidadFilled / identidadVals.length) * 100)}
        onEdit={() => setOpenModal('identidad')}
      />

      <Card
        icon={<MapPin size={16} />}
        title="Datos de Residencia"
        subtitle={residenciaSubtitle}
        state={residenciaState}
        completionPct={Math.round((residenciaFilled / residenciaVals.length) * 100)}
        onEdit={() => setOpenModal('residencia')}
      />

      <Card
        icon={<FileText size={16} />}
        title="Información Básica"
        subtitle={infoSubtitle}
        state={infoState}
        span2
        completionPct={Math.round((infoBasicaFilled / infoBasicaVals.length) * 100)}
        onEdit={() => setOpenModal('info-basica')}
      />

      <Modal
        open={openModal === 'identidad'}
        onClose={() => setOpenModal(null)}
        crumb="Datos Básicos · Identidad"
        title="Identidad del afiliado"
        icon={<User size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="genero_biologico"
            initialValue={data?.generoBiologico}
            onSaved={onPatchLocal}
            label="Género Biológico"
            options={GENERO_OPTS}
            placeholder="Seleccionar..."
          />
          <SelectField
            historiaId={historiaId}
            field="identidad_genero"
            initialValue={data?.identidadGenero}
            onSaved={onPatchLocal}
            label="Identidad de Género"
            options={IDENTIDAD_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="grupo_sanguineo"
            initialValue={data?.grupoSanguineo}
            onSaved={onPatchLocal}
            label="Grupo Sanguíneo"
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
            label="Fecha de Nacimiento"
            type="date"
            error={fechaError}
          />
          <SelectField
            historiaId={historiaId}
            field="comunidad_etnica"
            initialValue={data?.comunidadEtnica}
            onSaved={onPatchLocal}
            label="Comunidad Étnica"
            options={COMUNIDAD_ETNICA_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="pertenencia_etnica"
            initialValue={data?.pertenenciaEtnica}
            onSaved={onPatchLocal}
            label="Pertenencia Étnica"
            options={PERTENENCIA_ETNICA_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="estado_civil"
            initialValue={data?.estadoCivil}
            onSaved={onPatchLocal}
            label="Estado Civil"
            options={ESTADO_CIVIL_OPTS}
          />
          {age !== null && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Edad calculada
              </label>
              <div className="w-full bg-[#1a2530] border border-[#324049] text-[#a4b1b9] px-3.5 py-2.5 rounded-xl text-[13.5px]">
                {age} años
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={openModal === 'residencia'}
        onClose={() => setOpenModal(null)}
        crumb="Datos Básicos · Residencia"
        title="Datos de Residencia"
        icon={<MapPin size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="pais_residencia"
            initialValue={data?.paisResidencia}
            onSaved={onPatchLocal}
            label="País"
            options={PAIS_OPTS}
            searchable
          />
          <SelectField
            historiaId={historiaId}
            field="municipio"
            initialValue={data?.municipio}
            onSaved={onPatchLocal}
            label="Municipio"
            options={MUNICIPIO_OPTS}
            searchable
            placeholder="Buscar municipio..."
          />
          <SelectField
            historiaId={historiaId}
            field="zona_territorial"
            initialValue={data?.zonaTerritorial}
            onSaved={onPatchLocal}
            label="Zona Territorial"
            options={ZONA_TERRITORIAL_OPTS}
          />
          <TextField
            historiaId={historiaId}
            field="telefono_residencia"
            initialValue={data?.telefonoResidencia}
            onSaved={onPatchLocal}
            label="Teléfono Residencia"
            type="tel"
            placeholder="+57 ..."
          />
        </div>

        <div className="mt-5 pt-4 border-t border-dashed border-[#324049]">
          <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-2.5">
            Contacto de emergencia
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <TextField
              historiaId={historiaId}
              field="contacto_emergencia_nombre"
              initialValue={data?.contactoEmergenciaNombre}
              onSaved={onPatchLocal}
              label="Nombre"
              placeholder="Nombre completo"
            />
            <TextField
              historiaId={historiaId}
              field="contacto_emergencia_telefono"
              initialValue={data?.contactoEmergenciaTelefono}
              onSaved={onPatchLocal}
              label="Teléfono"
              type="tel"
            />
            <SelectField
              historiaId={historiaId}
              field="contacto_emergencia_parentesco"
              initialValue={data?.contactoEmergenciaParentesco}
              onSaved={onPatchLocal}
              label="Parentesco"
              options={PARENTESCO_OPTS}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={openModal === 'info-basica'}
        onClose={() => setOpenModal(null)}
        crumb="Datos Básicos · Información Básica"
        title="Información Básica"
        icon={<FileText size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField
            historiaId={historiaId}
            field="ocupacion"
            initialValue={data?.ocupacion}
            onSaved={onPatchLocal}
            label="Ocupación"
            placeholder="Ej. Diseñadora industrial"
          />
          <SelectField
            historiaId={historiaId}
            field="eps"
            initialValue={data?.eps}
            onSaved={onPatchLocal}
            label="EPS"
            options={EPS_OPTS}
            searchable
            required
          />
          <SelectField
            historiaId={historiaId}
            field="tipo_vinculacion"
            initialValue={data?.tipoVinculacion}
            onSaved={onPatchLocal}
            label="Tipo de Vinculación"
            options={TIPO_VINCULACION_OPTS}
          />
          <TextField
            historiaId={historiaId}
            field="entidad_territorial"
            initialValue={data?.entidadTerritorial}
            onSaved={onPatchLocal}
            label="Entidad Territorial"
            placeholder="Bogotá D.C., Antioquia, ..."
          />
          <SelectField
            historiaId={historiaId}
            field="categoria_discapacidad"
            initialValue={data?.categoriaDiscapacidad}
            onSaved={onPatchLocal}
            label="Categoría de Discapacidad"
            options={CATEGORIA_DISCAPACIDAD_OPTS}
          />
        </div>
      </Modal>
    </div>
  );
}
