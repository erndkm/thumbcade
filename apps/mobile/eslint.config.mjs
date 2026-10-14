import base from "../../eslint.config.js";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  ...base,
  { ignores: ["maestro/**", "dev-fixtures/**", "dist-export/**", ".expo/**", "*.config.js", "jest.setup.js"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
