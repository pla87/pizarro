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

- **A Linux server** with an x86_64 or arm64 processor: a VPS from any provider, a mini PC in the office or a
  Raspberry Pi 5.
- **1 GB of RAM**, 1 processor and about 10 GB of disk, plus whatever your attachments take up.
- **Terminal access** (SSH) as `root` or with a user who can use `sudo`.
- **Docker.** If you don't have it, the installer offers to install it for you.
- **A domain or subdomain** (for example `pizarro.example.com`) pointing to the server's IP address, with ports 80
  and 443 open. If you will only use it at home or in the office, it also works on the local network, with no domain.

**Or, with no server of your own:** an account on [Railway](https://railway.com), a cloud service that charges for what
you use, and a GitHub account.

## Choose your path {#choose-your-path}

| | Your own server | Railway |
|---|---|---|
| **Best if** | You have a VPS or a Linux machine | You don't want to look after a server |
| **How** | One command in the terminal | A few clicks in Railway's dashboard |
| **Time** | A few minutes | About 15 minutes |
| **HTTPS** | Automatic | Automatic |
| **Cost** | Your server's | Whatever Railway charges each month |

Both paths end the same way: in the wizard that creates your administrator account. Carry on with
[Your own server](#own-server) or jump to [Railway](#railway).

## Install on your server with one command {#own-server}

1. **Point your domain at the server.** In your domain provider's dashboard, create a DNS record of type `A` for
   `pizarro.example.com` with the server's IP address (and an `AAAA` one if it has IPv6). Also check that the firewall
   lets ports 80 and 443 through. If you will only use Pizarro on the local network, skip this step.

2. **Log in to the server** from your computer's terminal:

   ```bash
   ssh root@203.0.113.10
   ```

   Replace `203.0.113.10` with your server's IP address (or `root` with your user).

3. **Run the installer.** Copy this command, replace `pizarro.example.com` with your domain and paste it into the
   terminal:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
   ```

   To use it only on the local network, with no domain, change the end to `--local`:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --local
   ```

4. **Answer if it asks.** If the server has no Docker, the installer asks whether to install it with Docker's official
   script: type `s` (for *sí*, yes) and press Enter. If you didn't give it the domain, it asks how you will reach
   Pizarro.

5. **Wait a few minutes.** The installer downloads Pizarro, creates the configuration with secure keys, starts
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
> installation's keys. Without them, the backups cannot be opened. Copy it to a password manager or another computer;
> for example, to see it and copy its contents:
>
> ```bash
> cat /opt/pizarro/deploy/recovery-kit.txt
> ```

**What has been installed:** the code in `/opt/pizarro` and three Docker containers that start with the server: Caddy
(which provides HTTPS), Pizarro and its PostgreSQL database. Your data lives in Docker volumes, separate from the code,
and updates don't touch it.

> [!TIP]
> **Would you rather read the script before running it?** Download it, review it and run it afterwards:
>
> ```bash
> curl -fsSLO https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh
> less get.sh
> sh get.sh --domain pizarro.example.com
> ```

**Other installer options** (added at the end of the command):

- `--version 1.49.0` installs that version instead of the latest one.
- `--dir /srv/pizarro` uses another folder (by default, `/opt/pizarro`).
- `--yes` installs Docker without asking, if it is missing.
- `--build` builds Pizarro on the server instead of downloading it ready-made (needs 2 GB of RAM).
- `--help` shows every option.

## First steps {#first-steps}

1. **Open the wizard** in your browser: the address the installer gave you, ending in `/setup` (for example,
   `https://pizarro.example.com/setup`).
2. **Type the one-time code.** It checks that you are the person installing the server.
3. **Your organisation:** enter its name and choose the installation's language and time zone.
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

## Install on Railway, with no server of your own {#railway}

[Railway](https://railway.com) runs Pizarro and its database from the GitHub repository, with HTTPS. It is all done
from its web dashboard, with no terminal.

1. **Create the project and the database.** In Railway, click *New Project* and choose *Deploy PostgreSQL*. Railway
   creates a service called `Postgres`.
2. **Add Pizarro.** In the same project, click *+ New → GitHub Repo* and choose `pla87/pizarro` (or your copy). Railway
   starts deploying straight away; it will fail until you add the variables in step 5: that's normal.
3. **Choose the `stable` branch.** In Pizarro's service, *Settings → Source → Branch*: choose `stable`. That branch only
   moves when a version is published, so Railway only updates with finished versions, never with half-done changes.
4. **Give it an address and a volume.**
   - *Settings → Networking → Generate Domain* gives you an address such as
     `https://pizarro-production.up.railway.app`. Copy it.
   - Right-click the service → *Attach Volume*, with *Mount path* `/app/uploads`. Files and backups are kept there;
     without a volume they would be lost on every deploy.
5. **Add the variables.** In Pizarro's service, *Variables → Raw Editor*, paste this and change the values:

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=paste-a-key-here
   TOKEN_SECRET=paste-another-key-here
   ENCRYPTION_KEY=paste-another-key-here
   BACKUP_KEY=paste-the-backup-key-here
   APP_URL=https://pizarro-production.up.railway.app
   UPLOAD_DIR=/app/uploads
   ```

   - `APP_URL` is the address from step 4, with `https://` and no trailing slash.
   - Each key must be different and random. You can generate them in the terminal of a Mac or Linux computer (on
     Windows, in Git Bash): run this command three times, for `SESSION_SECRET`, `TOKEN_SECRET` and `ENCRYPTION_KEY`:

     ```bash
     openssl rand -base64 48
     ```

     And this one for `BACKUP_KEY`:

     ```bash
     openssl rand -base64 32
     ```

6. **Deploy.** Click *Deploy*. The first start prepares the database and takes a couple of minutes.
7. **Find the wizard's code.** In *Deployments → View logs*, look for the line that says `introduce el código:`
   ("enter the code"). Open your address ending in `/setup` and follow the [first steps](#first-steps) from step 2.

> [!IMPORTANT]
> Keep `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` and `BACKUP_KEY` **outside Railway** as well, in a password
> manager. Without `BACKUP_KEY` the backups cannot be opened, and without `ENCRYPTION_KEY` everyone would have to set up
> their two-step verification again.

> [!NOTE]
> Create the variables in Pizarro's service, not as the project's *Shared Variables*: those don't reach the service on
> their own. And don't add the `SEED_ADMIN_*` variables: without them, the first administrator is created with the
> wizard.

## Optional settings {#settings}

All of this is turned on from the app itself, in *Administration → Settings*, without touching the server. None of it
is required: Pizarro works without it.

### Email {#email}

With email, Pizarro sends invitations, notifications, digests and the "Forgot your password?" link. Set it up in
*Administration → Settings → Email notifications* in one of two ways:

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
   just for it, and add its details at the end of `/opt/pizarro/deploy/.env`:

   ```env
   BACKUP_S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-backups"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   ```

   Apply the change with `docker compose up -d` (in `/opt/pizarro/deploy`) and click *Copy to external destination now*
   in *Administration → Backups*. Everything uploaded is encrypted: the provider cannot read it.

The mounted folder, the S3 region and the other details are in the
[technical documentation](../../INSTALL.md#4-copias-de-seguridad) (in Spanish).

### Restore on a new server {#restore}

If you lose the server, you need the recovery kit and your external destination:

1. **Prepare the new server without starting Pizarro:** the install command with `--no-start` at the end.

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com --no-start
   ```

2. **Put in your keys.** In `/opt/pizarro/deploy/.env`, replace `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` and
   `BACKUP_KEY` with the ones in the kit and add your external destination's `BACKUP_S3_*` variables.
3. **Restore and start:**

   ```bash
   cd /opt/pizarro/deploy
   docker compose pull app
   docker compose up -d postgres
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
   docker compose up -d
   ```

To pick a specific backup, go back to an earlier backup on the same server or restore on Railway, see the
[technical documentation](../../INSTALL.md#6-restaurar) (in Spanish).

## Update {#update}

Before updating, make a backup: *Administration → Backups → Create backup now*.

**On your server,** run the install command again, without `--domain`:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh
```

It downloads the latest published version, starts it and keeps your configuration, the recovery kit and your data. Any
changes the database needs are applied automatically. If the update is interrupted halfway, the previous installation
stays intact.

**On Railway** you don't need to do anything: if the service follows the `stable` branch, it updates itself every time
a version is published.

**Going back to an earlier version** (or installing a specific one): add `--version` with its number.

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --version 1.49.0
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
2. In `/opt/pizarro/deploy/.env`, change `DOMAIN` and `APP_URL`:

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
3. When the domain shows as active, change `APP_URL` to the new address and deploy again.

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

If the log says `No se puede conectar con PostgreSQL` ("can't connect to PostgreSQL"), the app can't reach the
database: it says so after trying for 10 seconds, along with the server and the reason (no answer, connection refused
or no such name). Check that the database container is running (`docker compose ps`) or, on Railway, the
`DATABASE_URL` variable.

### Emails don't arrive

Check *Administration → Settings → Email notifications*, send a test email and look at *Administration → Logs*. With
Gmail, the password must be an app password, not the account's.

### Dates show the wrong time

Add your time zone to `/opt/pizarro/deploy/.env`, for example `APP_TIMEZONE="Europe/London"`, and apply the change with
`docker compose up -d`.

### No administrator can sign in

If the password was forgotten or the two-step verification phone was lost, generate a one-time link from the server:

```bash
cd /opt/pizarro/deploy
docker compose exec app node dist/reset-link.mjs person@example.com
```

Open the link it prints and choose a new password; it works once and expires after 30 minutes. If the phone was lost
too, add `--reset-2fa` at the end so they set up two-step verification again. On Railway, the same command
(`node dist/reset-link.mjs …`) runs in the service's terminal (`railway ssh`).

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
