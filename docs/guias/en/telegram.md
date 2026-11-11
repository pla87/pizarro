# Telegram notices

Pizarro can send notices (mentions, assignments, comments…) through Telegram. It's **free** and takes about five
minutes to set up: an administrator creates a bot and pastes its token into Pizarro, then each person connects their
Telegram from their profile.

You need:

- An administrator account in Pizarro.
- The Telegram app (on your phone or computer).

## Step 1. Create the bot with @BotFather

1. In Telegram, search for **@BotFather** (it has the blue verified tick) and open the chat.
2. Type `/newbot`.
3. Type the **name** people will see, for example `Pizarro notices`.
4. Type the bot's **username**. It must end in `bot`, for example `pizarro_notices_bot`. If it's taken, try another one.
5. BotFather replies with a **token** that looks like `123456789:AAH…`. Copy it. It's the bot's key: don't share it.

Optional: `/setdescription` and `/setuserpic` in BotFather let you give the bot a description and a picture.

## Step 2. Paste the token into Pizarro

1. In Pizarro, go to **Administration → Settings → 3. Telegram and WhatsApp notices**.
2. Under **Telegram (free)**, paste the token into **Bot token**.
3. Press **Save and turn on**.

Pizarro checks the token with Telegram, stores it encrypted and never shows it again (only its last 4 characters). You'll
see “On: bot @…”.

## Step 3. Test the bot

1. In **Administration → Settings**, press **Test**. Pizarro checks that the bot answers.
2. If you've also connected your own Telegram (step 4), you get a “Pizarro test message”.

## Step 4. Each person connects their Telegram

Each person does this once:

1. In **My profile → Notices → Notices on your phone**, press **Connect Telegram**.
2. Press **Open Telegram** (or scan the QR code with your phone if you're on a computer).
3. In Telegram, press **Start**. The bot replies “Done…” and Pizarro shows “Connected”.
4. Choose which notices you want on Telegram and press **Save**. By default only **mentions** and **assignments** arrive.

The link works only once and expires after 10 minutes. To stop getting notices: **Disconnect** in My profile, type
`/stop` to the bot or block it in Telegram.

## How Pizarro receives the bot's messages

Pizarro picks the method by itself, based on the installation's public address (the `APP_URL` variable):

- **With a public https `APP_URL`** (for example `https://pizarro.yourcompany.com`): Telegram notifies Pizarro instantly
  at `APP_URL/api/telegram/webhook`. Each call carries a secret that only Telegram and Pizarro know.
- **Without public https** (an installation at home or on the office network, `http://…`, an IP address or a port other
  than 443, 80, 88 or 8443): Pizarro asks Telegram every few seconds. No ports need opening and no domain is needed. The
  only difference is that connecting Telegram may take a couple of seconds longer.

Notices are sent the same way in both cases. If you change `APP_URL`, Pizarro registers the webhook again when it starts.

## Turning it off or changing bots

- **Turn off**: stops sending Telegram notices; the bot and the connections are kept for when you turn it back on.
- **Remove the bot**: deletes the token and disconnects everyone.
- **Change bots** (paste another bot's token with **Replace**): everyone has to connect their Telegram again, because
  the new bot can't write to people who haven't opened it.

## Common problems

- **“Telegram doesn't accept this token”**: copy the whole token from BotFather, without spaces. If you regenerated it
  with `/revoke`, the old one no longer works.
- **I connect Telegram but Pizarro keeps waiting**: make sure you pressed **Start** in the bot's chat. If the link
  expired, press **Connect Telegram** again.
- **“Telegram replied with an error” in Settings**: with the webhook, the https address usually isn't reachable from the
  Internet or the certificate isn't valid. Check `APP_URL` and the certificate.
- **Someone stopped getting them**: if they blocked the bot or deleted the chat, Pizarro disconnects them automatically.
  They just press **Connect Telegram** again.
- Each person gets at most 30 Telegram messages per hour; the rest of that hour's notices stay in Pizarro's bell.
  Failures are recorded in **Administration → Logs** (without tokens).
