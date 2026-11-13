# Ideas: licencia profesional y funciones de otras plataformas (R38)

Base: `docs/MANUAL.md` v1.41.0 y `docs/HANDOFF.md`. Para la lista de otras plataformas no se usó búsqueda web: se basa en el conocimiento de cada herramienta (puede haber cambiado algo reciente).

> **Estado (v1.48.0):** este documento es la propuesta de entonces. Desde v1.43.0 ya existen la pestaña
> *Administración → Licencia* (registro de la licencia o declaración de uso personal, sin funciones bloqueadas) y las
> ideas 1 a 4 y 8 de la segunda lista (importar desde Trello y CSV, suscripción al calendario, límite por columna,
> tareas bloqueadas y vista de lista). El resto sigue pendiente.

---

## R38F1 · Qué se podría reservar a la licencia profesional

### Antes de elegir: dos avisos

1. **Hoy no hay ningún mecanismo de licencia** en la app. Lo único que existe es el texto legal (`/licencia`) y un límite de 10 usuarios que se cambia con una variable (`MAX_USERS`).
2. **El código es visible.** Quien sepa programar puede quitar cualquier candado. El freno real es la licencia legal (que ya prohíbe «eludir límites técnicos»). Un bloqueo técnico solo sirve de recordatorio amable y de señal de «esto es de pago»; no es una protección.

### Grupo A · Candidatas claras (una familia no las necesita)

| # | Función | Qué es | Por qué una familia no la usa | Riesgo de molestar | Cómo bloquearla con amabilidad |
|---|---|---|---|---|---|
| A1 | **Resumen para el cliente (PDF)** (columna «Entrega al cliente») y el campo **Cliente** | Un PDF limpio para enseñar al cliente y un campo para anotar de quién es cada tarea | Una familia no tiene clientes | Muy bajo | El rol y el campo salen en la lista con candado y la frase «Para trabajar con clientes. Requiere licencia profesional». Al activar la licencia se desbloquean |
| A2 | **Informe semanal por email** | Cada semana llega por correo el informe PDF del proyecto a quien se elija | Es un informe de gestión para jefes o clientes; en casa se mira el tablero | Bajo | Sección visible en los ajustes del proyecto, con candado y explicación. El informe PDF manual sigue libre (ver B1) |
| A3 | **Descargar los registros (CSV) y conservarlos más de 7 días** | La pestaña Logs registra la actividad; el CSV permite exportarla | Es auditoría de empresa («quién hizo qué»). Una familia, como mucho, mira los últimos días | Bajo | Se ve la lista de los últimos días; el botón «Descargar CSV» y los periodos largos llevan candado |
| A4 | **Avisos por WhatsApp** | Aviso al móvil por WhatsApp (API oficial de Meta) | Exige una cuenta de empresa en Meta y paga por mensaje: ninguna familia lo configura | Casi nulo | Si no hay licencia, la casilla no aparece o sale con candado en Mi perfil y en las variables `WHATSAPP_*` no se hace nada |
| A5 | **Compartir los Docs/Sheets con todo el dominio de la empresa** | Los documentos de Google creados desde una tarea se comparten con todo el dominio de Google Workspace | «Dominio de empresa» solo existe en entornos de empresa. Las familias usan Gmail normal | Nulo | Las opciones «Todo el dominio…» salen con candado. «Solo personas del proyecto» y «No compartir» siguen libres |
| A6 | **Generador de release notes completo** (códigos R32F1, varias cabeceras y pies, histórico de releases, adjuntos renombrados, tareas fijas) | La función origen de Pizarro: convertir tareas en texto de despliegue | Es para equipos de software. En casa nadie «despliega» | **Medio**: es lo que más define a Pizarro y un desarrollador que lo use para un proyecto personal (gratis por licencia) lo echaría en falta | Mejor como fase 2. Si se hace, que sea solo activable con clave y no oculto, y dejar el uso básico (marcar la columna «En producción») libre |

### Grupo B · Dudosas (valorar con calma)

| # | Función | Qué es | Por qué podría no usarla una familia | Riesgo | Cómo bloquearla |
|---|---|---|---|---|---|
| B1 | **Informe PDF del proyecto** (manual) | Resumen con avance, plazos, carga por persona | Una familia puede imprimirlo para una mudanza o un evento | Medio | Si se bloquea, dejar el informe básico y reservar «carga por persona» y entregables |
| B2 | **Campos Coste, Horas y columna Presupuesto** | Seguimiento de dinero y horas por tarea | Las plantillas de Reformas, Viajes y Mudanza lo usan; una familia sí lleva presupuestos | **Alto** | No bloquear Coste/Presupuesto. Se podría reservar solo **Horas** (estimadas/reales), que es de gestión profesional |
| B3 | **Entregables (hitos) y su estado de riesgo** | Hitos con fecha y avance (En riesgo, Retrasado…) | El ejemplo «Preparación de un evento» y un viaje los usan | Medio | Dejar libres los entregables; reservar solo el estado «En riesgo/Retrasado» y las bandas del calendario sería poco natural. Mejor no tocar |
| B4 | **Exportar e importar proyectos completos** | Llevar un proyecto a otro servidor, con adjuntos e histórico | Sirve para migrar; una familia rara vez lo hace | Alto: choca con «tus datos son tuyos» | No bloquear la exportación (es la salida de los datos). Si acaso, reservar el «Todo el histórico» o importar a otro servidor. Mi consejo: C |
| B5 | **Más de N usuarios** (p. ej. más de 5 con licencia gratis) | Hoy el máximo es 10 por variable | Una familia son 3–6 personas | Medio: «familiar» puede ser una familia numerosa o un club | Límite blando de 5 con aviso: «Para más personas hace falta licencia». Pero 6 personas y uso personal sigue siendo legal, puede dar guerra |
| B6 | **Tipos de tarea con automatización** (título automático, texto inicial, subtareas predefinidas) y **plantillas de proyecto propias** | Atajos para crear tareas repetidas y proyectos tipo | Las 13 plantillas de serie y 3 tipos bastan en casa | Medio: las subtareas predefinidas agradan a todos | Dejar libres las plantillas de serie y reservar solo crear/editar plantillas propias |
| B7 | **Google: conectar Docs/Sheets** | Crear documentos desde una tarea | Algunas familias usan Google Docs para listas | Medio | No bloquear; solo el compartir con dominio (A5) |
| B8 | **Límites y cuotas por proyecto** (tamaños máximos, almacenamiento) | Ajustes técnicos | Nunca se tocan en casa | Bajo, pero poco valor comercial | Dejarlos libres: bloquearlos da mala imagen y no aporta |
| B9 | **Columnas especiales: Esperando (recordatorios), Revisión con requisitos, Entrega** | Automatismos por columna | «Esperando» sirve en casa («esperar al fontanero») | Medio | Dejar libres Esperando/Revisión; solo reservar Entrega (ver A1) y Presupuesto (ver B2) |

### Grupo C · Nunca bloquear (núcleo)

Tablero, tarjetas, subtareas, etiquetas, tipos básicos, fechas, repeticiones y Rutinas; arrastrar, selección múltiple, deshacer, filtros, atajos y dictado; comentarios, menciones, avisos y resumen diario; proyectos privados y de equipo; calendario y «Mis tareas»; columnas Planificación semanal, Lista consolidada (la compra), Agenda (.ics); documentación del proyecto; móvil y app instalable; apariencia e idioma; seguridad de la cuenta (verificación en dos pasos, sesiones, recuperar contraseña); administración de usuarios; **copias de seguridad cifradas y restauración**; exportar tus datos; email/SMTP e inicio con Google; dominio propio; actualizaciones.
Regla: **seguridad, copias y salida de datos nunca se bloquean** (sería una mala imagen y un riesgo real para la familia).

### Recomendación para empezar (5 funciones)

1. **Resumen para el cliente (PDF) + campo Cliente** (A1).
2. **Informe semanal por email** (A2).
3. **Descarga de logs en CSV y retención larga** (A3).
4. **Avisos por WhatsApp** (A4).
5. **Compartir con todo el dominio de Google Workspace** (A5).

Todas son funciones que una familia no ve ni echa en falta, y juntas dan el mensaje «la licencia profesional añade herramientas de empresa». Dejar el generador de release notes (A6) y los límites de usuarios (B5) para más adelante, solo si el propietario lo decide.

Alternativa honesta: **no bloquear nada** y confiar solo en la licencia legal, añadiendo una pestaña «Licencia» en Administración que diga «Esta instalación es: uso personal / con licencia profesional». Menos trabajo, ninguna fricción, y el mismo freno real. Los candados aportan sobre todo un recordatorio visible.

### Propuesta de activación por clave

**Cómo funcionaría**
- Al comprar, el propietario genera una **clave firmada** (un texto largo) con una herramienta propia: contiene nombre del titular, fecha de compra y, opcionalmente, el dominio del servidor. Se firma con una clave privada que solo tiene el propietario.
- En **Administración → Licencia** (pestaña nueva) el administrador **pega la clave**. La app comprueba la firma con la clave pública, que va incluida en el programa. Todo **sin conexión y sin llamar a casa**.
- Si es válida, se guarda en la base de datos y se desbloquean las funciones A. La pestaña muestra «Licencia profesional · titular · fecha». Sin clave, las funciones salen con candado y enlace a `/licencia`.
- Las actualizaciones no piden nueva clave (la licencia es perpetua): la clave no lleva caducidad ni número de versión.

**Pros**
- Funciona sin internet y sin servidor de licencias que mantener (encaja con «sin soporte»).
- No envía datos a nadie: coherente con «tus datos son tuyos».
- Sencilla de entender; el comprador puede reinstalar pegando la misma clave.
- Puede ir ligada al dominio (`APP_URL`) para que no circule tal cual entre empresas.

**Contras**
- **Se salta con facilidad**: el código es público, quien lo edite puede quitar la comprobación o compartir la clave.
- Una clave ligada al dominio obliga a reemitirla si el cliente cambia de dominio (soporte, aunque sea mínimo); sin ligarla, se puede copiar a otros servidores.
- No se puede revocar una clave filtrada sin llamar a casa.
- Hay que emitir claves (a mano o con un pequeño automatismo tras el pago) y guardar bien la clave privada: si se pierde, no se pueden firmar más.
- Algo de trabajo de mantenimiento: pruebas, textos en español e inglés, y no romper nunca el acceso a los datos si la licencia falta o caduca.

Conclusión: sirve como **recordatorio y como prueba de compra**, no como protección. Si se hace, que sea mínima: una sola comprobación en un único sitio, con los datos siempre accesibles.

---

## R38F2 · Ideas de otras plataformas que podríamos traer

**Ya lo tiene Pizarro (excluido):** subtareas, etiquetas, tipos, fechas límite y de inicio, repeticiones, calendario con arrastrar, comentarios con respuestas y @menciones, seguir tareas, avisos por email/WhatsApp, historial por tarea, deshacer/rehacer, filtros guardados, selección múltiple, duplicar, archivo, adjuntos y capturas pegadas, documentación del proyecto, plantillas de proyecto, exportar a .ics (columna Agenda), exportar/importar entre Pizarros, dictado, atajos, columnas con roles, informe PDF, presencia («quién está trabajando»), prioridad, coste y horas opcionales.
**No tiene (y es lo que sigue):** límites de tarjetas por columna, imagen de portada, tareas bloqueadas/dependientes, suscripción al calendario, importar desde Trello/CSV, enlace de lectura pública, búsqueda global, vista de lista/tabla, etc.

Orden: mejor relación beneficio/complejidad primero. ★ = top 5 recomendado.

| # | Idea | De dónde viene | Beneficio para equipos pequeños y familias | Complejidad | ¿Encaja con «simple»? |
|---|---|---|---|---|---|
| 1 ★ | **Importar desde Trello (JSON) y CSV** | Trello, Planka, Wekan, Kanboard | Quita la barrera de entrada: llevarse los tableros de la herramienta anterior en un minuto. Ayuda a vender | Media-baja (solo lectura de un fichero y crear tareas) | Sí, no añade nada al uso diario |
| 2 ★ | **Suscribirse al calendario (enlace .ics vivo)** | Vikunja, Planka, Asana, Trello (Power-Up), Todoist | Ver las fechas límite en el móvil/Google Calendar y que se actualicen solas, sin descargar el .ics a mano. Muy útil en familia | Media-baja (enlace con clave secreta por usuario) | Sí, ya existe la exportación; es dar un paso más |
| 3 ★ | **Límite de tarjetas por columna (WIP)** | Kanboard, Jira, Taiga, Trello (Power-Up) | Evita el exceso de «en curso»; es la esencia del Kanban. La columna se pone en rojo al pasar el límite (solo aviso) | Baja | Sí, es opcional por columna |
| 4 ★ | **Tareas bloqueadas / «depende de»** | Jira, Asana, Linear, GitHub Projects, Taiga | Marcar «bloqueada por esta otra» o «bloqueada» con un motivo; evita olvidar esperas. Una marca sencilla (sin diagramas) | Media-baja si es solo marca y enlace; alta si se pretende bloquear de verdad | Sí, en versión mínima (solo un icono y un enlace) |
| 5 ★ | **Imagen o color de portada en la tarjeta** | Trello, Planka, Notion | Reconocer tarjetas de un vistazo (una captura de la reforma, la foto del viaje). Ya hay adjuntos y color | Baja | Sí, es visual y opcional |
| 6 | **Enlace de solo lectura compartible** (tablero o informe) | Trello, Notion, Wekan, Taiga | Enseñar el estado a un cliente o a un familiar sin crearle cuenta | Media (seguridad: clave larga, caducidad, revocar) | Con cuidado; choca con «sin registro público», hacerlo opcional por proyecto |
| 7 | **Búsqueda global entre proyectos** | Notion, Linear, Asana, Jira | Encontrar una tarea sin saber en qué proyecto está; hoy se filtra solo en el tablero actual | Media | Sí |
| 8 | **Vista de lista o tabla ordenable** | Notion, Asana, Linear, GitHub Projects, Vikunja | Repasar muchas tareas rápido, ordenar por fecha o responsable; en móvil, más cómoda | Media | Sí, si es solo una vista y no otro sistema |
| 9 | **Plantilla de tarea (guardar una tarjeta como modelo)** | Trello, Asana, Notion | Crear «Revisión mensual» o «Visita al médico» con sus subtareas en un clic. Pizarro ya tiene predefinidas por tipo; esto sería por tarjeta | Baja | Sí |
| 10 | **Reglas sencillas «si pasa esto, haz esto»** (p. ej. al mover a «Hecho», poner fecha o asignar) | Trello (Butler), Asana, Jira, Planka | Ahorra clics repetidos | Alta si es general; **baja** con 3–4 reglas fijas (poner fecha de hoy, asignar a quien la mueve) | Solo en versión mínima: un menú de reglas fijas en la columna |
| 11 | **Avisar de tareas «paradas»** (sin cambios en N días) | Jira, Linear, Kanboard | Detecta lo que se ha atascado; Pizarro ya tiene «Esperando» | Baja | Sí |
| 12 | **Registrar el tiempo con un cronómetro** | Kanboard, Taiga, Vikunja, Jira | Horas reales sin teclearlas; útil a autónomos | Media | Dudoso: es de profesionales, encaja mejor como función de pago |
| 13 | **Reacciones con emoji en comentarios** | Planka, Linear, GitHub Projects, Notion | Responder «visto» o «de acuerdo» sin escribir; evita comentarios vacíos | Baja-media | Sí, aunque aporta poco |
| 14 | **Votos o «me gusta» en tarjetas** | Trello, Taiga, Wekan | Decidir en familia dónde ir de viaje o qué comprar | Baja | Sí, pero de nicho |
| 15 | **Crear tarea por email** (reenviar un correo al tablero) | Trello, Asana, Jira | Guardar lo que llega al correo; útil, sobre todo en el móvil | Alta (necesita recibir correo en el servidor) | No: añade infraestructura |
| 16 | **Hacer una tarjeta desde una plantilla de proyecto compartida entre servidores / galería** | Notion, Trello | Descubrir plantillas hechas por otros | Alta (necesita catálogo online) | No |
| 17 | **Vista Gantt / cronograma** | Asana, Jira, Taiga, GitHub Projects, Wekan | Ver plazos encadenados de un proyecto grande | Alta | No: contradice «ligero» (el calendario con franjas ya cubre lo básico) |
| 18 | **Hitos o ciclos (sprints) con burndown** | Jira, Linear, Taiga | Medir ritmo del equipo | Alta | No: es complejidad de empresa; ya hay entregables |
| 19 | **API / webhooks / conexión con Slack, Telegram** | Trello, Jira, Linear, Planka, Focalboard | Integrar con otras herramientas; Telegram es la alternativa gratuita a WhatsApp | Media (Telegram), alta (API pública) | Telegram sí (sustituye a WhatsApp); API abierta, no |
| 20 | **Campos personalizados por proyecto** | Notion, Jira, Asana, Linear | Poder añadir «Lugar» o «Precio» a medida | Alta | No: ya hay campos opcionales fijos (coste, horas, prioridad, cliente) que cubren lo común |

### Top 5 recomendado

1. **Importar desde Trello y CSV** (beneficio comercial inmediato, no toca el uso diario).
2. **Suscripción al calendario** (mucho valor en familia, aprovecha lo que ya hay).
3. **Límite de tarjetas por columna** (casi gratis y muy «Kanban»).
4. **Tareas bloqueadas** en versión mínima (marca + enlace a la otra tarea).
5. **Portada en la tarjeta** (imagen o color).

Si hay que sacrificar uno, el 4 es el que más puede complicar la interfaz; el sustituto natural es la **plantilla de tarea** (nº 9) o la **búsqueda global** (nº 7).

Nota: del 17 al 20 está justificado dejarlos fuera por complejidad; sirven para decirle «no» a quien los pida.

---

# Reglas sencillas «si pasa esto, haz esto» (diseño propuesto, sin implementar)

Objetivo: ahorrar clics repetidos sin convertir Pizarro en una herramienta de automatización. Por eso, un catálogo
**cerrado** de disparadores y acciones, frases legibles y nada de reglas encadenadas.

## Cómo lo vería la persona

*Ajustes del proyecto → Tablero → Reglas* (solo quien gestiona el proyecto), con una lista de frases editables:

- «Cuando una tarjeta **llega a** [En curso] → **asignarla a** [quien la mueve]»
- «Cuando una tarjeta **llega a** [Hecho] → **marcar todas sus subtareas** como hechas»
- «Cuando se **completan todas las subtareas** → **mover a** [Revisión]»
- «Cuando se **crea** una tarjeta de tipo [Corrección] → **poner la etiqueta** [Urgente]»
- «Cuando una tarjeta **vence** → **avisar a** [su responsable]»
- «Cuando una tarjeta **lleva N días** en [Esperando] → **mover a** [Por hacer]»

Cada regla se puede pausar; tope de 10 por proyecto.

## Catálogo inicial

- **Disparadores** (eventos que la app ya registra en el historial de la tarea, `src/lib/task-events.ts`): llega a
  columna X, sale de columna X, se crea (opcionalmente de tipo X o con etiqueta Y), se completan todas sus subtareas, se
  asigna, vence o le quedan N días, lleva N días en una columna.
- **Acciones**: mover a columna, asignar a una persona o a quien hizo el cambio, poner o quitar etiqueta, poner fecha
  límite (+N días), marcar subtareas hechas, archivar, avisar a una persona.

## Cómo funcionaría por dentro

1. **Modelo**: tabla `ProjectRule` (proyecto, disparador y sus parámetros, acción y sus parámetros, activa, orden), con
   validación estricta de que columnas, tipos, etiquetas y personas pertenecen al proyecto.
2. **Ejecución de los disparadores de cambio**: en `runAction`, justo donde hoy se guardan los eventos del historial
   (`saveTaskEvents`), se buscan las reglas activas del proyecto que encajan y se aplican en la misma operación. Así:
   - se guardan en el historial como «Regla: …» y entran en el **mismo paso de deshacer** que el cambio que las disparó;
   - **las reglas no disparan otras reglas** (un solo nivel), así no hay bucles;
   - si una regla falla (p. ej. la columna ya no existe), el cambio original sigue valiendo y se anota el aviso.
3. **Disparadores de tiempo** («vence», «lleva N días»): en el proceso periódico que ya existe
   (`src/lib/maintenance.ts` / `due-notices.ts`), con una marca para no repetir la misma regla sobre la misma tarjeta.
4. **Avisos en vivo**: los cambios hechos por reglas se publican como los demás, así las otras pestañas se actualizan.

## Coste y riesgos

- Esfuerzo medio: un modelo y su migración, el motor (unas 300–400 líneas), la pantalla de reglas y sus pruebas.
- Riesgo principal: que alguien no entienda por qué se movió una tarjeta. Por eso se anota siempre «Regla: …» en el
  historial y en el aviso, y se puede deshacer.
- Encaja con «simple» solo si el catálogo sigue cerrado: nada de condiciones combinadas («y/o») ni reglas encadenadas.

**Recomendación:** empezar con 3 reglas fijas que se activan con una casilla («al llegar a Hecho, completar subtareas»,
«al completar subtareas, mover a…», «al vencer, avisar al responsable») y solo después abrir el editor de frases.
