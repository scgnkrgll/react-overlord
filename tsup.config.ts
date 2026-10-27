import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stack.ts"],
  format: ["esm", "cjs"],
  target: "es2020",
  dts: true,
  clean: true,
  external: ["react"],
  // No "use client" banner: index.ts and stack.ts carry the directive in source (JSR needs it
  // there too), and esbuild keeps it, so a banner would emit it twice.
});
