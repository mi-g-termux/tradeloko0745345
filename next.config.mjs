/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Docker, Fly.io, Cloud Run, VPS and cPanel builds set BUILD_STANDALONE=1.
  // Standalone emits .next/standalone/server.js with only the node_modules the
  // app actually needs, which is what makes those platforms work (and keeps
  // cPanel under its inode limit). It is opt-in because Vercel and Netlify
  // supply their own server layer and do not want it.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" } : {}),

  images: {
    // Token logos come from arbitrary CDNs (DexScreener, IPFS gateways, project
    // sites), so the host cannot be enumerated ahead of time. Remote images are
    // never rendered with next/image for admin-supplied URLs - see the plain
    // <img> in Nav.tsx - so this stays permissive on purpose.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },

  // Do not fail a production deploy over a lint warning. Type errors still
  // block the build, which is what actually protects correctness.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
