/** @type {import('next').NextConfig} */
// Security headers (F26). The Content-Security-Policy for pages is set per
// request with a nonce in proxy.ts so no 'unsafe-inline' script is allowed;
// API responses never carry scripts and get the strictest static policy.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

const apiCsp = { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" };

const nextConfig = {
  serverExternalPackages: ['pg', 'bcrypt'],
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [apiCsp] }
    ];
  },
  async rewrites() {
    return [
      // French-language public URLs (F25): /fr/<org>/emplois -> /fr/<org>/jobs
      { source: '/fr/:org/emplois', destination: '/fr/:org/jobs' },
      { source: '/fr/:org/emplois/:path*', destination: '/fr/:org/jobs/:path*' }
    ];
  }
};

module.exports = nextConfig;
