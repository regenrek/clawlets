// Local oxlint jsPlugin rules for clawlets-specific lint policy.
export default {
  meta: { name: "clawlets" },
  rules: {
    "no-dynamic-import-main": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow dynamic import() in main code. Prefer static imports for deterministic loading and bundling.",
        },
        schema: [],
      },
      create(context) {
        return {
          ImportExpression(node) {
            context.report({
              node,
              message:
                "Don't use dynamic import() in main code (this includes await import()). Prefer static imports. Tests/routes/tooling are allowed.",
            });
          },
        };
      },
    },
  },
};
