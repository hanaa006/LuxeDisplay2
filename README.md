# Luxe Display – booking website

Online booking for Luxe Display: customers hire cake stands, food trays and drink
dispensers for their events, choose a **pick-up date** and a **drop-off date**, and the
owner manages every order from an **admin dashboard**.

## Features

**For customers** (`/`)
- Browse the collection (cake stands, food trays, drink dispensers…)
- Add one or more items to a booking
- Pick a pick-up date and a drop-off date on a calendar; dates that are already
  booked are striped out and cannot be selected
- Enter contact details and event info, then get a booking reference (e.g. `LD-3F9A2C`)

**No double bookings**
- Once an item is booked for a date range, nobody else can book that item on any of
  those days (pick-up day, drop-off day and every day in between).
- The server checks availability and saves the booking in one locked database
  transaction, so two people pressing "Book" at the same moment can't both get the
  same date. The tests cover this case.
- Each item has a **stock** number (default 1). If you own 3 identical dispensers, set
  stock to 3 and up to 3 customers can book it on the same day.
- Cancelling an order frees its dates again.

**For you, the owner** (`/admin`)
- Password-protected dashboard
- See every order: customer, phone, email, items, pick-up and drop-off dates, total
- Search by name, email, phone or reference; filter by status or upcoming/past
- Update status: Pending → Confirmed → Picked up → Returned (or Cancelled)
- Add private notes (deposit paid, collection time…)
- Add or edit items, prices, stock, photos (image URL), and hide items from the site

## Running it locally

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm start
```

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin (development password: `luxe-admin`)

Run the tests with `npm test`.

## Configuration

Copy `.env.example` and set these as environment variables on your host:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Admin dashboard password (**required** when `NODE_ENV=production`) |
| `SESSION_SECRET` | Long random string used to sign admin logins |
| `CURRENCY` | Price currency, e.g. `GBP`, `EUR`, `USD` (default `GBP`) |
| `TZ` | Your timezone, e.g. `Europe/London`, so "today" is correct |
| `DB_FILE` | Where the SQLite database is stored (default `data/luxe-display.db`) |
| `PORT` | Port to listen on (default `3000`) |

## Putting it online

The app is a single Node.js server with a SQLite database file, so it runs on any host
that supports Node and a **persistent disk** (Render, Railway, Fly.io, a small VPS…).

1. Create a new Node web service from this repository.
2. Build command: `npm install` · Start command: `npm start`
3. Set `NODE_ENV=production`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CURRENCY`, `TZ`.
4. Attach a persistent disk and point `DB_FILE` at it (e.g. `/var/data/luxe-display.db`)
   so bookings survive restarts and redeploys.
5. Back up that database file regularly.

## Project structure

```
server.js            Starts the server
src/app.js           Routes (public booking API + admin API)
src/bookings.js      Booking rules: availability, double-booking prevention
src/auth.js          Admin login (signed, HTTP-only cookie)
src/db.js            SQLite schema and starter items
public/index.html    Customer website
public/admin.html    Admin dashboard
public/js, css       Front-end scripts and styles
test/                Automated tests
```
