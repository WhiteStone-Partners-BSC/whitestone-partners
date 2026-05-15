=== START ===
/**
 * /api/scan-notify.js
 *
 * Receives Supabase Database Webhook fired on INSERT to dealer_box_scans.
 * Looks up the dealer's name and prior scan count, then sends a formatted
 * email alert to support@whitestone-partners.com via Resend.
 *
 * REQUIRED ENVIRONMENT VARIABLES (set in Vercel):
 *   - RESEND_API_KEY            — Resend API key for sending mail
 *   - SUPABASE_WEBHOOK_SECRET   — shared secret between Supabase and this endpoint
 *   - SUPABASE_URL              — your Supabase project URL
 *   - SUPABASE_SERVICE_KEY      — service role key (bypasses RLS for the lookup query)
 */

const NOTIFY_TO_EMAIL = 'support@whitestone-partners.com';
const NOTIFY_FROM_EMAIL = 'notifications@whitestone-partners.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const incomingSecret = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  pectedSecret = process.env.SUPABASE_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error('SUPABASE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (incomingSecret !== expectedSecret) {
    console.warn('Unauthorized webhook attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (payload?.type !== 'INSERT' || payload?.table !== 'dealer_box_scans') {
    return res.status(200).json({ ok: true, skipped: 'not an insert on dealer_box_scans' });
  }

  const scan = payload.record;
  if (!scan?.slug || !scan?.dealer_id) {
    return res.status(200).json({ ok: true, skipped: 'missing required fields' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabaseHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  let dealer = null;
  try {
    const dealerRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dealers?id=eq.${encodeURIComponent(scan.dealer_id)}&select=id,slug,legal_business_name,dealership_name,dba,box_recipient_first_name,box_recipient_last_name,box_recipient_title,box_shipped_at`,
      { headers: supabaseHeaders }
    );
    const dealerRows = await dealerRes.json();
    dealer = Array.isArray(dealerRows) ? dealerRows[0] : null;
  } catch (e) {
    console.error('Dealer lookup failed:', e);
  }

  if (!dealer) {
    return res.status(200).json({ ok: true, skipped: 'dealer not found' });
  }

  let scanCount = 1;
  try {
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dealer_box_scans?dealer_id=eq.${encodeURIComponent(scan.dealer_id)}&select=id`,
      {
        headers: { ...supabaseHeaders, Prefer: 'count=exact' },
      }
    );
    const contentRange = countRes.headers.get('content-range') || '';
    const match = contentRange.match(/\/(\d+)$/);
    if (match) scanCount = parseInt(match[1], 10) || 1;
  } catch (e) {
    console.error('Scan count fetch failed:', e);
  }

  const dealershipName = dealer.dba || dealer.legal_business_name || dealer.dealership_name || dealer.slug;
  const recipientName = [dealer.box_recipient_first_name, dealer.box_recipient_last_name]
    .filter(Boolean)
    .join(' ') || '(no recipient name set)';
  const recipientTitle = dealer.box_recipient_title || '';
  const recipient = recipientTitle ? `${recipientName} (${recipientTitle})` : recipientName;

  const scannedAt = scan.scanned_at ? new Date(scan.scanned_at) : new Date();
  const scannedAtFormatted = scannedAt.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const ua = scan.user_agent || '';
  const deviceLabel = formatUserAgent(ua);

  const isFirstScan = scanCount === 1;
  const scanCountLabel = isFirstScan
    ? '1st scan (FIRST TIME)'
    : `${ordinal(scanCount)} scan`;

  const landingUrl = `https://whitestone-partners.com/dealer/${dealer.slug}`;

  let subject;
  if (isFirstScan) {
    subject = `🔥 ${dealershipName} just scanned their Whitestone box`;
  } else if (scanCount >= 3) {
    subject = `🔥🔥 ${dealershipName} scanned again (${ordinal(scanCount)} time) — HOT lead`;
  } else {
    subject = `🔄 ${dealershipName} scanned their box again (${ordinal(scanCount)})`;
  }

  const html = renderEmailHtml({
    dealershipName, recipient, scannedAtFormatted, scanCountLabel,
    isFirstScan, deviceLabel, referrer: scan.referrer || '—',
    landingUrl, slug: dealer.slug,
  });

  const text = renderEmailText(shipName, recipient, scannedAtFormatted, scanCountLabel,
    isFirstScan, deviceLabel, referrer: scan.referrer || '—',
    landingUrl, slug: dealer.slug,
  });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Whitestone Scan Alerts <${NOTIFY_FROM_EMAIL}>`,
        to: [NOTIFY_TO_EMAIL],
        subject, html, text,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend send failed:', resendRes.status, errBody);
      return res.status(500).json({ error: 'Failed to send notification', detail: errBody });
    }
  } catch (e) {
    console.eor('Resend request failed:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }

  return res.status(200).json({
    ok: true,
    dealer: dealer.slug,
    scan_count: scanCount,
    notified: NOTIFY_TO_EMAIL,
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatUserAgent(ua) {
  if (!ua) return 'Unknown device';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua) && /Mobile/.test(ua)) return 'Android phone';
  if (/Android/.test(ua)) return 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac (desktop)';
  if (/Windows/.test(ua)) return 'Windows (desktop)';
  return 'Other / unknown';
}

function renderEmailHtml(d) {
  const urgencyColor = d.isFirstScan ? '#b8963e' : '#4a6278';
  const urgencyLabel = d.isFirstScan ? '🔥 FIRST SCAN' : '🔄 REPEAT SCAN';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">le>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fb;margin:0;padding:32px 16px;color:#0c1e2e;}
.wrap{max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4eaf0;}
.head{background:#0c1e2e;color:#ffffff;padding:28px 32px;}
.head .label{font-size:11px;font-weight:600;letter-spacing:0.25em;color:${urgencyColor};text-transform:uppercase;margin-bottom:8px;}
.head h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;font-weight:300;margin:0;line-height:1.3;}
.body{padding:32px;}
.row{display:table;width:100%;padding:12px 0;border-bottom:1px solid #f0f4f8;}
.row:last-child{border-bottom:none;}
.row .k{display:table-cell;width:130px;font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#6b8599;vertical-align:top;padding-top:2px;}
.row .v{display:table-cell;font-size:14px;color:#0c1e2e;vertical-align:top;line-height:1.6;}
.row .v.highlight{color:#b8963e;font-weight:600;}
.cta{padding:0 32px 32px;}
.btn{display:inline-block;padding:14px 24px;background:#0c1e2e;color:#ffffff !important;text-decoration:none;font-size:12px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;}
.foot{padding:20px 32px;background:#f8f9fb;font-size:11px;color:#6b8599;text-align:center;letter-spacing:0.05em;}
</style></head><body>
<div class="wrap">
<div class="head"><div class="label">${urgencyLabel}</div><h1>${escapeHtml(d.dealershipName)} scanned their Whitestone box</h1></div>
<div class="body">
<div class="row"><div class="k">Dealership</div><div class="v"><strong>${escapeHtml(d.dealershipName)}</strong></div></div>
<div class="row"><div class="k">Recipient</div><div class="v">${escapeHtml(d.recipient)}</div></div>
<div class="row"><div class="k">Scanned</div><div class="v">${escapeHtml(d.scannedAtFormatted)}</div></div>
<div class="row"><div class="k">Scan Count</div><div class="v ${d.isFirstScan ? 'highlight' : ''}">${escapeHtml(d.scanCountLabel)}</div></div>
<div class="row"><div class="k">Device</div><div class="v">${escapeHtml(d.deviceLabel)}</div></div>
<div class="row"><div class="k">Referrer</div><div class="v">${escapeHtml(d.referrer)}</div></div>
</div>
<div class="cta"><a href="${escapeHtml(d.landingUrl)}" class="btn">View Landing Page</a></div>
<div class="foot">Whitestone Box Campaign · Auto-notification · slug: ${escapeHtml(d.slug)}</div>
</div></body></html>`;
}

function renderEmailText(d) {
  return `${d.isFirstScan ? '🔥 FIRST SCAN' : '🔄 REPEAT SCAN'}

${d.dealershipName} scanned their Whitestone box

Dealership:    ${d.dealershipName}
Recipient:     ${d.recipient}
Scanned:       ${d.scannedAtFormatted}
Scan Count:    ${d.scanCountLabel}
Device:        ${d.deviceLabel}
Referrer:      ${d.referrer}

View landing page: ${d.landingUrl}

—
Whitestone Box Campaign · Auto-notification
Slug: ${d.slug}`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .reg, '&#039;');
}
=== END ===

