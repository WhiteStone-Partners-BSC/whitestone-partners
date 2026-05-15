/**
 * /api/send-followup.js
 *
 * Daily cron job that sends a follow-up email to dealers who scanned their
 * Whitestone box approximately 24 hours ago.
 */

const FROM_EMAIL = 'support@whitestone-partners.com';
const FROM_LABEL = 'Whitestone Partners';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const expectedToken = 'Bearer ' + (process.env.CRON_SECRET || '');
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (authHeader !== expectedToken) {
    console.warn('Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
    console.error('Missing required env vars');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabaseHeaders = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  const now = new Date();
  const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString();

  let eligibleDealers = [];
  try {
    const dealersRes = await fetch(
      SUPABASE_URL + '/rest/v1/dealers?' +
        'select=id,slug,dealership_name,legal_business_name,dba,box_recipient_first_name,box_recipient_email,followup_email_sent_at&' +
        'box_recipient_email=not.is.null&' +
        'followup_email_sent_at=is.null&' +
        'slug=not.is.null',
      { headers: supabaseHeaders }
    );
    const dealers = await dealersRes.json();

    if (!Array.isArray(dealers)) {
      console.error('Unexpected dealers response:', dealers);
      return res.status(500).json({ error: 'Failed to fetch dealers' });
    }

    for (const dealer of dealers) {
      const firstScanRes = await fetch(
        SUPABASE_URL + '/rest/v1/dealer_box_scans?' +
          'dealer_id=eq.' + encodeURIComponent(dealer.id) + '&' +
          'select=scanned_at&' +
          'order=scanned_at.asc&' +
          'limit=1',
        { headers: supabaseHeaders }
      );
      const scans = await firstScanRes.json();

      if (Array.isArray(scans) && scans.length > 0) {
        const firstScanAt = scans[0].scanned_at;
        if (firstScanAt >= windowStart && firstScanAt <= windowEnd) {
          eligibleDealers.push({ dealer: dealer, firstScanAt: firstScanAt });
        }
      }
    }
  } catch (e) {
    console.error('Dealer lookup failed:', e);
    return res.status(500).json({ error: 'Dealer lookup failed' });
  }

  if (eligibleDealers.length === 0) {
    return res.status(200).json({
      ok: true,
      message: 'No eligible dealers in the 22-48h scan window',
      window_start: windowStart,
      window_end: windowEnd,
    });
  }

  const results = [];

  for (const entry of eligibleDealers) {
    const dealer = entry.dealer;
    const firstName = dealer.box_recipient_first_name || 'there';
    const dealershipName = dealer.dba || dealer.legal_business_name || dealer.dealership_name || 'your dealership';
    const toEmail = dealer.box_recipient_email;

    const subject = 'Hope the box landed well, ' + firstName;
    const html = renderEmailHtml({ firstName: firstName, dealershipName: dealershipName });
    const text = renderEmailText({ firstName: firstName, dealershipName: dealershipName });

    let sendResult = { dealer_id: dealer.id, slug: dealer.slug, sent: false };

    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_LABEL + ' <' + FROM_EMAIL + '>',
          to: [toEmail],
          reply_to: FROM_EMAIL,
          subject: subject,
          html: html,
          text: text,
        }),
      });

      if (!resendRes.ok) {
        const errBody = await resendRes.text();
        console.error('Resend send failed for ' + dealer.slug + ':', resendRes.status, errBody);
        sendResult.error = 'Resend rejected: ' + resendRes.status;
        results.push(sendResult);
        continue;
      }
    } catch (e) {
      console.error('Resend request failed for ' + dealer.slug + ':', e);
      sendResult.error = 'Resend request threw';
      results.push(sendResult);
      continue;
    }

    try {
      const updateRes = await fetch(
        SUPABASE_URL + '/rest/v1/dealers?id=eq.' + encodeURIComponent(dealer.id),
        {
          method: 'PATCH',
          headers: Object.assign({}, supabaseHeaders, { Prefer: 'return=minimal' }),
          body: JSON.stringify({ followup_email_sent_at: new Date().toISOString() }),
        }
      );

      if (!updateRes.ok) {
        const errBody = await updateRes.text();
        console.error('Failed to mark ' + dealer.slug + ' as emailed:', updateRes.status, errBody);
        sendResult.warning = 'Email sent but failed to mark in DB';
      } else {
        sendResult.sent = true;
      }
    } catch (e) {
      console.error('DB update failed for ' + dealer.slug + ':', e);
      sendResult.warning = 'Email sent but DB update threw';
    }

    results.push(sendResult);
  }

  const summary = {
    ok: true,
    window_start: windowStart,
    window_end: windowEnd,
    eligible_count: eligibleDealers.length,
    sent_count: results.filter(function(r) { return r.sent; }).length,
    error_count: results.filter(function(r) { return r.error; }).length,
    results: results,
  };

  console.log('Follow-up cron completed:', JSON.stringify(summary));
  return res.status(200).json(summary);
};

function renderEmailHtml(d) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8f9fb;margin:0;padding:32px 16px;color:#0c1e2e;}' +
    '.wrap{max-width:560px;margin:0 auto;background:#ffffff;padding:48px 40px;border:1px solid #e4eaf0;}' +
    '.greeting{font-family:Cormorant Garamond,Georgia,serif;font-size:22px;font-weight:300;color:#0c1e2e;margin-bottom:24px;line-height:1.4;}' +
    'p{font-size:15px;line-height:1.7;color:#0c1e2e;margin-bottom:18px;}' +
    '.divider{width:40px;height:1px;background:#b8963e;margin:32px 0;}' +
    '.sig{font-family:Cormorant Garamond,Georgia,serif;font-size:18px;font-weight:300;color:#0c1e2e;margin-bottom:4px;}' +
    '.sig-title{font-size:11px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:#b8963e;margin-bottom:16px;}' +
    '.contact{font-size:13px;color:#4a6278;line-height:1.6;}' +
    '.contact a{color:#b8963e;text-decoration:none;}' +
    '</style></head><body><div class="wrap">' +
    '<div class="greeting">Hi ' + escapeHtml(d.firstName) + ',</div>' +
    '<p>We hope the box gave you a different perspective on what we&rsquo;re building &mdash; and that the sunglasses don&rsquo;t sit on the shelf 😎</p>' +
    '<p>We&rsquo;d love a few minutes to chat about what a partnership with <strong>' + escapeHtml(d.dealershipName) + '</strong> could look like.</p>' +
    '<p>What&rsquo;s a good time to give you a call?</p>' +
    '<div class="divider"></div>' +
    '<div class="sig">Whitestone Partners</div>' +
    '<div class="sig-title">A clearer view of dealership growth</div>' +
    '<div class="contact">' +
  '<a href="tel:+13855054256">385-505-4256</a><br>' +
    '<a href="mailto:support@whitestone-partners.com">support@whitestone-partners.com</a>' +
    '</div>' +
    '</div></body></html>';
}

function renderEmailText(d) {
  return 'Hi ' + d.firstName + ',\n\n' +
    'We hope the box gave you a different perspective on what we\'re building -- and that the sunglasses don\'t sit on the shelf :)\n\n' +
    'We\'d love a few minutes to chat about what a partnership with ' + d.dealershipName + ' could look like.\n\n' +
    'What\'s a good time to give you a call?\n\n' +
    '--\n' +
    'Whitestone Partners\n' +
    'A clearer view of dealership growth\n' +
    '385-505-4256\n' +
    'support@whitestone-partners.com';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
