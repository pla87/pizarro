---
titulo: Notifications on WhatsApp
descripcion: Notifications on WhatsApp through Meta's official API. Meta charges per message.
orden: 4
icono: message
---

# WhatsApp notices

Pizarro can send notices (mentions, assignments, comments…) through WhatsApp using Meta's official **WhatsApp Cloud
API**. Unlike Telegram, **it's paid**: Meta charges for every notice it delivers. Setting it up takes from half an hour
to a day (Meta has to approve the message template).

If you want something free and quicker to set up, use [Telegram](telegram.md).

You need:

- An administrator account in Pizarro.
- A Facebook account to sign in to Meta for Developers and Meta Business.
- A phone number to send from (Meta's test number is fine to start with).
- A card to pay for the messages (only with your own number).

## How much it costs

- Meta charges **for each delivered template message**. Pizarro's notices are in the **Utility** category.
- A utility message costs roughly **1 to 3 euro cents** in Spain; it varies by country and Meta changes its rates from
  time to time. Check the official table:
  [WhatsApp Business pricing](https://developers.facebook.com/docs/whatsapp/pricing).
- Example: a team of 10 people getting 5 notices each per working day is about 1,100 messages a month, that is, between
  10 and 35 € a month.
- To avoid surprises, Pizarro sends at most **10 WhatsApp messages per person per hour** (the rest stay in Pizarro's
  bell) and, by default, each person only gets **mentions and assignments**.
- Messages with the verification code and test messages from My profile are charged too: at most **5 a day per person**
  and **3 a day per destination number** (whoever asks for them).
- A notice that fails is not repeated if Meta may have sent it (5xx error, dropped connection or timeout): only
  rejections for sending too much (429) and connection failures before sending are retried. That way nothing is
  charged twice.

## Step 1. Create a Meta Business account

1. Go to [business.facebook.com](https://business.facebook.com) with your Facebook account.
2. Create a **business portfolio** (your organisation's name and a contact email). If you already have one, use it.

## Step 2. Create the app in Meta for Developers

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My apps → Create app**.
2. Choose the use case **Connect with customers through WhatsApp** (or the **Business** type) and link it to your
   business portfolio.
3. In the app, add the **WhatsApp** product.

## Step 3. Choose the sending number

In the app: **WhatsApp → API Setup**.

- Meta gives you a free **test number**. It can only write to 5 numbers that you verify in the **To** field. That's
  enough to try it or for a small team.
- To use it for real, press **Add phone number** and add a number of your own that is **not** in use in the WhatsApp app
  (it can be a landline). Meta asks for a display name and verifies the number by SMS or call. Also add a payment method
  in **WhatsApp Manager → Payment settings**.
- Copy the **Phone number ID**, a long number. You'll paste it into Pizarro.

## Step 4. Create a permanent token with a system user

The temporary token shown in “API Setup” expires after 24 hours. Pizarro needs a permanent one:

1. Go to [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System users** → **Add**.
   Give it a name (for example `pizarro`) and the **Admin** role.
2. With the user selected, press **Assign assets**: add your **app** and your **WhatsApp account** with full control.
3. Press **Generate new token**, choose your app, expiry **Never** and tick the `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions.
4. Copy the token (it starts with `EAA…`). It isn't shown again.

## Step 5. Create the message template

Outside a conversation started by the person, WhatsApp only lets you send **approved templates**. Pizarro uses a single
one for every notice.

1. Go to [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) → **Message templates → Create
   template**.
2. Category: **Utility**. Type: **Default** (custom).
3. Name: `aviso_pizarro` (exactly like that).
4. Language: **Spanish** (`es`) if your team uses Pizarro in Spanish, and/or **English** (`en`).
5. In **Body**, paste this exact text (with its line breaks). Spanish:

```text
Aviso de Pizarro: {{1}} (proyecto {{2}}).

Ábrelo aquí: {{3}}

Puedes cambiar estos avisos en Mi perfil de Pizarro.
```

English:

```text
Pizarro notice: {{1}} (project {{2}}).

Open it here: {{3}}

You can change these notices in your Pizarro profile.
```

6. Meta asks for a **sample** of each variable. Use:
   - `{{1}}`: `Ana assigned «Review budget» to you` (the notice sentence with the task).
   - `{{2}}`: `Web` (the project name).
   - `{{3}}`: `https://pizarro.example.com/p/abc?task=123` (the link to the task; use your Pizarro's address).
7. No header, no footer and no buttons. Press **Submit** and wait until the status is **Approved** (usually minutes,
   sometimes up to a day).

Pizarro fills in the variables in each person's language; the rest of the text is the template's.

## Step 6. Set it up in Pizarro

1. In Pizarro, go to **Administration → Settings → 3. Telegram and WhatsApp notices → WhatsApp**.
2. Fill in:
   - **Access token**: the permanent token from step 4.
   - **Phone number ID**: the one from step 3.
   - **Template name**: `aviso_pizarro` (the default if you leave it empty).
   - **Language**: the main template language, `es` or `en` (or the exact code it was approved with, for example
     `es_ES` or `en_US`).
   - **English language** (optional): `en` if the template has both languages; it's used for people who have Pizarro in
     English.
3. Press **Save** and then **Enable**.

The token is stored encrypted and never shown again (only its last 4 characters).

## Step 7. Test sending

1. In the same section, type a number in international format (for example `+34600111222`) and press **Test**. With
   Meta's test number, it must be one of the 5 verified numbers.
2. A WhatsApp with “Pizarro test message…” arrives. If it fails, Pizarro shows the error Meta returned.

## Step 8. Each person connects their WhatsApp

1. **My profile → Notices → Notices on your phone → WhatsApp**: type your number in international format (`+34…`).
2. Tick the **consent** box (you agree to receive Pizarro notices on WhatsApp at that number).
3. Press **Save and send code**. A WhatsApp from Pizarro arrives with “Your Pizarro verification code is 123456”.
4. Type those **6 digits** in My profile and press **Confirm**. From then on you get notices on WhatsApp.
5. Choose which notices you want on WhatsApp and press **Save**. By default, mentions and assignments.

The code goes in the same `aviso_pizarro` template (in the `{{1}}` variable): no separate template is needed. It expires
after **15 minutes** and allows **5 attempts**; if it expires or they run out, press **Send another code** (the previous
one stops working). Without the code nobody gets notices: that way nobody can enter someone else's number and send them
paid notices. People can disconnect at any time.

If the number was already saved from an earlier version with WhatsApp turned off, it shows up in the form: to turn
notices on, tick the consent box and confirm it with the code (or press **Delete the number**).

## Environment variables (earlier installations)

Installations that already set up WhatsApp with server variables keep working without changes: `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` and `WHATSAPP_API_VERSION` (default
`v23.0`).

Precedence: **what you save in Administration → Settings wins, field by field**; empty fields use those variables. Until
you press Enable or Turn off, WhatsApp is on if the settings are complete.

Before, the template could only be set with `WHATSAPP_TEMPLATE_NAME` and had **four variables** (who mentions, the task,
the project and the link), whatever its name. That is why, **as long as the template comes from that variable**,
Pizarro uses that old format and only sends **mentions** (Settings says so). The same goes for the `mencion_pizarro`
template, wherever it comes from. To send every kind of notice, create `aviso_pizarro` (step 5, three variables), type
its name in **Template name** in Administration → Settings and save: what is saved there wins over the variable. If
your template with another name already has the three variables of `aviso_pizarro`, just type its name in Settings.

## Common problems

- **Error 132001 (template doesn't exist)**: the name or language don't match the approved template. Check **Template
  name** and **Language** (`es` isn't the same as `es_ES`).
- **Error 132000 (number of parameters)**: the template doesn't have exactly the variables `{{1}}`, `{{2}}` and `{{3}}`.
- **Error 131030 (recipient not allowed)**: with the test number, add the number in the **To** field of “API Setup”.
- **Error 190 or 401 (token)**: the token expired or lacks permissions. Generate a permanent one (step 4).
- **Error 131026 (couldn't be delivered)**: that number has no WhatsApp or doesn't accept business messages.
- **The code doesn't arrive**: check the number (international format) and, with Meta's test number, that it is one of
  the 5 verified numbers. After 3 sends to the same number (or 5 from one person) you have to wait until the next day.
- **Nothing arrives**: check that the person confirmed their number with the code in My profile and that the notice is
  ticked for WhatsApp. Failures are recorded in **Administration → Logs** (with the phone masked and without the token).
