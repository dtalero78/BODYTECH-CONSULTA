// ARCHIVO GENERADO — no editar a mano.
// Lo produce `scripts/generar-catalogo.js` en cada compilación (npm run build).
// Para cambiar lo que dice, cambiá el código del que se deriva, o
// `src/bodyvibe/REGLAS.md` para la parte escrita a mano.

export interface PantallaCatalogo {
  ruta: string;
  componente: string | null;
  redirigeA: string | null;
  protegida: boolean;
  /** Roles que pueden entrar, cuando la pantalla los declara. */
  roles: string[] | null;
}

export interface RutaApiCatalogo {
  ruta: string;
  roles: string[] | null;
}

export interface CatalogoGenerado {
  pantallas: PantallaCatalogo[];
  api: RutaApiCatalogo[];
  visual: {
    variablesPanel: Record<string, string>;
    tokensCoordinador: Record<string, string>;
    tipografias: Record<string, string>;
  };
  /** Contenido literal de REGLAS.md — la mitad que no se puede deducir. */
  reglas: string;
  /** Fuentes que no se pudieron leer. Vacío es lo esperado. */
  faltantes: string[];
}

export const CATALOGO_GENERADO: CatalogoGenerado = {
  "pantallas": [
    {
      "ruta": "/",
      "componente": null,
      "redirigeA": "/login",
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/login",
      "componente": "LoginPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/forgot-password",
      "componente": "ForgotPasswordPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/reset-password",
      "componente": "ResetPasswordPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/coordinador-login",
      "componente": null,
      "redirigeA": "/login",
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/ordenes-login",
      "componente": null,
      "redirigeA": "/login",
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/sin-acceso",
      "componente": "SinAcceso",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/doctor",
      "componente": "DoctorPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/doctor/:roomName",
      "componente": "DoctorRoomPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/nutricion/:roomName",
      "componente": "NutricionRoomPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/demo-isak",
      "componente": "IsakDemo",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/patient/:roomName",
      "componente": "PatientPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/panel-medico/patient/:roomName",
      "componente": "PatientPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/bot-trepsi",
      "componente": "BotTrepsiPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/monitor-integracion",
      "componente": "MonitorIntegracionPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/monitor-mybodytech",
      "componente": "MonitorMybodytechPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/reprogramar/:id",
      "componente": "ReprogramarPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/terminos",
      "componente": "TerminosPage",
      "redirigeA": null,
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/terminos-y-condiciones",
      "componente": null,
      "redirigeA": "/terminos",
      "protegida": false,
      "roles": null
    },
    {
      "ruta": "/panel-medico",
      "componente": "MedicalPanelPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "medico",
        "coach",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/historias",
      "componente": "HistoriasClinicasPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "medico",
        "coach",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/historia/:historiaId",
      "componente": "HistoriaDetallePage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "medico",
        "coach",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/corporativo/:historiaId",
      "componente": "CorporativoConsultaPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "medico",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/acc",
      "componente": "AccAgendaPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "coach",
        "medico",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/acc/valoracion",
      "componente": "AccValoracionPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "coach",
        "medico",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/acc/valoracion/:id",
      "componente": "AccValoracionPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "coach",
        "medico",
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/ordenes",
      "componente": "OrdenesPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "admin",
        "coordinador",
        "auxiliar"
      ]
    },
    {
      "ruta": "/calidad",
      "componente": "CalidadPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "admin",
        "coordinador"
      ]
    },
    {
      "ruta": "/coordinador",
      "componente": "CoordinadorPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "admin",
        "coordinador"
      ]
    },
    {
      "ruta": "/bodyvibetech",
      "componente": "BodyVibeTechPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "admin"
      ]
    },
    {
      "ruta": "/apps",
      "componente": "AppsPublicadosPage",
      "redirigeA": null,
      "protegida": true,
      "roles": [
        "admin",
        "coordinador",
        "medico",
        "coach",
        "auxiliar",
        "torre"
      ]
    }
  ],
  "api": [
    {
      "ruta": "/api/...",
      "roles": null
    },
    {
      "ruta": "/api/auth",
      "roles": null
    },
    {
      "ruta": "/api/video",
      "roles": null
    },
    {
      "ruta": "/api/telemedicine",
      "roles": null
    },
    {
      "ruta": "/api/medical-panel",
      "roles": null
    },
    {
      "ruta": "/api/profesionales",
      "roles": null
    },
    {
      "ruta": "/api/calendario",
      "roles": null
    },
    {
      "ruta": "/api/torniquete",
      "roles": null
    },
    {
      "ruta": "/api/usuarios",
      "roles": [
        "admin",
        "coordinador"
      ]
    },
    {
      "ruta": "/api/bot-trepsi",
      "roles": null
    },
    {
      "ruta": "/api/twilio",
      "roles": null
    },
    {
      "ruta": "/api/whatsapp-leads",
      "roles": null
    },
    {
      "ruta": "/api/whatsapp-chat",
      "roles": null
    },
    {
      "ruta": "/api/calidad",
      "roles": [
        "coordinador",
        "admin"
      ]
    },
    {
      "ruta": "/api/admin/trepsi-webhook",
      "roles": [
        "admin",
        "coordinador"
      ]
    },
    {
      "ruta": "/api/admin/audit",
      "roles": [
        "admin",
        "coordinador"
      ]
    },
    {
      "ruta": "/api/bodyvibe",
      "roles": null
    },
    {
      "ruta": "/api/vistas",
      "roles": null
    },
    {
      "ruta": "/api/admin/gestion-report",
      "roles": [
        "admin"
      ]
    },
    {
      "ruta": "/api/public/gestion-report-image",
      "roles": null
    },
    {
      "ruta": "/api/v1/integrations/trepsi",
      "roles": null
    },
    {
      "ruta": "/api/v1/integrations/mybodytech",
      "roles": null
    },
    {
      "ruta": "/api/monitor-integracion",
      "roles": null
    },
    {
      "ruta": "/api/acc",
      "roles": null
    }
  ],
  "visual": {
    "variablesPanel": {
      "--p-bg": "#fafaf9",
      "--p-bg-2": "#f4f4f5",
      "--p-surface": "#ffffff",
      "--p-surface-2": "#fafaf9",
      "--p-surface-3": "#f4f4f5",
      "--p-surface-4": "#f4f4f5",
      "--p-surface-5": "#f4f4f5",
      "--p-surface-6": "#efeff1",
      "--p-surface-7": "#efeff1",
      "--p-input": "#ffffff",
      "--p-input-2": "#f4f4f5",
      "--p-line": "#e4e4e7",
      "--p-line-2": "#d4d4d8",
      "--p-text": "#18181b",
      "--p-text-2": "#3f3f46",
      "--p-text-3": "#71717a",
      "--p-text-3-rgb": "113, 113, 122",
      "--p-accent": "#1f3a8a",
      "--p-accent-hover": "#172e6e",
      "--p-accent-2": "#2f4fae",
      "--p-on-accent": "#ffffff",
      "--p-accent-rgb": "31, 58, 138",
      "--p-ok": "#15803d",
      "--p-ok-rgb": "22, 163, 74",
      "--p-warn": "#b45309",
      "--p-warn-rgb": "217, 119, 6",
      "--p-danger": "#dc2626",
      "--p-danger-rgb": "220, 38, 38",
      "--p-info": "#2563eb",
      "--p-info-rgb": "37, 99, 235",
      "--p-violet": "#6d28d9",
      "--p-violet-2": "#4c1d95",
      "--p-orange": "#ea580c",
      "--p-scrim-rgb": "24, 24, 27"
    },
    "tokensCoordinador": {
      "accent": "#1f3a8a",
      "accentSoft": "#eef2ff",
      "accentHover": "#1e3a8a",
      "surface": "#fafaf9",
      "panel": "#fcfcfb",
      "line": "#e4e4e7",
      "todayBg": "#f8fafc"
    },
    "tipografias": {
      "FONT_INTER": "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "FONT_MONO": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    }
  },
  "reglas": "# Reglas y cicatrices de la plataforma\n\nEste archivo se le entrega al agente de BodyVibeTech **textualmente**, en cada\npedido. Es la mitad del catálogo que ninguna máquina puede deducir: lo que hay\nque saber para que un reporte diga la verdad.\n\nLo que va acá: definiciones que no son obvias, huecos de datos conocidos, y\ncosas que ya salieron mal una vez. Lo que **no** va acá: nada que el catálogo\nautomático ya liste (nombres de estantes, columnas, tipos, pantallas). Eso se\ngenera solo y siempre está al día; esto se escribe a mano y hay que mantenerlo.\n\nCada afirmación con número está verificada contra la base de producción en la\nfecha que se indica. Si una regla no tiene fecha ni fuente, sospechá de ella.\n\n---\n\n## 0. Cómo se escribe acá\n\nTodo el texto visible va en **español de Colombia, tratando de usted**. Nunca\n\"vos\" ni \"contá / querés / podés / elegí\": en Bogotá suenan extranjeras. Diga\n\"cuente\", \"quiere\", \"puede\", \"elija\". Tampoco españolismos (\"vale\",\n\"ordenador\", \"coger\").\n\nEscriba para alguien del equipo de Bodytech, no para un programador: \"citas\natendidas\", no \"registros con fechaConsulta no nula\".\n\n---\n\n## 1. Los estantes primero, las tablas después\n\nPuede consultar **cualquier tabla** de la plataforma, siempre en solo lectura.\nPero los estantes `bv_*` no son un subconjunto pobre: son las mismas tablas con\nlas definiciones ya resueltas.\n\nSi el dato que necesita está en un estante, **use el estante**. Ahí \"cita\natendida\" ya significa lo que debe significar, el género ya viene normalizado,\nla fecha ya está en hora Colombia y la cobertura ya está medida. Yendo directo a\nla tabla cruda, todo eso queda de su lado — y es exactamente donde nacen los\nreportes que no fallan y están mal.\n\nUse las tablas crudas para lo que ningún estante cubra. Cuando lo haga, lea\nantes la sección 2: son las trampas que el estante le estaba evitando.\n\n**Columnas vacías.** El catálogo lista, de cada tabla, solo las columnas que\ntienen datos. `HistoriaClinica` tiene 337 columnas y **225 están prácticamente\nvacías** — restos de la migración desde Wix y campos que nadie diligencia. No\nlas use: un reporte construido sobre una de ellas devuelve ceros que se leen\ncomo hallazgos.\n\n**Lo que no vas a encontrar, y es a propósito.** La transcripción de la consulta\n(`transcription_text`, `transcript`), el hash de contraseñas, las firmas\ndigitalizadas y los `payload` crudos de Trepsi no son legibles. Ningún reporte\nlos necesita, y una fuga de eso no se repara. Si algún pedido los requiere de\nverdad, la respuesta es que eso se decide fuera de acá.\n\n---\n\n## 2. Reglas duras\n\nEstas no se negocian. Si un pedido las contradice, la respuesta correcta es\nexplicar por qué no se puede, no buscarle la vuelta.\n\n**Nunca invente datos que no existen.** Si un pedido necesita un dato que\nningún estante tiene, dígalo. No lo aproxime con otro campo \"parecido\", no lo\ndeje en cero, no lo simule. Un tablero vacío es un problema; un tablero con\nnúmeros inventados es un desastre que nadie detecta.\n\n**Siempre muestre la cobertura cuando el dato esté incompleto.** Si va a\nagrupar por un campo que tiene huecos, consulte `bv_cobertura` y muestre el\nporcentaje al lado del resultado. \"Bogotá: 409\" es engañoso si 2.072 registros\nno tienen ciudad. \"Bogotá: 409 (de 811 con ciudad registrada; 72% sin dato)\" es\nhonesto.\n\n**Piense dos veces antes de cruzar identidad con contenido clínico.** Ahora que\nlas tablas están abiertas, `HistoriaClinica` permite poner el nombre del paciente\nal lado de su diagnóstico en la misma fila. Que se pueda no significa que deba\nhacerse: para contar, agrupar y comparar nunca hace falta el nombre. Reserve la\nidentidad para los tableros operativos —a quién hay que llamar, quién no\ncontestó— y déjela afuera de los clínicos.\n\n**Solo lectura, siempre.** No existe forma de escribir desde un app. Si alguien\npide \"un botón que marque la cita como atendida\", la respuesta es que eso se\nhace desde el panel médico, no desde acá.\n\n---\n\n## 3. Definiciones: qué significa cada número\n\n### Cita atendida → `fechaConsulta IS NOT NULL`\n\n**Verificado 2026-08-11.** Es la definición canónica, decidida por el autor. En\nlos estantes ya viene resuelta como `bv_citas.estado`:\n\n| `estado`     | Significa                                                    |\n|--------------|--------------------------------------------------------------|\n| `ATENDIDA`   | La consulta ocurrió (`fechaConsulta` tiene valor)            |\n| `NOCONTESTA` | El paciente no respondió (`pvEstado = 'No Contesta'`)        |\n| `PENDIENTE`  | Ni lo uno ni lo otro                                          |\n\n**Use `estado`. No use `atendido` ni `estado_calendario`.**\n\n`estado_calendario` existe en el estante solo para depuración, no para\nreportar. Es el criterio viejo del calendario del coordinador\n(`UPPER(atendido) = 'ATENDIDO'`) y **no coincide con el canónico en 38 de 2.883\ncitas (1,3%)**. La causa: el valor `atendido = 'REPROGRAMADA'`, que el `CASE`\ndel calendario no contempla y que cae al `ELSE` como pendiente. De esas 38, hay\n**13 consultas que sí ocurrieron y el calendario cuenta como pendientes.**\n\nSi alguien pide \"las citas donde los dos paneles no coinciden\", esa consulta es\nlegítima y útil: `WHERE estados_discrepan`.\n\n### Jornada de un coach → `bv_jornada.minutos_jornada`\n\nYa viene calculado. La sutileza que resuelve: una jornada **abierta** se mide\ncontra el último latido, no contra `NOW()`. Si un coach cerró el navegador a\nlas 3pm y son las 9pm, su jornada duró hasta las 3pm, no seis horas más.\n\n### Género → `bv_citas.genero`, ya normalizado\n\n**Verificado 2026-08-12.** El dato vive en `HistoriaClinica.genero_biologico` y\nllega como `'F'` / `'M'`, con una fila suelta escrita `'Femenino'`. El estante\nlo entrega ya unificado como `Femenino` / `Masculino`, así que **nunca agrupe\npor la columna cruda**: en un `GROUP BY` sin normalizar, esa fila sale como una\ntercera categoría de un solo paciente.\n\n| Valor        | Citas | Atendidas |\n|--------------|-------|-----------|\n| Femenino     | 1.214 | 702       |\n| Masculino    | 1.039 | 607       |\n| (sin dato)   | 677   | 302       |\n\n**Falta en el 23%.** Todo reporte por género tiene que decirlo — la cifra está\nen `bv_cobertura.con_genero`. Un gráfico de dos barras sobre el 77% de los\ndatos, sin esa línea, se ve completo y no lo está.\n\nExiste además `identidad_genero`, y está **vacía en las 2.930 historias**: nadie\nla diligencia. No está en ningún estante, por la misma razón que no hay estante\nde antecedentes.\n\n### Hora y fecha → siempre Colombia (UTC-5)\n\nEl servidor de producción corre en UTC. `bv_citas.fecha_local` ya viene\nconvertida a hora Colombia; úsela en vez de `fecha_atencion` para agrupar por\ndía, o los registros de la noche se van al día siguiente.\n\n---\n\n## 4. Huecos de datos conocidos\n\nEsto es lo que **no se puede reportar**, por más que lo pidan. Decirlo de\nentrada ahorra un tablero inútil.\n\n### Antecedentes y condiciones médicas: NO HAY DATOS\n\n**Verificado 2026-08-11.** De 2.883 historias clínicas:\n\n- Los seis flags de antecedentes (`patológico`, `quirúrgico`, `alérgicos`,\n  `farmacológico`, `familiares`, `osteomuscular`) están en `false` en **las\n  2.883**.\n- Los seis campos de detalle están vacíos en **las 2.883**.\n- Solo hay texto libre suelto: 140 historias con antecedentes familiares\n  escritos a mano, y una sola con antecedente patológico.\n- La tabla `formularios`, que en su momento guardaba 35 antecedentes, tiene\n  **0 filas** (sus 78 columnas siguen ahí, sin datos).\n\n**Nadie los diligencia.** Confirmado con el autor, no inferido.\n\nPor eso **no existe un estante de condiciones médicas**, y es deliberado. Un\nestante lleno de `false` produciría \"0 pacientes con antecedentes patológicos\",\nque se lee como un hallazgo clínico cuando significa \"nadie llenó el campo\".\n\n**Si alguien pide un reporte de condiciones médicas, la respuesta es que no hay\ndatos que reportar** — no un tablero de ceros. Se puede ofrecer, en cambio, un\ntablero de `bv_cobertura` que muestre cuántas historias tienen antecedentes\ndiligenciados, que hoy es cero y sirve para saber si eso cambia.\n\n### Ciudad: falta en el 72%\n\n**Verificado 2026-08-11.** 2.072 de 2.883 historias no tienen ciudad.\n\n| Ciudad       | Historias |\n|--------------|-----------|\n| (sin ciudad) | 2.072     |\n| Bogotá       | 409       |\n| Medellín     | 72        |\n| Cartagena    | 58        |\n| Soacha       | 48        |\n| Cali         | 42        |\n\nUn reporte \"por ciudad\" es válido, pero **tiene que decir sobre qué base está\nconstruido**. Sin esa línea, se ve impecable y engaña.\n\n### Historial: solo tres meses\n\nLos datos van de **julio a septiembre de 2026**. No hay serie histórica larga:\ncualquier gráfico de tendencia anual, comparación interanual o estacionalidad\nno tiene con qué construirse.\n\n### `link_enviado_at`: solo confiable desde 2026-07-09\n\nNo hubo relleno retroactivo. Cualquier métrica de \"citas sin contactar\" que\nmire meses anteriores sale inflada.\n\n---\n\n## 5. Escala real de la plataforma\n\n**Verificado 2026-08-11.** Conviene saberlo porque cambia qué reportes tienen\nsentido.\n\n| Sede            | Citas | Atendidas |\n|-----------------|-------|-----------|\n| `trepsi`        | 2.718 | 1.509     |\n| `bdt-nutricion` | 134   | 70        |\n| `bsl`           | 31    | 16        |\n\nLa tabla `sedes` tiene 6 filas, pero **solo tres tienen citas**, y el 94% entra\npor la integración con Trepsi. Un tablero \"comparativo entre sedes\" hoy compara\n2.718 contra 134 contra 31: el gráfico va a estar dominado por una sola barra.\nMejor sugerir un corte distinto (por profesional, por mes, por modalidad).\n\nOtros volúmenes: 17 profesionales, 3.802 jornadas registradas, 772\nvideollamadas, 23 evaluaciones de calidad.\n\n---\n\n## 6. Cicatrices\n\nCosas que ya salieron mal. No están en el código; están acá porque son la\ndiferencia entre un app que funciona y uno que causa un problema.\n\n### No sugiera reasignar citas de Trepsi\n\nReasignar el profesional de una cita que vino de Trepsi **la desincroniza con\nel sistema del otro lado**: Trepsi le sigue avisando al coach viejo y la cita no\nle aparece al nuevo. Ya pasó con 14 citas y la decisión fue dejarlas quietas\nporque arreglarlas era peor.\n\nUna aplicación no puede reasignar nada (es de solo lectura), pero **tampoco\ndebe recomendarlo** en un texto ni presentarlo como acción sugerida.\n\n### Las tablas `citas` y `ordenes` no existen\n\n**Verificado 2026-08-11.** La documentación del repositorio las menciona, pero\nno están en la base. Las citas son filas de `HistoriaClinica`, y por eso el\nestante se llama `bv_citas` aunque no exista una tabla `citas`.\n\n### `fechaAtencion` es texto, no fecha\n\nSe guarda como texto ISO. Hoy las 2.883 filas convierten sin error, pero el\nestante usa el ayudante `bv_a_fecha()`, que devuelve nulo en vez de fallar si\nalguna vez entra una fecha mal formada. Una sola fila mala tumbaría el reporte\nentero para todos.\n\n### El panel médico comparte pantalla con la videollamada\n\nCualquier cosa que se inyecte ahí compite con una consulta en vivo. Por eso en\nese panel solo se permiten cambios de apariencia, y se apagan mientras haya una\nllamada activa.\n\n---\n\n## 7. Pendiente de escribir\n\nEste archivo está incompleto a propósito: lo de arriba es lo que se pudo\nverificar contra la base. Falta lo que solo está en la cabeza del autor.\n\n- Qué significa exactamente cada `tipoExamen` y cuáles están vigentes.\n- Qué distingue operativamente `bsl` de `bdt-nutricion`.\n- Qué estados de `trepsi_appointments` son terminales y cuáles no.\n- Qué evaluaciones de calidad son comparables entre sí (la rúbrica cambió).\n- Qué campos de la historia clínica son de uso real y cuáles quedaron muertos\n  de la migración desde Wix (hay 337 columnas; casi seguro no se usan todas).\n\nCada uno de estos huecos es un reporte que puede salir mal sin que nadie lo\nnote.\n\n---\n\n## 8. Quién puede construir, y por qué son pocos\n\nBodyVibeTech usa **la misma llave de Anthropic que el resto de la plataforma**,\ncon un tope de gasto compartido. Cada app que se genera consume de ese mismo\ncupo, el mismo que alimenta las sugerencias clínicas y el Bot Trepsi.\n\nPor eso construir no está abierto a todos los administradores: la lista vive en\nla variable `BODYVIBE_CONSTRUCTORES` y hoy tiene una sola persona. El tope\nmensual de BodyVibeTech (`BODYVIBE_TOPE_USD`) cuenta **solo lo que gasta\nBodyVibeTech** — no ve el consumo del resto de la plataforma, así que no protege\ndel tope global de la cuenta. Sumar constructores antes de separar la llave es\nsubir el riesgo de que la plataforma entera se quede sin cupo a mitad de mes.\n",
  "faltantes": []
};

export default CATALOGO_GENERADO;
