const ORIGIN = "https://offramp-omray.vercel.app";

const worker = {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LOOKUPS.limit({ key: ip });
      if (!success) return Response.json({ error: "Too many lookups from here. Wait a minute and try again." }, { status: 429 });
    }
    const upstream = new URL(ORIGIN);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of ["accept", "accept-language", "accept-encoding", "user-agent", "if-none-match", "if-modified-since", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("x-edge-auth", env.EDGE_SECRET);
    const isApi = url.pathname.startsWith("/api/");
    let response;
    try {
      response = await fetch(upstream, { method: request.method, headers, redirect: "manual" });
    } catch (err) {
      if (!isApi) throw err;
      return Response.json({ error: "We couldn't read this wallet just now. Try again, or type your totals in by hand below." }, { status: 503 });
    }
    if (!isApi || response.ok) return response;
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/json")) return new Response(response.body, { status: response.status, headers: { "content-type": type, "cache-control": "no-store" } });
    return Response.json({ error: "We couldn't read this wallet just now. Try again, or type your totals in by hand below." }, { status: response.status });
  },
};

export default worker;
