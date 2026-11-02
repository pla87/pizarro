// Textos legales por defecto (Markdown) de /privacy y /terms, orientados al RGPD y la LOPDGDD (España/UE), en español e inglés.
// Llevan los marcadores {responsable} y {email}. Son plantillas: el responsable debe completarlas (proveedores, plazos) y
// revisarlas con un profesional jurídico. Plazos que reflejan la aplicación: sesión 14 días, dispositivo recordado 400 días,
// logs técnicos LOG_RETENTION_DAYS (7 por defecto, máx. 90), historial de tareas 365 días, copias 14 diarias + 6 mensuales.

const PRIVACY_ES = `## 1. Responsable del tratamiento

El responsable del tratamiento de tus datos personales en esta instalación de Pizarro es {responsable}. Puedes contactar para cualquier asunto de protección de datos en {email}. Pizarro es software libre; sus desarrolladores no tienen acceso a los datos de esta instalación.

## 2. Finalidades del tratamiento

Tratamos tus datos para:

- Gestionar tu cuenta de usuario y permitirte acceder al servicio.
- Gestionar proyectos, tareas, comentarios, archivos y notas de versión, y la colaboración con otras personas de tu equipo.
- Enviarte avisos por email relacionados con el servicio (asignaciones, menciones, recordatorios, restablecimiento de contraseña, códigos de verificación). No enviamos comunicaciones comerciales.
- Permitir el inicio de sesión con Google y la creación de documentos de Google Docs y Sheets, si el administrador lo ha activado y tú decides usarlo (opcional).
- Garantizar la seguridad del servicio (registros técnicos, detección de accesos indebidos) y realizar copias de seguridad.

## 3. Base jurídica

- La ejecución del servicio que has solicitado o del que formas parte por tu relación con {responsable} (art. 6.1.b RGPD): cuenta, proyectos, tareas y avisos del servicio.
- El interés legítimo de {responsable} en la seguridad de la información y la continuidad del servicio (art. 6.1.f RGPD): registros de seguridad y copias de seguridad.
- Tu consentimiento (art. 6.1.a RGPD) para el inicio de sesión con Google y la integración con Google Docs y Sheets; puedes retirarlo en cualquier momento desvinculando tu cuenta de Google, sin que ello afecte a la licitud del tratamiento anterior.
- El cumplimiento de obligaciones legales cuando corresponda (art. 6.1.c RGPD).

## 4. Datos que tratamos

- Identificación y contacto: nombre, dirección de email y, si la has indicado, tu teléfono o foto de perfil. La contraseña se guarda solo cifrada con hash, nunca en claro.
- Contenido que subes o escribes: proyectos, tareas, descripciones, comentarios, archivos adjuntos y enlaces. Eres responsable de no incluir datos innecesarios o de categorías especiales.
- Datos de uso, técnicos y de seguridad: dirección IP, navegador, fechas de acceso, dispositivos recordados, intentos de inicio de sesión y eventos de actividad.
- Si usas Google: tu nombre, email y perfil básico para reconocer tu cuenta, y acceso solo a los archivos que crea la propia aplicación; no vemos el resto de tu Drive.

No usamos analítica de terceros ni publicidad, ni elaboramos perfiles con efectos jurídicos sobre ti.

## 5. Destinatarios y encargados del tratamiento

No vendemos ni cedemos tus datos a terceros con fines propios. Pueden acceder a ellos, como encargados del tratamiento y con las garantías del art. 28 RGPD:

- El proveedor de alojamiento (servidor) de esta instalación.
- El proveedor del servicio de correo electrónico usado para los avisos.
- El proveedor de almacenamiento de las copias de seguridad, si se usa uno externo.
- Google, solo si se usa el inicio de sesión con Google o la integración con Docs y Sheets.

El responsable debe indicar aquí los proveedores concretos que utiliza. Dentro de tu organización, el resto de miembros de un proyecto ven el contenido y tu nombre en ese proyecto, y los administradores pueden gestionar cuentas y proyectos.

## 6. Transferencias internacionales

Si alguno de los proveedores anteriores trata datos fuera del Espacio Económico Europeo, la transferencia se ampara en una decisión de adecuación de la Comisión Europea, en cláusulas contractuales tipo u otra garantía adecuada del capítulo V del RGPD. Puedes pedir información sobre estas garantías escribiendo a {email}.

## 7. Plazos de conservación

- Cuenta y contenido: mientras tu cuenta esté activa. Al darla de baja se suprimen o anonimizan tus datos, salvo los que haya que conservar por obligación legal (bloqueados hasta que prescriban las responsabilidades).
- Registros técnicos y de seguridad (con IP): 7 días por defecto (el administrador puede ampliarlo hasta 90 días).
- Historial de actividad de las tareas: hasta 365 días.
- Copias de seguridad: se conservan las diarias de las últimas dos semanas y las mensuales de los últimos seis meses; los datos suprimidos desaparecen de las copias al rotar.
- Sesión iniciada: 14 días; dispositivo recordado: hasta 400 días.

## 8. Tus derechos

Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad escribiendo a {email}, indicando qué derecho ejerces y acreditando tu identidad. Responderemos en el plazo de un mes. Si consideras que no se han atendido correctamente, puedes presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD, [www.aepd.es](https://www.aepd.es)) o ante la autoridad de control de tu país.

## 9. Seguridad

Aplicamos medidas técnicas y organizativas adecuadas: conexiones cifradas en tránsito (HTTPS), contraseñas almacenadas con hash, verificación en dos pasos (2FA) disponible y obligatoria para administradores, control de acceso por proyecto, límites de intentos de acceso y copias de seguridad cifradas. Si se produjera una brecha que te afecte, se te notificará conforme a la ley.

## 10. Cookies

Solo usamos cookies técnicas estrictamente necesarias, que no requieren consentimiento. No usamos cookies de analítica ni de publicidad.

- Sesión (\`tablon_session\`, o \`__Host-tablon_session\` con HTTPS): mantiene tu inicio de sesión; caduca a los 14 días.
- Verificación en dos pasos (\`pz_2fa\`): recuerda brevemente que estás completando el segundo factor.
- Dispositivo recordado (\`pz_device\`): evita pedir el segundo factor en un dispositivo de confianza; hasta 400 días.
- Cambio de contraseña (\`pz_pwchange\`): indica que debes cambiar la contraseña antes de continuar.
- Inicio de sesión con Google (\`pz_glogin\`): protege el proceso de acceso con Google; dura unos minutos.

Tu preferencia de idioma se guarda en tu cuenta, no en una cookie.

## 11. Cambios en esta política

Podemos actualizar esta política; la versión vigente es siempre la publicada aquí, con su fecha de última actualización. Si el cambio es relevante, te lo comunicaremos.`;

const PRIVACY_EN = `## 1. Data controller

The controller of your personal data in this Pizarro installation is {responsable}. For any data protection matter, contact {email}. Pizarro is free software; its developers have no access to the data of this installation.

## 2. Purposes of processing

We process your data to:

- Manage your user account and let you access the service.
- Manage projects, tasks, comments, files and release notes, and collaboration with others on your team.
- Send you service-related emails (assignments, mentions, reminders, password reset, verification codes). We send no marketing.
- Allow sign-in with Google and the creation of Google Docs and Sheets, if the administrator has enabled it and you choose to use it (optional).
- Keep the service secure (technical logs, detection of improper access) and make backups.

## 3. Legal basis

- Performance of the service you requested or are part of through your relationship with {responsable} (Art. 6(1)(b) GDPR): account, projects, tasks and service notices.
- The legitimate interest of {responsable} in information security and service continuity (Art. 6(1)(f) GDPR): security logs and backups.
- Your consent (Art. 6(1)(a) GDPR) for sign-in with Google and the Google Docs and Sheets integration; you can withdraw it at any time by unlinking your Google account, without affecting the lawfulness of earlier processing.
- Compliance with legal obligations where applicable (Art. 6(1)(c) GDPR).

## 4. Data we process

- Identification and contact: name, email address and, if you provided them, your phone number or profile picture. Your password is stored only as a hash, never in clear text.
- Content you upload or write: projects, tasks, descriptions, comments, attachments and links. You are responsible for not including unnecessary data or special-category data.
- Usage, technical and security data: IP address, browser, access dates, remembered devices, sign-in attempts and activity events.
- If you use Google: your name, email and basic profile to recognise your account, and access only to files created by the app itself; we cannot see the rest of your Drive.

We use no third-party analytics or advertising, and we do not profile you in ways that produce legal effects.

## 5. Recipients and processors

We do not sell or give your data to third parties for their own purposes. The following may access it as processors, under the safeguards of Art. 28 GDPR:

- The hosting provider (server) of this installation.
- The email service provider used for notices.
- The backup storage provider, if an external one is used.
- Google, only if sign-in with Google or the Docs and Sheets integration is used.

The controller should name the specific providers it uses here. Within your organisation, other members of a project see the content and your name in that project, and administrators can manage accounts and projects.

## 6. International transfers

If any of the providers above processes data outside the European Economic Area, the transfer relies on a European Commission adequacy decision, standard contractual clauses or another appropriate safeguard under Chapter V GDPR. You can request information about these safeguards by writing to {email}.

## 7. Retention periods

- Account and content: while your account is active. When it is closed, your data is deleted or anonymised, except what must be kept to meet legal obligations (blocked until liability expires).
- Technical and security logs (with IP): 7 days by default (the administrator may extend this up to 90 days).
- Task activity history: up to 365 days.
- Backups: daily backups of the last two weeks and monthly backups of the last six months are kept; deleted data disappears from backups as they rotate.
- Signed-in session: 14 days; remembered device: up to 400 days.

## 8. Your rights

You can exercise your rights of access, rectification, erasure, objection, restriction of processing and portability by writing to {email}, stating which right you are exercising and proving your identity. We will reply within one month. If you believe your request was not handled properly, you can lodge a complaint with the Spanish Data Protection Agency (AEPD, [www.aepd.es](https://www.aepd.es)) or with the supervisory authority of your country.

## 9. Security

We apply appropriate technical and organisational measures: encrypted connections in transit (HTTPS), hashed passwords, two-factor authentication (2FA) available and mandatory for administrators, per-project access control, sign-in attempt limits and encrypted backups. If a breach affecting you occurs, you will be notified as required by law.

## 10. Cookies

We only use strictly necessary technical cookies, which do not require consent. We use no analytics or advertising cookies.

- Session (\`tablon_session\`, or \`__Host-tablon_session\` over HTTPS): keeps you signed in; expires after 14 days.
- Two-factor verification (\`pz_2fa\`): briefly remembers that you are completing the second factor.
- Remembered device (\`pz_device\`): avoids asking for the second factor on a trusted device; up to 400 days.
- Password change (\`pz_pwchange\`): indicates that you must change your password before continuing.
- Google sign-in (\`pz_glogin\`): protects the Google sign-in flow; lasts a few minutes.

Your language preference is stored in your account, not in a cookie.

## 11. Changes to this policy

We may update this policy; the current version is always the one published here, with its last-updated date. If a change is significant, we will let you know.`;

const TERMS_ES = `## 1. Objeto

Estas condiciones regulan el uso de esta instalación de Pizarro, una herramienta de gestión de tareas y proyectos en equipo operada por {responsable}. Al usar el servicio las aceptas.

## 2. Acceso y cuentas

Solo pueden usar el servicio las personas a las que {responsable} ha dado de alta o invitado. Eres responsable de mantener la confidencialidad de tus credenciales y de la actividad realizada con tu cuenta; avisa cuanto antes en {email} si sospechas un uso no autorizado. Debes facilitar datos veraces y no compartir tu cuenta.

## 3. Uso aceptable

No puedes usar el servicio para fines ilícitos, para vulnerar derechos de terceros, para enviar malware o spam, ni para intentar acceder a datos o cuentas ajenos, interferir en el funcionamiento o eludir las medidas de seguridad y los límites establecidos.

## 4. Contenido de los usuarios

El contenido que subes o escribes sigue siendo tuyo (o de quien te lo licencie o de tu organización). Concedes a {responsable} el permiso necesario para almacenarlo, mostrarlo a los miembros de tus proyectos y copiarlo en las copias de seguridad, solo para prestar el servicio. Eres responsable de que tengas derecho a subirlo y de que no sea ilícito, ofensivo ni vulnere derechos de terceros.

## 5. Disponibilidad y copias de seguridad

El servicio se ofrece tal cual, sin garantía de disponibilidad continua; puede haber interrupciones por mantenimiento o fallos. Se realizan copias de seguridad periódicas, pero no se garantiza la recuperación de todo el contenido: conserva una copia de lo importante.

## 6. Limitación de responsabilidad

En la medida permitida por la ley, {responsable} no responde de daños indirectos, lucro cesante o pérdida de datos derivados del uso o la imposibilidad de usar el servicio, salvo dolo o negligencia grave. Esto no limita los derechos que la ley reconozca irrenunciablemente a los consumidores.

## 7. Suspensión y baja

{responsable} puede suspender o cancelar cuentas que incumplan estas condiciones o pongan en riesgo la seguridad del servicio. Puedes pedir la baja de tu cuenta en cualquier momento escribiendo a {email}; tus datos se tratarán según la política de privacidad.

## 8. Protección de datos

El tratamiento de tus datos personales se describe en la política de privacidad de esta instalación.

## 9. Licencia del software

Pizarro se usa bajo su propia licencia, que puedes consultar en [/licencia](/licencia). El uso con fines empresariales o profesionales requiere una licencia comercial, y {responsable} es quien debe disponer de ella para esta instalación.

## 10. Cambios

Podemos modificar estas condiciones; la versión vigente es la publicada aquí. Si el cambio es relevante, te lo comunicaremos, y el uso continuado del servicio implica su aceptación.

## 11. Ley aplicable y jurisdicción

Estas condiciones se rigen por la ley española. Para cualquier controversia, las partes se someten a los juzgados y tribunales que correspondan conforme a la ley, respetando el fuero que corresponda a los consumidores.

## 12. Contacto

Para cualquier duda sobre estas condiciones, escribe a {email}.`;

const TERMS_EN = `## 1. Purpose

These terms govern the use of this installation of Pizarro, a team task and project management tool operated by {responsable}. By using the service you accept them.

## 2. Access and accounts

Only people whom {responsable} has registered or invited may use the service. You are responsible for keeping your credentials confidential and for activity carried out with your account; let us know as soon as possible at {email} if you suspect unauthorised use. You must provide truthful data and not share your account.

## 3. Acceptable use

You may not use the service for unlawful purposes, to infringe third-party rights, to send malware or spam, or to try to access other people's data or accounts, interfere with how the service works, or bypass security measures and established limits.

## 4. User content

The content you upload or write remains yours (or that of whoever licenses it to you or of your organisation). You grant {responsable} the permission needed to store it, show it to the members of your projects and copy it into backups, solely to provide the service. You are responsible for having the right to upload it and for it not being unlawful, offensive or infringing third-party rights.

## 5. Availability and backups

The service is provided as is, with no guarantee of continuous availability; there may be interruptions for maintenance or faults. Backups are made periodically, but recovery of all content is not guaranteed: keep a copy of anything important.

## 6. Limitation of liability

To the extent permitted by law, {responsable} is not liable for indirect damages, loss of profit or loss of data arising from the use of, or inability to use, the service, except in cases of wilful misconduct or gross negligence. This does not limit rights that the law grants to consumers and that cannot be waived.

## 7. Suspension and termination

{responsable} may suspend or cancel accounts that breach these terms or put the security of the service at risk. You may ask for your account to be closed at any time by writing to {email}; your data will be handled according to the privacy policy.

## 8. Data protection

How your personal data is processed is described in this installation's privacy policy.

## 9. Software licence

Pizarro is used under its own licence, which you can read at [/licencia](/licencia?lang=en). Use for business or professional purposes requires a commercial licence, and {responsable} is responsible for holding it for this installation.

## 10. Changes

We may amend these terms; the current version is the one published here. If a change is significant, we will let you know, and continued use of the service means acceptance.

## 11. Governing law and jurisdiction

These terms are governed by Spanish law. For any dispute, the parties submit to the courts that have jurisdiction under the law, respecting the forum that applies to consumers.

## 12. Contact

For any question about these terms, write to {email}.`;

export const LEGAL_DEFAULTS = {
  privacy: { es: PRIVACY_ES, en: PRIVACY_EN },
  terms: { es: TERMS_ES, en: TERMS_EN },
} as const;
