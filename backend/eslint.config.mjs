import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: ["eslint.config.mjs"]
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            // Every Node global (timers, URL, Buffer, TextDecoder, fetch, …), so code uses them directly
            globals: globals.node,
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];
