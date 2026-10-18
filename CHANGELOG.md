# Changelog

Historial de versiones de Tablón. Fuente: `changelog.json`.

## v1.0.0 — 2026-10-18

Primera versión de Tablón: kanban multiproyecto y generador de release notes.

### Nuevas funcionalidades

- Tablero Kanban multiproyecto con arrastrar y soltar entre columnas y dentro de cada columna.
- Columnas configurables por proyecto: crear, renombrar, reordenar, asignar rol y borrar cuando están vacías.
- Tarjetas con tipo (Feature, Fix, Chore, Refactor, Hotfix), color, responsable, etiquetas, enlace externo, checklist y descripción en Markdown.
- Capturas pegadas desde el portapapeles o subidas desde archivo/cámara, optimizadas a WebP.
- Selección múltiple y movimiento en lote a «Siguiente salto a producción».
- Generador de release notes con cabecera y pie personales, editor con vista previa, copiar, descargar .md/.txt y «Marcar como desplegado».
- Histórico de releases por proyecto.
- Vista «Mis tareas asignadas».
- Visibilidad de proyectos restringible por usuario.
- Gestión de usuarios (máx. 5) con roles Admin y Miembro.
- Historial de versiones de la aplicación.

### Mejoras

- Interfaz adaptada a móvil con pestañas de columnas y botón flotante para crear tareas o subir capturas.

### Cambios técnicos / DB

- Next.js (App Router) + PostgreSQL con Prisma; migración inicial y seed.
- Sesiones en base de datos con cookie HttpOnly, SameSite=Lax y limitación de intentos de login.
- Despliegue en un único contenedor Docker con volumen persistente para adjuntos (Railway).
