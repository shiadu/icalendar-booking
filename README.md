# iCalendar (free Calendly-like app)

A lightweight booking tool with:
- Clean, modern booking UX with event types (Calendly-inspired)
- Duration options: 15/20/30/45/60
- Availability: Tuesday, 2 PM–6 PM ET (configurable)
- Google Calendar sync to prevent double-booking
- Min notice, buffer, and max meetings/day controls
- Automatic confirmation emails (Google invite + optional custom branded email)

## 1) Setup

```bash
cd "/Users/shiadu/.openclaw/workspaceopenclaw configur/Startup/Apps/iCalendar"
npm install
cp .env.example .env
```

Fill `.env` with Google OAuth values.

Optional: add SMTP values to send a custom confirmation email (in addition to Google Calendar invite emails).

## 2) Google Calendar OAuth (one-time)

1. In Google Cloud Console, create OAuth Client credentials.
2. Add redirect URI (example): `https://developers.google.com/oauthplayground`
3. Get a refresh token for Calendar scope:
   - Scope: `https://www.googleapis.com/auth/calendar`
4. Put these in `.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `GOOGLE_REFRESH_TOKEN`
   - `GOOGLE_CALENDAR_ID` (`primary` is fine)

## 3) Run

```bash
npm run dev
```

Open: `http://localhost:3000`

## 4) Deploy for free

### Option A: Render (easy)
- Create new Web Service from this folder/repo
- Build command: `npm install`
- Start command: `npm start`
- Add env vars from `.env`

### Option B: Railway/Fly.io
- Same env vars + start command

## Notes
- Time zone defaults to `America/New_York`.
- Only Tuesdays are bookable by default.
- To change availability/rules, edit `.env`:
  - `MIN_NOTICE_HOURS`
  - `BUFFER_MINUTES`
  - `MAX_MEETINGS_PER_DAY`
  - `BOOKING_DAY`, `BOOKING_START_HOUR`, `BOOKING_END_HOUR`
  - `BRAND_NAME`, `HOST_NAME`
