import js from "@eslint/js";

export default [
    {
        ignores: ["eslint.config.mjs"]
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                console: "readonly",
                process: "readonly",
                module: "readonly",
                require: "readonly",
                __dirname: "readonly",
                // Web-standard globals built into Node 18+ (no module to import them from).
                fetch: "readonly",
                AbortController: "readonly",
                AbortSignal: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];
