# Coast Nation — online ticketing

A complete event-ticketing website: public listing, checkout with online payment, instant QR tickets,
and a hidden admin control room. Plain HTML/CSS/JS — no build step, no npm. All data lives in Supabase.

---

## Files

```
index.html          public homepage — every published event
event.html          one event: details + ticket picker + checkout
ticket.html         order confirmation / QR ticket wallet ("find my ticket")
admin.html          the control room (PIN protected)
assets/css/style.css
assets/video/       hero.mp4 / hero.webm / hero-poster.jpg — the homepage banner
assets/js/config.js Supabase URL + public key. Edit only if you move projects.
assets/js/common.js shared helpers (formatting, footer, the secret door)
assets/js/public.js homepage logic
assets/js/event.js  event page + Paystack / Flutterwave checkout
assets/js/ticket.js ticket wallet + QR rendering
assets/js/charts.js hand-built SVG charts for the analytics tab
assets/js/admin.js  the whole admin app
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

## How the money works

Right now **no payment key is set**, so a customer who checks out gets a purchase saved as *pending*
and a "Pay via WhatsApp" button. You confirm payment yourself in Admin → Purchases → **Mark paid**,
which issues their QR tickets.

To take payment automatically:

1. Open a [Paystack](https://paystack.com) account (card + M-Pesa in Kenya) — or Flutterwave.
2. Copy your **public key** (`pk_live_…` or `FLWPUBK-…`). **Never paste a secret key here** — this
   code runs in the customer's browser.
3. Admin → Settings → Payments → paste it → Save.

From then on: customer pays in the popup → tickets are issued instantly.

**One honest caveat.** Because the whole site is static, the "payment succeeded" message comes from
the customer's browser. Purchases paid that way show a small **unverified** badge in your Purchases table.
For real money this should be checked server-side against the gateway. When you're ready, the next
step is a Supabase Edge Function holding your *secret* key that verifies each transaction and flips
`payment_verified` to true — ask me and I'll add it. Until then, cross-check large orders against
your Paystack dashboard.

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
4. Customers buy → they get a QR ticket page they can screenshot or print.
5. **Gate check-in** — open Admin → Gate check-in on your phone, scan the QR with the camera (or type
   the code). It says ✅ let them in, or ⚠️ already scanned. Every scan is recorded.
6. **Purchases** — see every buyer, mark manual payments as paid, cancel a purchase, export CSV,
   and delete purchases (one at a time, or in bulk from the red panel at the bottom).
7. **Analytics** — revenue and tickets per day, revenue by event, tickets by type, where checkouts
   ended up, and what time of day people buy. Switch between the last 7 / 30 / 90 days. Every chart
   has a "Show the numbers" link if you'd rather read the raw figures.

**Cancel vs delete.** *Cancel* voids the tickets but keeps the record and the money history —
use it when someone shouldn't get in. *Delete* removes the purchase, its tickets and its QR codes
for good, and puts paid tickets back on sale. Deleting is not undoable, so export the CSV first.

Your **profile picture** lives in Admin → Settings. Upload a square logo and it replaces the "CN"
badge in the header and footer across the whole site.

---

## Supabase

- Project: **coast-nation** — `https://ygfmcllmwtkfmcpgovbl.supabase.co`
- Tables: `events`, `ticket_types`, `orders`, `order_items`, `tickets`, `settings`, `admin_attempts`
- Storage bucket: `event-images` (public, 5MB max per image)

Security model: the public can only *read* published events and their active ticket types. Orders and
tickets are invisible to the public — every admin action goes through a database function that checks
the PIN server-side, so the key sitting in `config.js` on its own opens nothing sensitive.

A sample event ("Sundowner Sessions Vol. 4") is already loaded so the site isn't empty. Delete it from
Admin → Events whenever you like.

---

## Ideas for later

- Server-side payment verification (Edge Function) — the important one
- Emailing the ticket automatically after purchase (Resend / SendGrid)
- M-Pesa STK push directly via Safaricom Daraja
- Multiple organisers with their own logins and their own dashboards
- Discount codes, tiered pricing, group tickets
