---
name: antecedentes-booleanos
description: Usar al leer, escribir, exportar o depurar antecedentes personales y familiares, condiciones especiales, tags del paciente o cualquier columna booleana de HistoriaClinica y formularios. También cuando un antecedente marcado por el paciente no aparece en el panel, en el PDF o en la hoja de cálculo.
---

# Un antecedente positivo tiene cuatro formas

Las columnas de antecedentes se llenaron por vías distintas a lo largo de los
años, así que un positivo puede estar guardado como booleano `true`, como texto
`'true'`, como `'Sí'` o como `'SI'`. Comparar sólo contra `true` esconde
antecedentes reales del paciente.

## Al leer

```ts
const positivo =
  row.condicion_medica === true ||
  row.condicion_medica === 'true' ||
  row.condicion_medica === 'Sí' ||
  row.condicion_medica === 'SI';
```

Está hecho así en `backend/src/services/historia-query.service.ts` (~línea 211)
para las ~27 condiciones personales y las 8 familiares, y en
`corporativo-sheet.service.ts` para el volcado a Google Sheets.

## Al escribir

La coerción de entrada es más amplia y ya está resuelta: `coerceValue()` en
`backend/src/services/historia-field-coercion.service.ts` acepta `'true'`,
`'Sí'`, `'SI'`, `'sí'`, `'si'` y `'1'`. No escribir una segunda coerción:
usarla.

## NULL no es "no"

Un antecedente en `NULL` significa **nadie lo preguntó**, no "el paciente dijo
que no". Al exportar hay que dejarlo en blanco, no convertirlo a `'No'` ni a
`false`. Lo mismo con los números: un campo vacío se exporta vacío, nunca `0`
(un IMC en 0 se leería como una medición tomada).

## Señales de que algo está mal

- `if (row.x)` o `row.x === true` sobre una columna de antecedente.
- `Boolean(row.x)` — `'false'` como texto es `true`.
- Un `COALESCE(x, false)` en SQL sobre un antecedente.
