/** haloK@MPUS web: consoles, dashboards, data-rights page, channel simulators. */
const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@hk/shared"],
  poweredByHeader: false,
  // Socket.IO requests end with "/socket.io/?EIO=…"; do not redirect the trailing slash away.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // Same-origin proxy so the httpOnly session cookie and CSRF token work without CORS.
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/public/:path*", destination: `${api}/public/:path*` },
      { source: "/sim/:channel/:action(send|outbox|read)", destination: `${api}/sim/:channel/:action` },
      { source: "/socket.io/", destination: `${api}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "same-origin" }] }];
  },
};
export default nextConfig;
