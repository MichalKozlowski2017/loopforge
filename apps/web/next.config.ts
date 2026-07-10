import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@loopforge/brouter",
    "@loopforge/generator",
    "@loopforge/scoring",
    "@loopforge/gpx",
    "@loopforge/osm-types",
  ],
};

export default nextConfig;
