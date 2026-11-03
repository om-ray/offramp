const ORIGIN = "https://offramp-oms-projects-b0066465.vercel.app";

const worker = {
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    return fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  },
};

export default worker;
