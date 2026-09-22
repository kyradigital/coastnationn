# Coast Nation — online ticketing

A complete event-ticketing website: public listing, verified checkout with online payment,
QR tickets emailed to the buyer, a gate-check page, and a hidden admin dashboard.
Plain HTML/CSS/JS — no build step, no npm. All data lives in Supabase.

---

## Files

```
index.html          public homepage — every published event
event.html          one event: details + ticket picker + verified checkout
ticket.html         order confirmation / QR ticket wallet ("find my ticket")
verify.html         what a scanned QR opens — is this ticket good?
admin.html          the admin dashboard (PIN protected)
assets/css/style.css
assets/video/       hero.mp4 / hero.webm / hero-poster.jpg — the homepage banner
assets/js/config.js Supabase URL + public key. Edit only if you move projects.
assets/js/common.js shared helpers (formatting, footer, the secret door)
assets/js/public.js homepage logic
assets/js/event.js  event page + OTP verification + Paystack / Flutterwave checkout
assets/js/ticket.js ticket wallet + QR rendering
assets/js/verify.js the ticket-check page
assets/js/charts.js hand-built SVG charts for the analytics tab
assets/js/admin.js  the whole admin app
assets/js/vendor/   Supabase, the QR encoder and the camera scanner, self-hosted.
                    Nothing loads from a CDN, so nothing breaks when a CDN does.
```

Open `index.html` in a browser and it just works. To put it online, drag this folder onto
[netlify.com/drop](https://app.netlify.com/drop) or connect it to Vercel / GitHub Pages / any host.

---

## Getting into the admin

There is **no login link anywhere on the site**. At the bottom of every page the underlined line
`© 2026 All rights reserved · Coast Nation` is the door: **click it 3 times within 2.5 seconds** and
you land on the PIN screen.

**Your PIN: `0113236161`**

Change it any time in Admin → Settings → Access PIN. After 8 wrong attempts the door locks for
15 minutes.

You can also just open `admin.html` directly — the secret click is convenience, the PIN is the lock.

---

## How a ticket gets made

This is the part worth understanding, because none of it happens in the browser.

```
buyer picks tickets
   → types name + email
   → server emails a 6-digit code        (request_otp)
   → buyer types the code back           (verify_otp → one-time token)
   → order created, tickets NOT issued   (create_order)
   → buyer pays with Paystack
   → PAYSTACK calls our webhook          (Edge Function: paystack-webhook)
   → webhook checks the signature, then re-asks Paystack "was this really paid?"
   → only now: order marked paid, tickets created, QR generated, email sent
```

The browser never creates a ticket. If someone fakes a "payment succeeded" message in their
browser console, the order simply stays pending and nothing is issued. Codes are stored
bcrypt-hashed — not even the database holds the plaintext — and each verification token works
once, for the one email address that was verified.

Every QR contains a link to `verify.html?t=…` carrying a 48-character random token. It holds **no**
name, email, phone or order reference. Open it and you see valid / already used / cancelled.
Marking a ticket used asks for your PIN, so a punter scanning their own QR cannot burn it.

---

## What you must set up before selling

Everything below lives in **Admin → Settings**, except the two marked *Supabase* / *Paystack*.

| What | Where | Why |
|---|---|---|
| `resend_api_key` | Settings → Email & ticket delivery | sends the OTP and the ticket |
| `mail_from_email` | Settings → Email & ticket delivery | must be on a domain verified at Resend |
| `mail_from_name` | Settings → Email & ticket delivery | what the buyer sees as the sender |
| `site_url` | Settings → Email & ticket delivery | your live address — the QR links point at it |
| `paystack_public_key` | Settings → Payments | opens the payment popup |
| `paystack_secret_key` | Settings → Payment confirmation | the webhook's password. **Without it the webhook refuses everything and no ticket is ever issued.** |
| `PAYSTACK_SECRET_KEY` | *Supabase* → Edge Functions → Secrets | the same key, for the signature check |
| Webhook URL | *Paystack* dashboard → Settings → API Keys & Webhooks | `https://ygfmcllmwtkfmcpgovbl.supabase.co/functions/v1/paystack-webhook` |

Until the Resend key is in, the code can't be emailed, so nobody can check out. Until the Paystack
secret is in, payments go through but tickets are never created. Both are deliberate: the system
fails closed rather than handing out tickets it isn't sure about.

You can turn verification off entirely with the **Require email verification** switch in Settings
if you ever need to (a door sale, say). It is on by default.

---

## Day-to-day flow

1. **Create event** — name, poster (square image), date, venue, description, organiser contacts.
2. **Add tickets** — Early Bird / Regular / VIP, each with its own price and quantity.
   Quantity `0` = unlimited. Price `0` = free ticket. Each ticket has an **Available / Unavailable**
   switch — flip it off and that ticket disappears from the public page instantly (nothing is deleted,
   and the sales figures stay). The event card on the homepage always shows the ticket that is
   currently on sale, e.g. *Current ticket — Early Bird · KES 1,000*; turn Early Bird off and the card
   moves on to Regular.
3. **Publish** — the event appears on the homepage immediately.
4. Customers verify, pay, and get their QR ticket by email and on screen.
5. **Gate check-in** — two ways. Scan the QR with any phone camera and it opens `verify.html`
   (enter the PIN to let them in), or open Admin → Gate check-in and scan from there.
6. **Purchases** — search by name, email, phone or reference; see whether the ticket was delivered;
   **Resend** the ticket email; **Cancel a ticket** so it stops working at the gate; export CSV;
   delete purchases (one at a time, or in bulk from the red panel at the bottom).
7. **Analytics** — revenue and tickets per day, revenue by event, tickets by type, where checkouts
   ended up, and what time of day people buy. Switch between the last 7 / 30 / 90 days. Every chart
   has a "Show the numbers" link if you'd rather read the raw figures.

**Cancel vs delete.** *Cancel* voids the tickets but keeps the record and the money history —
use it when someone shouldn't get in. *Delete* removes the purchase, its tickets and its QR codes
for good, and puts paid tickets back on sale. Deleting is not undoable, so export the CSV first.

Your **profile picture** lives in Admin → Settings. Upload a square logo and it replaces the "CN"
badge in the header and footer across the whole site.

---

## Sale alerts on your phone

Admin → Settings → Sale alerts sends a Telegram message the moment a sale clears. If Telegram is
slow or unreachable the message goes into a queue and is retried for two days rather than being
lost. Admin → Settings shows the queue's health.

---

## Supabase

- Project: **coast-nation** — `https://ygfmcllmwtkfmcpgovbl.supabase.co`
- Tables: `events`, `ticket_types`, `orders`, `order_items`, `tickets`, `settings`,
  `otp_codes`, `verified_contacts`, `alert_outbox`, `admin_attempts`
- Storage bucket: `event-images` (public, 5MB max per image)
- Edge Function: `paystack-webhook`

Security model: the public can only *read* published events and their active ticket types.
Orders, tickets, OTP codes and private settings are invisible — every admin action goes through a
database function that checks the PIN server-side. The key sitting in `config.js` opens nothing
sensitive on its own. Exactly six functions are reachable without the PIN (`request_otp`,
`verify_otp`, `create_order`, `confirm_order_payment`, `get_order`, `verify_ticket`), and none of
them can issue a ticket.

---

## Ideas for later

- A PDF ticket attached to the email (today the email carries the QR and links to the ticket page)
- WhatsApp delivery as well as email (Twilio or the Meta Cloud API)
- M-Pesa STK push directly via Safaricom Daraja
- Multiple organisers with their own logins and their own dashboards
- Discount codes, tiered pricing, group tickets
