---
titulo: Iniciar sesión con Google
descripcion: Que tu equipo entre en Pizarro con su cuenta de Google, sin otra contraseña que recordar.
orden: 1
icono: login
---

# Iniciar sesión con Google

Con esta conexión, la pantalla de acceso de Pizarro muestra el botón **Iniciar sesión con Google**. Entra quien ya tiene cuenta en Pizarro con ese mismo email: no abre el registro a nadie más. El cliente de Google que crees aquí sirve también para [Google Docs, Sheets y Slides](google-docs.md).

Necesitas:

- Ser administrador de Pizarro.
- La dirección pública de tu Pizarro, con `https://`: es la variable `APP_URL` del servidor (por ejemplo, `https://pizarro.example.com`). Google no acepta `localhost` ni una IP.
- Una cuenta de Google. Google Cloud es gratis para esto: no hace falta activar la facturación.

## 1. Decide la dirección

Elige con qué dirección entrará tu gente, porque de ella salen todos los valores que pide Google: la del servidor (por ejemplo, `https://algo.up.railway.app`) o un dominio propio (`https://pizarro.example.com`, lo recomendable). Si la cambias más adelante, tendrás que actualizar Google.

En Pizarro, **Administración → Ajustes → Acceso con Google** muestra arriba la «Dirección pública de Pizarro» y avisa si estás entrando por otra. Debajo hay una guía desplegable con las direcciones de esta guía ya calculadas y un botón para copiar cada una.

## 2. Crea el proyecto en Google Cloud

1. Entra en <https://console.cloud.google.com/projectcreate> y crea un proyecto (por ejemplo, «Pizarro»), o elige uno que ya tengas.
2. Busca **Google Auth Platform** en la barra superior y ábrelo. La primera vez, pulsa **Get started** (*Comenzar*).

## 3. Branding: la marca de la aplicación

- **Nombre de la aplicación:** «Pizarro».
- **Email de asistencia:** el de quien administra Pizarro.
- **Logotipo:** déjalo vacío si la aplicación va a ser «Externa» y publicada; subir un logotipo obliga a que Google la verifique.
- **Application home page:** tu `APP_URL`.
- **Privacy policy link:** `APP_URL/privacy`. **Terms of service link:** `APP_URL/terms`. Son páginas públicas de Pizarro.
- **Authorized domains:** el dominio principal, sin `https://` ni subdominios (`example.com`).
- **Developer contact information:** tu email.

## 4. Audience: quién puede entrar

- **Interno:** solo las cuentas de tu organización de Google Workspace. No hay que publicar ni verificar nada.
- **Externo:** cualquier cuenta de Google, también de Gmail. Mientras esté en **Testing**, solo entran los **Test users** que añadas (hasta 100). Con **Publish app** (*In production*) entra cualquiera y, para iniciar sesión, Google no pide verificación.

## 5. Data Access: los permisos

Pulsa **Add or remove scopes**, marca `openid`, `email` y `profile` (son los básicos) y guarda. Si también vas a crear Docs, Sheets y Slides, añade el permiso de Drive que explica [su guía](google-docs.md).

## 6. Crea el cliente OAuth

1. En **Clients**, pulsa **Create client**.
2. Tipo **Web application**; de nombre, por ejemplo, «Pizarro».
3. En **Authorized redirect URIs**, pulsa **Add URI** y escribe tu `APP_URL` seguida de `/api/auth/google/callback`. Debe ser exacta: con `https` y sin barra al final. Por ejemplo:

   ```
   https://pizarro.example.com/api/auth/google/callback
   ```

   Si vas a usar Docs, Sheets y Slides, añade en el mismo cliente también `APP_URL` + `/api/google/callback`.
4. Pulsa **Create** y copia el **Client ID** y el **Client secret**. El secreto completo solo se ve en ese momento; si lo pierdes, crea otro.

## 7. Pégalo en Pizarro

En **Administración → Ajustes → Acceso con Google**, pega el ID y el secreto y pulsa **Guardar**. En unos segundos el estado pasa a «Activo», sin reiniciar nada.

- **Dominio de Workspace permitido** (opcional): si lo rellenas (`example.com`), solo valen las cuentas de ese dominio. Vacío, vale cualquier cuenta de Google.
- Si prefieres configurarlo en el servidor, usa las variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y, si quieres, `GOOGLE_WORKSPACE_DOMAIN`. Mandan sobre lo guardado en Ajustes.
- Para que **solo** se entre con Google, `AUTH_GOOGLE_ONLY=true`. Con `AUTH_ALLOW_ADMIN_PASSWORD=true`, los administradores conservan la contraseña como acceso de emergencia.

## 8. Pruébalo

1. Cierra la sesión y pulsa **Iniciar sesión con Google** en la pantalla de acceso.
2. Usa una cuenta cuyo email ya exista en Pizarro (y, si la aplicación está en **Testing**, que esté en **Test users**).
3. Los administradores pasan después por la verificación en dos pasos de Pizarro; el resto entra directamente.

## Si algo falla

- **redirect_uri_mismatch:** la dirección de redirección no es idéntica a la del paso 6. Revisa el `https`, la barra final y los espacios; tras corregirla pueden pasar unos minutos.
- **access_blocked** o «app no verificada»: la aplicación está en **Testing** y esa cuenta no está en **Test users**. Añádela o publica la aplicación.
- «No hay ninguna cuenta con ese email de Google»: Google ha ido bien, pero ese email no existe en Pizarro. Crea antes el usuario en **Administración → Usuarios**.
- «Usa una cuenta de Google del dominio de la empresa»: hay un dominio de Workspace permitido y la cuenta es de otro.
