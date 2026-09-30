import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  {
    ignores: [".next/**", "node_modules/**", "src/vendor/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tseslint, "react-hooks": reactHooks },
    rules: {
      "no-debugger": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "react-hooks/exhaustive-deps": "off",
      "no-duplicate-imports": "error",
      "no-fallthrough": "error",
      "no-constant-binary-expression": "error",
    },
  },
];
