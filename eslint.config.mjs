import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["**/.next/**", "**/node_modules/**"] },
  ...ts.configs.recommended,
);
