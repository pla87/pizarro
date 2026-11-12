# Guía de venta de la licencia (Stripe, sin programar)

Esta guía explica cómo cobrar la licencia comercial de Pizarro (100 € **más IVA**, pago único por servidor; el uso personal y el educativo son gratuitos) con tarjeta en la web y con factura automática, usando solo el panel de Stripe. No hace falta escribir código: al final se pega un enlace en un fichero del proyecto.

> Los pasos y nombres de menú de Stripe cambian de vez en cuando. Si algo no coincide exactamente, busca la opción por su nombre en el panel (o en su ayuda). No guardes en el repositorio ninguna clave ni secreto de Stripe: para esto no hacen falta, solo se usa un enlace público.

## Antes de empezar: lo que debe confirmar el propietario con su gestor

Esta guía es técnica, no es asesoramiento fiscal. Antes de publicar el enlace conviene confirmar con el gestor o asesor:

1. Que el autor está **dado de alta** para facturar (alta censal como autónomo o sociedad, epígrafe de actividad, obligaciones con Hacienda y con la Seguridad Social) antes del primer cobro.
2. Que el **tipo de IVA aplicable es el 21 %** a la venta de esta licencia a clientes de España y cómo se declara (modelo 303).
3. El **tratamiento de las ventas a empresas de otros países de la UE** (inversión del sujeto pasivo, ver más abajo) y la obligación de presentar el modelo 349 si se hacen.
4. El **tratamiento de las ventas a clientes fuera de la UE** y a particulares de otros países de la UE (régimen de ventanilla única, OSS, en su caso).
5. Que la **factura que genera Stripe** cumple los requisitos de factura que exige su caso (datos del emisor, numeración, mención de la inversión del sujeto pasivo cuando proceda), o si prefiere emitirla con su propio sistema.
6. Cómo se declaran los ingresos que Stripe liquida en la cuenta bancaria, y la **comisión** de Stripe (que no es el precio de la factura).
7. Qué cuenta de Stripe usar (a nombre del autor o de la sociedad) y el país de la cuenta.

Y con un abogado, el texto de `LICENSE.md`. En especial, las definiciones de **centro educativo** y **uso educativo** (sección 2), que son gratuitos: incluyen los centros privados con ánimo de lucro (academias) y la gestión interna del propio centro, permiten que la administración de la que depende un centro público instale Pizarro para sus centros, y dejan fuera la actividad comercial ajena a la enseñanza y la formación interna de las empresas. Conviene confirmar que esos límites se entienden sin ambigüedad (por ejemplo, el caso de un profesor particular o formador autónomo, que hoy no se menciona y cuenta como profesional).

## 1. Crear la cuenta de Stripe

1. Entra en la web de Stripe y crea una cuenta con un email de la actividad.
2. Activa la cuenta (**Activar pagos** o similar): datos de la actividad, del titular, y la cuenta bancaria donde recibir los cobros. Hasta completarlo, Stripe funciona en modo de prueba.
3. En **Configuración de la empresa** completa el nombre comercial, la dirección y el NIF del emisor: aparecerán en las facturas.
4. Mientras pruebas, usa el **modo de prueba** (interruptor arriba del panel). Todo lo de esta guía se puede probar antes con las tarjetas de prueba de Stripe; cuando funcione, repite la creación del enlace en modo real.

## 2. Crear el producto

1. **Catálogo de productos → Añadir producto.**
2. Nombre: **Licencia comercial Pizarro**.
3. Descripción (opcional): «Licencia comercial de Pizarro, pago único por servidor. Actualizaciones incluidas.»
4. Precio: **100 €**, tipo **Pago único** (no recurrente), moneda euro.
5. **Comportamiento fiscal (tax behavior): «Exclusivo» (exclusive)**. Así el precio de 100 € es **sin IVA** y el IVA se suma después, que es lo que se anuncia en la web.
6. Guarda el producto.

## 3. Configurar el IVA

### Opción recomendada: Stripe Tax

1. **Impuestos (Tax) → Empezar** y activa Stripe Tax.
2. Indica la dirección del emisor y añade tu **registro de IVA** (el país donde estás registrado; en España, el IVA general).
3. Elige el **código fiscal del producto** (software o servicio electrónico, según te indique el gestor).
4. Deja el comportamiento fiscal del precio en **exclusivo (exclusive)**.

Stripe Tax calcula el IVA según el país del comprador y aplica la inversión del sujeto pasivo cuando el comprador es una empresa de la UE con un número de IVA válido (ver el apartado de IVA intracomunitario).

### Alternativa: tasa de IVA manual del 21 %

Si no se activa Stripe Tax:

1. **Catálogo de productos → Tasas de impuestos → Crear** una tasa **IVA 21 %**, tipo **Exclusiva (no incluida en el precio)**, país España.
2. Asígnala al producto o al Payment Link como tasa de impuesto por defecto.

Con la tasa manual se cobra el 21 % a todos los compradores, incluidas las empresas de otros países de la UE. Si vas a vender fuera de España, pregunta al gestor si te conviene Stripe Tax o gestionar esos casos a mano.

## 4. Crear el Payment Link

1. **Payment Links → Nuevo** (o **Crear enlace de pago**).
2. Elige el producto **Licencia comercial Pizarro** (cantidad 1; desactiva el selector de cantidad: la licencia es por servidor y se compra una por servidor; quien tenga varios servidores repite la compra).
3. Activa la **recogida automática de impuestos** (con Stripe Tax) o aplica la tasa manual del paso 3.
4. En **Opciones**:
   - **Crear factura después del pago** (invoice creation): **activado**. Stripe genera y envía la factura por email al comprador automáticamente.
   - **Recoger la dirección de facturación**: activado (obligatoria para calcular el IVA y para la factura).
   - **Recoger el nombre de la empresa** (o «Permitir que los clientes compren como empresa»): activado.
   - **Recoger el NIF/CIF/número de IVA (tax ID collection)**: activado. Es **opcional** para quien compra: los particulares pueden dejarlo en blanco.
   - El **email** del comprador se pide siempre en el pago; Stripe lo usa para enviarle el recibo y la factura.
5. **Página de confirmación**: elige **Mostrar mensaje de confirmación** y escribe algo como: «Gracias por tu compra. Te hemos enviado la factura por email. Ahora, en Pizarro, ve a Administración → Licencia y anota el titular y el número de factura. No hace falta activar nada: Pizarro funciona igual con o sin ese registro.» (Si prefieres, redirige a una página tuya.)
6. Guarda (**Crear enlace**). Stripe te da una dirección pública del estilo `https://buy.stripe.com/...`.

Antes de publicarlo, prueba el enlace en modo de prueba: paga con una tarjeta de prueba, comprueba que llega la factura con el IVA bien calculado (21 % para un comprador de España) y con el NIF y el nombre de empresa si se rellenan.

## 5. Dónde pegar el enlace y cómo publicarlo

1. Abre `src/lib/product.ts` y pega el enlace (el del modo real) en la constante `BUY_URL`:

   ```ts
   export const BUY_URL: string = "https://buy.stripe.com/...";
   ```

   Es una constante del producto, no de cada instalación: el producto se vende desde un único sitio. Es un enlace público; no contiene claves ni secretos.
2. Guarda el cambio con un commit y publica una versión nueva como se hace habitualmente (ver `docs/HANDOFF.md`; si la publicas a mano con **Actions → Release → Run workflow**, elige la rama `main`: la publicación manual solo funciona desde `main`). La página de presentación (botón «Comprar»), Administración → Licencia (botón «Comprar licencia (100 € + IVA)») y el recordatorio de licencia para administradores usan ese enlace. La web getpizarro.com se regenera sola al subir el cambio a `main` (ver «Web getpizarro.com»): su botón «Próximamente» pasa a ser «Comprar licencia».
3. Mientras `BUY_URL` esté vacía, el botón de la app lleva al email de contacto público (el configurado en Administración → Textos legales) o, si tampoco hay, a la página `/licencia`; en getpizarro.com sale «Próximamente», deshabilitado, con la nota «Mientras tanto puedes usar Pizarro con normalidad: la licencia se basa en la buena voluntad».

## 6. Qué hace el comprador después

1. Paga con tarjeta en el enlace y recibe la factura por email.
2. En su instalación de Pizarro, entra como administrador en **Administración → Licencia → Registrar licencia** y anota el **titular** (empresa o nombre) y, si quiere, el **número de factura o recibo** y el email de compra; la fecha se pone sola. Se guarda en su instalación, queda anotado en el registro de actividad y deja de salir el recordatorio de licencia a los administradores.
3. Ese registro es solo informativo: no activa nada ni bloquea nada, y Pizarro no hace llamadas a internet para comprobarlo.

Cada servidor necesita su licencia. Las actualizaciones son gratuitas para siempre. El soporte no está incluido.

## 7. IVA intracomunitario (empresas de otros países de la UE)

- Si el comprador es una **empresa de otro país de la UE con un número de IVA (VAT) válido**, la operación normalmente se factura **sin IVA** por **inversión del sujeto pasivo** (el IVA lo declara el comprador en su país), y la factura debe indicarlo.
- **Stripe Tax lo gestiona**: valida el número de IVA que se recoge en el pago y, si es válido y el comprador está en otro país de la UE, no cobra IVA y lo anota en la factura. Con la tasa manual del 21 % **no** se hace: cobraría el 21 % a todos.
- Si el comprador es un particular, o la empresa no aporta un número de IVA válido, se cobra el IVA que corresponda.
- Estas ventas hay que declararlas (por ejemplo, el modelo 349 de operaciones intracomunitarias en España). Consúltalo con el gestor.
- Para ventas fuera de la UE, el IVA español normalmente no se aplica, pero conviene confirmar con el gestor cada caso.

## 8. Web getpizarro.com

La web del producto es un sitio estático (sin cookies ni analítica, sin recursos externos; solo unas líneas de JavaScript para el botón «Copiar» del comando de instalación) que se genera desde el repositorio y se publica gratis con **GitHub Pages**. Tiene la presentación del producto (qué es, capturas reales, precio, preguntas e instalación en un bloque corto), la guía de instalación para usuarios (`/instalar/` y `/en/install/`, desde `docs/web/instalar.md` y `docs/web/en/install.md`; el generador falla si falta una de las dos), las guías de conexión (`/guias/`, desde `docs/guias/`) y la licencia. La referencia técnica de la instalación sigue en `docs/INSTALL.md`.

- **Fuentes:** `site/templates/layout.html` (plantilla), `site/static/` (hoja de estilos, `CNAME`, `robots.txt`, imágenes para redes `og.png` y `og-en.png`, capturas en `img/`) y `scripts/build-site.mjs`, que genera `site/dist` (falla si falta una traducción o una captura). Los textos salen de `src/lib/site-content.ts` (y las preguntas frecuentes, de `src/lib/landing-content.ts`, las mismas de `/presentacion`), con su inglés en `src/i18n/en/` (`web2.ts` y `licencia2.ts`); el precio y el enlace de compra, de `src/lib/product.ts`; la licencia (`/licencia/` y `/en/license/`), de `LICENSE.md`. Español en `/` e inglés en `/en/`.
- **Probarla en local:** `node scripts/build-site.mjs` (Node 22.18 o superior) y abre `site/dist` con cualquier servidor estático.
- **Capturas:** son de la app real, con datos de demostración (personas ficticias, emails `@example.com`), en español e inglés y en tema claro y oscuro (WebP a dos tamaños). Se regeneran con `scripts/site-screenshots.mjs`, que rellena una base de datos de pruebas, abre la app con Playwright y crea también las imágenes para redes; los pasos están al principio del script. Hazlo cuando cambie el aspecto de la app.
- **Publicación:** el workflow `.github/workflows/site.yml` la regenera y la publica en cada push a `main` que cambie `site/`, el script, `LICENSE*.md`, `src/lib/product.ts` o sus textos, y también a mano (**Actions → Web → Run workflow**).

### Pasos del propietario (una sola vez)

1. **Activar Pages con origen «GitHub Actions» (imprescindible):** en el repositorio, **Settings → Pages → Build and deployment → Source** y elige **GitHub Actions** en el desplegable. **No** elijas «Deploy from a branch»: con esa opción GitHub no usa la web generada, sino que publica el `README.md` del repositorio con Jekyll (se ve el README con un tema genérico en lugar de la presentación de Pizarro). Si ya estaba en «Deploy from a branch», cámbialo a **GitHub Actions**. Si GitHub llegó a crear un fichero `CNAME` en la raíz del repositorio (un commit «Create CNAME» al poner el dominio), sobra y se puede borrar: la web lleva el suyo en `site/static/CNAME`.
   Después lanza el workflow: **Actions → Web → Run workflow** (rama `main`) y pulsa el botón verde **Run workflow**. También se lanza solo al subir a `main` un cambio en `site/` o en sus textos.
2. **DNS en el registrador del dominio** `getpizarro.com` (en su panel de DNS):
   - Cuatro registros **A** del dominio raíz (`@`) a `185.199.108.153`, `185.199.109.153`, `185.199.110.153` y `185.199.111.153`.
   - Opcional (IPv6): cuatro registros **AAAA** de `@` a `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153` y `2606:50c0:8003::153`.
   - Un registro **CNAME** de `www` a `pla87.github.io` (así `www.getpizarro.com` redirige a `getpizarro.com`).
   - Borra otros registros A/AAAA/CNAME del raíz o de `www` que ponga el registrador por defecto (páginas de aparcamiento).
3. **Dominio personalizado:** en **Settings → Pages → Custom domain** escribe `getpizarro.com` y pulsa **Save** (con la publicación por GitHub Actions este paso es obligatorio: el fichero `CNAME` del sitio no basta). Cuando GitHub compruebe el DNS (de minutos a unas horas), marca **Enforce HTTPS**.
4. **Verificar el dominio** para que nadie pueda usarlo en otro repositorio de GitHub (secuestro de dominio): en la configuración de **tu cuenta** (no del repositorio), **Settings → Pages → Verified domains → Add a domain**, escribe `getpizarro.com` y crea en el DNS el registro **TXT** que indica GitHub (del estilo `_github-pages-challenge-pla87.getpizarro.com`); después pulsa **Verify**. Deja ese registro TXT puesto.

### Comprobar que funciona

- **El workflow:** en **Actions → Web**, la última ejecución está en verde con sus dos pasos, «Generar la web» y «Publicar en GitHub Pages». Si falla en «Publicar en GitHub Pages» (error del estilo «Get Pages site failed» o «Not Found»), Pages no está activado con **Source: GitHub Actions** (paso 1).
- **Una señal de que el origen es el equivocado:** en **Actions** aparece un workflow que no es del repositorio, «pages build and deployment». Sale solo con «Deploy from a branch»; con «GitHub Actions» no debe aparecer.
- **Settings → Pages:** arriba indica «Your site is live at https://getpizarro.com» (o la dirección `github.io` mientras no haya dominio) con el botón **Visit site**, y en *Build and deployment* sigue **Source: GitHub Actions**.
- **La web:** abre https://getpizarro.com (mejor en una ventana privada, para no ver una copia antigua). Debe verse la presentación de Pizarro con el logo, las capturas de la app y el precio, no el texto del README. Comprueba también https://getpizarro.com/en/ (inglés), https://getpizarro.com/licencia/ (texto de la licencia) y que `http://` y `www.` llevan a `https://getpizarro.com`.
- **Desde la terminal (opcional):** `curl -sI https://getpizarro.com` responde `HTTP/2 200` y `curl -s https://getpizarro.com | grep -c 'og.png'` da 1 o más; si la página contiene el texto del README, el origen sigue en «Deploy from a branch».

La web no muestra ningún email de contacto. Cuando haya un enlace de pago (`BUY_URL`, sección 5), el botón «Comprar licencia» aparece solo tras el siguiente despliegue.

## Comprobación final

- [ ] El gestor ha confirmado el alta, el tipo de IVA y el tratamiento de las ventas fuera de España.
- [ ] El producto tiene el precio de 100 € con comportamiento fiscal exclusivo.
- [ ] Stripe Tax está activado (o la tasa manual del 21 % exclusiva está asignada).
- [ ] El Payment Link crea factura después del pago y pide dirección, empresa y NIF/CIF/VAT (opcional).
- [ ] Una compra de prueba produce una factura correcta.
- [ ] `BUY_URL` contiene el enlace del modo real y la nueva versión está publicada.
- [ ] getpizarro.com muestra el botón «Comprar licencia» (workflow «Web» ejecutado tras el cambio) y tiene HTTPS forzado y el dominio verificado.
