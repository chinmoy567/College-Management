/** Served by Express through next({ dev, dir }); not standalone. */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@cms/shared'],
};
export default nextConfig;
