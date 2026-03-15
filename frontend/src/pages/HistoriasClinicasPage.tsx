import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/api.service';

interface HistoriaClinicaItem {
  _id: string;
  numeroId: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  celular: string;
  email?: string;
  codEmpresa?: string;
  empresa?: string;
  cargo?: string;
  tipoExamen?: string;
  mdConceptoFinal?: string;
  mdDx1?: string;
  mdDx2?: string;
  mdAntecedentes?: string;
  mdObsParaMiDocYa?: string;
  mdObservacionesCertificado?: string;
  mdRecomendacionesMedicasAdicionales?: string;
  talla?: string;
  peso?: string;
  motivoConsulta?: string;
  diagnostico?: string;
  tratamiento?: string;
  fechaAtencion?: string;
  fechaConsulta?: string;
  atendido?: string;
  medico?: string;
  ciudad?: string;
  examenes?: string;
  horaAtencion?: string;
  datosNutricionales?: any;
  edad?: number;
  genero?: string;
  foto?: string;
}

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const conceptoColor = (concepto?: string) => {
  if (!concepto) return 'bg-gray-100 text-gray-600';
  const c = concepto.toUpperCase();
  if (c === 'APTO') return 'bg-green-100 text-green-800';
  if (c === 'NO APTO') return 'bg-red-100 text-red-800';
  if (c === 'APLAZADO') return 'bg-yellow-100 text-yellow-800';
  return 'bg-blue-100 text-blue-800';
};

function FichaModal({ historia, onClose }: { historia: HistoriaClinicaItem; onClose: () => void }) {
  const nombreCompleto = [historia.primerNombre, historia.segundoNombre, historia.primerApellido, historia.segundoApellido]
    .filter(Boolean)
    .join(' ');

  const imc = historia.talla && historia.peso
    ? (parseFloat(historia.peso) / Math.pow(parseFloat(historia.talla) / 100, 2)).toFixed(1)
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-4">
            {historia.foto ? (
              <img src={historia.foto} alt="" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                {historia.primerNombre?.[0]}{historia.primerApellido?.[0]}
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-gray-800">{nombreCompleto}</h2>
              <p className="text-sm text-gray-500">CC {historia.numeroId} | {historia.celular}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Info General */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="Empresa" value={historia.codEmpresa || historia.empresa} />
            <InfoItem label="Cargo" value={historia.cargo} />
            <InfoItem label="Tipo Examen" value={historia.tipoExamen} />
            <InfoItem label="Ciudad" value={historia.ciudad} />
            <InfoItem label="Edad" value={historia.edad ? `${historia.edad} años` : undefined} />
            <InfoItem label="Genero" value={historia.genero} />
            <InfoItem label="Medico" value={historia.medico} />
            <InfoItem label="Fecha Consulta" value={formatDate(historia.fechaConsulta)} />
          </div>

          {/* Concepto Final */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600">Concepto Final:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${conceptoColor(historia.mdConceptoFinal)}`}>
              {historia.mdConceptoFinal || '—'}
            </span>
          </div>

          {/* Antropometria */}
          {(historia.talla || historia.peso) && (
            <Section title="Antropometria">
              <div className="grid grid-cols-3 gap-4">
                <InfoItem label="Talla (cm)" value={historia.talla} />
                <InfoItem label="Peso (kg)" value={historia.peso} />
                <InfoItem label="IMC" value={imc || undefined} />
              </div>
            </Section>
          )}

          {/* Diagnosticos */}
          {(historia.mdDx1 || historia.mdDx2) && (
            <Section title="Diagnosticos">
              {historia.mdDx1 && <InfoItem label="Dx Principal" value={historia.mdDx1} />}
              {historia.mdDx2 && <InfoItem label="Dx Secundario" value={historia.mdDx2} />}
            </Section>
          )}

          {/* Campos medicos */}
          {historia.mdAntecedentes && (
            <Section title="Antecedentes">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.mdAntecedentes}</p>
            </Section>
          )}

          {historia.mdObsParaMiDocYa && (
            <Section title="Observaciones para MiDocYa">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.mdObsParaMiDocYa}</p>
            </Section>
          )}

          {historia.mdObservacionesCertificado && (
            <Section title="Observaciones Certificado">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.mdObservacionesCertificado}</p>
            </Section>
          )}

          {historia.mdRecomendacionesMedicasAdicionales && (
            <Section title="Recomendaciones Medicas">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.mdRecomendacionesMedicasAdicionales}</p>
            </Section>
          )}

          {historia.motivoConsulta && (
            <Section title="Motivo de Consulta">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.motivoConsulta}</p>
            </Section>
          )}

          {historia.diagnostico && (
            <Section title="Diagnostico">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.diagnostico}</p>
            </Section>
          )}

          {historia.tratamiento && (
            <Section title="Tratamiento">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.tratamiento}</p>
            </Section>
          )}

          {/* Datos Nutricionales */}
          {historia.datosNutricionales && Object.keys(historia.datosNutricionales).length > 0 && (
            <Section title="Datos Nutricionales">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(historia.datosNutricionales).map(([key, value]) => (
                  value ? <InfoItem key={key} label={key} value={String(value)} /> : null
                ))}
              </div>
            </Section>
          )}

          {/* Examenes */}
          {historia.examenes && (
            <Section title="Examenes">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{historia.examenes}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">{title}</h3>
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-xs text-gray-400 block">{label}</span>
      <span className="text-sm text-gray-800">{value || '—'}</span>
    </div>
  );
}

export function HistoriasClinicasPage() {
  const [historias, setHistorias] = useState<HistoriaClinicaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(0);
  const [total, setTotal] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedHistoria, setSelectedHistoria] = useState<HistoriaClinicaItem | null>(null);
  const limit = 20;

  const fetchAtendidos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiService.getAtendidos({ page, limit, buscar: buscar || undefined });
      setHistorias(result.data);
      setTotalPaginas(result.totalPaginas);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || 'Error al cargar historias');
    } finally {
      setIsLoading(false);
    }
  }, [page, buscar]);

  useEffect(() => {
    fetchAtendidos();
  }, [fetchAtendidos]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setBuscar(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setBuscar('');
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Historias Clinicas</h1>
            <p className="text-sm text-gray-500">Pacientes atendidos ({total} registros)</p>
          </div>
          <a href="/panel-medico" className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
            Volver al panel
          </a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre o documento..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Buscar
          </button>
          {buscar && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
            >
              Limpiar
            </button>
          )}
        </form>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {/* Table */}
        {!isLoading && historias.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Paciente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Documento</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Empresa</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Medico</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha Consulta</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Concepto</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Dx</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Ficha</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {historias.map((h) => (
                    <tr key={h._id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {h.foto ? (
                            <img src={h.foto} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold">
                              {h.primerNombre?.[0]}{h.primerApellido?.[0]}
                            </div>
                          )}
                          <span className="font-medium text-gray-800">
                            {h.primerNombre} {h.primerApellido}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{h.numeroId}</td>
                      <td className="px-4 py-3 text-gray-600">{h.codEmpresa || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{h.medico || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(h.fechaConsulta)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${conceptoColor(h.mdConceptoFinal)}`}>
                          {h.mdConceptoFinal || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={h.mdDx1 || ''}>
                        {h.mdDx1 || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setSelectedHistoria(h)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-xs font-medium transition-colors"
                        >
                          Ver ficha
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPaginas > 1 && (
              <div className="border-t px-4 py-3 flex items-center justify-between bg-gray-50">
                <span className="text-sm text-gray-500">
                  Pagina {page} de {totalPaginas} ({total} registros)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-white"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
                    disabled={page >= totalPaginas}
                    className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-white"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && historias.length === 0 && !error && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">No se encontraron historias clinicas</p>
            {buscar && <p className="text-sm mt-1">Intenta con otro termino de busqueda</p>}
          </div>
        )}
      </div>

      {/* Ficha Modal */}
      {selectedHistoria && (
        <FichaModal historia={selectedHistoria} onClose={() => setSelectedHistoria(null)} />
      )}
    </div>
  );
}
