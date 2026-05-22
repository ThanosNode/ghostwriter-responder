// api/route-draft.js
// Vercel Serverless Function — Node.js runtime
// ✅ Correct deploy path: /api/route-draft

// ✅ CommonJS export — required for plain Vercel projects (no Next.js)
// ✅ Removed "export const config" ESM syntax that breaks plain Vercel functions

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function buildSystemPrompt(brandTone) {
  const toneInstructions = {
    professional: `You are a professional business owner writing a polished, courteous response to a customer review. Your tone is confident, empathetic, and solution-oriented. Use clear, concise language. Never use slang or overly casual phrasing.`,
    friendly: `You are a warm, approachable business owner responding to a customer review. Your tone is conversational, genuine, and enthusiastic without being over-the-top. Use a natural, human voice that makes customers feel valued.`,
    luxury: `You are a representative of a premium, luxury brand responding to a guest or client review. Your tone is refined, gracious, and measured. Every word should convey exclusivity, attentiveness, and impeccable standards. Avoid any casual language.`,
    casual: `You are a laid-back, friendly small business owner replying to a review. Your tone is relaxed, sincere, and personable — like you're talking to a neighbor. A touch of humor is welcome when appropriate.`,
    formal: `You are a formal business representative responding to a customer review. Maintain a strict professional register. Use complete sentences, avoid contractions, and project authority and competence at all times.`,
  };

  const toneKey = Object.keys(toneInstructions).includes(brandTone) ? brandTone : "professional";

  return `${toneInstructions[toneKey]}

Your task: Write a single, complete reply to the customer review provided by the user.

Rules you must follow without exception:
1. Do NOT include any preamble, explanation, or meta-commentary — output only the reply text itself.
2. Do NOT use placeholder text like "[Your Name]" or "[Business Name]". Write the reply as if you are the owner.
3. Keep the reply between 60 and 160 words — concise but substantive.
4. Acknowledge any specific points the reviewer mentioned (positive or negative).
5. If the review is negative, express genuine empathy and invite the customer to return or make it right — never be defensive.
6. If the review is positive, express authentic gratitude and reinforce what made the experience great.
7. End with a warm closing that invites future engagement.
8. Never fabricate specific facts, promotions, or names not present in the review.`;
}

// ✅ module.exports instead of "export default" — this is what Vercel needs for plain projects
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  // ── 1. Parse and Validate Body ───────────────────────────────────────────

  let email, reviewText;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    email = body?.email?.trim();
    reviewText = body?.reviewText?.trim();
  } catch {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (!reviewText || typeof reviewText !== "string" || reviewText.length < 5) {
    return res.status(400).json({ error: "Review text is missing or too short." });
  }
  if (reviewText.length > 5000) {
    return res.status(400).json({ error: "Review text exceeds maximum length of 5000 characters." });
  }

  // ── 2. Query Supabase ────────────────────────────────────────────────────

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[GhostWriter] Missing Supabase environment variables.");
    return res.status(500).json({ error: "Server configuration error. Please contact support." });
  }

  let profile;
  try {
    const supabaseRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=subscription_status,brand_tone&limit=1`,
      {
        method: "GET",
        headers: {
          "apikey": supabaseServiceKey,
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!supabaseRes.ok) {
      const errBody = await supabaseRes.text();
      console.error("[GhostWriter] Supabase query failed:", supabaseRes.status, errBody);
      return res.status(502).json({ error: "Database query failed. Please try again shortly." });
    }
    const rows = await supabaseRes.json();
    profile = rows?.[0] ?? null;
  } catch (err) {
    console.error("[GhostWriter] Supabase fetch exception:", err);
    return res.status(502).json({ error: "Could not reach the database. Please try again shortly." });
  }

  // ── 3. Gatekeeper: Check Subscription ───────────────────────────────────

  if (!profile || profile.subscription_status !== "active") {
    return res.status(403).json({
      error: "Subscription inactive. Please click the GhostWriter icon or check your Stripe Portal to activate your $5/mo account.",
    });
  }

  // ── 4. Call Anthropic API ────────────────────────────────────────────────

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("[GhostWriter] Missing ANTHROPIC_API_KEY environment variable.");
    return res.status(500).json({ error: "Server configuration error. Please contact support." });
  }

  const systemPrompt = buildSystemPrompt(profile.brand_tone || "professional");

  let generatedReply;
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Here is the customer review to respond to:\n\n"${reviewText}"`,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error("[GhostWriter] Anthropic API error:", anthropicRes.status, errBody);
      if (anthropicRes.status === 429) {
        return res.status(429).json({ error: "AI service is busy right now. Please wait a moment and try again." });
      }
      return res.status(502).json({ error: "AI service returned an error. Please try again shortly." });
    }

    const anthropicData = await anthropicRes.json();
    const contentBlock = anthropicData?.content?.find((block) => block.type === "text");
    generatedReply = contentBlock?.text?.trim();

    if (!generatedReply) {
      console.error("[GhostWriter] Anthropic returned no text content:", JSON.stringify(anthropicData));
      return res.status(502).json({ error: "AI returned an empty response. Please try again." });
    }
  } catch (err) {
    console.error("[GhostWriter] Anthropic fetch exception:", err);
    return res.status(502).json({ error: "Could not reach the AI service. Please check your connection and try again." });
  }

  // ── 5. Return Success ────────────────────────────────────────────────────

  return res.status(200).json({ replyText: generatedReply });
};
