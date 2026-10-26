import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        include: ["**/*.test.js"],
        exclude: ["**/node_modules/**"],
        environment: "node",
        testTimeout: 30000,
        hookTimeout: 30000
    }
})
