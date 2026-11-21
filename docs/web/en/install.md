---
titulo: Install Pizarro
descripcion: Step by step, no expertise needed: on your own server with a single command, or on Railway with no server of your own.
---

<!--
Installation guide for users: the website publishes it at https://getpizarro.com/en/install/ (scripts/build-site.mjs).
Its Spanish version is docs/web/instalar.md and both must exist. The fixed identifiers ({#…}) are linked from the home
page, the app and the release notes: do not change them. The technical reference is docs/INSTALL.md (in Spanish).
-->

# Install Pizarro

Pizarro runs on a server of your own and your data stays there. This guide takes you from nothing to your first board:
what you need, how to install it, the first steps and how to keep it up to date. If something is not covered here, the
[full technical documentation](../../INSTALL.md) (in Spanish) explains it in detail.

## What you need {#what-you-need}

**To install it on your own server:**

- **A Linux server** with an x86_64 or arm64 processor: a VPS (a server you rent by the month from a hosting provider;
  any of them will do), a mini PC in the office or a Raspberry Pi 5.
- **Recommended size: 2 GB of RAM, 1 or 2 processors (vCPUs) and 20 GB of disk**, plus whatever your attachments take
  up. Pizarro starts with 1 GB of RAM, but 2 GB gives it room to spare. The most basic plan that reaches those figures
  is usually enough.
- **Terminal access** (SSH) as `root` or with a user who can use `sudo`. On Windows, PowerShell will do, since it
  already includes SSH; on a Mac, the Terminal app.
- **Docker.** If you don't have it, the installer offers to install it for you.
- **A domain or subdomain** (for example `pizarro.example.com`) pointing to the server's IP address, with ports 80
  and 443 open. If you will only use it at home or in the office, it also works on the local network, with no domain.

**Or, with no server of your own:** an account on [Railway](https://railway.com), a cloud service that charges for what
you use, and a GitHub account.

## Choose your path {#choose-your-path}

| Option | Your own server | Railway |
|---|---|---|
| **Best if** | You have a VPS or a Linux machine | You don't want to look after a server |
| **How** | One command in the terminal | A few clicks in Railway's dashboard |
| **Time** | A few minutes | About 15 minutes |
| **HTTPS** | Automatic | Automatic |
| **Cost** | Your server's | Whatever Railway charges each month |

Both paths end the same way: in the wizard that creates your administrator account. Carry on with
[Your own server](#own-server) or jump to [Railway](#railway).

## Install on your server with one command {#own-server}

1. **Point your domain at the server.** Sign in to the dashboard of the company you bought the domain from and look for
   the **DNS** section (sometimes called **DNS zone** or *Manage DNS*). Create a record of type `A`: as the name, the
   front part of the domain (`pizarro` for `pizarro.example.com`, or `@` if you use the whole domain) and as the value,
   the server's IP address. If the server has IPv6, create another one of type `AAAA` with that address. The change can
   take anywhere from a few minutes to a few hours to reach the whole Internet. If you will only use Pizarro on the
   local network, skip this step.

2. **Log in to the server** from your computer's terminal: on Windows, open **PowerShell** (search for it in the Start
   menu); on a Mac, the **Terminal** app. Type:

   ```bash
   ssh root@203.0.113.10
   ```

   Replace `203.0.113.10` with your server's IP address (or `root` with your user). The first time, it asks whether you
   trust the server: type `yes` and press Enter. Then type the password your provider gave you (nothing shows while you
   type it: that's normal).

3. **Open ports 80 and 443.** That's how people reach Pizarro and how the HTTPS certificate is requested. If your
   provider has a firewall in its dashboard (*Firewall* or *Security group*), add a rule there that allows incoming TCP
   on ports 80 and 443. If the server itself also uses `ufw` (check with `ufw status`: it says `Status: active`), open
   them there too:

   ```bash
   ufw allow 80,443/tcp
   ```

   If `ufw status` says `inactive` or that it doesn't exist, there's nothing else to do. On the local network, with no
   domain, skip this step.

4. **Run the installer.** Copy this command, replace `pizarro.example.com` with your domain and paste it into the
   terminal:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --domain pizarro.example.com
   ```

   To use it only on the local network, with no domain, change the end to `--local`:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --local
   ```

5. **Answer if it asks.** If the server has no Docker, the installer asks whether to install it with Docker's official
   script: type `s` (for *sí*, yes) and press Enter. If you didn't give it the domain, it asks how you will reach
   Pizarro.

6. **Wait a few minutes.** The installer downloads Pizarro, creates the configuration with secure keys, starts
   everything and checks that it works. When it finishes, it shows you the address and a code for the next step.

### What you will see on screen {#on-screen}

Something like this (the download lines have been shortened). For now the installer speaks Spanish: the lines that
matter are **Dirección** (address), **Asistente** (setup wizard) and **Código** (one-time code).

```text
Docker listo: Docker version 27.3.1, build ce12230.
Última versión publicada: v1.50.0.
Descargando Pizarro (v1.50.0) desde GitHub...
Instalando en /opt/pizarro...

Ejecutando deploy/install.sh ...
Creado /opt/pizarro/deploy/.env a partir de .env.example.
Secretos generados: POSTGRES_PASSWORD APP_DB_PASSWORD SESSION_SECRET BACKUP_KEY TOKEN_SECRET ENCRYPTION_KEY
Kit de recuperación escrito en /opt/pizarro/deploy/recovery-kit.txt (permisos 600).

Descargando la imagen de Pizarro...
Arrancando Pizarro...
Esperando a que la app esté lista...

Pizarro está en marcha.

  Dirección:  https://pizarro.example.com
  Asistente:  https://pizarro.example.com/setup
  Código:     K7QM-4TXD      (caduca en 24 horas; se renueva si se reinicia la app)
```

Write down the **code**: you need it in the next step. Below it you will see a box asking you to keep the recovery kit
safe.

> [!IMPORTANT]
> **Keep the recovery kit off the server.** It is the file `/opt/pizarro/deploy/recovery-kit.txt` and holds your
> installation's keys. Without them, the backups cannot be opened. Download it to your computer: open **another**
> PowerShell or Terminal window, on your computer and not on the server, and type (with your server's IP address):
>
> ```bash
> scp root@203.0.113.10:/opt/pizarro/deploy/recovery-kit.txt .
> ```
>
> The whole file lands in the folder that window is in (on Windows, usually your user folder). That's safer than
> copying it off the screen, where it's easy to miss a piece. Then keep it in a password manager or somewhere else
> safe.

**What has been installed:** the code in `/opt/pizarro` and three Docker containers that start with the server: Caddy
(which provides HTTPS), Pizarro and its PostgreSQL database. Your data lives in Docker volumes, separate from the code,
and updates don't touch it.

> [!TIP]
> **Would you rather read the script before running it?** Download it, review it and run it afterwards:
>
> ```bash
> curl -fsSLO https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh
> less get.sh
> sh get.sh --domain pizarro.example.com
> ```

**Other installer options** (added at the end of the command):

- `--version 1.49.0` installs that version instead of the latest one (1.38.0 or later).
- `--dir /srv/pizarro` uses another folder (by default, `/opt/pizarro`).
- `--yes` installs Docker without asking, if it is missing.
- `--build` builds Pizarro on the server instead of downloading it ready-made (needs 2 GB of RAM).
- `--help` shows every option.

### Change the configuration (`.env`) {#edit-env}

Some things, such as the external backup destination, the time zone or the domain, are changed in the
`/opt/pizarro/deploy/.env` file on the server. To edit it, log in to the server and open it with the `nano` editor (if
you are not `root`, put `sudo` in front):

```bash
nano /opt/pizarro/deploy/.env
```

Move around with the arrow keys and type or change what you need. To save, press **Ctrl+O** and then Enter; to exit,
**Ctrl+X** (on a Mac too: Ctrl, not Cmd). Then apply the change:

```bash
cd /opt/pizarro/deploy
docker compose up -d
```

## First steps {#first-steps}

1. **Open the wizard** in your browser: the address the installer gave you, ending in `/setup` (for example,
   `https://pizarro.example.com/setup`).
2. **Type the one-time code.** It checks that you are the person installing the server.
3. **Your organization:** enter its name and choose the installation's language and time zone.
4. **First administrator:** your name, your email and a password of at least 10 characters.
5. **Email:** the wizard tells you whether sending email is ready and lets you send a test. If it isn't yet, carry on:
   you set it up later from the app itself ([how](#email)).
6. **Sign in and turn on two-step verification.** When you sign in, Pizarro asks you to set it up (it is mandatory for
   administrators): with an authenticator app, such as Google Authenticator, Microsoft Authenticator or your password
   manager's, or with a code by email if email is already set up. Keep the recovery codes it shows you.
7. **Invite your team** from *Administration → Users*.

When you finish, the wizard goes away: `/setup` no longer exists and from then on everyone uses the normal sign-in
screen.

> [!NOTE]
> **Lost the code?** It expires after 24 hours. To see the latest one or get a new one, on the server:
>
> ```bash
> cd /opt/pizarro/deploy
> docker compose restart app
> docker compose logs app | grep "introduce el código"
> ```
>
> On Railway, restart Pizarro's service (in *Deployments*, the *⋮* menu of the active deployment → *Restart*) and look
> in the log for the line `PIZARRO ESTÁ SIN CONFIGURAR`: the new code is right below it.

## Install on Railway, with no server of your own {#railway}

[Railway](https://railway.com) runs Pizarro and its database from the GitHub repository, with HTTPS. It is all done
from its web dashboard, with no terminal.

> [!NOTE]
> **How Railway deploys.** While you set up the service, Railway doesn't deploy each change: it collects them in a
> notice at the top left, "Apply N changes", with a **Deploy** button. In this guide you click it **only once**, at the
> end (step 6), when everything is ready.

1. **Create the project and the database.** Open <https://railway.com/new> and choose **Database → PostgreSQL**.
   Railway creates a service called `Postgres`. If you like, give the project a name in *Settings → General*.
2. **Add Pizarro.** In the same project, click **+ Add → GitHub Repository** and choose `pla87/pizarro` (or your copy).
   The first time, Railway asks for permission to see your GitHub repositories. A second box appears: Pizarro's
   service.
3. **Choose the `stable` branch.** Click Pizarro's box and go to *Settings → Source → **Branch connected to
   production***. The drop-down lists every branch: type `stable` to filter and pick it. That branch only moves when a
   version is published, so Railway only updates with finished versions, never with half-done changes.
4. **Generate the address and attach the volume.**
   - In *Settings → Networking*, click **Generate Domain**. Railway reserves an address such as
     `pizarro-production.up.railway.app`. It doesn't work until the first deploy: that's normal.
   - Right-click Pizarro's box → **Attach volume** and, as the *Mount path*, type `/app/uploads`. Files and backups
     are kept there; without a volume they would be lost on every deploy.
5. **Paste the variables.** Click **Generate my variables**: the page creates four random keys in your browser and puts
   them in the block below. They aren't sent anywhere, neither to this website nor to Railway: they only exist on your
   screen until you copy them. Click **Copy**, go to Pizarro's service → *Variables* → *Raw Editor*, paste and click
   *Update Variables*.

   ```railway-env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=click-generate-my-variables
   TOKEN_SECRET=click-generate-my-variables
   ENCRYPTION_KEY=click-generate-my-variables
   BACKUP_KEY=click-generate-my-variables
   UPLOAD_DIR=/app/uploads
   ```

   - **`APP_URL` isn't needed:** Pizarro uses the address Railway reserved in step 4 by itself. You only have to add
     it if you set up [your own domain](#domain).
   - `${{Postgres.DATABASE_URL}}` stays as it is: Railway replaces it with the database's address. If your database
     service isn't called `Postgres`, change that name.
   - **Save the four keys now** in a password manager (see the notice below).
   - **Without the button:** you can also generate them in the terminal of a Mac or Linux computer (on Windows, in Git
     Bash). Each key must be different. Run this command three times, for `SESSION_SECRET`, `TOKEN_SECRET` and
     `ENCRYPTION_KEY`:

     ```bash
     openssl rand -base64 48
     ```

     And this one for `BACKUP_KEY`:

     ```bash
     openssl rand -base64 32
     ```

6. **Deploy, just once.** At the top left you will see "Apply N changes": click **Deploy**. Railway builds Pizarro and
   starts it, which takes a few minutes. If Railway got to deploy before you had added the variables or the volume, you
   may get a "Build failed" email: that's normal and there's nothing to do. The deploy that counts is this one, with
   everything in place.
7. **Wait for Pizarro to prepare the database.** The first time it takes 2 or 3 more minutes, even if Railway already
   shows *Active*. In Pizarro's service, open *Deployments → View logs*, scroll to the end of the log and wait for the
   line `PIZARRO ESTÁ SIN CONFIGURAR` ("Pizarro is not set up yet"). The red lines at the start are normal. You will
   see something like this:

   ```text
   ================================================================
   [setup] PIZARRO ESTÁ SIN CONFIGURAR
   [setup] Abre https://pizarro-production.up.railway.app/setup e introduce el código: K7QM-4TXD
   [setup] El código caduca en 24 horas y cambia en cada arranque mientras falte la configuración.
   ================================================================
   ```

   The second line gives the address of the setup wizard and the code (*código*).
8. **Open the wizard.** Go to your address ending in `/setup` and follow the [first steps](#first-steps) from step 2,
   with the code from the log.

> [!IMPORTANT]
> Keep `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` and `BACKUP_KEY` **outside Railway** as well, in a password
> manager. Without `BACKUP_KEY` the backups cannot be opened, and without `ENCRYPTION_KEY` everyone would have to set up
> their two-step verification again.

> [!WARNING]
> **Railway may suggest changes you didn't ask for.** Sometimes the notice at the top left says, for example, "Apply 2
> changes" with region or replica changes you never touched. Open it to see what they are before clicking **Deploy**:
>
> - **Replicas:** don't apply a change that sets more than one. Pizarro runs as a single instance (its configuration
>   already says so); with two or more, live updates and the sign-in attempt limits would break. Discard that change or
>   set it back to 1.
> - **Region:** it doesn't matter which one, as long as the database (`Postgres`) is in the same one. If they are in
>   different regions, Pizarro is slower.

> [!NOTE]
> Create the variables in Pizarro's service, not as the project's *Shared Variables*: those don't reach the service on
> their own. And don't add the `SEED_ADMIN_*` variables: without them, the first administrator is created with the
> wizard.

## Optional settings {#settings}

All of this is turned on from the app itself, in *Administration → Integrations*, without touching the server. None of it
is required: Pizarro works without it.

### Email {#email}

With email, Pizarro sends invitations, notifications, digests and the "Forgot your password?" link. Set it up in
*Administration → Integrations → Email notifications* in one of two ways:

- **With an administrator's Gmail** (the simplest for a family or a small team): turn on two-step verification in that
  Google account, create an app password at <https://myaccount.google.com/apppasswords> and paste it into Pizarro
  along with the Gmail address.
- **With your company's email:** choose your provider (Google Workspace, Microsoft 365, Brevo, SendGrid, Amazon SES,
  Mailgun or Mailchimp Transactional) and Pizarro fills in the server and the port; you enter the user and the
  password.

Click *Send test email* to check it.

### Google, Telegram and WhatsApp {#connections}

Each connection has its own step-by-step guide:

- [Sign in with Google](../../guias/en/google-login.md): sign in with a Google account, with no extra password.
- [Google Docs, Sheets and Slides](../../guias/en/google-docs.md): create a document, a spreadsheet or a presentation from a task.
- [Notifications on Telegram](../../guias/en/telegram.md): free and ready in five minutes.
- [Notifications on WhatsApp](../../guias/en/whatsapp.md): with Meta's official API, paid.

## Backups {#backups}

Pizarro makes **an automatic backup every day**, encrypted, of the database and all the files. It keeps those from the
last two weeks and one a month for the last six months, and every month it test-restores the latest one to check that
it works. You can see how they are going, and make one on the spot with *Create backup now*, in *Administration →
Backups*.

Those backups are kept on the server itself, so they don't protect you if you lose it. For that:

1. **Keep the recovery kit off the server** (or, on Railway, the four keys).
2. **Add an external destination**, where Pizarro uploads each backup: S3-compatible storage (Cloudflare R2,
   Backblaze B2, MinIO…) or a mounted folder, such as a USB drive or a NAS. For S3, create a private *bucket* and a key
   just for it, and add its details at the end of `/opt/pizarro/deploy/.env` ([how to edit it](#edit-env)):

   ```env
   BACKUP_S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-backups"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   ```

   Apply the change with `docker compose up -d` (in `/opt/pizarro/deploy`) and click *Copy to external destination now*
   in *Administration → Backups*. Everything uploaded is encrypted: the provider cannot read it.

   **On Railway,** put the `BACKUP_S3_*` variables in the *Variables* of Pizarro's service (same names and values,
   without the quotes), also add `BACKUP_S3_PREFIX=pizarro` and deploy again.

> [!TIP]
> **With Cloudflare R2, protect the backups with a retention rule.** In the Cloudflare dashboard, in your *bucket* →
> *Settings* → *Bucket Lock Rules*, add a rule for the `pizarro/` prefix (the one in `BACKUP_S3_PREFIX`) with a
> 30-day retention. That way nobody can delete or overwrite a backup before it is 30 days old, even if they get hold of
> the access key or a mistake deletes what it shouldn't. Pizarro works the same with the rule in place.

The mounted folder, the S3 region and the other details are in the
[technical documentation](../../INSTALL.md#4-copias-de-seguridad) (in Spanish).

### Restore on a new server {#restore}

If you lose the server, you need the recovery kit and your external destination:

1. **Prepare the new server without starting Pizarro:** the install command with `--no-start` at the end.

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --domain pizarro.example.com --no-start
   ```

2. **Put in your keys.** In `/opt/pizarro/deploy/.env`, replace `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` and
   `BACKUP_KEY` with the ones in the kit (if the kit says «no definida», "not set", for any of them, delete its line)
   and add your external destination's `BACKUP_S3_*` variables.
3. **Restore and start:**

   ```bash
   cd /opt/pizarro/deploy
   docker compose pull app
   docker compose up -d --wait postgres
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
   docker compose up -d
   ```

To pick a specific backup, go back to an earlier backup on the same server or restore on Railway, see the
[technical documentation](../../INSTALL.md#6-restaurar) (in Spanish).

## Update {#update}

Before updating, make a backup: *Administration → Backups → Create backup now*.

**On your server,** run the install command again, without `--domain`:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh
```

It downloads the latest published version, starts it and keeps your configuration, the recovery kit and your data. Any
changes the database needs are applied automatically. If the update is interrupted halfway, the previous installation
stays intact.

**On Railway** you don't need to do anything: if the service follows the `stable` branch, it updates itself every time
a version is published.

**Going back to an earlier version** (or installing a specific one): add `--version` with its number.

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --version 1.49.0
```

> [!WARNING]
> If the new version has already started, it may have changed the database and an earlier version might not understand
> it. That's why the backup beforehand matters: if needed, you restore it and go back.

**What each installation receives.** Only published, tested versions: the install command, the Docker image and
Railway's `stable` branch always follow the latest published version, never loose changes. The versions and what's new
in each are at <https://github.com/pla87/pizarro/releases>.

**New version notice.** When one comes out, administrators see a discreet notice in *Administration*. To do this, the
server asks GitHub, at most every 12 hours, which is the latest version, without sending anything about your
installation. If you'd rather it didn't, add `UPDATE_CHECK=0` to `/opt/pizarro/deploy/.env` (or to Railway's
variables).

## Your own domain and HTTPS {#domain}

**On your server,** HTTPS is automatic: as soon as the domain points to the server, Caddy requests the certificate from
Let's Encrypt and renews it by itself. To change domain later on:

1. Point the new domain at the server (an `A` record, as when installing).
2. In `/opt/pizarro/deploy/.env` ([how to edit it](#edit-env)), change `DOMAIN` and `APP_URL`:

   ```env
   DOMAIN="pizarro.example.com"
   APP_URL="https://pizarro.example.com"
   ```

3. Apply the change:

   ```bash
   cd /opt/pizarro/deploy
   docker compose up -d
   ```

**On Railway,** to use your domain instead of the `up.railway.app` address:

1. In Pizarro's service, *Settings → Networking → Custom Domain*, type your domain.
2. At your DNS provider, create the `CNAME` record (and the `TXT` one, if asked) that Railway shows you.
3. When the domain shows as active, add `APP_URL` in *Variables* with the new address (for example,
   `APP_URL=https://pizarro.example.com`, with `https://` and no trailing slash) and deploy again. That's the only case
   in which Railway needs `APP_URL`.

When the address changes, everyone has to sign in again, and anyone who installed Pizarro as an app on their phone
must install it again. If you use "Sign in with Google", also add the new addresses in Google Cloud
([guide](../../guias/en/google-login.md)).

### Another proxy in front, or no proxy {#proxy}

Pizarro uses the IP of whoever connects to limit sign-in attempts and for the activity log. Behind a proxy (the Caddy
from the installation, Railway's or one of your own) the connection comes from the proxy, so the real IP is passed on
by the proxy in the `X-Real-IP` or `X-Forwarded-For` headers. But anyone can write those headers: Pizarro only trusts
them if there is a proxy in front that overwrites them. The `TRUST_PROXY` variable decides:

- **Not set** (the usual case): with Docker and on Railway it trusts them, because they come with their proxy; started
  with `npm start`, it doesn't. There's nothing to change.
- **`TRUST_PROXY=1`** if you start Pizarro with `npm start` behind your own proxy (nginx, Apache, another Caddy…). That
  proxy must overwrite `X-Real-IP` with the client's IP (in nginx: `proxy_set_header X-Real-IP $remote_addr;`).
- **`TRUST_PROXY=0`** if you publish the container without the included Caddy, with port 3000 open as is (not
  recommended).

On your server, the variable goes in `/opt/pizarro/deploy/.env` (apply it with `docker compose up -d`); on Railway, in
the *Variables* of Pizarro's service.

> [!NOTE]
> **On the local network, with no domain,** Pizarro works over plain HTTP, unencrypted. That's enough at home or in the
> office, but don't open it to the Internet like that. Without HTTPS, signing in with Google and installing it as an app
> on most phones don't work either.

## Troubleshooting {#troubleshooting}

### The browser says the certificate is not valid

The domain doesn't point to the server yet or ports 80 and 443 are closed. Check the DNS record (changes can take a
while to spread) and the firewall. To see what Caddy says: `docker compose logs caddy` in `/opt/pizarro/deploy`.

### `/setup` says "Page not found"

The installation is already set up: use the sign-in screen. The wizard only exists while there are no users.

### The installer stops

Read the line that starts with `ERROR:`: it says what is missing. Usually there is no Docker (run the command again and
answer `s`, or add `--yes`), GitHub is not responding (try again later) or the folder already holds something else
(use `--dir`). Running the command again doesn't break anything.

### The app doesn't finish starting

See what's going on with:

```bash
cd /opt/pizarro/deploy
docker compose ps
docker compose logs --tail 80 app
```

If the disk is almost full or memory is short, the app doesn't start or keeps restarting: free up space
(`docker system prune` removes old images) or upgrade the server.

If the log says `PostgreSQL aún no responde` ("PostgreSQL isn't answering yet"), the app is waiting for the database:
it retries every 3 seconds for 3 minutes and starts as soon as it answers. If after that time it says
`No se puede conectar con PostgreSQL` ("can't connect to PostgreSQL"), along with the server and the reason (no
answer, connection refused or no such name), check that the database container is running (`docker compose ps` and
`docker compose logs --tail 50 postgres`) or, on Railway, that the PostgreSQL service is active and the `DATABASE_URL`
variable. With the app already running, the same message appears if the database stops answering for 20 seconds.

If the log says `una migración de la base de datos falló a medias (P3009)` ("a database migration failed halfway"),
an update didn't finish preparing the database and the app won't start until it is resolved. The log itself explains
what to do, with the command ready to copy; the details are in the
[technical documentation](../../INSTALL.md#81-una-migración-falló-a-medias-p3009) (in Spanish).

### Emails don't arrive

Check *Administration → Integrations → Email notifications*, send a test email and look at *Administration → Logs*. With
Gmail, the password must be an app password, not the account's.

### Dates show the wrong time

Add your time zone to `/opt/pizarro/deploy/.env` ([how to edit it](#edit-env)), for example `APP_TIMEZONE="Europe/London"`, and apply the change with
`docker compose up -d`.

### No administrator can sign in {#locked-out}

If the password was forgotten or the two-step verification phone was lost, first try what needs no terminal:

- **With email set up,** click *Forgot your password?* on the sign-in screen.
- **If the phone was lost,** sign in with one of the recovery codes you saved when you turned on two-step
  verification.
- **If another administrator can sign in,** they go to *Administration → Users* and, next to that person, choose
  *Force password change* (it gives a one-time link) or *Reset two-step verification*.

If none of that works, generate a one-time link from the server:

```bash
cd /opt/pizarro/deploy
docker compose exec app node dist/reset-link.mjs person@example.com
```

Open the link it prints and choose a new password; it works once and expires after 30 minutes. If the phone was lost
too, add `--reset-2fa` at the end so they set up two-step verification again.

**On Railway** that command has to run inside Pizarro's service, and Railway's web dashboard has no terminal: you do it
from your computer with Railway's command-line program (its *CLI*). Install it with one line: `brew install railway` on
a Mac, or `npm install -g @railway/cli` on Windows and Linux (it needs [Node.js](https://nodejs.org)). Then, in your
computer's terminal:

```bash
railway login
railway link
railway ssh
```

`railway login` opens the browser to sign in to your account; `railway link` asks for the project and the service
(choose Pizarro's); `railway ssh` opens a terminal inside the service. There, type
`node dist/reset-link.mjs person@example.com` (with `--reset-2fa` if needed) and, when you're done, `exit`.

### If you need help

*Administration → Settings → Download diagnostics* gives you a technical summary with no personal data or keys. To
report a bug, use *Report a bug* in *Version history*. More cases in the
[technical documentation](../../INSTALL.md#8-resolución-de-problemas) (in Spanish).

## Uninstall {#uninstall}

> [!CAUTION]
> Before deleting anything, download what you want to keep: export your projects or save a backup and the recovery
> kit.

**Stop Pizarro** without deleting the data (start it again with `docker compose up -d`):

```bash
cd /opt/pizarro/deploy
docker compose down
```

**Delete everything,** including the database, the files and the backups kept on the server. It cannot be undone:

```bash
cd /opt/pizarro/deploy
docker compose down -v
cd /
rm -rf /opt/pizarro
```

Docker stays installed in case you use it for other things. If you are not `root`, put `sudo` before the `docker` and
`rm` commands.

**On Railway,** delete the project from its settings (*Settings → Danger*). The database and the volume are deleted
too.

## Technical documentation {#technical-docs}

This guide covers the usual. For advanced topics (installing by hand without the command, building the image, memory,
container hardening, every variable, backup destinations and restoring in detail) there is the
[technical installation documentation](../../INSTALL.md), and for using and running the app, the
[manual](../../MANUAL.md). Both are in Spanish.
