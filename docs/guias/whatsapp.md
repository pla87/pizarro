---
titulo: Avisos por WhatsApp
descripcion: Avisos en WhatsApp con la API oficial de Meta. Meta cobra cada mensaje.
orden: 4
icono: message
---

# Avisos por WhatsApp

Pizarro puede enviar los avisos (menciones, asignaciones, comentarios…) por WhatsApp con la **WhatsApp Cloud API**
oficial de Meta. A diferencia de Telegram, **es de pago**: Meta cobra cada aviso que entrega. Prepararlo lleva entre
media hora y un día (Meta tiene que aprobar la plantilla del mensaje).

Si buscas algo gratis y más rápido de preparar, usa [Telegram](telegram.md).

Necesitas:

- Una cuenta de administrador en Pizarro.
- Una cuenta de Facebook para entrar en Meta for Developers y en Meta Business.
- Un número de teléfono para enviar (el de prueba de Meta sirve para empezar).
- Una tarjeta para pagar los mensajes (solo con un número propio).

## Cuánto cuesta

- Meta cobra **por cada mensaje de plantilla entregado**. Los avisos de Pizarro son de la categoría **Utilidad**.
- En España, un mensaje de utilidad cuesta del orden de **1 a 3 céntimos de euro**; varía por país y Meta cambia las
  tarifas de vez en cuando. Consulta la tabla oficial:
  [precios de WhatsApp Business](https://developers.facebook.com/docs/whatsapp/pricing).
- Ejemplo: un equipo de 10 personas que recibe 5 avisos por día laborable cada una son unos 1.100 mensajes al mes, es decir,
  entre 10 y 35 € al mes.
- Para no llevarte sorpresas, Pizarro envía como mucho **10 WhatsApp por persona y hora** (el resto de avisos quedan en
  la campana de Pizarro) y, por defecto, cada persona recibe solo **menciones y asignaciones**.

## Paso 1. Crea una cuenta de Meta Business

1. Entra en [business.facebook.com](https://business.facebook.com) con tu cuenta de Facebook.
2. Crea un **portfolio empresarial** (nombre de tu organización y un email de contacto). Si ya tienes uno, úsalo.

## Paso 2. Crea la app en Meta for Developers

1. Entra en [developers.facebook.com](https://developers.facebook.com) → **Mis apps → Crear app**.
2. Elige el caso de uso **Conectar con clientes a través de WhatsApp** (o el tipo **Empresa**) y asóciala a tu
   portfolio empresarial.
3. En la app, añade el producto **WhatsApp**.

## Paso 3. Elige el número que envía

En la app: **WhatsApp → Configuración de la API** (API Setup).

- Meta te da un **número de prueba** gratuito. Solo puede escribir a 5 números que tú verifiques en el campo **Para**.
  Basta para probar o para un equipo pequeño.
- Para usarlo de verdad, pulsa **Añadir número de teléfono** y añade un número propio que **no** esté en uso en la app de
  WhatsApp (puede ser un fijo). Meta pide un nombre visible y verificar el número por SMS o llamada. Añade también un
  método de pago en **WhatsApp Manager → Configuración de pago**.
- Copia el **identificador del número de teléfono** (Phone number ID), un número largo. Lo pegarás en Pizarro.

## Paso 4. Crea un token permanente con un usuario del sistema

El token temporal que aparece en «Configuración de la API» caduca en 24 horas. Para Pizarro hace falta uno permanente:

1. Entra en [business.facebook.com/settings](https://business.facebook.com/settings) → **Usuarios → Usuarios del
   sistema** → **Añadir**. Ponle un nombre (por ejemplo `pizarro`) y el rol **Administrador**.
2. Con el usuario seleccionado, pulsa **Asignar activos**: añade tu **app** y tu **cuenta de WhatsApp** con control total.
3. Pulsa **Generar nuevo token**, elige tu app, caducidad **Nunca** y marca los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copia el token (empieza por `EAA…`). No se vuelve a mostrar.

## Paso 5. Crea la plantilla del mensaje

Fuera de una conversación que haya empezado la persona, WhatsApp solo deja enviar **plantillas aprobadas**. Pizarro usa
una sola para todos los avisos.

1. Ve a [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) → **Plantillas de mensajes →
   Crear plantilla**.
2. Categoría: **Utilidad**. Tipo: **Predeterminado** (personalizado).
3. Nombre: `aviso_pizarro` (exactamente así).
4. Idioma: **Español** (`es`).
5. En **Cuerpo**, pega este texto exacto (con sus saltos de línea):

```text
Aviso de Pizarro: {{1}} (proyecto {{2}}).

Ábrelo aquí: {{3}}

Puedes cambiar estos avisos en Mi perfil de Pizarro.
```

6. Meta pide un **ejemplo** de cada variable. Usa:
   - `{{1}}`: `Ana te ha asignado «Revisar presupuesto»` (la frase del aviso con la tarea).
   - `{{2}}`: `Web` (el nombre del proyecto).
   - `{{3}}`: `https://pizarro.example.com/p/abc?task=123` (el enlace a la tarea; usa la dirección de tu Pizarro).
7. Sin cabecera, sin pie y sin botones. Pulsa **Enviar** y espera a que el estado sea **Aprobada** (suele tardar minutos,
   a veces hasta un día).

Si en tu equipo hay gente que usa Pizarro en inglés, añade a la misma plantilla el idioma **Inglés** (`en`) con este
cuerpo:

```text
Pizarro notice: {{1}} (project {{2}}).

Open it here: {{3}}

You can change these notices in your Pizarro profile.
```

Las variables las rellena Pizarro en el idioma de cada persona; el resto del texto es el de la plantilla.

## Paso 6. Configúralo en Pizarro

1. En Pizarro, ve a **Administración → Ajustes → 3. Avisos por Telegram y WhatsApp → WhatsApp**.
2. Rellena:
   - **Token de acceso**: el token permanente del paso 4.
   - **Identificador del número (Phone number ID)**: el del paso 3.
   - **Nombre de la plantilla**: `aviso_pizarro` (es el valor por defecto si lo dejas vacío).
   - **Idioma**: `es` (o el código exacto con el que se aprobó, por ejemplo `es_ES`).
   - **Idioma en inglés** (opcional): `en` si añadiste la traducción inglesa.
3. Pulsa **Guardar** y después **Activar**.

El token se guarda cifrado y no se vuelve a mostrar (solo sus 4 últimos caracteres).

## Paso 7. Prueba el envío

1. En la misma sección, escribe un número en formato internacional (por ejemplo `+34600111222`) y pulsa **Probar**.
   Con el número de prueba de Meta, tiene que ser uno de los 5 verificados.
2. Llega un WhatsApp con «Mensaje de prueba de Pizarro…». Si falla, Pizarro muestra el error que devuelve Meta.

## Paso 8. Cada persona conecta su WhatsApp

1. **Mi perfil → Avisos → Avisos en el móvil → WhatsApp**: escribe tu número en formato internacional (`+34…`).
2. Marca la casilla de **consentimiento** (aceptas recibir avisos de Pizarro por WhatsApp en ese número).
3. Pulsa **Guardar y enviar mensaje de prueba**. Te llega un WhatsApp de prueba.
4. Pulsa **Sí, me ha llegado**. Desde ese momento recibes avisos por WhatsApp.
5. Elige qué avisos quieres por WhatsApp y pulsa **Guardar**. Por defecto, menciones y asignaciones.

Pizarro no usa un código de verificación porque exigiría una segunda plantilla (de categoría «Autenticación»), con su
aprobación y su coste aparte. A cambio, nadie recibe avisos hasta confirmar que le llegó el mensaje de prueba, y la
persona puede desconectarse en cualquier momento.

## Variables de entorno (instalaciones anteriores)

Las instalaciones que ya configuraban WhatsApp con variables del servidor siguen funcionando sin tocar nada:
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` y
`WHATSAPP_API_VERSION` (por defecto `v23.0`).

Precedencia: **lo que se guarda en Administración → Ajustes manda, campo a campo**; los campos vacíos usan esas
variables. Mientras no pulses Activar ni Desactivar, WhatsApp está activo si la configuración está completa.

Si usabas la plantilla antigua `mencion_pizarro` (cuatro variables), Pizarro la sigue admitiendo, pero con ella solo se
envían **menciones**. Para enviar todos los tipos de aviso, crea `aviso_pizarro` (paso 5) y cambia el nombre de la
plantilla en Pizarro.

## Problemas frecuentes

- **Error 132001 (la plantilla no existe)**: el nombre o el idioma no coinciden con los de la plantilla aprobada.
  Revisa **Nombre de la plantilla** e **Idioma** (`es` no es lo mismo que `es_ES`).
- **Error 132000 (número de parámetros)**: la plantilla no tiene exactamente las variables `{{1}}`, `{{2}}` y `{{3}}`.
- **Error 131030 (destinatario no permitido)**: con el número de prueba, añade el número en el campo **Para** de
  «Configuración de la API».
- **Error 190 o 401 (token)**: el token caducó o le faltan permisos. Genera uno permanente (paso 4).
- **Error 131026 (no se pudo entregar)**: ese número no tiene WhatsApp o no acepta mensajes de empresas.
- **No llega nada**: comprueba que la persona confirmó su número en Mi perfil y que el aviso está marcado para WhatsApp.
  Los fallos quedan en **Administración → Logs** (con el teléfono enmascarado y sin el token).
