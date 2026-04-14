import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM = "WCF Planner <reports@wcfplanner.com>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(payload: object): Promise<Response> {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ═══════════════════════════════════════════════════════════════════
// SHARED BRANDED TEMPLATE — all emails use this wrapper
// ═══════════════════════════════════════════════════════════════════
function brandedEmail(opts: {
  title: string;        // e.g. "🥚 Egg Report"
  subtitle?: string;    // e.g. date or tagline
  bodyHtml: string;     // inner content
  isTest?: boolean;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  ${opts.isTest ? '<div style="background:#c46904;color:white;text-align:center;padding:8px;font-family:sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;">⚠ TEST EMAIL — NOT SENT TO REAL RECIPIENTS</div>' : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Header Banner -->
        <tr><td style="background:#566542;border-radius:8px 8px 0 0;padding:28px 36px;text-align:center;">
          <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:Arial,sans-serif;">White Creek Farm</div>
          <div style="color:#ffffff;font-size:22px;font-weight:700;font-family:Georgia,serif;margin-bottom:4px;">${opts.title}</div>
          ${opts.subtitle ? `<div style="color:rgba(255,255,255,0.8);font-size:13px;font-family:Arial,sans-serif;">${opts.subtitle}</div>` : ''}
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px;">
          ${opts.bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#566542;border-radius:0 0 8px 8px;padding:16px 36px;text-align:center;">
          <div style="color:rgba(255,255,255,0.7);font-size:11px;font-family:Arial,sans-serif;letter-spacing:0.5px;">White Creek Farm · wcfplanner.com</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════
// EGG REPORT — uses the shared template
// ═══════════════════════════════════════════════════════════════════
function eggEmailHtml(data: any, isTest: boolean) {
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bodyHtml = `
    <!-- Stats -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td width="48%" style="background:#f8f6f0;border-radius:8px;padding:20px 16px;text-align:center;border:1px solid #e8e4dc;">
          <div style="color:#566542;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">Dozens on Hand</div>
          <div style="color:#566542;font-size:13px;font-style:italic;font-family:Georgia,serif;margin-bottom:6px;">(&lt;2 weeks old)</div>
          <div style="color:#232323;font-size:36px;font-weight:700;font-family:Georgia,serif;line-height:1;">${data.dozens_on_hand != null ? data.dozens_on_hand : '—'}</div>
          <div style="color:#888;font-size:12px;font-family:Arial,sans-serif;margin-top:4px;">dozen</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#f8f6f0;border-radius:8px;padding:20px 16px;text-align:center;border:1px solid #e8e4dc;">
          <div style="color:#566542;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">Collected Today</div>
          <div style="color:#566542;font-size:13px;font-style:italic;font-family:Georgia,serif;margin-bottom:6px;">&nbsp;</div>
          <div style="color:#232323;font-size:36px;font-weight:700;font-family:Georgia,serif;line-height:1;">${data.daily_dozen_count ?? 0}</div>
          <div style="color:#888;font-size:12px;font-family:Arial,sans-serif;margin-top:4px;">dozen</div>
        </td>
      </tr>
    </table>

    <!-- Submitted by -->
    <div style="border-top:1px solid #e8e4dc;padding-top:16px;text-align:center;">
      <span style="color:#999;font-size:12px;font-family:Arial,sans-serif;">Submitted by <strong style="color:#566542;">${data.team_member || 'Farm Team'}</strong> · WCF Planner</span>
    </div>
  `;
  return brandedEmail({ title: '🥚 Egg Report', subtitle: date, bodyHtml, isTest });
}

// ═══════════════════════════════════════════════════════════════════
// STARTER FEED ALERT — upgraded to use shared template
// ═══════════════════════════════════════════════════════════════════
function starterFeedHtml(batchLabel: string, totalLbs: number, isTest: boolean) {
  const bodyHtml = `
    <p style="font-family:Georgia,serif;font-size:15px;color:#232323;margin:0 0 16px 0;">Dear Supreme Chicken Raiser,</p>

    <!-- Alert box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#fffbeb;border:2px solid #fde68a;border-radius:8px;padding:20px;text-align:center;">
        <div style="color:#92400e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">Starter Feed Total</div>
        <div style="color:#232323;font-size:36px;font-weight:700;font-family:Georgia,serif;line-height:1;margin-bottom:4px;">${totalLbs.toLocaleString()} lbs</div>
        <div style="color:#92400e;font-size:13px;font-family:Arial,sans-serif;">of 1,500 lbs maximum</div>
      </td></tr>
    </table>

    <p style="font-family:Georgia,serif;font-size:15px;color:#232323;line-height:1.6;margin:0 0 16px 0;">The starter feed for <strong style="color:#566542;">${batchLabel}</strong> has reached <strong>${totalLbs.toLocaleString()} lbs</strong>. The max for each batch is 1,500 lbs. Your attention to this matter is greatly appreciated.</p>

    <p style="font-family:Georgia,serif;font-size:15px;color:#232323;margin:24px 0 0 0;">Best,<br>White Creek Farm</p>

    <!-- Footer note -->
    <div style="border-top:1px solid #e8e4dc;padding-top:16px;margin-top:24px;text-align:center;">
      <span style="color:#999;font-size:11px;font-family:Arial,sans-serif;">WCF Planner automated alert</span>
    </div>
  `;
  return brandedEmail({ title: '⚠ Starter Feed Alert', subtitle: batchLabel, bodyHtml, isTest });
}

// ═══════════════════════════════════════════════════════════════════
// USER WELCOME — new user created
// ═══════════════════════════════════════════════════════════════════
function welcomeEmailHtml(name: string, email: string, role: string, resetLink: string, isTest: boolean) {
  const roleLabels: Record<string, string> = {
    'admin': '👑 Admin — Full access to all features',
    'management': '🔑 Management — Edit anything, delete daily reports',
    'farm_team': '🌾 Farm Team — Edit & delete your daily reports',
  };
  const roleDescription = roleLabels[role] || role;

  const bodyHtml = `
    <p style="font-family:Georgia,serif;font-size:16px;color:#232323;margin:0 0 16px 0;">Welcome, <strong style="color:#566542;">${name || email}</strong>!</p>

    <p style="font-family:Georgia,serif;font-size:15px;color:#232323;line-height:1.6;margin:0 0 20px 0;">Your account has been created for the White Creek Farm planner. This is the system we use to track all animal programs on the farm.</p>

    <!-- Role card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#f8f6f0;border:1px solid #e8e4dc;border-radius:8px;padding:18px 20px;">
        <div style="color:#566542;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:6px;">Your Role</div>
        <div style="color:#232323;font-size:15px;font-family:Georgia,serif;">${roleDescription}</div>
      </td></tr>
    </table>

    <!-- Next steps -->
    <div style="color:#566542;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:10px;">Next Steps</div>
    <ol style="font-family:Georgia,serif;font-size:15px;color:#232323;line-height:1.7;margin:0 0 24px 0;padding-left:22px;">
      <li>Click the button below to set your password</li>
      <li>Log in at <a href="https://wcfplanner.com" style="color:#566542;">wcfplanner.com</a></li>
      <li>Start using the planner on any device — desktop or mobile</li>
    </ol>

    <!-- CTA button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr><td align="center">
        <a href="${resetLink}" style="display:inline-block;background:#566542;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.5px;">Set Your Password</a>
      </td></tr>
    </table>

    <p style="font-family:Georgia,serif;font-size:13px;color:#888;line-height:1.6;margin:0 0 16px 0;text-align:center;">This link is valid for 24 hours. If you need a new one, visit <a href="https://wcfplanner.com" style="color:#566542;">wcfplanner.com</a> and click "Forgot password?"</p>

    <!-- Footer note -->
    <div style="border-top:1px solid #e8e4dc;padding-top:16px;text-align:center;">
      <span style="color:#999;font-size:11px;font-family:Arial,sans-serif;">Questions? Reply to this email.</span>
    </div>
  `;
  return brandedEmail({ title: '🌾 Welcome to WCF Planner', subtitle: 'Your account is ready', bodyHtml, isTest });
}

// ═══════════════════════════════════════════════════════════════════
// PASSWORD RESET — user requested or admin triggered
// ═══════════════════════════════════════════════════════════════════
function passwordResetHtml(name: string, resetLink: string, isTest: boolean) {
  const bodyHtml = `
    <p style="font-family:Georgia,serif;font-size:16px;color:#232323;margin:0 0 16px 0;">Hi <strong style="color:#566542;">${name || 'there'}</strong>,</p>

    <p style="font-family:Georgia,serif;font-size:15px;color:#232323;line-height:1.6;margin:0 0 24px 0;">A password reset was requested for your WCF Planner account. Click the button below to set a new password.</p>

    <!-- CTA button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td align="center">
        <a href="${resetLink}" style="display:inline-block;background:#566542;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.5px;">Reset Password</a>
      </td></tr>
    </table>

    <!-- Info box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td style="background:#f8f6f0;border:1px solid #e8e4dc;border-radius:8px;padding:16px 20px;">
        <div style="color:#566542;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:6px;">What to expect</div>
        <ul style="font-family:Georgia,serif;font-size:14px;color:#232323;line-height:1.6;margin:0;padding-left:20px;">
          <li>Link is valid for 24 hours</li>
          <li>Password must be at least 6 characters</li>
          <li>You'll be logged in automatically after setting it</li>
        </ul>
      </td></tr>
    </table>

    <p style="font-family:Georgia,serif;font-size:13px;color:#888;line-height:1.6;margin:0 0 16px 0;">Didn't request this? You can safely ignore this email — your password won't change unless you click the link.</p>

    <!-- Footer note -->
    <div style="border-top:1px solid #e8e4dc;padding-top:16px;text-align:center;">
      <span style="color:#999;font-size:11px;font-family:Arial,sans-serif;">WCF Planner · Questions? Reply to this email.</span>
    </div>
  `;
  return brandedEmail({ title: '🔑 Password Reset', subtitle: 'WCF Planner', bodyHtml, isTest });
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { type, data, test_to } = await req.json();

    // ─── EGG REPORT ───
    if (type === "egg_report") {
      const res = await sendEmail({
        from: FROM,
        to: test_to ? [test_to] : ["isabel@sonnysfarm.com"],
        ...(test_to ? {} : { cc: ["brian@sonnysfarm.com", "jessica@marbellagroup.com"], bcc: ["ronnie@whitecreek.farm"] }),
        subject: test_to ? `[TEST] Egg Report - ${new Date(data.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : `Egg Report - ${new Date(data.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        html: eggEmailHtml(data, !!test_to),
      });
      const result = await res.json();
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── STARTER FEED ALERT ───
    if (type === "starter_feed_check") {
      if (!data.batch_label || !data.feed_lbs || parseFloat(data.feed_lbs) <= 0) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: records, error: queryError } = await admin
        .from("poultry_dailys").select("feed_lbs")
        .eq("batch_label", data.batch_label).eq("feed_type", "STARTER");
      if (queryError) throw new Error(queryError.message);
      const total = records?.reduce((s, r) => s + (parseFloat(r.feed_lbs) || 0), 0) ?? 0;
      const prevTotal = total - (parseFloat(data.feed_lbs) || 0);
      if (test_to || (total >= 1400 && prevTotal < 1400)) {
        const displayTotal = test_to ? 1432 : Math.round(total);
        const res = await sendEmail({
          from: FROM,
          to: test_to ? [test_to] : ["Simon.rosa3@gmail.com"],
          ...(test_to ? {} : { cc: ["mak@whitecreek.farm"] }),
          subject: test_to ? `[TEST] STARTER FEED LIMIT - NEAR CUTOFF FOR ${data.batch_label}` : `STARTER FEED LIMIT - NEAR CUTOFF FOR ${data.batch_label}`,
          html: starterFeedHtml(data.batch_label, displayTotal, !!test_to),
        });
        const result = await res.json();
        return new Response(JSON.stringify({ ok: true, alert_sent: true, total: displayTotal, result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, alert_sent: false, total: Math.round(total) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── USER WELCOME — sent when admin creates a new user ───
    if (type === "user_welcome") {
      if (!data.email) throw new Error("email required");
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      // Generate a magic recovery link so they can set their password
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: data.email,
        options: { redirectTo: 'https://wcfplanner.com' },
      });
      if (linkError) throw new Error(linkError.message);
      const resetLink = linkData.properties?.action_link || 'https://wcfplanner.com';

      const res = await sendEmail({
        from: FROM,
        to: test_to ? [test_to] : [data.email],
        ...(test_to ? {} : { bcc: ["ronnie@whitecreek.farm"] }),
        subject: test_to ? `[TEST] Welcome to WCF Planner` : `Welcome to WCF Planner`,
        html: welcomeEmailHtml(data.name || '', data.email, data.role || 'farm_team', resetLink, !!test_to),
      });
      const result = await res.json();
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── PASSWORD RESET — admin triggered or user forgot ───
    if (type === "password_reset") {
      if (!data.email) throw new Error("email required");
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: data.email,
        options: { redirectTo: 'https://wcfplanner.com' },
      });
      if (linkError) throw new Error(linkError.message);
      const resetLink = linkData.properties?.action_link || 'https://wcfplanner.com';

      const res = await sendEmail({
        from: FROM,
        to: test_to ? [test_to] : [data.email],
        subject: test_to ? `[TEST] Reset your WCF Planner password` : `Reset your WCF Planner password`,
        html: passwordResetHtml(data.name || '', resetLink, !!test_to),
      });
      const result = await res.json();
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
