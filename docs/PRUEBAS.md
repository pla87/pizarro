# Pruebas en real

Lo que no se puede comprobar con las pruebas automáticas porque necesita cuentas o servicios de verdad (Google, Meta, Telegram, un servidor de correo, Stripe, Railway, un móvil). Hazlas en tu instalación real después de desplegar.

Cómo usar esta lista:

- Cada prueba dice **qué necesitas**, los **pasos**, **qué debe pasar** y **qué mirar si falla**.
- Para mirar los fallos: **Administración → Logs**. Escribe en **Buscar (acción, mensaje, ruta)** la palabra que indica cada prueba y, si hace falta, filtra por **Nivel** o **Categoría**. Los logs nunca muestran tokens ni contraseñas.
- Usa una **persona de prueba** (un usuario normal, no tu cuenta de administrador) para todo lo que borra o desconecta algo.
- Ejemplos de esta guía: `https://pizarro.example.com` es tu `APP_URL`.

## Resumen

| Hecho | Prueba | Necesitas |
|:---:|---|---|
| ☐ | 1.1 Baja de cuenta: Google pide la contraseña | Acceso con Google activo y una persona de prueba |
| ☐ | 1.2 Baja de cuenta: con otra cuenta de Google no deja | Dos cuentas de Google |
| ☐ | 2.1 WhatsApp: plantillas `aviso_pizarro` y `codigo_pizarro` aprobadas | Cuenta de Meta Business |
| ☐ | 2.2 WhatsApp: configurar y «Probar» | Token y Phone number ID |
| ☐ | 2.3 WhatsApp: conectar un número y recibir un aviso | Un móvil con WhatsApp |
| ☐ | 3.1 Telegram: crear el bot, configurarlo y «Probar» | App de Telegram |
| ☐ | 3.2 Telegram: conectar y recibir un aviso | App de Telegram |
| ☐ | 3.3 Telegram: modo webhook o sondeo | Saber cómo es tu `APP_URL` |
| ☐ | 4.1 Email: configurar y «Enviar email de prueba» | Servidor SMTP o Gmail con contraseña de aplicación |
| ☐ | 4.2 Email: invitación de una persona nueva | Un buzón de prueba |
| ☐ | 4.3 Email: «¿Olvidaste tu contraseña?» | El mismo buzón |
| ☐ | 4.4 Email: avisos y resumen diario | El mismo buzón |
| ☐ | 5.1 Licencia: botón «Comprar» sin enlace de pago | Nada |
| ☐ | 5.2 Licencia: registrar y declarar el uso | Nada |
| ☐ | 5.3 Stripe: compra de prueba y enlace real (pendiente) | Cuenta de Stripe |
| ☐ | 5.4 Web getpizarro.com | Dominio y GitHub Pages |
| ☐ | 6.1 Acceso normal con Google | Cliente OAuth de Google |
| ☐ | 6.2 Google Docs, Sheets y Slides | API de Drive activada |
| ☐ | 6.3 Rama `stable` y «Mover stable» | Permisos en el repositorio de GitHub |
| ☐ | 6.4 Railway despliega desde `stable` | Proyecto de Railway |
| ☐ | 6.5 Copias: destino externo | Bucket S3 compatible o carpeta montada |
| ☐ | 6.6 Copias: restauración de prueba | Una base de datos vacía |
| ☐ | 6.7 App instalada en Android y iPhone, con su icono | Un Android y un iPhone |
| ☐ | 6.8 Dos instalaciones en el mismo móvil | Dos instalaciones de Pizarro |
| ☐ | 6.9 Calendario suscrito en Google, Apple y Outlook | Cuentas de calendario |
| ☐ | 6.10 Aviso de versión nueva | Publicar una versión |
| ☐ | 7.1 Exportar tareas e importarlas en otro proyecto (y en otra instalación) | Dos proyectos; mejor dos instalaciones |
| ☐ | 7.2 Pegar una tarea copiada en «Nueva tarea» y en otra tarea | Un proyecto |
| ☐ | 7.3 Importar desde Trello, Jira, GitHub, Asana y CSV de otras herramientas | Cuentas o exportaciones reales de esas herramientas |
| ☐ | 13.1 Railway desde cero sin `APP_URL` | Proyecto de prueba en Railway |
| ☐ | 13.2 Copias en R2 con bloqueo de retención | Cuenta de Cloudflare |
| ☐ | 13.3 Emails: citas, baja en un clic, «Esperando» | Email configurado |
| ☐ | 13.4 Dos cuentas en el mismo navegador e invitación en otro idioma | Dos cuentas |
| ☐ | 13.5 Cloudflare sin reescribir emails | Dominio con Cloudflare |
| ☐ | 13.6 Tablero en vivo con dos navegadores | Dos navegadores |
| ☐ | 14.1 Plantillas de serie tras actualizar | Tu instalación |
| ☐ | 14.2 Informar de un error con captura | Instalación oficial |
| ☐ | 14.3 Avisos por email, invitación sin email y usuarios sin tope | Tu instalación |
| ☐ | 14.4 Calendario con el dedo en una tableta | Un iPad o tableta |
| ☐ | 14.5 Copias en R2 con bloqueo | Bucket con la regla |

## 1. Baja de cuenta con Google

Quien entra con Google y no conoce su contraseña de Pizarro confirma el borrado de su cuenta de otra forma. Una de ellas es **Volver a entrar con Google**, y ahí Google tiene que pedir la contraseña aunque la sesión de Google ya esté abierta (Pizarro lo pide con `prompt=login` y `max_age=0`, y a la vuelta comprueba la hora en la que Google dice que te identificaste).

### 1.1 Google pide la contraseña

**Necesitas:** el acceso con Google activo (prueba 6.1) y una persona de prueba cuyo email sea una cuenta de Google tuya. Que **no** tenga la verificación en dos pasos con app: si la tiene, el diálogo pide ese código en lugar de ofrecer Google. No uses tu cuenta de administrador: el borrado es de verdad.

1. En el navegador, deja abierta la sesión de Google de esa cuenta (por ejemplo, con Gmail abierto en otra pestaña).
2. Entra en Pizarro con esa persona usando **Iniciar sesión con Google**.
3. Ve a **Mi perfil → Cuenta** y, al final, pulsa **Borrar mi cuenta**.
4. Pulsa **Entro con Google y no conozco mi contraseña**. Debe salir el texto «Google te pedirá la contraseña de tu cuenta de Google aunque ya tengas la sesión abierta.»
5. Pulsa **Volver a entrar con Google**.
6. Escribe la contraseña en Google y vuelve a Pizarro.

**Qué debe pasar:**

- En el paso 5, Google **pide la contraseña** (o volver a identificarte). Si solo te deja elegir la cuenta y vuelve sin pedir nada, la prueba no vale.
- De vuelta en Pizarro aparece «Has vuelto a entrar con Google: ya puedes borrar tu cuenta.»
- Al escribir **BORRAR** y confirmar, la cuenta se borra y vuelves a la pantalla de acceso con «Tu cuenta se ha borrado.»
- La confirmación vale 10 minutos y solo en ese navegador: si esperas más, hay que repetirla.

**Si Google no pide la contraseña:** Pizarro no debe dar la confirmación por buena. El diálogo muestra «Google no te ha pedido la contraseña. Para borrar la cuenta tienes que escribir la contraseña de tu cuenta de Google: vuelve a intentarlo.» y la cuenta sigue ahí. Es el comportamiento correcto; anótalo si te pasa siempre con tu cuenta (por ejemplo, con llaves de acceso), porque entonces esa persona tendría que usar el código por email.

**Si falla, en Logs busca** `googleReauth`: `auth.googleReauth` es la confirmación correcta y `auth.googleReauthFailed` (nivel aviso) explica el motivo. Otros mensajes del diálogo: «No se pudo confirmar con Google. Vuelve a intentarlo.» (falló la vuelta de Google; revisa la dirección de redirección de la prueba 6.1).

### 1.2 Con otra cuenta de Google no deja

**Necesitas:** otra persona de prueba y una segunda cuenta de Google distinta.

1. Repite los pasos 1 a 5 de la prueba 1.1.
2. En Google, elige la **otra** cuenta y escribe su contraseña.

**Qué debe pasar:** el diálogo dice «Esa cuenta de Google no es la de tu cuenta de Pizarro.» y no deja borrar.

**Si falla, en Logs busca** `googleReauthFailed`: debe haber una línea con «ha vuelto a entrar con otra cuenta de Google».

## 2. WhatsApp

Guía completa, con los textos exactos: [docs/guias/whatsapp.md](guias/whatsapp.md) (también en getpizarro.com, en **Guías**). Meta cobra cada mensaje entregado, también los de prueba y los códigos.

### 2.1 Crear las dos plantillas en Meta

**Necesitas:** una cuenta de Meta Business, la app de Meta for Developers con el producto WhatsApp, un número que envía (el de prueba de Meta sirve) y un token permanente de un usuario del sistema (pasos 1 a 4 de la guía).

1. En WhatsApp Manager, **Plantillas de mensajes → Crear plantilla**.
2. Plantilla de avisos: categoría **Utilidad**, nombre `aviso_pizarro` (exacto), idioma **Español** (`es`). En el cuerpo, el texto de la guía (paso 5), con las tres variables `{{1}}`, `{{2}}` y `{{3}}`. Sin cabecera, sin pie y sin botones. Rellena los ejemplos que pide Meta.
3. Plantilla del código: categoría **Autenticación**, nombre `codigo_pizarro` (exacto), el mismo idioma, entrega **Copiar código** y caducidad de **15 minutos** (paso 6 de la guía). El texto lo pone Meta.
4. Envía las dos y espera.

**Qué debe pasar:** las dos quedan en estado **Aprobada** (de minutos a un día).

**Si falla:** si Meta la rechaza o la cambia de categoría, revisa que el cuerpo sea el de la guía, sin añadidos. Esto ocurre en Meta: en los Logs de Pizarro todavía no hay nada.

### 2.2 Configurar en Pizarro y «Probar»

**Necesitas:** las dos plantillas aprobadas, el token y el **Phone number ID**.

1. **Administración → Integraciones → 3. Avisos por Telegram y WhatsApp → WhatsApp**.
2. Rellena **Token de acceso**, **Identificador del número (Phone number ID)**, **Nombre de la plantilla** (`aviso_pizarro`), **Idioma** (`es`, o el código exacto con el que se aprobó) y **Plantilla de verificación** (`codigo_pizarro`).
3. Pulsa **Guardar** y después **Activar**.
4. Escribe un número en formato internacional (`+34600111222`) y pulsa **Probar**. Con el número de prueba de Meta, tiene que ser uno de los 5 verificados.

**Qué debe pasar:** llegan **dos** WhatsApp: «Mensaje de prueba de Pizarro…» (plantilla de avisos) y un código de muestra, `123456`, con el botón **Copiar código** (plantilla de verificación). El token ya no se vuelve a mostrar, solo sus 4 últimos caracteres.

**Si falla:** la propia pantalla dice qué plantilla falló y el error de Meta. Los más habituales: **132001** (nombre o idioma no coinciden; `es` no es `es_ES`), **132000** (la plantilla no tiene exactamente tres variables, o `codigo_pizarro` no es de Autenticación), **131030** (con el número de prueba, el destino no está entre los verificados) y **190 o 401** (token caducado o sin permisos). En Logs busca `whatsapp` (`settings.testWhatsapp`; el teléfono sale enmascarado).

### 2.3 Conectar un número y recibir un aviso real

**Necesitas:** dos personas en un proyecto (tú y una de prueba) y un móvil con WhatsApp.

1. Con la persona que va a recibir: **Mi perfil → Avisos → Avisos en el móvil → WhatsApp**. Escribe el número (`+34…`) y marca la casilla de consentimiento.
2. Pulsa **Guardar y enviar código**. Llega «Tu código de verificación es 123456.» con el botón **Copiar código**.
3. Escribe las 6 cifras y pulsa **Confirmar**.
4. Deja marcadas menciones y asignaciones y pulsa **Guardar**.
5. Con la otra persona, asígnale una tarea o menciónala en un comentario.

**Qué debe pasar:** llega un WhatsApp «Aviso de Pizarro: … (proyecto …)» con el enlace a la tarea, y el enlace abre esa tarea. El aviso también está en la campana.

Comprueba además:

- Un código equivocado no conecta; tras 5 intentos o 15 minutos hay que pulsar **Enviar otro código**.
- Con el canal desconectado en Mi perfil, deja de llegar.

**Si falla:** «No llega el código»: revisa el formato del número y los límites (3 envíos al día por número, 5 por persona). «No llega el aviso»: comprueba que el número está confirmado y que ese tipo de aviso está marcado para WhatsApp; como mucho salen 10 por persona y hora. En Logs busca `whatsapp`: `notify.whatsapp` es un envío correcto, `notify.whatsappFailed` trae el error de Meta y `notify.whatsappRateLimited` indica que se alcanzó el tope por hora. El error **131026** significa que ese número no acepta mensajes de empresas.

## 3. Telegram

Guía completa: [docs/guias/telegram.md](guias/telegram.md). Es gratis.

### 3.1 Crear el bot, configurarlo y «Probar»

**Necesitas:** la app de Telegram.

1. En Telegram, abre **@BotFather** (el verificado) y escribe `/newbot`. Dale un nombre y un usuario que termine en `bot`. Copia el token.
2. En Pizarro: **Administración → Integraciones → 3. Avisos por Telegram y WhatsApp → Telegram (gratis)**. Pega el token en **Token del bot** y pulsa **Guardar y activar**.
3. Pulsa **Probar**.

**Qué debe pasar:** aparece «Activo: bot @…» con el usuario de tu bot y el modo (webhook o sondeo). **Probar** confirma que el bot responde. El token no se vuelve a mostrar.

**Si falla:** «Telegram no acepta este token»: cópialo entero, sin espacios. «Telegram ha respondido con un error»: con webhook, la dirección https no es accesible desde Internet o el certificado no es válido. En Logs busca `telegram` (`telegram.webhookFailed`, `telegram.syncFailed`).

### 3.2 Conectar en Mi perfil y recibir un aviso

**Necesitas:** dos personas en un proyecto y Telegram en el móvil o en el ordenador.

1. **Mi perfil → Avisos → Avisos en el móvil**, pulsa **Conectar Telegram**.
2. Pulsa **Abrir Telegram** (o escanea el código QR con el móvil).
3. En Telegram, pulsa **Iniciar**.
4. Vuelve a Pizarro, elige qué avisos quieres y pulsa **Guardar**.
5. En **Administración → Integraciones**, pulsa otra vez **Probar**.
6. Con la otra persona, asígnate una tarea o menciónate.

**Qué debe pasar:** el bot responde «Listo…» y Pizarro muestra «Conectado». Tras el paso 5 llega «Mensaje de prueba de Pizarro». Tras el paso 6 llega el aviso con el enlace a la tarea.

Comprueba además: escribir `/stop` al bot desconecta (Mi perfil deja de decir «Conectado»); el enlace de conexión sirve una sola vez y caduca a los 10 minutos.

**Si falla:** si Pizarro se queda esperando, comprueba que pulsaste **Iniciar** y que el enlace no caducó. En Logs busca `telegram`: `notify.telegramLinked` es una conexión correcta, `notify.telegramFailed` es un aviso que no salió y `notify.telegramDisconnected` indica que Pizarro desconectó a alguien (bloqueó el bot o borró el chat).

### 3.3 Modo webhook o sondeo

Pizarro elige solo, según `APP_URL`. Prueba el que te toque (o los dos, si tienes una instalación de cada tipo).

- **Webhook** (`APP_URL` https pública, puertos 443, 80, 88 u 8443): el estado en Ajustes dice **webhook**. Al pulsar **Iniciar** en Telegram, «Conectado» aparece al instante.
- **Sondeo** (instalación en casa o en la oficina: `http://`, una IP u otro puerto): el estado dice **sondeo**. Funciona sin abrir puertos; conectar puede tardar un par de segundos más. Solo vale con **una** instancia de Pizarro.

**Qué debe pasar:** el modo que muestra Ajustes coincide con tu `APP_URL` y los avisos llegan igual en los dos.

**Si falla:** en webhook, busca en Logs `telegram.webhookFailed` (Telegram no llega a tu dirección) o `telegram.webhookUnauthorized` (llamadas sin el secreto: no es Telegram). Si cambiaste `APP_URL`, reinicia: Pizarro registra el webhook al arrancar y lo reintenta solo.

## 4. Email

### 4.1 Configurar y «Enviar email de prueba»

**Necesitas:** una de las dos opciones de **Administración → Integraciones → 1. Avisos por email**:

- **Gmail de un administrador (uso familiar):** en esa cuenta de Google activa la verificación en 2 pasos y crea una **contraseña de aplicación** en `myaccount.google.com/apppasswords`.
- **Correo de la empresa:** los datos SMTP de tu proveedor (Google Workspace, Brevo, SendGrid, Amazon SES, Mailgun…).

1. Rellena la opción elegida. Con Gmail, la dirección y la contraseña de aplicación (no la normal).
2. Pulsa **Guardar**.
3. Pulsa **Enviar email de prueba**.

**Qué debe pasar:** el email de prueba llega a tu buzón (mira también la carpeta de correo no deseado). El remitente y el nombre son los esperados. La contraseña no se vuelve a mostrar.

**Si falla:** la pantalla muestra el error del servidor de correo (usuario o contraseña, puerto, seguridad). El botón está desactivado si hay cambios sin guardar. Si el servidor tiene variables `SMTP_*`, mandan ellas y la tarjeta es de solo lectura. En Logs busca `email`.

### 4.2 Invitación de una persona nueva

**Necesitas:** el email funcionando y un buzón de prueba.

1. **Administración → Usuarios**: crea una persona con el email de ese buzón.
2. Abre el email de invitación y pulsa el enlace.
3. Elige una contraseña y entra.

**Qué debe pasar:** llega la invitación; el enlace apunta a tu `APP_URL` (no a `localhost` ni a otra dirección), vale 72 horas y deja elegir la contraseña. **Reenviar invitación** manda otro enlace.

**Si falla:** en Logs busca `auth.email`: `auth.emailSent` es un envío correcto y `auth.emailFailed` trae el error. Si el enlace lleva a otra dirección, corrige `APP_URL`.

### 4.3 «¿Olvidaste tu contraseña?»

1. Cierra la sesión. En la pantalla de acceso, pulsa **¿Olvidaste tu contraseña?** y escribe el email de la persona de prueba.
2. Abre el enlace del email y elige una contraseña nueva.
3. Prueba también con un email que no existe.

**Qué debe pasar:** el enlace llega en menos de un minuto, vale 30 minutos y solo una vez (al abrirlo por segunda vez ya no sirve). Tras cambiarla se cierran las demás sesiones de esa persona. Con el email que no existe, la pantalla responde igual y no llega nada.

**Si falla:** en Logs busca `auth.emailFailed`.

### 4.4 Avisos y resumen diario

**Necesitas:** dos personas en un proyecto.

1. Con la persona de prueba, en **Mi perfil → Avisos** deja activados los avisos por email y activa el **resumen diario por email** a una hora cercana.
2. Con la otra persona, menciónala en un comentario y asígnale una tarea con fecha límite.
3. Espera a la hora elegida. Las tareas de envío se ejecutan cada hora, así que puede tardar hasta una hora más.

**Qué debe pasar:** llega el aviso de la mención con el enlace a la tarea, y a su hora el resumen con la actividad del proyecto, lo asignado y lo vencido. Los enlaces abren tu instalación. En **Administración → Copias de seguridad**, la tabla de tareas de mantenimiento muestra **Resúmenes e informes por email** con su última ejecución.

**Si falla:** en Logs busca `notify.email`: `notify.email` es un envío correcto y `notify.emailFailed` trae el error. Si no hubo actividad desde el resumen anterior, puede no haber nada que enviar.

## 5. Stripe y el botón «Comprar»

Cómo está hoy el código:

- **No hay integración con Stripe dentro de Pizarro.** La venta se hace con un **Payment Link** de Stripe (un enlace público) que se pega en la constante `BUY_URL` de `src/lib/product.ts`. Guía: [docs/VENTA.md](VENTA.md).
- **`BUY_URL` está vacía: el enlace de pago está pendiente.** Mientras siga así, no hay nada que cobrar ni que probar en Stripe desde la app.
- **Pendiente de implementar (y no previsto): la activación automática.** No hay webhook de Stripe, ni claves de licencia, ni comprobación en línea. Tras pagar, el comprador anota su licencia a mano en **Administración → Licencia**; ese registro es solo informativo y no bloquea nada.

### 5.1 El botón «Comprar» sin enlace de pago (estado actual)

**Necesitas:** nada.

1. Abre **Administración → Licencia** y pulsa **Comprar licencia (100 € + IVA)**.
2. Cierra la sesión, abre la página de presentación (`/presentacion`) y pulsa **Comprar**.
3. Repite con y sin email de contacto público en **Administración → Textos legales**.

**Qué debe pasar:** con email de contacto, el botón abre un correo nuevo a esa dirección; sin él, lleva a la página `/licencia`. Nunca debe llevar a una página rota.

**Si falla:** revisa el email de contacto en **Administración → Textos legales**.

### 5.2 Registrar la licencia y declarar el uso

**Necesitas:** ser administrador.

1. **Administración → Licencia → Registrar licencia**: escribe el titular y, si quieres, el número de factura y el email de compra. Guarda.
2. Comprueba que el recordatorio de licencia deja de salir a los administradores.
3. Pulsa **Quitar registro** y prueba la otra vía: declara **Uso personal o educativo** y después **Quitar la declaración**.

**Qué debe pasar:** el estado pasa de «Sin licencia registrada» a registrada (o a «Declarada de uso personal o educativo»), con la fecha puesta sola, y el recordatorio desaparece. Pizarro funciona igual en todos los casos.

**Si falla:** cada cambio queda en el registro de actividad; en Logs busca `License` (`settings.saveLicense`, `settings.removeLicense`, `settings.setPersonalUse`).

### 5.3 Stripe: compra de prueba y enlace real (pendiente)

**Necesitas:** una cuenta de Stripe y haber confirmado con tu gestor lo que indica [docs/VENTA.md](VENTA.md) (alta, IVA, ventas fuera de España).

1. En Stripe, en **modo de prueba**, crea el producto (100 €, pago único, impuesto exclusivo), configura el IVA y crea el Payment Link (secciones 1 a 4 de la guía).
2. Paga con una tarjeta de prueba de Stripe como comprador de España, con nombre de empresa y NIF.
3. Repite la creación del enlace en modo real, pégalo en `BUY_URL`, publica una versión y actualiza tu instalación.
4. Repite la prueba 5.1.

**Qué debe pasar:** tras el paso 2 llega por email la factura con el 21 % de IVA, el nombre de la empresa y el NIF, y la página de confirmación muestra tu mensaje. Tras el paso 4, los tres botones (presentación, **Administración → Licencia** y el recordatorio de licencia) abren el pago de Stripe.

**Si falla:** todo esto se revisa en el panel de Stripe (pagos, facturas, impuestos). Pizarro no recibe nada de Stripe, así que en Logs no habrá rastro.

### 5.4 Web getpizarro.com

**Necesitas:** GitHub Pages activado con origen **GitHub Actions** y el DNS del dominio (pasos en [docs/VENTA.md](VENTA.md), sección 8).

1. En GitHub, **Actions → Web**: la última ejecución está en verde.
2. Abre `https://getpizarro.com` en una ventana privada, y también `/en/`, `/instalar/`, `/guias/` y `/licencia/`.
3. Comprueba que `http://` y `www.` llevan a `https://getpizarro.com`.
4. Mira el botón de compra.

**Qué debe pasar:** se ve la presentación de Pizarro con las capturas y el precio, no el README. Mientras `BUY_URL` esté vacía, el botón dice **Próximamente** y está desactivado; cuando haya enlace (prueba 5.3), dice **Comprar licencia** tras el siguiente despliegue de la web.

**Si falla:** si se ve el README, Pages está en «Deploy from a branch»: cámbialo a **GitHub Actions**. Si el workflow falla en «Publicar en GitHub Pages», Pages no está activado.

## 6. Otras comprobaciones tras desplegar

### 6.1 Acceso normal con Google

**Necesitas:** el cliente OAuth creado según [docs/guias/google-login.md](guias/google-login.md), con la dirección de redirección `https://pizarro.example.com/api/auth/google/callback`.

1. **Administración → Integraciones → Acceso con Google**: pega el ID y el secreto y pulsa **Guardar**. El estado pasa a «Activo».
2. Cierra la sesión y pulsa **Iniciar sesión con Google** con una cuenta cuyo email ya existe en Pizarro.
3. Prueba con una cuenta de Google que **no** existe en Pizarro.
4. Prueba con tu cuenta de administrador.

**Qué debe pasar:** la persona entra directamente. La cuenta que no existe recibe «No hay ninguna cuenta con ese email de Google» (no se crea ninguna cuenta). El administrador pasa después por la verificación en dos pasos de Pizarro.

**Si falla:** **redirect_uri_mismatch**: la dirección de redirección no es idéntica (https, sin barra final). **access_blocked**: la aplicación está en **Testing** y esa cuenta no está en **Test users**. En Logs busca `google`.

### 6.2 Google Docs, Sheets y Slides

**Necesitas:** la API de Google Drive activada, el permiso `drive.file` y la segunda dirección de redirección, `https://pizarro.example.com/api/google/callback` ([docs/guias/google-docs.md](guias/google-docs.md)).

1. **Mi perfil → Cuenta → Google Docs, Sheets y Slides → Conectar con Google** y acepta el permiso de Drive.
2. Abre una tarea y, en **Documentos de Google**, pulsa **Nuevo Doc**, **Nuevo Sheet** y **Nuevo Slides**.
3. Escribe `@docs` en un comentario.
4. Con otra persona del proyecto, abre uno de los archivos desde la tarjeta.

**Qué debe pasar:** cada archivo se crea en tu Drive con el título de la tarjeta, se abre en otra pestaña y queda enlazado en la tarea. Con un dominio de Workspace permitido, la otra persona puede abrirlo. Quitar el enlace no borra el archivo de Drive.

**Si falla:** «Google ha denegado la creación del archivo…»: falta activar la API de Drive. «No se concedió el permiso de Google Drive»: vuelve a conectar y marca la casilla. En Logs busca `google.` (`google.createFileFailed`, `google.shareFailed`, `google.callbackError`). Con la aplicación en **Testing**, el permiso caduca a los 7 días.

### 6.3 Rama `stable` y «Mover stable»

**Necesitas:** permisos de mantenedor en el repositorio y el secreto `STABLE_PUSH_TOKEN` (pasos en `docs/HANDOFF.md`, sección 5).

1. Publica una versión (**Actions → Release**) y espera a que termine.
2. Mira el job **Rama stable** y comprueba que la rama `stable` apunta al commit de la etiqueta `vX.Y.Z` recién publicada.
3. Aunque haya ido bien, lanza una vez **Actions → Mover stable → Run workflow** (rama `main`).

**Qué debe pasar:** `stable` queda en la última versión publicada y nunca retrocede. **Mover stable** termina en verde y, si ya estaba al día, no cambia nada.

**Si falla:** el paso «Comprobar STABLE_PUSH_TOKEN» dice la causa (token caducado, sin acceso al repositorio o sin permiso de escritura). Regenera el token con **Contents** y **Workflows** en lectura y escritura, guárdalo en el secreto y vuelve a lanzar **Mover stable**. La imagen y la release ya están publicadas: no hay que repetirlas.

### 6.4 Railway despliega desde `stable`

**Necesitas:** tu proyecto de Railway.

1. En el servicio de Pizarro, **Settings → Source → Branch**: comprueba que es `stable`.
2. Sube un commit a `main` sin publicar versión y mira **Deployments**.
3. Publica una versión y vuelve a mirar.
4. En Pizarro, abre *Historial de versiones*.

**Qué debe pasar:** con el commit en `main` Railway **no** despliega; al publicar la versión, sí, y el historial muestra la versión nueva. El healthcheck `/api/health` responde.

**Si falla:** si `stable` no aparece en la lista de ramas, aún no se ha movido nunca (prueba 6.3). Si el despliegue falla, mira los logs del despliegue en Railway: Pizarro no ha llegado a arrancar y en sus Logs no habrá nada.

### 6.5 Copias de seguridad con destino externo

**Necesitas:** `BACKUP_KEY` definida y un destino: un bucket S3 compatible (Cloudflare R2, Backblaze B2, MinIO) con las variables `BACKUP_S3_*`, o una carpeta montada. Pasos: `docs/INSTALL.md`, sección 4.

1. Define las variables y despliega.
2. **Administración → Copias de seguridad**: pulsa **Crear copia ahora**.
3. En **Destino externo**, pulsa **Copiar ahora a destino externo**. Espera unos minutos y recarga.
4. Mira el bucket (o la carpeta).
5. Pulsa **Descargar** en una copia.

**Qué debe pasar:** la copia diaria y la copia a destino externo salen como **Correcta**. En el destino están el volcado cifrado, el manifiesto y los ficheros. **Descargar** pide tu contraseña (o un código de tu app) y baja la base de datos cifrada. Desaparece el aviso «Sin destino externo…».

**Si falla:** el estado sale **Con error** con el motivo. En Logs, categoría **sistema**, busca `backup` (`backup.failed`, `backup.externalFailed`). Lo habitual: endpoint, región o permisos de la clave del bucket.

### 6.6 Restauración de prueba

Una copia que no se ha restaurado nunca no cuenta como copia. Hazlo **en otra instalación o en una base de datos vacía**, nunca sobre la real.

**Necesitas:** la `BACKUP_KEY` guardada fuera del servidor y una base de datos vacía. Pasos: `docs/INSTALL.md`, sección 6.3.

1. En **Administración → Copias de seguridad**, mira **Prueba de restauración mensual**: debe decir cuándo se hizo la última y que fue correcta.
2. En la instalación de prueba, con `BACKUP_PAUSE=1`, lista las copias: `node dist/restore.mjs --list`.
3. Restaura la última del destino externo con sus ficheros: `node dist/restore.mjs s3:latest --files` (o `external:latest` con una carpeta montada, `BACKUP_EXTERNAL_DIR`).
4. Arranca, entra y abre un proyecto con adjuntos.

**Qué debe pasar:** entras con tu usuario de siempre, están los proyectos, las tareas y los adjuntos, y la verificación en dos pasos sigue funcionando (si conservaste `ENCRYPTION_KEY`).

**Si falla:** la herramienta dice si la copia está dañada o se hizo con otra `BACKUP_KEY`. Una copia de una versión más nueva que la imagen se rechaza: usa la misma versión o una posterior. En la instalación real, busca en Logs `backup.restoreTest`.

### 6.7 App instalada en Android y iPhone, con su icono

**Necesitas:** un Android con Chrome y un iPhone con Safari.

1. **Administración → Ajustes → Icono de la app**: elige un color que no sea el azul por defecto.
2. Android: abre Pizarro en Chrome y, en el menú lateral, pulsa **Instalar app**.
3. iPhone: abre Pizarro en **Safari** y pulsa *Compartir → Añadir a pantalla de inicio*.
4. Abre la app instalada en los dos.

**Qué debe pasar:** el icono de la pantalla de inicio tiene el **color elegido** y debajo el nombre de la organización (o «Pizarro»). La app abre a pantalla completa, sin barra del navegador, y mantiene la sesión. La pestaña del navegador también cambia de color al recargar.

**Si falla:** el icono puede tardar unos minutos en cambiar (recarga con Ctrl+F5 en el ordenador). En Android, la app ya instalada se actualiza sola al cabo de un tiempo; en iPhone hay que quitarla y volver a añadirla. Los errores de la app instalada quedan en Logs, aunque no haya sesión («(sin sesión)»).

### 6.8 Dos instalaciones en el mismo móvil

**Necesitas:** dos instalaciones de Pizarro (por ejemplo, la del trabajo y la personal), cada una con su color de icono y su nombre de organización.

1. Instala las dos en el mismo móvil como en la prueba 6.7.
2. Abre una, inicia sesión; abre la otra, inicia sesión.
3. Vuelve a la primera.

**Qué debe pasar:** hay **dos iconos distintos**, cada uno con su color y su nombre, y cada app abre su instalación con su propia sesión. Entrar en una no cierra la otra.

**Si falla:** si los dos iconos salen iguales, comprueba el color y el nombre de la organización en **Administración → Ajustes** de cada una, y reinstala la app (prueba 6.7).

### 6.9 Calendario suscrito en Google, Apple y Outlook

**Necesitas:** tareas con fecha límite asignadas a ti y una cuenta de cada calendario que uses. Para Google y Outlook en la web, tu `APP_URL` tiene que ser accesible desde Internet.

1. En **Calendario**, pulsa **Suscribirse** y después **Generar enlace de suscripción**.
2. Pulsa **Abrir en Google Calendar** y acepta.
3. Pulsa **Abrir en Apple Calendar** (en un Mac o un iPhone).
4. Para Outlook, pulsa **Copiar enlace** y pégalo en *Agregar calendario → Suscribirse desde la web*.
5. Cambia la fecha de una tarea y espera a la siguiente sincronización.
6. Pulsa **Regenerar enlace**.

**Qué debe pasar:** las fechas límite y los entregables aparecen como eventos de día completo, con el proyecto en el título y un enlace a la tarea. El cambio de fecha llega solo, pero tarda: esos programas consultan cada cierto tiempo (de una a varias horas; Google puede tardar más). Tras **Regenerar enlace**, el enlace anterior deja de funcionar.

**Si falla:** si el calendario externo no carga nada, abre el enlace copiado en una ventana privada: debe descargar un fichero de calendario. El enlace es secreto y nunca aparece en Logs.

### 6.10 Aviso de versión nueva

**Necesitas:** una instalación que no esté en la última versión publicada (y sin `UPDATE_CHECK=0`).

1. Publica una versión nueva (o espera a la siguiente).
2. Como administrador, abre **Administración**. La comprobación consulta GitHub como mucho cada 12 horas.
3. Pulsa **Ver novedades** y **Cómo actualizar**.
4. Actualiza la instalación y deja una pestaña de Pizarro abierta durante el despliegue.

**Qué debe pasar:** aparece el aviso de versión nueva, con un punto en el menú junto a **Administración**; **Ocultar este aviso** lo quita para esa versión. Tras actualizar, el aviso desaparece y la pestaña que estaba abierta se recarga sola al volver a ella (o muestra «Hay una versión nueva…»).

**Si falla:** el servidor necesita salida a Internet hacia GitHub. Si tras actualizar aparece «Algo ha fallado», usa **Recargar**; esos errores quedan en Logs.

## 7. Importar y exportar tareas

### 7.1 Exportar tareas e importarlas en otro proyecto

**Necesitas:** dos proyectos en tu instalación (mejor uno con tareas de verdad, con descripciones largas, etiquetas, subtareas y responsables); si puedes, una segunda instalación (por ejemplo, la del VPS de prueba).

1. En el tablero, marca con su casilla unas cuantas tarjetas (prueba también con muchas, cientos si las tienes). El botón de la cabecera pasa a **Exportar (N)**: pulsa **Descargar .json**.
2. Abre el otro proyecto, pulsa **Importar**, elige el fichero y mira la vista previa (columna a la que irá cada una y avisos). Pulsa **Importar N tareas**.
3. Pulsa **Ctrl+Z** (o el botón de deshacer) y comprueba que desaparecen todas.
4. Repite copiando en vez de descargar (**Exportar (N) → Copiar**) y pegando con **Ctrl+V** en el tablero del otro proyecto.
5. Si tienes una segunda instalación, importa allí el mismo fichero, con la app en el otro idioma (inglés/español).

**Qué debe pasar:** las tareas llegan con su título, descripción, tipo (también entre inglés y español), columna si existe con el mismo nombre, etiquetas (las que faltan se crean), subtareas y fecha. El responsable solo se asigna si existe una persona con ese nombre; el fichero nunca lleva emails. Tú eres el creador de las tareas importadas. Las dependencias con tareas de otro proyecto se ignoran. El deshacer quita también las etiquetas que creó.

**Si falla:** busca `tasks.importTasks` en Logs. Si sale «Error inesperado» con un fichero grande, apunta su tamaño.

### 7.2 Pegar una tarea en «Nueva tarea» y en otra tarea

**Necesitas:** un proyecto con alguna tarea completa.

1. Abre una tarea y pulsa **Copiar tarea** (o Ctrl+C sin texto seleccionado).
2. Abre **Nueva tarea** (el cursor queda en el título) y pulsa **Ctrl+V** sin escribir nada. Repite con el foco en un desplegable o tras hacer clic en una zona vacía del formulario.
3. Abre otra tarea y pulsa **Ctrl+V** fuera de un campo de texto; luego prueba **Importar tarea → Desde el portapapeles** y **Desde un fichero**.
4. En el móvil, abre el detalle de una tarea y usa **⋯ → Copiar tarea / Importar**.

**Qué debe pasar:** en «Nueva tarea» se rellena el formulario (título, descripción idéntica, tipo, columna, etiquetas que existan, color, enlace…) y avisa de lo que no admite; en otra tarea se sustituyen sus campos con un solo deshacer. Si el portapapeles tiene otra cosa (texto normal), Ctrl+V pega como siempre.

**Si falla:** anota en qué campo estaba el cursor y qué navegador usas.

### 7.3 Importar desde otras herramientas

**Necesitas:** exportaciones reales (las de prueba usan formatos sacados de la documentación de cada herramienta; hay que confirmarlos con ficheros de verdad).

1. **Trello:** exporta el JSON de un tablero (menú del tablero → Imprimir, exportar y compartir → Exportar como JSON) con listas, etiquetas con y sin nombre, checklists, fechas, miembros, tarjetas archivadas, comentarios y un adjunto. Importa en un proyecto con alguna columna del mismo nombre. Repite con un tablero grande (más de 5 MB) y con el `.json` de una sola tarjeta (abre la tarjeta y añade `.json` a la dirección; prueba también con `?list=true`).
2. **Jira:** el CSV exportado con todos los campos (varias columnas «Labels», «Parent summary», «Due date») y, si puedes, el JSON de `/rest/api/3/issue/CLAVE`.
3. **GitHub:** `gh issue list --state all --json title,body,labels,state,assignees,url` (o la API). Las cerradas y las pull requests no deben importarse.
4. **Asana:** el CSV del proyecto y, si puedes, el JSON de la API.
5. **Linear, Notion, ClickUp, Todoist, GitHub Projects:** el CSV de cada uno.
6. **Planner y Monday:** guarda el Excel como CSV (prueba «CSV UTF-8» y «CSV delimitado por comas») e impórtalo.
7. Repite alguno con la app en inglés y en el móvil.

**Qué debe pasar:** la vista previa dice «Formato detectado: …» con la herramienta correcta; títulos, descripciones, estados (pasan a columnas del mismo nombre), etiquetas, fechas (sin desfases de un día) y subtareas salen bien; lo que no se trae (archivadas, comentarios, adjuntos subidos) se avisa.

**Si falla:** guarda el fichero de prueba (sin datos personales, o con datos inventados) y anota la herramienta y la fecha de la exportación: así se puede ajustar el lector.

## 8. Novedades de la v1.59.0

### 8.1 Copiar con Ctrl al panel de tareas fijas

**Necesitas:** un proyecto con columna *Siguiente salto a producción* (y, si puedes, una de *Plan de trabajo para IA*).

1. Abre el panel **Siempre en la release** con 3 o 4 tareas fijas y pocas tarjetas en la columna: no debe salir barra de desplazamiento en la lista si las tarjetas caben.
2. Arrastra una tarjeta de otra columna y suéltala **con Ctrl** (⌥ en Mac) sobre el panel abierto. Repite sobre el panel cerrado (se abre al mantenerla encima) y sobre «Siempre en el plan».
3. Arrastra varias veces seguidas, rápido, entre la lista de la columna y el panel, con y sin Ctrl.
4. Ctrl/⌘+Z tras la copia.

**Qué debe pasar:** la copia aparece al momento dentro del panel y queda como fija (con la misma cadencia si la original lo era); la original no se mueve; un solo deshacer la quita. Nunca sale «Algo ha fallado».

**Si falla:** anota exactamente qué arrastre hacías justo antes (y si el panel estaba abierto) y mira *Administración → Logs* (categoría *client*).

### 8.2 Subidas con dos personas a la vez

**Necesitas:** dos personas con la app abierta (dos navegadores valen) y varios archivos grandes (10–20 MB).

1. Con solo una persona conectada, adjunta 3 archivos a la vez a una tarea.
2. Con las dos conectadas, la primera adjunta 3 archivos a la vez y la segunda, mientras tanto, adjunta uno.
3. Con una subida grande en curso, importa unas tareas en JSON pequeñas.

**Qué debe pasar:** sola, los 3 suben a la vez; con dos personas, los de la primera van de uno en uno, sin errores ni repeticiones, y el de la segunda entra sin esperar; la importación pequeña no espera.

### 8.3 Detalle de tarea compacto

1. Abre una tarea en un portátil (1280×720 o similar) en un proyecto con *Fecha de inicio* activada: la columna de campos debe caber sin desplazarse.
2. En un proyecto con muchos tipos y etiquetas, en una pantalla ancha: la columna se ensancha.
3. En el móvil, comprueba que se puede quitar la fecha límite con la ✕ junto a su rótulo.

### 8.4 Jira con cabeceras en español

Exporta un CSV de Jira con la interfaz en español que incluya incidencias resueltas y sin resolver. **Qué debe pasar:** «Formato detectado: Jira», las resueltas no se importan y se avisa de cuántas son.

## 9. Novedades de la v1.60.0

### 9.1 Presencia en vivo y recarga

**Necesitas:** dos personas (dos navegadores) en el mismo tablero de tu instalación en Railway.

1. B abre una tarea; en el tablero de A, la tarjeta muestra la burbuja de B al momento. B la cierra: desaparece en un segundo. Repite abriendo y cerrando muy deprisa.
2. B cierra la pestaña o cierra sesión: deja de salir en «Quién está» enseguida.
3. Deja el tablero abierto 20 minutos sin tocar nada y mira en *Administración → Logs* que no hay visitas cada 2 minutos.

**Qué debe pasar:** todo al momento, sin burbujas que se queden.

### 9.2 Error de hidratación (Cloudflare)

Abre *Mi perfil* y *Administración → Usuarios* con la consola del navegador abierta y mira *Administración → Logs* (categoría *client*): no debe aparecer «Minified React error #418». Si usas Cloudflare, comprueba en su panel *Scrape Shield → Email Address Obfuscation* y desactívalo.

### 9.3 Descargas ZIP de adjuntos

En *Releases*, abre una release con adjuntos y pulsa **Descargar adjuntos**: la descarga la hace el navegador, con su barra de progreso. Prueba también **Descargar adjuntos** en *Generar release* y en un plan de trabajo con varios paquetes. Cancela una a mitad: sale el aviso «No se pudieron descargar los adjuntos».

### 9.4 Móvil

1. Abre el tablero en el móvil: abre la última columna que viste; la lupa abre el buscador con el teclado; al buscar, salta a la columna con resultados.
2. Calendario: abre en hoy (o en el aviso de vencidas, con «Ir a hoy»).
3. *Administración → Usuarios*: las acciones de cada persona en «⋯».
4. Con la app instalada, Pizarro en *Oscuro* y el móvil en claro: la barra de estado sale oscura.

### 9.5 Informe semanal y cambio de email

1. En *Ajustes del proyecto → Informes*, elige destinatario por nombre. Con una cuenta de miembro, mira que una dirección externa puesta por un administrador sale enmascarada.
2. Cambia el email de la persona destinataria: el informe le sigue llegando a la nueva dirección.

## 10. Novedades de la v1.61.0

### 10.1 Compartir con Pizarro (móvil)

**Necesitas:** la app instalada en un Android (o Chrome/Edge en el ordenador) con la versión nueva (si ya estaba instalada, ábrela una vez para que se actualice el manifiesto).

1. Desde la galería, *Compartir → Pizarro* con una o dos fotos; desde el navegador, comparte un enlace; desde una app de notas, un texto.
2. Cambia el proyecto en el selector antes de *Crear tarea*.
3. Repite sin sesión iniciada.

**Qué debe pasar:** se abre *Nueva tarea* con el texto, el enlace y los archivos; al crear vas al tablero del proyecto elegido. Sin sesión, pide entrar y conserva los textos (los archivos hay que volver a compartirlos).

### 10.2 Plantillas de serie

Crea un proyecto con *Mantenimiento e instalaciones*, *Ventas* y alguna revisada (*Negocio*, *Reformas y obras*, *Tareas familiares*) y úsalo un rato como lo usarías en real. Anota columnas, tipos o etiquetas que sobren o falten.

### 10.3 Cabecera, menú de columna y Nueva tarea

1. En el ordenador, cambia de proyecto desde la barra lateral (también con Alt+P); el informe PDF está en el menú lateral.
2. En el menú ⋯ de una columna, *Rol de la columna ›*.
3. Crea una tarea con un tipo y abre otra vez *Nueva tarea*: propone ese tipo, con su título y subtareas si los tiene.

### 10.4 Móvil

Los avisos salen abajo; abre una tarea archivada para leerla; en el detalle, *Descartar cambios* pregunta antes; *Editar* en tus comentarios.

### 10.5 Administración

*Administración → Integraciones*: email, Google, Telegram y WhatsApp siguen configurados como estaban. Abre `/robots.txt` de tu instalación: debe decir `Disallow: /`.

## 11. Novedades de la v1.62.0

### 11.1 Railway: arranque con la base de datos parada

1. En Railway, reinicia a la vez el servicio de PostgreSQL y el de Pizarro (o detén Postgres un minuto y reinicia Pizarro).
2. Mira los logs del despliegue de Pizarro.

**Qué debe pasar:** salen avisos de espera («PostgreSQL aún no responde… Se reintenta cada 3 s») y, en cuanto la base responde, Pizarro arranca solo, sin quedarse en «Crashed». Un despliegue normal no debe tardar más que antes.

### 11.2 Servidor propio: actualizar

1. Actualiza con el mismo comando de instalación (`get.sh`).
2. Comprueba que en la salida se descargan las imágenes de Pizarro, Caddy y PostgreSQL, y que el mensaje final es el de actualización (no «crea el primer administrador»).
3. `docker compose exec app sh -c 'echo "[$POSTGRES_PASSWORD]"'` (en `/opt/pizarro/deploy`) debe mostrar `[]`.
4. Abre `deploy/recovery-kit.txt`: lleva las cuatro claves y los pasos de la guía de la web.

### 11.3 Releases y Documentación

1. En *Releases*, abre una release: *Borrar adjuntos* y *Borrar release* están en el botón ⋯ al final de la fila Copiar/.md/.txt.
2. En *Documentación*, cada fila tiene ⋯ con *Descargar* y *Enviar a la papelera*.
3. Genera un PDF grande (programa del curso, lista consolidada o resumen para el cliente con muchas tareas): debe salir en segundos y verse igual que antes.

### 11.4 Varios

- Con el móvil en modo oscuro, los textos en rojo (Borrar…) y los enlaces de color se leen bien.
- Cambia el día del informe semanal a otro posterior de la misma semana tras un envío: si han pasado 3 días o más, llega.
- Cierra sesión y abre `/login?next=/.//example.com`: tras entrar, debes quedarte en Pizarro.

## 12. Novedades de la v1.63.0

### 12.1 Miembros e invitaciones (con email configurado)

1. En *Ajustes del proyecto → General*, añade a un administrador como miembro: sale con la marca «admin».
2. Añade a una persona que ya tiene cuenta: debe recibir «… te ha añadido al proyecto «X»» con el botón *Abrir el tablero*. Quítala y vuelve a añadirla: no recibe un segundo email ese día.
3. *Invitar por email* a una dirección tuya sin cuenta: llega la invitación al proyecto; al elegir la contraseña entras directamente en el tablero.
4. *Copiar enlace* tras añadir o invitar: pégalo en otro navegador y comprueba que lleva al sitio correcto.

### 12.2 Móvil (en el teléfono)

- Todas las columnas llegan hasta abajo, también «Siguiente salto» con su panel «Siempre en la release».
- En una columna larga no hay barra de desplazamiento fija a la derecha.
- Dicta una tarea larga sin tocar la pantalla: la pantalla no se apaga y el dictado no se corta.
- En *Documentación*, sube una foto de la cámara (12–48 MP): se ve su vista previa.

### 12.3 Servidor propio (VPS)

1. Antes de actualizar: `docker run --rm -v $PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro -e DOMAIN=:80 caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile` (en la carpeta del repositorio de la versión nueva) debe decir «Valid configuration».
2. Actualiza con `curl … /pizarro/stable/deploy/get.sh | sh`. Tras actualizar, `docker compose logs caddy` muestra peticiones sin la ruta.
3. Si usas `SMTP_*` en el `.env` con un servidor que no es local y un puerto distinto de 465: envía un email de prueba. Si falla por STARTTLS, el diagnóstico lo avisa (`smtp_starttls_required`).

### 12.4 Emails

- El informe semanal a una persona que usa Pizarro en inglés llega en inglés, con el nombre de la organización y quién lo configuró.
- Los emails llevan el pie «No respondas a este email…» y, si el remitente no tiene nombre, el de la organización.
- El aviso de nuevo inicio de sesión muestra la hora con la zona (por ejemplo «(CET)»).

### 12.5 Publicar la versión

- En la GitHub Release de la v1.63.0 deben aparecer adjuntos `MANUAL.pdf` y `PRUEBAS.pdf`, y el enlace «Manual en PDF» de getpizarro.com debe descargarlo.

## 13. Novedades de la v1.64.0

### 13.1 Railway desde cero (proyecto de prueba)

1. Sigue la guía de getpizarro.com (*Instalar → Railway*) en un proyecto nuevo: dominio y volumen primero, variables con **Generar mis variables** (sin `APP_URL`) y un solo **Deploy**.
2. Qué debe pasar: el servicio no sale *Active* hasta que Pizarro está listo; al final del log aparece `PIZARRO ESTÁ SIN CONFIGURAR` con el código y la dirección `https://…up.railway.app/setup` (no `localhost`). *Administración → Ajustes → Instalación* dice que la dirección sale de Railway.
3. En *Settings → Deploy* del servicio, comprueba que *Healthcheck Path* es `/api/health` con *Healthcheck Timeout* `600` (se pone a mano: Railway ya no lee `railway.json`, que se quitó del repositorio; ver `docs/INSTALL.md`, «Railway», paso 5) y que el log de construcción del despliegue trae `Starting Healthcheck` con `Path: /api/health`.
4. Si falla: *Logs*, busca `appUrl` y `migrate`; la línea «Base de datos al día (migraciones: … s; espera a PostgreSQL: … s)» dice en qué se fue el tiempo.

### 13.2 Copias de seguridad en R2 con bloqueo de retención

1. En tu instalación, *Administración → Copias de seguridad*: si sale *Omitida: sin destino externo*, faltan las variables `BACKUP_S3_*` en el servicio (en tu Railway parece que desaparecieron hacia el 18-11: la última copia del bucket es de ese día). Vuelve a ponerlas y despliega.
2. En Cloudflare, bucket de Pizarro → *Settings → Bucket Lock Rules*: regla con el prefijo de las copias (`pizarro/pizarro-backup-` si usas `BACKUP_S3_PREFIX=pizarro`) a 31 días y, si el espacio lo permite, otra para `pizarro/files/` (indefinida o 180 días).
3. Pulsa *Copiar ahora a destino externo*: debe salir *Correcta*. A partir del día 15, la página puede decir «N objetos retenidos por el bloqueo del bucket»: es lo esperado, no un error.

### 13.3 Emails

- Un aviso de comentario por email presenta el texto como «Ana ha escrito:» seguido de la cita.
- Al pie de los avisos, del resumen diario y del informe semanal sale «Dejar de recibir estos emails»: ábrelo (no da de baja), pulsa *Darme de baja* y comprueba que la casilla correspondiente de *Mi perfil → Avisos* queda desmarcada. En Gmail (con `APP_URL` en https) aparece además «Cancelar suscripción» junto al remitente.
- Con la casilla «Email con los cambios de fecha límite y los recordatorios de «Esperando»» marcada, llegan los recordatorios de una tarea que lleva días en «Esperando».
- El informe semanal de un proyecto grande muestra como mucho 15 tareas por listado con «… y N más».

### 13.4 Cuentas en el mismo navegador

- Entra con dos cuentas, una tras otra, en el mismo navegador marcando «Recordar este dispositivo»: ninguna recibe el aviso de nuevo inicio de sesión al volver a entrar ni vuelve a pedir el segundo factor.
- Invita desde un proyecto con la app en inglés: el email llega en inglés y la persona sale como «Invitación pendiente» hasta que elige su contraseña.

### 13.5 Cloudflare

- Con la ofuscación de emails activada en la zona, abre *Mi perfil* o *Administración → Usuarios* y mira el código fuente: no debe aparecer `__cf_email__` ni `email-decode.min.js`.

### 13.6 Varias pestañas y tablero grande

- Con el mismo tablero abierto en dos navegadores, mueve, edita y archiva tarjetas en uno: el otro las cambia en uno o dos segundos sin recargar entero (la búsqueda y la selección se mantienen).
- En un tablero con cientos de tarjetas por columna, el móvil abre el tablero antes y nada salta al cargar.

### 13.7 Publicar la versión

- En la GitHub Release de la v1.64.0 deben aparecer `MANUAL.pdf` y `PRUEBAS.pdf`, y la rama `stable` debe quedar en el commit de la versión (Railway despliega solo).

## 14. Novedades de la v1.65.0

### 14.1 Plantillas tras actualizar (tu instalación)

1. *Administración → Tipos y plantillas → Plantillas*: deben quedar las 6 de serie (*Vibecoding*, *Trabajo y clientes*, *Casa y familia*, *Eventos y viajes*, *Estudios y aprendizaje*, *Curso o charla*) y, como **propias**, solo las antiguas que hubieras modificado.
2. *Nuevo proyecto* → *Casa y familia* con **Con tarjetas de ejemplo**: se abre el tablero con unas pocas tarjetas «Ejemplo» en columnas que existen.
3. Tus proyectos ya creados no cambian.
4. Si falla: *Logs*, busca `boot` (la línea de plantillas retiradas).

### 14.2 Informar de un error (instalación oficial: tu Railway)

1. Junto a *Cerrar sesión* aparece el bicho. Con la última versión, se abre el diálogo; marca la captura: se ve la página sin el diálogo.
2. Con el envío de emails configurado, «Enviar» lo manda en privado a `feedback@getpizarro.com` (`FEEDBACK_EMAIL`): envía uno de prueba y comprueba que llega con la captura adjunta (la dirección tiene que existir y reenviar a tu buzón).
3. En una instalación sin envío de emails: «Enviar por email» abre tu programa de correo con el asunto, los datos técnicos y el texto para `feedback@getpizarro.com`; con captura, «Descargar la captura» para adjuntarla a mano. «o publicarlo en GitHub» abre el formulario público con lo escrito.

### 14.3 Avisos y usuarios

- *Mi perfil → Avisos*: una sola tarjeta de email con un solo «Guardar avisos».
- Sin email configurado: en los miembros del proyecto, una invitación pendiente muestra «Generar enlace de invitación nuevo» con confirmación.
- *Administración → Usuarios*: «N usuarios activos» sin «de 10» (salvo que tengas `MAX_USERS`).

### 14.4 Calendario en una tableta (iPad con Safari)

- Desliza el dedo sobre una franja de entregable: la página se desplaza y la fecha no cambia.
- Mantén el dedo hasta que la franja se marque y arrástrala: cambia de fecha.

### 14.5 Copias en R2 con el bloqueo puesto

- A partir del día 15 desde que creaste la regla, *Administración → Copias de seguridad* puede decir «N objetos retenidos por el bloqueo del bucket» en el destino externo: es lo esperado, no un error. La copia sigue saliendo *Correcta*.

## 15. Novedades de la v1.66.0

### 15.1 Antes de publicar: la dirección de los informes

- `feedback@getpizarro.com` debe existir y reenviar a tu buzón (prompt 1 de `docs/PRUEBAS-CHROME.md`). Envía un email de prueba a esa dirección desde otro correo y comprueba que llega. Si no existe, los informes de las instalaciones con email rebotarán.

### 15.2 Railway sin `railway.json` (tus dos proyectos)

1. *Settings → Deploy*: *Healthcheck Path* `/api/health`, *Healthcheck Timeout* `600` (o la variable `RAILWAY_HEALTHCHECK_TIMEOUT_SEC=600`), *Restart Policy* «On Failure», una réplica (prompt 3 de `docs/PRUEBAS-CHROME.md`).
2. Al desplegar, el log termina con «Starting Healthcheck», «Path: /api/health» y «Healthcheck succeeded!».

### 15.3 Informar de un error (tu Railway, instalación oficial)

- Con email configurado: «Enviar» con una captura; debe llegarte a tu buzón por el reenvío de `feedback@`.
- Con el teclado, el resaltado de «Tipo» rodea toda la opción; el texto de GitHub es un solo párrafo.

### 15.4 Usuarios sin email (instalación de prueba)

1. *Administración → Usuarios → Nuevo usuario*: no pide contraseña; al crear sale el enlace de invitación con «Copiar». Pulsa Atrás: solo se cierra el diálogo.
2. Abre el enlace en una ventana de incógnito, elige contraseña y entra.
3. *Forzar cambio de contraseña* sobre alguien con la invitación pendiente: el enlace de invitación anterior deja de valer.

### 15.5 Render o Fly.io (opcional, solo si quieres probar las guías nuevas)

- Sigue la guía de `getpizarro.com/instalar` (Render: botón *Deploy to Render*, plan de pago; Fly.io: `flyctl`). Al terminar, `/setup` debe abrir con la dirección pública correcta, y en *Administración → Logs* tu IP real (no la de la plataforma).
- Borra después el servicio, el disco y la base para no pagar de más.

### 15.6 En el móvil (teléfono real)

- Doble clic (doble toque) en una descripción larga: el editor se abre sin mover el texto.
- «@» en un comentario con el teclado abierto: la lista no queda tapada ni cortada.
- Menú → «+ Nuevo proyecto»: el menú se cierra y se escribe el nombre a la primera.
