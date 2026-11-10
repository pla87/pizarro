---
titulo: Sign in with Google
descripcion: Let your team sign in to Pizarro with their Google account, with no extra password to remember.
orden: 1
icono: login
---

# Sign in with Google

With this connection, Pizarro's sign-in screen shows a **Sign in with Google** button. Anyone who already has a Pizarro account with that same email can use it: it does not open sign-up to anyone else. The Google client you create here also works for [Google Docs and Sheets](google-docs.md).

You need:

- To be a Pizarro administrator.
- Your Pizarro's public address, with `https://`: the server's `APP_URL` variable (for example, `https://pizarro.example.com`). Google does not accept `localhost` or an IP address.
- A Google account. Google Cloud is free for this: you don't need to turn on billing.

## 1. Decide on the address

Choose the address your people will use, because every value Google asks for comes from it: the server's address (for example, `https://something.up.railway.app`) or your own domain (`https://pizarro.example.com`, the recommended option). If you change it later, you will have to update Google.

In Pizarro, **Administration → Settings → Sign in with Google** shows "Pizarro's public address" at the top and warns you if you are using a different one. Below it there is a collapsible guide with this guide's addresses already worked out and a button to copy each one.

## 2. Create the project in Google Cloud

1. Go to <https://console.cloud.google.com/projectcreate> and create a project (for example, "Pizarro"), or pick one you already have.
2. Search for **Google Auth Platform** in the top bar and open it. The first time, click **Get started**.

## 3. Branding

- **App name:** "Pizarro".
- **User support email:** the email of whoever runs Pizarro.
- **App logo:** leave it empty if the app will be "External" and published; uploading a logo means Google has to verify the app.
- **Application home page:** your `APP_URL`.
- **Privacy policy link:** `APP_URL/privacy`. **Terms of service link:** `APP_URL/terms`. Both are public Pizarro pages.
- **Authorized domains:** the main domain, without `https://` or subdomains (`example.com`).
- **Developer contact information:** your email.

## 4. Audience: who can sign in

- **Internal:** only accounts in your Google Workspace organisation. Nothing needs to be published or verified.
- **External:** any Google account, including Gmail. While it is in **Testing**, only the **Test users** you add can sign in (up to 100). After **Publish app** (*In production*) anyone can, and Google does not ask for verification just to sign in.

## 5. Data Access: the scopes

Click **Add or remove scopes**, tick `openid`, `email` and `profile` (the basic ones) and save. If you are also going to create Docs and Sheets, add the Drive scope explained in [its guide](google-docs.md).

## 6. Create the OAuth client

1. In **Clients**, click **Create client**.
2. Type **Web application**; for the name, for example, "Pizarro".
3. Under **Authorized redirect URIs**, click **Add URI** and type your `APP_URL` followed by `/api/auth/google/callback`. It must be exact: with `https` and no trailing slash. For example:

   ```
   https://pizarro.example.com/api/auth/google/callback
   ```

   If you are going to use Docs and Sheets, add `APP_URL` + `/api/google/callback` to the same client as well.
4. Click **Create** and copy the **Client ID** and the **Client secret**. The full secret is only shown at that moment; if you lose it, create another one.

## 7. Paste it into Pizarro

In **Administration → Settings → Sign in with Google**, paste the ID and the secret and click **Save**. Within seconds the status changes to "Active", with no restart.

- **Allowed Workspace domain** (optional): if you fill it in (`example.com`), only accounts from that domain are accepted. Left empty, any Google account works.
- If you prefer to set it up on the server, use the `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and, optionally, `GOOGLE_WORKSPACE_DOMAIN` variables. They take precedence over what is saved in Settings.
- To allow signing in **only** with Google, set `AUTH_GOOGLE_ONLY=true`. With `AUTH_ALLOW_ADMIN_PASSWORD=true`, administrators keep their password as emergency access.

## 8. Try it

1. Sign out and click **Sign in with Google** on the sign-in screen.
2. Use an account whose email already exists in Pizarro (and, if the app is in **Testing**, that is listed under **Test users**).
3. Administrators then go through Pizarro's two-step verification; everyone else goes straight in.

## If something goes wrong

- **redirect_uri_mismatch:** the redirect address is not identical to the one in step 6. Check the `https`, the trailing slash and any spaces; after fixing it, it can take a few minutes.
- **access_blocked** or "app not verified": the app is in **Testing** and that account is not under **Test users**. Add it or publish the app.
- "There is no account with that Google email": Google worked, but that email does not exist in Pizarro. Create the user first in **Administration → Users**.
- "Use a Google account from the company domain": there is an allowed Workspace domain and the account belongs to another one.
