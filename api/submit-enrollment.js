/**
 * /api/submit-enrollment.js
 *
 * Receives "Become an Exclusive Whitestone Dealer" form submissions.
 * Writes to dealer_enrollments + sends formatted notification email.
 * This is the PRIMARY conversion event of the box campaign.
 */

const NOTIFY_TO_EMAIL = 'support@whitestone-partners.com';
const NOTIFY_FROM_EMAIL = 'notifications@whitestone-partners.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const name = (payload && payload.name || '').trim();
  const email = (payload && payload.email || '').trim();
  const phone = (payload && payload.phone || '').trim();
  const dealership = (payload && payload.dealership || '').trim();
  const message = (payload && payload.message || '').trim();
  const slug = (payload && payload.slug || '').trim();

  if (!name || !email || !phone || !dealership) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
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

  let dealer = null;
  if (slug) {
    try {
      const dealerRes = await fetch(
        SUPABASE_URL + '/rest/v1/dealers?slug=eq.' + encodeURIComponent(slug) +
          '&select=id,slug,legal_business_name,dealership_name,dba,box_recipient_first_name,box_recipient_last_name,box_recipient_title',
        { headers: supabaseHeaders }
      );
      const rows = await dealerRes.json();
      dealer = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (e) {
      console.error('Dealer lookup failed:', e);
    }
  }

  let submissionId = null;
  try {
    const insertRes = await fetch(SUPABASE_URL + '/rest/v1/dealer_enrollments', {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        dealer_id: dealer ? dealer.id : null,
        slug: slug || null,
        submitter_name: name,
        submitter_email: email,
        submitter_phone: phone,
        dealership_name: dealership,
        message: message || null,
      }),
    });

    if (!insertRes.ok) {
      const errBody = await insertRes.text();
      console.error('Supabase insert failed:', insertRes.status, errBody);
      return res.status(500).json({ error: 'Failed to save submission' });
    }
    const inserted = await insertRes.json();
    submissionId = Array.isArray(inserted) && inserted.length > 0 ? inserted[0].id : null;
  } catch (e) {
    console.error('Supabase insert threw:', e);
    return res.status(500).json({ error: 'Failed to save submission' });
  }

  const recipientName = dealer
    ? [dealer.box_recipient_first_name, dealer.box_recipient_last_name].filter(function(p) { return !!p; }).join(' ')
    : '';
  const recipientTitle = dealer ? (dealer.box_recipient_title || '') : '';
  const recipientLabel = recipientName
    ? (recipientTitle ? recipientName + ' (' + recipientTitle + ')' : recipientName)
    : 'unknown';

  const submittedAt = new Date();
  const submittedAtFormatted = submittedAt.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const landingUrl = slug ? 'https://whitestone-partners.com/dealer/' + slug : 'N/A';
  const subject = 'NEW Whitestone Partner: ' + dealership + ' just signed up';

  const ctx = {
    name: name, email: email, phone: phone, dealership: dealership,
    message: message, slug: slug || 'N/A', landingUrl: landingUrl,
    recipientLabel: recipientLabel, submittedAtFormatted: submittedAtFormatted,
    submissionId: submissionId || 'unknown',
    hasMessage: !!message,
  };

  const html = renderEnrollmentHtml(ctx);
  const text = renderEnrollmentText(ctx);

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Whitestone Enrollments <' + NOTIFY_FROM_EMAIL + '>',
        to: [NOTIFY_TO_EMAIL],
        reply_to: email,
        subject: subject,
        html: html,
        text: text,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend send failed:', resendRes.status, errBody);
      return res.status(200).json({
        ok: true,
        warning: 'Submission saved but email notification failed',
        submission_id: submissionId,
      });
    }
  } catch (e) {
    console.error('Resend request failed:', e);
    return res.status(200).json({
      ok: true,
      warning: 'Submission saved but email notification threw',
      submission_id: submissionId,
    });
  }

  return res.status(200).json({ ok: true, submission_id: submissionId });
};

function renderEnrollmentHtml(d) {
  var messageBlock = '';
  if (d.hasMessage) {
    messageBlock =
      '<div style="height:24px;"></div>' +
      '<div class="section-label">Their Note</div>' +
      '<div class="message-block">' + escapeHtml(d.message).replace(/\n/g, '<br>') + '</div>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8f9fb;margin:0;padding:32px 16px;color:#0c1e2e;}' +
    '.wrap{max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4eaf0;}' +
    '.head{background:#0c1e2e;color:#ffffff;padding:32px 32px;border-bottom:3px solid #b8963e;}' +
    '.head .label{font-size:11px;font-weight:600;letter-spacing:0.3em;color:#b8963e;text-transform:uppercase;margin-bottom:10px;}' +
    '.head h1{font-family:Cormorant Garamond,Georgia,serif;font-size:26px;font-weight:300;margin:0 0 8px 0;line-height:1.3;}' +
    '.head .sub{font-size:13px;color:rgba(255,255,255,0.75);line-height:1.5;}' +
    '.context-bar{background:#fdf9ed;padding:14px 32px;font-size:12px;color:#5a4810;border-bottom:1px solid #e8d99b;line-height:1.5;}' +
    '.body{padding:28px 32px;}' +
    '.section-label{font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#b8963e;margin-bottom:14px;}' +
    '.row{display:table;width:100%;padding:10px 0;border-bottom:1px solid #f0f4f8;}' +
    '.row:last-child{border-bottom:none;}' +
    '.row .k{display:table-cell;width:120px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6b8599;vertical-align:top;padding-top:2px;}' +
    '.row .v{display:table-cell;font-size:14px;color:#0c1e2e;vertical-align:top;line-height:1.6;}' +
    '.row .v a{color:#b8963e;text-decoration:none;}' +
    '.message-block{background:#f8f9fb;padding:20px 22px;border-left:3px solid #b8963e;margin-top:18px;font-size:14px;line-height:1.7;color:#0c1e2e;font-style:italic;}' +
    '.action-block{background:#0c1e2e;color:#ffffff;padding:22px 26px;margin-top:28px;}' +
    '.action-block .action-label{font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#b8963e;margin-bottom:10px;}' +
    '.action-block .action-text{font-size:14px;color:rgba(255,255,255,0.92);line-height:1.7;}' +
    '.action-block ol{margin:10px 0 0;padding-left:18px;}' +
    '.action-block ol li{font-size:13px;color:rgba(255,255,255,0.85);line-height:1.7;margin-bottom:4px;}' +
    '.foot{padding:18px 32px;background:#f8f9fb;font-size:11px;color:#6b8599;text-align:center;letter-spacing:0.05em;border-top:1px solid #e4eaf0;}' +
    '</style></head><body><div class="wrap">' +
    '<div class="head">' +
      '<div class="label">New Partner Enrollment</div>' +
      '<h1>' + escapeHtml(d.dealership) + ' just signed up</h1>' +
      '<div class="sub">This is a real enrollment. The submitter clicked Submit on the "Become an Exclusive Whitestone Dealer" form. Highest-priority follow-up.</div>' +
    '</div>' +
    '<div class="context-bar">Submitted from <strong>' + escapeHtml(d.landingUrl) + '</strong></div>' +
    '<div class="body">' +
      '<div class="section-label">From</div>' +
      '<div class="row"><div class="k">Name</div><div class="v"><strong>' + escapeHtml(d.name) + '</strong></div></div>' +
      '<div class="row"><div class="k">Email</div><div class="v"><a href="mailto:' + escapeHtml(d.email) + '">' + escapeHtml(d.email) + '</a></div></div>' +
      '<div class="row"><div class="k">Phone</div><div class="v"><a href="tel:' + escapeHtml(d.phone) + '">' + escapeHtml(d.phone) + '</a></div></div>' +
      '<div class="row"><div class="k">Dealership</div><div class="v">' + escapeHtml(d.dealership) + '</div></div>' +
      '<div style="height:24px;"></div>' +
      '<div class="section-label">Context</div>' +
      '<div class="row"><div class="k">Box recipient</div><div class="v">' + escapeHtml(d.recipientLabel) + '</div></div>' +
      '<div class="row"><div class="k">Slug</div><div class="v">' + escapeHtml(d.slug) + '</div></div>' +
      '<div class="row"><div class="k">Submitted</div><div class="v">' + escapeHtml(d.submittedAtFormatted) + '</div></div>' +
      messageBlock +
      '<div class="action-block">' +
        '<div class="action-label">Next Actions</div>' +
        '<div class="action-text">Move fast. New enrollments are hot. Recommended:</div>' +
        '<ol>' +
          '<li>Call ' + escapeHtml(d.phone) + ' within 24 hours to confirm interest and answer questions</li>' +
          '<li>Send the official Dealer Partner Agreement for signature</li>' +
          '<li>Create their dealer portal account once agreement is signed</li>' +
          '<li>Update the dealer record in Supabase from active=false to active=true</li>' +
        '</ol>' +
      '</div>' +
    '</div>' +
    '<div class="foot">Whitestone Box Campaign - Enrollment submission - ID: ' + escapeHtml(d.submissionId) + '</div>' +
    '</div></body></html>';
}

function renderEnrollmentText(d) {
  var messageBlock = '';
  if (d.hasMessage) {
    messageBlock = '\nTHEIR NOTE\n\n"' + d.message + '"\n\n------------------------------------------------------------\n';
  }

  return 'NEW PARTNER ENROLLMENT\n\n' +
    'This is a real enrollment. The submitter clicked Submit on the\n' +
    '"Become an Exclusive Whitestone Dealer" form on their personalized\n' +
    'dealer landing page. Highest-priority follow-up.\n\n' +
    '------------------------------------------------------------\n\nFROM\n' +
    '  Name:        ' + d.name + '\n  Email:       ' + d.email + '\n' +
    '  Phone:       ' + d.phone + '\n  Dealership:  ' + d.dealership + '\n\nCONTEXT\n' +
    '  Landing page:    ' + d.landingUrl + '\n  Box recipient:   ' + d.recipientLabel + '\n' +
    '  Submitted:       ' + d.submittedAtFormatted + '\n\n' +
    '------------------------------------------------------------\n' +
    messageBlock +
    '\nNEXT ACTIONS\nMove fast. New enrollments are hot. Recommended:\n' +
    '  1. Call ' + d.phone + ' within 24 hours to confirm interest\n' +
    '  2. Send the official Dealer Partner Agreement for signature\n' +
    '  3. Create their dealer portal account once agreement is signed\n' +
    '  4. Update the dealer record in Supabase from active=false to active=true\n\n' +
    '------------------------------------------------------------\n\nWhitestone Box Campaign - Auto-notification\n' +
    'slug: ' + d.slug + ' - submission_id: ' + d.submissionId;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
