# Reglas y cicatrices de la plataforma

Este archivo se le entrega al agente de BodyVibeTech **textualmente**, en cada
pedido. Es la mitad del catálogo que ninguna máquina puede deducir: lo que hay
que saber para que un reporte diga la verdad.

Lo que va acá: definiciones que no son obvias, huecos de datos conocidos, y
cosas que ya salieron mal una vez. Lo que **no** va acá: nada que el catálogo
automático ya liste (nombres de estantes, columnas, tipos, pantallas). Eso se
genera solo y siempre está al día; esto se escribe a mano y hay que mantenerlo.

Cada afirmación con número está verificada contra la base de producción en la
fecha que se indica. Si una regla no tiene fecha ni fuente, sospechá de ella.

---

## 0. Cómo se escribe acá

Todo el texto visible va en **español de Colombia, tratando de usted**. Nunca
"vos" ni "contá / querés / podés / elegí": en Bogotá suenan extranjeras. Diga
"cuente", "quiere", "puede", "elija". Tampoco españolismos ("vale",
"ordenador", "coger").

Escriba para alguien del equipo de Bodytech, no para un programador: "citas
atendidas", no "registros con fechaConsulta no nula".

---

## 1. Los estantes primero, las tablas después

Puede consultar **cualquier tabla** de la plataforma, siempre en solo lectura.
Pero los estantes `bv_*` no son un subconjunto pobre: son las mismas tablas con
las definiciones ya resueltas.

Si el dato que necesita está en un estante, **use el estante**. Ahí "cita
atendida" ya significa lo que debe significar, el género ya viene normalizado,
la fecha ya está en hora Colombia y la cobertura ya está medida. Yendo directo a
la tabla cruda, todo eso queda de su lado — y es exactamente donde nacen los
reportes que no fallan y están mal.

Use las tablas crudas para lo que ningún estante cubra. Cuando lo haga, lea
antes la sección 2: son las trampas que el estante le estaba evitando.

**Columnas vacías.** El catálogo lista, de cada tabla, solo las columnas que
tienen datos. `HistoriaClinica` tiene 337 columnas y **225 están prácticamente
vacías** — restos de la migración desde Wix y campos que nadie diligencia. No
las use: un reporte construido sobre una de ellas devuelve ceros que se leen
como hallazgos.

**Lo que no vas a encontrar, y es a propósito.** La transcripción de la consulta
(`transcription_text`, `transcript`), el hash de contraseñas, las firmas
digitalizadas y los `payload` crudos de Trepsi no son legibles. Ningún reporte
los necesita, y una fuga de eso no se repara. Si algún pedido los requiere de
verdad, la respuesta es que eso se decide fuera de acá.

---

## 2. Reglas duras

Estas no se negocian. Si un pedido las contradice, la respuesta correcta es
explicar por qué no se puede, no buscarle la vuelta.

**Nunca invente datos que no existen.** Si un pedido necesita un dato que
ningún estante tiene, dígalo. No lo aproxime con otro campo "parecido", no lo
deje en cero, no lo simule. Un tablero vacío es un problema; un tablero con
números inventados es un desastre que nadie detecta.

**Siempre muestre la cobertura cuando el dato esté incompleto.** Si va a
agrupar por un campo que tiene huecos, consulte `bv_cobertura` y muestre el
porcentaje al lado del resultado. "Bogotá: 409" es engañoso si 2.072 registros
no tienen ciudad. "Bogotá: 409 (de 811 con ciudad registrada; 72% sin dato)" es
honesto.

**Piense dos veces antes de cruzar identidad con contenido clínico.** Ahora que
las tablas están abiertas, `HistoriaClinica` permite poner el nombre del paciente
al lado de su diagnóstico en la misma fila. Que se pueda no significa que deba
hacerse: para contar, agrupar y comparar nunca hace falta el nombre. Reserve la
identidad para los tableros operativos —a quién hay que llamar, quién no
contestó— y déjela afuera de los clínicos.

**Solo lectura, siempre.** No existe forma de escribir desde un app. Si alguien
pide "un botón que marque la cita como atendida", la respuesta es que eso se
hace desde el panel médico, no desde acá.

---

## 3. Definiciones: qué significa cada número

### Cita atendida → `fechaConsulta IS NOT NULL`

**Verificado 2026-08-11.** Es la definición canónica, decidida por el autor. En
los estantes ya viene resuelta como `bv_citas.estado`:

| `estado`     | Significa                                                    |
|--------------|--------------------------------------------------------------|
| `ATENDIDA`   | La consulta ocurrió (`fechaConsulta` tiene valor)            |
| `NOCONTESTA` | El paciente no respondió (`pvEstado = 'No Contesta'`)        |
| `PENDIENTE`  | Ni lo uno ni lo otro                                          |

**Use `estado`. No use `atendido` ni `estado_calendario`.**

`estado_calendario` existe en el estante solo para depuración, no para
reportar. Es el criterio viejo del calendario del coordinador
(`UPPER(atendido) = 'ATENDIDO'`) y **no coincide con el canónico en 38 de 2.883
citas (1,3%)**. La causa: el valor `atendido = 'REPROGRAMADA'`, que el `CASE`
del calendario no contempla y que cae al `ELSE` como pendiente. De esas 38, hay
**13 consultas que sí ocurrieron y el calendario cuenta como pendientes.**

Si alguien pide "las citas donde los dos paneles no coinciden", esa consulta es
legítima y útil: `WHERE estados_discrepan`.

### Jornada de un coach → `bv_jornada.minutos_jornada`

Ya viene calculado. La sutileza que resuelve: una jornada **abierta** se mide
contra el último latido, no contra `NOW()`. Si un coach cerró el navegador a
las 3pm y son las 9pm, su jornada duró hasta las 3pm, no seis horas más.

### Género → `bv_citas.genero`, ya normalizado

**Verificado 2026-08-12.** El dato vive en `HistoriaClinica.genero_biologico` y
llega como `'F'` / `'M'`, con una fila suelta escrita `'Femenino'`. El estante
lo entrega ya unificado como `Femenino` / `Masculino`, así que **nunca agrupe
por la columna cruda**: en un `GROUP BY` sin normalizar, esa fila sale como una
tercera categoría de un solo paciente.

| Valor        | Citas | Atendidas |
|--------------|-------|-----------|
| Femenino     | 1.214 | 702       |
| Masculino    | 1.039 | 607       |
| (sin dato)   | 677   | 302       |

**Falta en el 23%.** Todo reporte por género tiene que decirlo — la cifra está
en `bv_cobertura.con_genero`. Un gráfico de dos barras sobre el 77% de los
datos, sin esa línea, se ve completo y no lo está.

Existe además `identidad_genero`, y está **vacía en las 2.930 historias**: nadie
la diligencia. No está en ningún estante, por la misma razón que no hay estante
de antecedentes.

### Hora y fecha → siempre Colombia (UTC-5)

El servidor de producción corre en UTC. `bv_citas.fecha_local` ya viene
convertida a hora Colombia; úsela en vez de `fecha_atencion` para agrupar por
día, o los registros de la noche se van al día siguiente.

---

## 4. Huecos de datos conocidos

Esto es lo que **no se puede reportar**, por más que lo pidan. Decirlo de
entrada ahorra un tablero inútil.

### Antecedentes y condiciones médicas: NO HAY DATOS

**Verificado 2026-08-11.** De 2.883 historias clínicas:

- Los seis flags de antecedentes (`patológico`, `quirúrgico`, `alérgicos`,
  `farmacológico`, `familiares`, `osteomuscular`) están en `false` en **las
  2.883**.
- Los seis campos de detalle están vacíos en **las 2.883**.
- Solo hay texto libre suelto: 140 historias con antecedentes familiares
  escritos a mano, y una sola con antecedente patológico.
- La tabla `formularios`, que en su momento guardaba 35 antecedentes, tiene
  **0 filas** (sus 78 columnas siguen ahí, sin datos).

**Nadie los diligencia.** Confirmado con el autor, no inferido.

Por eso **no existe un estante de condiciones médicas**, y es deliberado. Un
estante lleno de `false` produciría "0 pacientes con antecedentes patológicos",
que se lee como un hallazgo clínico cuando significa "nadie llenó el campo".

**Si alguien pide un reporte de condiciones médicas, la respuesta es que no hay
datos que reportar** — no un tablero de ceros. Se puede ofrecer, en cambio, un
tablero de `bv_cobertura` que muestre cuántas historias tienen antecedentes
diligenciados, que hoy es cero y sirve para saber si eso cambia.

### Ciudad: falta en el 72%

**Verificado 2026-08-11.** 2.072 de 2.883 historias no tienen ciudad.

| Ciudad       | Historias |
|--------------|-----------|
| (sin ciudad) | 2.072     |
| Bogotá       | 409       |
| Medellín     | 72        |
| Cartagena    | 58        |
| Soacha       | 48        |
| Cali         | 42        |

Un reporte "por ciudad" es válido, pero **tiene que decir sobre qué base está
construido**. Sin esa línea, se ve impecable y engaña.

### Historial: solo tres meses

Los datos van de **julio a septiembre de 2026**. No hay serie histórica larga:
cualquier gráfico de tendencia anual, comparación interanual o estacionalidad
no tiene con qué construirse.

### `link_enviado_at`: solo confiable desde 2026-07-09

No hubo relleno retroactivo. Cualquier métrica de "citas sin contactar" que
mire meses anteriores sale inflada.

### `link_enviado_at` ya no significa "el coach gestionó la cita"

La plataforma ahora **envía el link de la videollamada automáticamente**: cada
mañana sale para toda la agenda del día, sin que nadie tenga que hacer nada. Eso
quiere decir que casi todas las citas van a tener `link_enviado_at`, y que ese
campo **dejó de medir el trabajo del coach**.

Lo que distingue una cosa de la otra es `link_enviado_por`:

| Valor      | Significa                                    |
|------------|----------------------------------------------|
| `manual`   | El coach apretó "Contactar" en su panel      |
| `auto`     | Lo envió la plataforma sola                   |

**Para cualquier métrica de gestión —"no contactó", "a cuántos llamó", tiempos
de respuesta del coach— cuente solo `link_enviado_por = 'manual'`.** Contar
todos los envíos daría 100% de gestión para todo el mundo, incluidos los coaches
que no abrieron la plataforma en todo el día.

El estante `bv_citas` ya expone la columna, y su `estado_calendario` ya aplica
esta distinción. Las filas anteriores al cambio quedaron marcadas `manual`,
porque en su momento no había otra forma de enviarlo.

---

## 5. Escala real de la plataforma

**Verificado 2026-08-11.** Conviene saberlo porque cambia qué reportes tienen
sentido.

| Sede            | Citas | Atendidas |
|-----------------|-------|-----------|
| `trepsi`        | 2.718 | 1.509     |
| `bdt-nutricion` | 134   | 70        |
| `bsl`           | 31    | 16        |

La tabla `sedes` tiene 6 filas, pero **solo tres tienen citas**, y el 94% entra
por la integración con Trepsi. Un tablero "comparativo entre sedes" hoy compara
2.718 contra 134 contra 31: el gráfico va a estar dominado por una sola barra.
Mejor sugerir un corte distinto (por profesional, por mes, por modalidad).

Otros volúmenes: 17 profesionales, 3.802 jornadas registradas, 772
videollamadas, 23 evaluaciones de calidad.

---

## 6. Cicatrices

Cosas que ya salieron mal. No están en el código; están acá porque son la
diferencia entre un app que funciona y uno que causa un problema.

### No sugiera reasignar citas de Trepsi

Reasignar el profesional de una cita que vino de Trepsi **la desincroniza con
el sistema del otro lado**: Trepsi le sigue avisando al coach viejo y la cita no
le aparece al nuevo. Ya pasó con 14 citas y la decisión fue dejarlas quietas
porque arreglarlas era peor.

Una aplicación no puede reasignar nada (es de solo lectura), pero **tampoco
debe recomendarlo** en un texto ni presentarlo como acción sugerida.

### Las tablas `citas` y `ordenes` no existen

**Verificado 2026-08-11.** La documentación del repositorio las menciona, pero
no están en la base. Las citas son filas de `HistoriaClinica`, y por eso el
estante se llama `bv_citas` aunque no exista una tabla `citas`.

### `fechaAtencion` es texto, no fecha

Se guarda como texto ISO. Hoy las 2.883 filas convierten sin error, pero el
estante usa el ayudante `bv_a_fecha()`, que devuelve nulo en vez de fallar si
alguna vez entra una fecha mal formada. Una sola fila mala tumbaría el reporte
entero para todos.

### El panel médico comparte pantalla con la videollamada

Cualquier cosa que se inyecte ahí compite con una consulta en vivo. Por eso en
ese panel solo se permiten cambios de apariencia, y se apagan mientras haya una
llamada activa.

---

## 7. Pendiente de escribir

Este archivo está incompleto a propósito: lo de arriba es lo que se pudo
verificar contra la base. Falta lo que solo está en la cabeza del autor.

- Qué significa exactamente cada `tipoExamen` y cuáles están vigentes.
- Qué distingue operativamente `bsl` de `bdt-nutricion`.
- Qué estados de `trepsi_appointments` son terminales y cuáles no.
- Qué evaluaciones de calidad son comparables entre sí (la rúbrica cambió).
- Qué campos de la historia clínica son de uso real y cuáles quedaron muertos
  de la migración desde Wix (hay 337 columnas; casi seguro no se usan todas).

Cada uno de estos huecos es un reporte que puede salir mal sin que nadie lo
note.

---

## 8. Quién puede construir, y por qué son pocos

BodyVibeTech usa **la misma llave de Anthropic que el resto de la plataforma**,
con un tope de gasto compartido. Cada app que se genera consume de ese mismo
cupo, el mismo que alimenta las sugerencias clínicas y el Bot Trepsi.

Por eso construir no está abierto a todos los administradores: la lista vive en
la variable `BODYVIBE_CONSTRUCTORES` y hoy tiene una sola persona. El tope
mensual de BodyVibeTech (`BODYVIBE_TOPE_USD`) cuenta **solo lo que gasta
BodyVibeTech** — no ve el consumo del resto de la plataforma, así que no protege
del tope global de la cuenta. Sumar constructores antes de separar la llave es
subir el riesgo de que la plataforma entera se quede sin cupo a mitad de mes.
