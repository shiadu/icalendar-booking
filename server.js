require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { formatInTimeZone, fromZonedTime, toZonedTime } = require('date-fns-tz');
const { addMinutes, addHours, isBefore, isEqual } = require('date-fns');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.BOOKING_TIMEZONE || 'America/New_York';
const BOOKING_DAY = Number(process.env.BOOKING_DAY || 2); // 0 Sun, 2 Tue
const START_HOUR = Number(process.env.BOOKING_START_HOUR || 14); // 2 PM
const END_HOUR = Number(process.env.BOOKING_END_HOUR || 18); // 6 PM

// New controls (more Calendly-like)
const MIN_NOTICE_HOURS = Number(process.env.MIN_NOTICE_HOURS || 2);
const BUFFER_MINUTES = Number(process.env.BUFFER_MINUTES || 0);
const MAX_MEETINGS_PER_DAY = Number(process.env.MAX_MEETINGS_PER_DAY || 12);

const BRAND_NAME = process.env.BRAND_NAME || 'iCalendar';
const HOST_NAME = process.env.HOST_NAME || 'Shia';

function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google OAuth env vars.');
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getAuth() });
}

function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID || 'primary';
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
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

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

function expandBusyWindowsForBuffer(busy) {
  if (!BUFFER_MINUTES) return busy;
  return busy.map(b => ({
    start: addMinutes(b.start, -BUFFER_MINUTES),
    end: addMinutes(b.end, BUFFER_MINUTES)
  }));
}

function applyMinNotice(slots) {
  const minStart = addHours(new Date(), MIN_NOTICE_HOURS);
  return slots.filter(s => !isBefore(s.start, minStart));
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

async function sendCustomConfirmationEmail({ name, email, startDate, endDate, eventLink, eventTypeLabel }) {
  const transporter = getMailer();
  if (!transporter) return { sent: false, reason: 'smtp_not_configured' };

  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || BRAND_NAME;

  const startLabel = formatInTimeZone(startDate, TZ, "EEEE, MMM d, yyyy 'at' h:mm a zzz");
  const endLabel = formatInTimeZone(endDate, TZ, 'h:mm a zzz');

  const subject = `Booking confirmed: ${eventTypeLabel || 'Meeting'} · ${startLabel}`;
  const text = `Hi ${name},\n\nYour booking is confirmed.\n\nMeeting: ${eventTypeLabel || 'Meeting'}\nWhen: ${startLabel} - ${endLabel}\nTimezone: ${TZ}\n\nGoogle Calendar event: ${eventLink || 'Attached via invite'}\n\nThanks,\n${fromName}`;

  const html = `
    <p>Hi ${name},</p>
    <p>Your booking is confirmed.</p>
    <p>
      <strong>Meeting:</strong> ${eventTypeLabel || 'Meeting'}<br/>
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

async function getMeetingCountForLocalDay(startDate) {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

  const localYMD = formatInTimeZone(startDate, TZ, 'yyyy-MM-dd');
  const dayStart = fromZonedTime(`${localYMD}T00:00:00`, TZ);
  const dayEnd = fromZonedTime(`${localYMD}T23:59:59`, TZ);

  const res = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    maxResults: 250,
    orderBy: 'startTime'
  });

  const events = res.data.items || [];
  return events.length;
}

app.get('/api/config', (_req, res) => {
  res.json({
    brandName: BRAND_NAME,
    hostName: HOST_NAME,
    timezone: TZ,
    bookingDay: BOOKING_DAY,
    startHour: START_HOUR,
    endHour: END_HOUR,
    minNoticeHours: MIN_NOTICE_HOURS,
    bufferMinutes: BUFFER_MINUTES,
    maxMeetingsPerDay: MAX_MEETINGS_PER_DAY,
    durations: [15, 20, 30, 45, 60],
    eventTypes: [
      { id: 'standard', label: 'Standard Session', duration: 30, description: 'Focused discussion with actionable next steps' },
      { id: 'intro', label: 'Intro Call', duration: 20, description: 'Quick intro + goals alignment' },
      { id: 'consult', label: 'Consulting Session', duration: 45, description: 'Deep dive into your product/UX challenge' },
      { id: 'strategy', label: 'Strategy Session', duration: 60, description: 'Roadmap and action planning' }
    ]
  });
});

app.get('/api/availability', async (req, res) => {
  try {
    const { date, duration } = req.query;
    const durationMin = Number(duration || 30);
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (![15, 20, 30, 45, 60].includes(durationMin)) {
      return res.status(400).json({ error: 'invalid duration' });
    }

    let slots = getDaySlots(date, durationMin);
    if (!slots.length) return res.json({ slots: [] });

    slots = applyMinNotice(slots);
    if (!slots.length) return res.json({ slots: [] });

    const busyRaw = await getBusyWindows(slots[0].start, slots[slots.length - 1].end);
    const busy = expandBusyWindowsForBuffer(busyRaw);

    const available = slots.filter(s => !busy.some(b => overlaps(s.start, s.end, b.start, b.end)));

    res.json({
      slots: available.map(s => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        hostLabel: formatInTimeZone(s.start, TZ, 'EEE, MMM d · h:mm a zzz')
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load availability' });
  }
});

app.post('/api/book', async (req, res) => {
  try {
    const { name, email, start, duration, eventTypeLabel } = req.body;
    const durationMin = Number(duration || 30);
    if (!name || !email || !start) {
      return res.status(400).json({ error: 'name, email, start are required' });
    }

    const startDate = new Date(start);
    const endDate = addMinutes(startDate, durationMin);

    // Min notice re-check
    const minStart = addHours(new Date(), MIN_NOTICE_HOURS);
    if (isBefore(startDate, minStart)) {
      return res.status(409).json({ error: `Bookings must be at least ${MIN_NOTICE_HOURS} hour(s) in advance.` });
    }

    // Daily cap check
    const meetingCount = await getMeetingCountForLocalDay(startDate);
    if (meetingCount >= MAX_MEETINGS_PER_DAY) {
      return res.status(409).json({ error: 'Daily booking limit reached. Please choose another day.' });
    }

    // Recheck availability before writing event
    const busyRaw = await getBusyWindows(startDate, endDate);
    const busy = expandBusyWindowsForBuffer(busyRaw);
    if (busy.some(b => overlaps(startDate, endDate, b.start, b.end))) {
      return res.status(409).json({ error: 'That slot was just booked. Pick another time.' });
    }

    const calendar = getCalendarClient();
    const calendarId = getCalendarId();

    const summary = `${eventTypeLabel || 'Meeting'} with ${name}`;

    const event = await calendar.events.insert({
      calendarId,
      sendUpdates: 'all',
      requestBody: {
        summary,
        description: `Booked via ${BRAND_NAME}\nHost: ${HOST_NAME}\nName: ${name}\nEmail: ${email}`,
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
        eventLink: event.data.htmlLink,
        eventTypeLabel
      });
    } catch (mailErr) {
      customEmail = { sent: false, reason: mailErr.message || 'mail_failed' };
    }

    res.json({
      ok: true,
      eventId: event.data.id,
      htmlLink: event.data.htmlLink,
      customEmail
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to book event' });
  }
});

app.listen(PORT, () => {
  console.log(`${BRAND_NAME} running on http://localhost:${PORT}`);
});
