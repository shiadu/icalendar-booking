require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { formatInTimeZone, fromZonedTime, toZonedTime } = require('date-fns-tz');
const { addMinutes, isBefore, isEqual } = require('date-fns');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.BOOKING_TIMEZONE || 'America/New_York';
const BOOKING_DAY = Number(process.env.BOOKING_DAY || 2); // 0 Sun, 2 Tue
const START_HOUR = Number(process.env.BOOKING_START_HOUR || 14); // 2 PM
const END_HOUR = Number(process.env.BOOKING_END_HOUR || 18); // 6 PM

function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google OAuth env vars.');
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getDaySlots(dateStr, durationMin) {
  // dateStr = YYYY-MM-DD interpreted in TZ
  const baseLocal = `${dateStr}T00:00:00`;
  const dayStart = fromZonedTime(`${dateStr}T${String(START_HOUR).padStart(2, '0')}:00:00`, TZ);
  const dayEnd = fromZonedTime(`${dateStr}T${String(END_HOUR).padStart(2, '0')}:00:00`, TZ);

  const dayCheck = toZonedTime(fromZonedTime(baseLocal, TZ), TZ);
  if (dayCheck.getDay() !== BOOKING_DAY) return [];

  const slots = [];
  let cur = dayStart;
  while (isBefore(addMinutes(cur, durationMin), dayEnd) || isEqual(addMinutes(cur, durationMin), dayEnd)) {
    slots.push({ start: new Date(cur), end: addMinutes(cur, durationMin) });
    cur = addMinutes(cur, durationMin);
  }
  return slots;
}

async function getBusyWindows(timeMin, timeMax) {
  const calendar = google.calendar({ version: 'v3', auth: getAuth() });
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }]
    }
  });

  return (res.data.calendars?.[calendarId]?.busy || []).map(b => ({
    start: new Date(b.start),
    end: new Date(b.end)
  }));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function getMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

async function sendCustomConfirmationEmail({ name, email, startDate, endDate, eventLink }) {
  const transporter = getMailer();
  if (!transporter) return { sent: false, reason: 'smtp_not_configured' };

  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || 'iCalendar';

  const startLabel = formatInTimeZone(startDate, TZ, "EEEE, MMM d, yyyy 'at' h:mm a zzz");
  const endLabel = formatInTimeZone(endDate, TZ, 'h:mm a zzz');

  const subject = `Booking confirmed: ${startLabel}`;
  const text = `Hi ${name},\n\nYour booking is confirmed.\n\nWhen: ${startLabel} - ${endLabel}\nTimezone: ${TZ}\n\nGoogle Calendar event: ${eventLink || 'Attached via invite'}\n\nThanks,\n${fromName}`;

  const html = `
    <p>Hi ${name},</p>
    <p>Your booking is confirmed.</p>
    <p>
      <strong>When:</strong> ${startLabel} - ${endLabel}<br/>
      <strong>Timezone:</strong> ${TZ}
    </p>
    <p><a href="${eventLink || '#'}">Open Google Calendar event</a></p>
    <p>Thanks,<br/>${fromName}</p>
  `;

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject,
    text,
    html
  });

  return { sent: true };
}

app.get('/api/availability', async (req, res) => {
  try {
    const { date, duration } = req.query;
    const durationMin = Number(duration || 30);
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (![15, 20, 30, 45, 60].includes(durationMin)) {
      return res.status(400).json({ error: 'invalid duration' });
    }

    const slots = getDaySlots(date, durationMin);
    if (!slots.length) return res.json({ slots: [] });

    const busy = await getBusyWindows(slots[0].start, slots[slots.length - 1].end);
    const available = slots.filter(s => !busy.some(b => overlaps(s.start, s.end, b.start, b.end)));

    res.json({
      slots: available.map(s => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        label: `${formatInTimeZone(s.start, TZ, 'EEE, MMM d · h:mm a')} ET`
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load availability' });
  }
});

app.post('/api/book', async (req, res) => {
  try {
    const { name, email, start, duration } = req.body;
    const durationMin = Number(duration || 30);
    if (!name || !email || !start) return res.status(400).json({ error: 'name, email, start are required' });

    const startDate = new Date(start);
    const endDate = addMinutes(startDate, durationMin);

    // Recheck availability before writing event
    const busy = await getBusyWindows(startDate, endDate);
    if (busy.length) return res.status(409).json({ error: 'That slot was just booked. Pick another time.' });

    const calendar = google.calendar({ version: 'v3', auth: getAuth() });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const event = await calendar.events.insert({
      calendarId,
      sendUpdates: 'all',
      requestBody: {
        summary: `Meeting with ${name}`,
        description: `Booked via iCalendar\nName: ${name}\nEmail: ${email}`,
        start: { dateTime: startDate.toISOString(), timeZone: TZ },
        end: { dateTime: endDate.toISOString(), timeZone: TZ },
        attendees: [{ email }]
      }
    });

    let customEmail = { sent: false, reason: 'not_attempted' };
    try {
      customEmail = await sendCustomConfirmationEmail({
        name,
        email,
        startDate,
        endDate,
        eventLink: event.data.htmlLink
      });
    } catch (mailErr) {
      customEmail = { sent: false, reason: mailErr.message || 'mail_failed' };
    }

    res.json({ ok: true, eventId: event.data.id, htmlLink: event.data.htmlLink, customEmail });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to book event' });
  }
});

app.listen(PORT, () => {
  console.log(`iCalendar running on http://localhost:${PORT}`);
});
