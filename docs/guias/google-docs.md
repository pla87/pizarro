---
titulo: Google Docs, Sheets y Slides
descripcion: Crea un documento, una hoja de cálculo o una presentación desde una tarea y que quede enlazado en ella.
orden: 2
icono: google
---

# Google Docs, Sheets y Slides

Con esta conexión, desde cualquier tarea se puede crear un Google Doc, un Google Sheet o una presentación de Google Slides: se crea en el Drive de quien lo pide, con el título de la tarjeta, se abre en otra pestaña y queda enlazado en la tarea. Usa el mismo cliente de Google que [Iniciar sesión con Google](google-login.md); si ya lo tienes, empieza en el paso 1 y sáltate el 3.

Necesitas ser administrador de Pizarro, la dirección pública de tu Pizarro con `https://` (la variable `APP_URL`) y una cuenta de Google.

## 1. Activa la API de Google Drive

1. Entra en <https://console.cloud.google.com> y elige el proyecto de Pizarro (o crea uno, como en el paso 2 de [la otra guía](google-login.md)).
2. Abre **APIs y servicios → Biblioteca**, busca **Google Drive API** y pulsa **Habilitar**.

Es la única API necesaria: los Docs, Sheets y Slides se crean a través de Drive, así que no hace falta activar las de Docs, Sheets ni Slides.

## 2. Añade el permiso de Drive

En **Google Auth Platform → Data Access**, pulsa **Add or remove scopes**, añade este permiso y guarda:

```
https://www.googleapis.com/auth/drive.file
```

Solo da acceso a los archivos que crea o abre Pizarro, no al resto del Drive de cada persona.

- Con una aplicación **Interna** (solo tu Google Workspace) no hay nada más que hacer.
- Con una aplicación **Externa** en **Testing**, solo pueden conectarse los **Test users** y el permiso de Drive caduca a los 7 días: cada persona tendrá que volver a conectar. Publicada (*In production*), Google puede pedir una verificación por este permiso.

## 3. Crea el cliente OAuth (si aún no lo tienes)

Sigue los pasos 2 a 6 de [Iniciar sesión con Google](google-login.md). En **Authorized redirect URIs**, la dirección para Docs, Sheets y Slides es tu `APP_URL` seguida de `/api/google/callback`, exacta (con `https` y sin barra al final):

```
https://pizarro.example.com/api/google/callback
```

Si también usas el inicio de sesión con Google, pon las dos direcciones en el mismo cliente. Después pega el **Client ID** y el **Client secret** en **Administración → Ajustes → Acceso con Google** (o en las variables `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del servidor).

## 4. Decide con quién se comparten los archivos

- **Dominio de Workspace permitido** (en Ajustes, o la variable `GOOGLE_WORKSPACE_DOMAIN`): con él, cada archivo de un proyecto de equipo se comparte con todo el dominio, para que cualquiera pueda abrirlo desde la tarjeta. Sin dominio, solo lo ve quien lo crea hasta que lo comparta.
- Cada proyecto puede elegir en **Ajustes del proyecto → General → Documentos de Google**: todo el dominio puede editar, todo el dominio puede leer, solo las personas del proyecto, o no compartir. Un proyecto privado nunca se comparte con el dominio.

## 5. Cada persona conecta su cuenta

Una vez por persona: **Mi perfil → Cuenta → Google Docs, Sheets y Slides → Conectar con Google**, y aceptar el permiso de Drive.

## 6. Pruébalo

1. Abre una tarea y pulsa **Nuevo Doc**, **Nuevo Sheet** o **Nuevo Slides** (en **Documentos de Google**), o escribe `@docs`, `@sheets` o `@slides` en la descripción o en un comentario.
2. El archivo se abre en otra pestaña y queda en **Documentos de Google** de la tarjeta.
3. Quitar el enlace de la tarjeta no borra el archivo de Drive.

## Si algo falla

- «Google ha denegado la creación del archivo (revisa que la API de Drive esté activada)»: falta el paso 1.
- «No se concedió el permiso de Google Drive»: al conectar no se marcó la casilla de Drive. Vuelve a conectar y acéptala.
- «Documento creado, pero no se ha compartido: solo lo ves tú»: no había con quién compartirlo (sin dominio, o el proyecto está en «No compartir») o lo impidió la política de tu Workspace. Compártelo desde Google como cualquier otro archivo.
- **redirect_uri_mismatch** al conectar: falta la dirección `/api/google/callback` en el cliente, o no es idéntica.
