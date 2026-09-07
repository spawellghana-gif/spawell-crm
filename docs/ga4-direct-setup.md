# Direct Google Analytics connection

The CRM imports website traffic directly from Google's Analytics Data API.
The GA4 property is **314693631** (`spawellghana.com - GA4`).

## Configure access

1. In the business's Google Cloud project, enable the **Google Analytics Data API**.
2. Create a service account such as `spawell-crm-ga4`. It does not need Google
   Cloud project roles to read Analytics reports.
3. In GA4, select property **314693631**, open **Admin → Property access
   management**, and add the service account's email with the **Viewer** role.
4. Create a JSON key for that service account. Keep the key out of this
   repository and chat messages.
5. In Vercel project **spawell-crm**, set these variables for **Production**:

   | Variable | Value |
   | --- | --- |
   | `GA4_PROPERTY_ID` | `314693631` |
   | `GA4_SA_CLIENT_EMAIL` | The JSON key's `client_email` |
   | `GA4_SA_PRIVATE_KEY` | The JSON key's `private_key`, stored as a sensitive variable |

   The private key accepts actual line breaks or literal `\n` sequences. Do
   not add surrounding quotation marks in Vercel's value field.

6. Redeploy production so the new credentials become available to the app.
7. As owner, open **Marketing → Sync GA4**. Confirm a successful Google response
   and the updated traffic import time. A property with no traffic returns an
   explicit empty-result message.

The import requests only the `analytics.readonly` OAuth scope. It runs when
the owner clicks **Sync GA4**; this setup does not create a scheduled import.
Ad spend can be entered separately in **Record spend**, in GHS.

`GA4_MEASUREMENT_ID` and `GA4_API_SECRET` are for the separate optional feature
that sends bookings to Google. They are not needed for reading website traffic.

References: [Google Analytics API setup](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart),
[service account keys](https://cloud.google.com/iam/docs/creating-managing-service-account-keys),
[Vercel environment variables](https://vercel.com/docs/environment-variables).
