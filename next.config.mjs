/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Server-only database drivers: loaded at runtime, not bundled (PGlite is the local-development database).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**.public.blob.vercel-storage.com" }] },
};
export default nextConfig;
