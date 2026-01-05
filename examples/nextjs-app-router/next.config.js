/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@langchain/langgraph-sdk"],
  },
};

module.exports = nextConfig;
