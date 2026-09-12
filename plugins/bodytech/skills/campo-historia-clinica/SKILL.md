---
name: campo-historia-clinica
description: Usar al agregar, renombrar o quitar un campo de la historia clínica en el panel de consulta (tabs Datos Básicos, Anamnesis, Riesgo, Examen Físico, Intervención, Conducta, Observaciones). También cuando un campo nuevo no se guarda, se guarda y se pierde al recargar, o el PATCH responde 400.
---

# Un campo del panel toca cuatro archivos

El auto-guardado del panel manda `PATCH /api/video/medical-history/:id/field`,
y ese endpoint sólo acepta columnas que estén en una whitelist. Un campo al que
le falte cualquiera de los cuatro pasos se ve bien en pantalla y no se guarda.

## Los cuatro pasos, en orden

1. **Whitelist + tipo** — agregar `{ field: 'nombre_campo', type: 'string' }` a
   `EDITABLE_FIELD_DEFS` en
   `backend/src/services/historia-field-coercion.service.ts`. Tipos válidos:
   `string`, `number`, `boolean`, `date`. Sin esto, `updateField()` rechaza el
   PATCH: el nombre de columna que se concatena en el SQL sale siempre de esa
   constante, nunca del request.
2. **Migración** — agregar `ADD COLUMN IF NOT EXISTS "nombre_campo" TIPO` al
   bloque de `HistoriaClinica` en `runMigrations()` de
   `backend/src/services/postgres.service.ts`. Es idempotente y corre en cada
   arranque.
3. **Tipo del frontend** — agregar el campo a `MedicalHistoryFull` en
   `frontend/src/components/panel/types.ts`.
4. **Render con auto-guardado** — en el tab correspondiente
   (`frontend/src/components/panel/tabs/`), enganchar el valor con
   `useFieldAutoSave`:

```ts
useFieldAutoSave({
  historiaId,
  field: 'nombre_campo',
  value,
  onSaved: onPatchLocal,
  serverValue: valorDelServidor ?? null,
});
```

`serverValue` es lo que evita que el primer render pise con vacío lo que ya
estaba guardado. `onSaved: onPatchLocal` actualiza la caché local sin refetch.

## Detalles que muerden

- `EDITABLE_FIELDS` sigue importándose desde `medical-history.service.ts`, pero
  ese archivo hoy es sólo un barrel: la definición vive en
  `historia-field-coercion.service.ts`.
- Los campos nuevos van en `snake_case`; los legacy están en `camelCase` y se
  dejan como están.
- Un campo compuesto (lista, JSON) se serializa con `JSON.stringify` antes de
  pasarlo a `value`, como hace `ant_osteomuscular_lista` en `AnamnesisTab.tsx`.
- El debounce del guardado es de 800 ms; no hay botón de guardar.
