---
titulo: Google Docs and Sheets
descripcion: Create a document or a spreadsheet from a task and keep it linked to it.
orden: 2
icono: google
---

# Google Docs and Sheets

With this connection, any task can create a Google Doc or a Google Sheet: it is created in the Drive of whoever asks for it, named after the card, opens in a new tab and stays linked to the task. It uses the same Google client as [Sign in with Google](google-login.md); if you already have it, start at step 1 and skip step 3.

You need to be a Pizarro administrator, your Pizarro's public address with `https://` (the `APP_URL` variable) and a Google account.

## 1. Enable the Google Drive API

1. Go to <https://console.cloud.google.com> and pick Pizarro's project (or create one, as in step 2 of [the other guide](google-login.md)).
2. Open **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.

It is the only API you need: Docs and Sheets are created through Drive, so there is no need to enable the Docs or Sheets APIs.

## 2. Add the Drive scope

In **Google Auth Platform → Data Access**, click **Add or remove scopes**, add this scope and save:

```
https://www.googleapis.com/auth/drive.file
```

It only gives access to the files Pizarro creates or opens, not to the rest of each person's Drive.

- With an **Internal** app (your Google Workspace only), there is nothing else to do.
- With an **External** app in **Testing**, only **Test users** can connect and the Drive permission expires after 7 days: each person will have to connect again. Once published (*In production*), Google may ask for verification because of this scope.

## 3. Create the OAuth client (if you don't have it yet)

Follow steps 2 to 6 of [Sign in with Google](google-login.md). Under **Authorized redirect URIs**, the address for Docs and Sheets is your `APP_URL` followed by `/api/google/callback`, exactly (with `https` and no trailing slash):

```
https://pizarro.example.com/api/google/callback
```

If you also use Sign in with Google, put both addresses in the same client. Then paste the **Client ID** and the **Client secret** in **Administration → Settings → Sign in with Google** (or in the server's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` variables).

## 4. Decide who the files are shared with

- **Allowed Workspace domain** (in Settings, or the `GOOGLE_WORKSPACE_DOMAIN` variable): with it, every file from a team project is shared with the whole domain, so anyone can open it from the card. Without a domain, only its creator can see it until they share it.
- Each project can choose in **Project settings → General → Google documents**: the whole domain can edit, the whole domain can read, only the people in the project, or do not share. A private project is never shared with the domain.

## 5. Each person connects their account

Once per person: **My profile → Account → Google Docs and Sheets → Connect with Google**, and accept the Drive permission.

## 6. Try it

1. Open a task and click **New Doc** or **New Sheet** (under **Google documents**), or type `@docs` or `@sheets` in the description or in a comment.
2. The file opens in a new tab and stays under **Google documents** on the card.
3. Removing the link from the card does not delete the file from Drive.

## If something goes wrong

- "Google denied creating the file (check that the Drive API is enabled)": step 1 is missing.
- "Google Drive permission was not granted": the Drive box was not ticked when connecting. Connect again and accept it.
- "Document created, but not shared: only you can see it": there was nobody to share it with (no domain, or the project is set to "Do not share") or your Workspace policy prevented it. Share it from Google like any other file.
- **redirect_uri_mismatch** when connecting: the `/api/google/callback` address is missing from the client, or it is not identical.
