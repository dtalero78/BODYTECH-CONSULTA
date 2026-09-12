---
name: consultas-dia-colombia
description: Usar al escribir o revisar cualquier consulta, filtro, estadística o reporte acotado a "hoy", "ayer", "este día", "el día de la cita" o un rango de fechas sobre HistoriaClinica, citas, indicadores o el panel médico. También al depurar un conteo que "da un día corrido" o filas que aparecen o faltan cerca de medianoche.
---

# El día en Colombia son las 05:00 UTC

Producción corre en UTC. Colombia es UTC-5 y no tiene horario de verano. Un
`new Date()` en el servidor devuelve un día que, entre las 19:00 y las 23:59
hora Colombia, **ya es el día siguiente**. Toda consulta acotada a un día tiene
que construir sus límites en UTC a mano.

## Los límites

```ts
const startOfDay = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));        // 00:00 Colombia
const endOfDay   = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999)); // 23:59:59 Colombia
```

`m` es 0-indexado, como espera `Date.UTC`. Si la fecha viene como texto
`YYYY-MM-DD`, hay que restarle 1 al mes al partirla.

## Obtener el y/m/d de "hoy" en Colombia

Nunca `new Date().getFullYear()` y sus hermanos: eso es el día del servidor, no
el de Colombia. Hay que correr el reloj 5 horas hacia atrás y leerlo en UTC:

```ts
const now = new Date();
const colombiaTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
const year  = colombiaTime.getUTCFullYear();
const month = colombiaTime.getUTCMonth();
const day   = colombiaTime.getUTCDate();
```

## Dónde está hecho

- `backend/src/services/medical-panel.service.ts` → `colombiaDay()` (fecha
  `YYYY-MM-DD` → límites) y `getDailyStats()` / `getPendingPatients()` (hoy).
- Reusar `colombiaDay()` cuando la fecha ya viene como texto, en vez de repetir
  el cálculo.

## Señales de que algo está mal

- `new Date()` usado directo para sacar y/m/d de un filtro por día.
- Un `BETWEEN` cuyo fin es `23:59` sin el `+1 día` y el `04:59:59.999`.
- `DATE(fecha)` en SQL sin convertir a la zona: Postgres compara en UTC.
- Un indicador que "cambia de día" a las 7 de la noche.
