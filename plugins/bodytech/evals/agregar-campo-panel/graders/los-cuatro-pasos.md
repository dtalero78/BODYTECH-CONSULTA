---
type: llm
---

La respuesta enumera los pasos para agregar un campo al panel de historia clínica.

PASS si menciona los CUATRO, con cualquier redacción:
1. Agregar el campo a la whitelist de campos editables (EDITABLE_FIELD_DEFS o
   EDITABLE_FIELDS) con su tipo, en el backend.
2. Agregar la columna con una migración ADD COLUMN IF NOT EXISTS en
   runMigrations de postgres.service.ts.
3. Agregar el campo a la interfaz MedicalHistoryFull en el types.ts del panel.
4. Renderizarlo enganchado a useFieldAutoSave en el tab.

FAIL si omite cualquiera de los cuatro, si inventa un botón de guardar manual,
o si dice que basta con agregar el input en el frontend.

Juzgá sólo el contenido, no el formato ni el orden.
