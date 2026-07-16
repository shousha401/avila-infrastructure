// api/contact.js — Vercel Serverless Function (Node.js)
//
// Handles Avila contact-form submissions:
//   1) emails the lead to the business (reply-to = the customer)
//   2) sends an auto-reply to the customer
//   3) optionally texts Jonathan (Twilio, or a free carrier email-to-SMS gateway)
//
// Configure in Vercel → Project → Settings → Environment Variables:
//   RESEND_API_KEY   (required)  Resend API key — https://resend.com
//   MAIL_FROM        (required)  Verified sender, e.g. "Avila Website <leads@avilainfrastructure.com>"
//   LEAD_TO          (required)  Where new leads are emailed (e.g. jonathan@avilainfrastructure.com)
//   SMS_TO           (optional)  Free carrier email-to-SMS gateway, e.g. "5593494392@vtext.com"
//   TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM / TWILIO_TO  (optional) reliable paid SMS; used if all set

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

async function sendEmail(opts) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + opts.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      reply_to: opts.replyTo
    })
  });
  if (!res.ok) {
    throw new Error('Resend ' + res.status + ': ' + (await res.text()));
  }
  return res.json();
}

async function sendTwilioSms(opts) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + opts.sid + '/Messages.json';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(opts.sid + ':' + opts.token).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: opts.from, To: opts.to, Body: opts.body }).toString()
  });
  if (!res.ok) throw new Error('Twilio ' + res.status);
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').trim();
  const email = String(b.email || '').trim();
  const type = String(b.type || '').trim();
  const message = String(b.message || '').trim();
  const gotcha = String(b._gotcha || '').trim();

  // Honeypot — pretend success and drop bots
  if (gotcha) return res.status(200).json({ ok: true });

  if (!name || !phone || !email || !type || !message) {
    return res.status(400).json({ error: 'Please fill in every field.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const leadTo = process.env.LEAD_TO;
  if (!apiKey || !from || !leadTo) {
    return res.status(500).json({ error: 'Email is not configured on the server yet.' });
  }

  // LEAD_TO may be a single address or a comma-separated list (e.g. Jonathan + oversight inbox)
  const leadRecipients = leadTo.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

  try {
    // 1) Lead notification to the business (reply-to = customer, so Jonathan just hits Reply)
    await sendEmail({
      apiKey: apiKey, from: from, to: leadRecipients, replyTo: email,
      subject: 'New estimate request from ' + name + ' — Avila website',
      html:
        '<h2 style="font-family:Arial,sans-serif;color:#C10D17">New Estimate Request</h2>' +
        '<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">' +
        '<tr><td style="padding:4px 14px 4px 0"><b>Name</b></td><td>' + escapeHtml(name) + '</td></tr>' +
        '<tr><td style="padding:4px 14px 4px 0"><b>Phone</b></td><td><a href="tel:' + escapeHtml(phone) + '">' + escapeHtml(phone) + '</a></td></tr>' +
        '<tr><td style="padding:4px 14px 4px 0"><b>Email</b></td><td><a href="mailto:' + escapeHtml(email) + '">' + escapeHtml(email) + '</a></td></tr>' +
        '<tr><td style="padding:4px 14px 4px 0"><b>Service</b></td><td>' + escapeHtml(type) + '</td></tr>' +
        '<tr><td style="padding:4px 14px 4px 0;vertical-align:top"><b>Message</b></td><td>' + escapeHtml(message).replace(/\n/g, '<br>') + '</td></tr>' +
        '</table>' +
        '<p style="font-family:Arial,sans-serif;color:#666;font-size:13px">Reply to this email to respond directly to ' + escapeHtml(name) + '.</p>',
      text: 'New estimate request\n\nName: ' + name + '\nPhone: ' + phone + '\nEmail: ' + email + '\nService: ' + type + '\n\nMessage:\n' + message
    });

    // 2) Auto-reply to the customer
    await sendEmail({
      apiKey: apiKey, from: from, to: email, replyTo: leadTo,
      subject: 'We received your request — Avila Infrastructure & Contracting',
      html:
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#17181B;max-width:520px;line-height:1.6">' +
        '<p>Hi ' + escapeHtml(name) + ',</p>' +
        '<p>Thanks for reaching out to <b>Avila Infrastructure &amp; Contracting</b>. We’ve received your request for <b>' + escapeHtml(type) + '</b>, and Jonathan will get back to you within 24 hours.</p>' +
        '<p>Need us sooner? Call <a href="tel:5593494392" style="color:#C10D17;font-weight:bold">(559) 349-4392</a>.</p>' +
        '<p style="margin-top:24px">— Avila Infrastructure &amp; Contracting<br>' +
        '<span style="color:#666">Licensed &middot; Insured &middot; Bonded &middot; Lemoore, CA</span></p>' +
        '</div>',
      text: 'Hi ' + name + ',\n\nThanks for reaching out to Avila Infrastructure & Contracting. We received your request for ' + type + ', and Jonathan will get back to you within 24 hours.\n\nNeed us sooner? Call (559) 349-4392.\n\n— Avila Infrastructure & Contracting\nLicensed - Insured - Bonded - Lemoore, CA'
    });

    // 3) SMS alert to Jonathan — best-effort; never fail the whole request if SMS fails
    const smsBody = 'New Avila lead: ' + name + ' (' + phone + ') — ' + type + '. Reply within 24h.';
    try {
      const t = process.env;
      if (t.TWILIO_SID && t.TWILIO_TOKEN && t.TWILIO_FROM && t.TWILIO_TO) {
        await sendTwilioSms({ sid: t.TWILIO_SID, token: t.TWILIO_TOKEN, from: t.TWILIO_FROM, to: t.TWILIO_TO, body: smsBody });
      } else if (t.SMS_TO) {
        await sendEmail({ apiKey: apiKey, from: from, to: t.SMS_TO, subject: 'New lead', text: smsBody });
      }
    } catch (smsErr) {
      console.error('SMS failed (non-fatal):', smsErr.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact handler error:', err.message);
    return res.status(500).json({ error: 'Could not send your request. Please call (559) 349-4392.' });
  }
};
