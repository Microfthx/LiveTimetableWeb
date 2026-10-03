/** Attach once per request in the direct Node service on port 9000. */
export function attachAccessLog(request, response) {
  const started = performance.now();
  let path = "<invalid URL>";
  try { path = new URL(request.url, "http://localhost").pathname; }
  catch { /* The application will return its own 400 response. */ }
  response.once("finish", () => {
    process.stdout.write(`${JSON.stringify({
      kind: "access",
      port: 9000,
      time: new Date().toISOString(),
      ip: request.socket.remoteAddress ?? "",
      method: request.method ?? "",
      path,
      status: response.statusCode,
      duration_ms: Math.round(performance.now() - started),
      user_agent: String(request.headers["user-agent"] ?? "").slice(0, 512),
    })}\n`);
  });
}
