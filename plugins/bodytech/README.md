# Plugin `bodytech` — reglas del repo, con examen

Cuatro reglas del `CLAUDE.md` empaquetadas como skills, y una suite de evals que
comprueba que Claude realmente las aplique cuando alguien le pide algo en
palabras normales.

## Para qué sirve

El `CLAUDE.md` es un manual largo escrito con fe: nadie había comprobado nunca
si el asistente lo sigue. `claude plugin eval` toma esa medida, y de paso mide
lo contrario: si un caso saca la misma nota **con** y **sin** el plugin, esa
regla no está aportando nada y se puede borrar del manual.

Ojo: esto examina al asistente que escribe código, no a los prompts de
producción de la app (la extracción de los 11 campos, el OCR de cédulas, la
rúbrica de calidad, el bot de Trepsi). Esos corren contra otros modelos dentro
del backend y necesitan su propio arnés.

## Las skills

| Skill | Regla que protege |
|---|---|
| `consultas-dia-colombia` | El día en Colombia empieza a las 05:00 UTC. Producción corre en UTC. |
| `campo-historia-clinica` | Un campo del panel toca cuatro archivos; si falta uno, no guarda. |
| `antecedentes-booleanos` | Un positivo puede ser `true`, `'true'`, `'Sí'` o `'SI'`. `NULL` no es "no". |
| `whatsapp-plantilla` | A un paciente sólo se le manda plantilla aprobada. Nada de `wa.me`. |

## Los casos

| Caso | Qué mide |
|---|---|
| `citas-de-hoy` | Que el rango del día salga en UTC-5, no del reloj del servidor |
| `agregar-campo-panel` | Que enumere los cuatro pasos, no sólo el input del frontend |
| `antecedente-no-aparece` | Que sospeche de las cuatro formas del booleano |
| `whatsapp-texto-libre` | Que **se niegue** al texto libre y pida plantilla |
| `pregunta-no-relacionada` | Que una pregunta ajena (instalar Docker) **no** dispare ninguna skill |

Los dos últimos son los importantes: uno comprueba que el plugin frene el
atajo prohibido, el otro que no se meta donde no lo llaman. Un `Δ` de 0 en
`pregunta-no-relacionada` es el resultado correcto.

## Correrlo

Desde este directorio (`plugins/bodytech/`):

```bash
claude plugin eval .                      # suite completa, con brazo de comparación
claude plugin eval . --case citas-de-hoy --runs 1 --ablation none   # iterar barato
```

Cada caso corre 3 veces con el plugin y 3 sin él, así que la suite son 30
corridas y cuesta unos pocos dólares de llamadas al modelo. `--ablation none`
corre un solo brazo y lo parte a la mitad; `-j 4` lo acelera.

Leer el resultado: `WITH` es la nota con el plugin, `W/OUT` sin él, y `Δ` es lo
que aportó el plugin. `Δ` cercano a 0 con nota alta en las dos columnas
significa que el modelo ya lo hacía solo.

## Agregar un caso

```bash
claude plugin eval init --bare mi-caso
```

Deja un `prompt.md` (la frase que teclearía alguien del equipo, sin nombrar la
skill) y un `graders/` con un archivo por chequeo. Dos reglas prácticas: un
grader sobre el **resultado** (`regex` si el texto esperado es fijo, `llm` si
hay que juzgar contenido) y uno sobre el **camino** (`tool_used: Skill`, que
dice si la skill fue la que produjo la respuesta).

Los graders `regex` y `tool_used` no cuestan nada; los `llm` llaman a un modelo
juez. Preferí `regex` cuando lo que esperás es un literal.

## Instalarlo para el uso diario

Las skills sirven en cualquier sesión de Claude Code sobre este repo:

```bash
/plugin marketplace add .
/plugin install bodytech@bodytech-local
```

## Nunca

Ningún caso, fixture ni prompt puede llevar datos reales de pacientes: cédulas,
nombres, transcripciones. Son datos clínicos y los reportes pueden publicarse.
Todo lo de acá es inventado a propósito.
