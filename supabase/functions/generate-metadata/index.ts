import { serve } from "https://deno.land/std/http/server.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const jsonHeaders = {
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Server misconfigured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing authorization header" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const userRes = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!userRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    const userData = await userRes.json();
    if (!userData?.id) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = await req.json();
    const model = typeof body?.model === "string" ? body.model : "";
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    const responseFormat = body?.response_format && typeof body.response_format === "object"
      ? body.response_format
      : undefined;
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;

    if (!model || !messages) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid payload" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    });

    const payload = await openaiRes.json();
    if (!openaiRes.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: payload?.error?.message || "OpenAI request failed",
      }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    const content = payload?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ ok: true, content, usage: payload?.usage ?? null }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
