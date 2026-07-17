/** @type {import('next').NextConfig} */
const nextConfig = {
  // @duckdb/node-api is a native addon; keep it out of the bundler so both the
  // build and the serverless runtime load the prebuilt binary directly.
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
