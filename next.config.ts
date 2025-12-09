import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产镜像使用 standalone 输出以便最小化运行时依赖
  output: "standalone",
};

export default nextConfig;
