# iCalendar (free Calendly-like app)

A lightweight booking tool with:
- Public booking page
- Duration options: 15/20/30/45/60
- Availability: Tuesday, 2 PM–6 PM ET
- Google Calendar sync to prevent double-booking
- Automatic confirmation emails (Google invite + optional custom branded email)

## 1) Setup

```bash
cd icalendar-app
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
- Time zone is fixed to `America/New_York`.
- Only Tuesdays are bookable by default.
- To change availability, edit `.env`.
