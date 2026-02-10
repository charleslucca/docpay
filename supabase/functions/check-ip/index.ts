import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract client IP
    const forwarded = req.headers.get("x-forwarded-for");
    const clientIp = forwarded ? forwarded.split(",")[0].trim() : "unknown";

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if there are any active IPs in whitelist
    const { data: whitelistEntries, error } = await supabaseAdmin
      .from("ip_whitelist")
      .select("ip")
      .eq("active", true);

    if (error) {
      console.error("Error querying ip_whitelist:", error);
      return new Response(
        JSON.stringify({ allowed: false, error: "Internal error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no active entries, allow all (whitelist not configured)
    if (!whitelistEntries || whitelistEntries.length === 0) {
      return new Response(
        JSON.stringify({ allowed: true, ip: clientIp, reason: "no_whitelist_configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if client IP is in whitelist
    const allowed = whitelistEntries.some((entry) => entry.ip === clientIp);

    return new Response(
      JSON.stringify({ allowed, ip: clientIp }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-ip error:", err);
    return new Response(
      JSON.stringify({ allowed: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
