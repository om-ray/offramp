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
    return fetch(upstream, { method: request.method, headers, redirect: "manual" });
  },
};

export default worker;
