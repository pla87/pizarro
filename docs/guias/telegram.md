---
titulo: Avisos por Telegram
descripcion: Recibe menciones y asignaciones en Telegram. Gratis y listo en cinco minutos.
orden: 3
icono: send
---

# Avisos por Telegram

Pizarro puede enviar los avisos (menciones, asignaciones, comentarios…) por Telegram. Es **gratis** y se prepara en unos
cinco minutos: un administrador crea un bot y pega su token en Pizarro, y después cada persona conecta su Telegram desde
su perfil.

Necesitas:

- Una cuenta de administrador en Pizarro.
- La app de Telegram (en el móvil o en el ordenador).

## Paso 1. Crea el bot con @BotFather

1. En Telegram, busca **@BotFather** (tiene la marca azul de verificado) y abre el chat.
2. Escribe `/newbot`.
3. Escribe el **nombre** que verá la gente, por ejemplo `Avisos de Pizarro`.
4. Escribe el **usuario** del bot. Tiene que terminar en `bot`, por ejemplo `pizarro_avisos_bot`. Si ya existe, prueba
   con otro.
5. BotFather te responde con un **token** parecido a `123456789:AAH…`. Cópialo. Es la llave del bot: no lo compartas.

Opcional: con `/setdescription` y `/setuserpic` en BotFather puedes poner una descripción y una foto al bot.

## Paso 2. Pega el token en Pizarro

1. En Pizarro, ve a **Administración → Ajustes → 3. Avisos por Telegram y WhatsApp**.
2. En **Telegram (gratis)**, pega el token en **Token del bot**.
3. Pulsa **Guardar y activar**.

Pizarro comprueba el token con Telegram, lo guarda cifrado y no lo vuelve a mostrar (solo sus 4 últimos caracteres).
Verás «Activo: bot @…».

## Paso 3. Prueba el bot

1. En **Administración → Ajustes**, pulsa **Probar**. Pizarro comprueba que el bot responde.
2. Si además has conectado tu propio Telegram (paso 4), te llega un «Mensaje de prueba de Pizarro».

## Paso 4. Cada persona conecta su Telegram

Cada persona lo hace una vez:

1. **Mi perfil → Avisos → Avisos en el móvil**, pulsa **Conectar Telegram**.
2. Pulsa **Abrir Telegram** (o escanea el código QR con el móvil si estás en el ordenador).
3. En Telegram, pulsa **Iniciar**. El bot responde «Listo…» y Pizarro muestra «Conectado».
4. Elige qué avisos quieres recibir por Telegram y pulsa **Guardar**. Por defecto llegan solo las **menciones** y las
   **asignaciones**.

El enlace sirve una sola vez y caduca a los 10 minutos. Para dejar de recibir avisos: **Desconectar** en Mi perfil,
escribir `/stop` al bot o bloquearlo en Telegram.

## Cómo recibe Pizarro los mensajes del bot

Pizarro elige solo la forma, según la dirección pública de la instalación (variable `APP_URL`):

- **Con `APP_URL` https pública** (por ejemplo `https://pizarro.tuempresa.com`): Telegram avisa a Pizarro al instante en
  `APP_URL/api/telegram/webhook`. Cada llamada lleva un secreto que solo conocen Telegram y Pizarro.
- **Sin https pública** (instalación en casa o en la red de la oficina, `http://…`, una IP o un puerto distinto de 443,
  80, 88 u 8443): Pizarro pregunta a Telegram cada pocos segundos. No hace falta abrir puertos ni tener dominio. Lo único
  que cambia es que conectar Telegram puede tardar un par de segundos más.

Los avisos salen igual en los dos casos. Si cambias `APP_URL`, Pizarro vuelve a registrar el webhook al arrancar. Si al
arrancar Telegram no responde (o la base de datos aún no está lista), Pizarro lo vuelve a intentar solo, cada vez más
espaciado (hasta cada 5 minutos), hasta que sale bien.

El modo sin https (Pizarro pregunta a Telegram) es para **una sola instancia** de Pizarro. Con varias réplicas detrás de
un balanceador, todas preguntarían a la vez por los mismos mensajes del bot (Telegram rechaza la segunda): en ese caso
usa una `APP_URL` https pública para que Telegram llame al webhook. Al apagarse, Pizarro avisa a Telegram de los mensajes
que ya ha procesado, para que la instancia siguiente no los repita.

## Desactivar o cambiar de bot

- **Desactivar**: deja de enviar avisos por Telegram; el bot y las conexiones se conservan para cuando lo reactives.
- **Quitar el bot**: borra el token y desconecta a todo el mundo.
- **Cambiar de bot** (pegar el token de otro bot con **Reemplazar**): cada persona tiene que volver a conectar su
  Telegram, porque el bot nuevo no puede escribir a quien no lo ha abierto. Pizarro quita el webhook del bot anterior
  (deja de recibir sus mensajes) y crea un secreto nuevo para el webhook del nuevo.

## Problemas frecuentes

- **«Telegram no acepta este token»**: copia el token entero de BotFather, sin espacios. Si lo regeneraste con
  `/revoke`, el anterior ya no vale.
- **Conecto Telegram pero Pizarro sigue esperando**: comprueba que pulsaste **Iniciar** en el chat del bot. Si el enlace
  caducó, vuelve a pulsar **Conectar Telegram**.
- **«Telegram ha respondido con un error» en Ajustes**: con webhook, suele ser que la dirección https no es accesible
  desde Internet o el certificado no es válido. Revisa `APP_URL` y el certificado.
- **A alguien le dejaron de llegar**: si bloqueó el bot o borró el chat, Pizarro lo desconecta solo. Que vuelva a pulsar
  **Conectar Telegram**.
- Cada persona recibe como mucho 30 mensajes de Telegram por hora; el resto de avisos de esa hora quedan en la campana de
  Pizarro. Los fallos quedan en **Administración → Logs** (sin tokens).
