import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { MesResumen } from '../../services/calendario.service';
import { Profesional } from '../../services/profesionales.service';

interface Props {
  mes: MesResumen;
  profesionales: Profesional[];
}

const PIE_COLORS = ['#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b', '#6366f1', '#06b6d4', '#10b981'];

function nombreDe(codigo: string, profesionales: Profesional[]): string {
  if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
  const p = profesionales.find((x) => x.codigo === codigo);
  if (!p) return codigo;
  return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
}

export function CalendarioStats({ mes, profesionales }: Props) {
  // Distribución por médico (suma total del mes)
  const porMedico = useMemo(() => {
    const map = new Map<string, number>();
    for (const fecha of Object.keys(mes.porDia)) {
      const dia = mes.porDia[fecha];
      for (const [codigo, info] of Object.entries(dia.porMedico)) {
        map.set(codigo, (map.get(codigo) ?? 0) + info.total);
      }
    }
    return Array.from(map.entries())
      .map(([codigo, total]) => ({
        nombre: nombreDe(codigo, profesionales),
        value: total,
        codigo,
      }))
      .sort((a, b) => b.value - a.value);
  }, [mes, profesionales]);

  // Atendidas vs Pendientes (donut)
  const estadoData = useMemo(
    () => [
      { name: 'Atendidas', value: mes.totalAtendidos, color: '#10b981' },
      { name: 'Pendientes', value: mes.totalPendientes, color: '#f59e0b' },
    ],
    [mes]
  );

  // Citas por día (barra) — solo días con citas, ordenados
  const porDia = useMemo(() => {
    return Object.entries(mes.porDia)
      .map(([fecha, dia]) => {
        const day = Number(fecha.split('-')[2]);
        return {
          dia: day,
          fecha,
          atendidas: dia.atendidos,
          pendientes: dia.pendientes,
          total: dia.total,
        };
      })
      .sort((a, b) => a.dia - b.dia);
  }, [mes]);

  if (mes.totalCitas === 0) {
    return null; // sin datos no renderizamos
  }

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Distribución por médico */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Citas por profesional</h3>
        {porMedico.length === 0 ? (
          <p className="text-sm text-gray-500">Sin datos</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={porMedico}
                dataKey="value"
                nameKey="nombre"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
              >
                {porMedico.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  fontSize: '12px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: '11px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Atendidas vs Pendientes */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Estado del mes</h3>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={estadoData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
              label={({ value }) => value}
              labelLine={false}
            >
              {estadoData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                fontSize: '12px',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
              }}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Citas por día — full width */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Citas por día</h3>
        {porDia.length === 0 ? (
          <p className="text-sm text-gray-500">Sin datos</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porDia}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: '12px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                }}
                labelFormatter={(label) => `Día ${label}`}
              />
              <Legend iconType="rect" iconSize={10} wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="atendidas" stackId="a" fill="#10b981" name="Atendidas" radius={[0, 0, 0, 0]} />
              <Bar dataKey="pendientes" stackId="a" fill="#f59e0b" name="Pendientes" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
