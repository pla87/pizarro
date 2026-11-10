# Seguridad / Security

## Informar de un fallo de seguridad

**No abras una incidencia pública** para un fallo de seguridad: el repositorio es público y cualquiera podría
aprovecharlo antes de que haya una versión corregida.

Infórmalo en privado con **GitHub Security Advisories**: en este repositorio, pestaña *Security* →
**Report a vulnerability**, o directamente en <https://github.com/pla87/pizarro/security/advisories/new>. Solo lo
ven los mantenedores. Incluye:

- la versión de Pizarro (la de *Historial de versiones*) y cómo está instalada (Docker Compose, Railway, otro);
- qué se puede hacer con el fallo y quién podría hacerlo (sin cuenta, un miembro, un administrador…);
- los pasos para reproducirlo, con datos de prueba (`example.com`), nunca datos reales de personas.

Recibirás respuesta en la propia notificación. Cuando haya una versión corregida se publica en
[Releases](https://github.com/pla87/pizarro/releases) y, si procede, el aviso de seguridad.

## Versiones con soporte

Solo se corrigen fallos en la **última versión publicada**, sin modificar. Para recibir las correcciones, actualiza
(`docs/INSTALL.md`, sección 5). En Railway, despliega desde la rama `stable`.

## Otros errores

Los errores que no son de seguridad se informan en público con el formulario de incidencias (enlace *Informar de
un error* en *Historial de versiones* dentro de la app, o *Issues → New issue*).

---

## Reporting a security vulnerability

**Do not open a public issue** for a security vulnerability. Report it privately through **GitHub Security
Advisories**: *Security* tab → **Report a vulnerability**, or <https://github.com/pla87/pizarro/security/advisories/new>.
Include the Pizarro version, how it is installed, the impact, and steps to reproduce using test data only.

Only the **latest released version**, unmodified, receives fixes. Other bugs go through the public issue form.
