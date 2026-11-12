// Plantilla de autenticación de WhatsApp (codigo_pizarro) para el código de verificación: Ajustes, su «Probar» y Mi
// perfil. Clave: texto exacto en español.
export const waauth: Record<string, string> = {
  // Administración → Ajustes → WhatsApp.
  "Plantilla de verificación": "Verification template",
  "Idioma de la verificación": "Verification language",
  "La plantilla de verificación lleva el código de 6 cifras con el que cada persona conecta su WhatsApp. Meta exige que sea de categoría Autenticación (no vale aviso_pizarro). Vacío = codigo_pizarro, en el mismo idioma que los avisos.":
    "The verification template carries the 6-digit code each person uses to connect their WhatsApp. Meta requires it to be in the Authentication category (aviso_pizarro will not do). Empty = codigo_pizarro, in the same language as the notices.",
  "Una plantilla de categoría Autenticación llamada codigo_pizarro, aprobada, con la opción «Copiar código» y el mismo idioma. Su texto lo pone Meta («Tu código de verificación es…»): con ella llega el código para conectar WhatsApp.":
    "An approved Authentication template named codigo_pizarro, with the “Copy code” option and the same language. Meta sets its text (“… is your verification code”): it carries the code for connecting WhatsApp.",
  "Envía a ese número las dos plantillas: un aviso de prueba y un código de verificación de muestra (son 2 mensajes de pago; con el número de prueba de Meta, solo a los números verificados).":
    "Sends both templates to that number: a test notice and a sample verification code (2 paid messages; with Meta's test number, only to verified numbers).",
  "Enviados 2 WhatsApp de prueba a {to}: un aviso y un código de verificación de muestra (123456).": "2 test WhatsApp messages sent to {to}: a notice and a sample verification code (123456).",
  "Solo ha salido el aviso de prueba.": "Only the test notice was sent.",
  "Solo ha salido el código de verificación de prueba.": "Only the test verification code was sent.",
  "Plantilla de avisos:": "Notice template:",
  "Plantilla de verificación:": "Verification template:",
  // Meta rechaza la plantilla de verificación (errores 132001, 132000/132012/132018, 132015/132016).
  "La plantilla de verificación «{name}» ({lang}) no existe en Meta o aún no está aprobada (error {code}). Créala en WhatsApp Manager: categoría Autenticación, opción «Copiar código», con ese nombre e idioma. Hasta entonces nadie puede conectar su WhatsApp.":
    "The verification template “{name}” ({lang}) does not exist in Meta or is not approved yet (error {code}). Create it in WhatsApp Manager: Authentication category, “Copy code” option, with that name and language. Until then nobody can connect their WhatsApp.",
  "La plantilla de verificación «{name}» no tiene la forma que espera Pizarro (error {code}): tiene que ser de categoría Autenticación con el botón «Copiar código».":
    "The verification template “{name}” is not in the form Pizarro expects (error {code}): it must be in the Authentication category with the “Copy code” button.",
  "Meta ha pausado o desactivado la plantilla de verificación «{name}» (error {code}). Revísala en WhatsApp Manager.":
    "Meta has paused or disabled the verification template “{name}” (error {code}). Check it in WhatsApp Manager.",
  // Mi perfil → Avisos → WhatsApp.
  "Ahora no se pueden enviar códigos por WhatsApp: el administrador de Pizarro tiene que crear (o revisar) en Meta la plantilla de verificación. Avísale y vuelve a intentarlo después.":
    "Codes cannot be sent by WhatsApp right now: your Pizarro administrator needs to create (or check) the verification template in Meta. Let them know and try again later.",
  "Todavía no se ha podido enviar el código a {phone}. Cuando el administrador lo arregle, pulsa «Enviar otro código».":
    "The code could not be sent to {phone} yet. Once the administrator fixes it, press “Send another code”.",
};
