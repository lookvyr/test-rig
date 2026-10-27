import * as Predicate from "effect/Predicate";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as JsonSchema from "effect/JsonSchema";
import { McpSchema, McpServer, Tool, type Toolkit } from "effect/unstable/ai";

/** Compact advertised input schemas without changing the tool's decoder. */
export function compactJsonSchema(schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema {
  const compact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(compact);
    if (!Predicate.isObject(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (key === "additionalProperties" && field === true) continue;
      if (key === "minimum" && field === Number.MIN_SAFE_INTEGER) continue;
      if (key === "maximum" && field === Number.MAX_SAFE_INTEGER) continue;
      if (
        ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"].includes(
          key,
        ) &&
        Predicate.isObject(field)
      ) {
        result[key] = Object.fromEntries(
          Object.entries(field).map(([name, child]) => [name, compact(child)]),
        );
      } else if (
        [
          "anyOf",
          "oneOf",
          "allOf",
          "prefixItems",
          "items",
          "additionalProperties",
          "contains",
          "not",
          "if",
          "then",
          "else",
          "propertyNames",
          "unevaluatedItems",
          "unevaluatedProperties",
        ].includes(key)
      ) {
        result[key] = compact(field);
      } else {
        result[key] = field;
      }
    }
    if (Array.isArray(result.anyOf)) {
      const branches = result.anyOf.flatMap((branch: unknown) =>
        Predicate.isObject(branch) &&
        Object.keys(branch).length === 1 &&
        Array.isArray(branch.anyOf)
          ? branch.anyOf
          : [branch],
      );
      // Keep semantic nulls (for clearing settings), branch requirements, and
      // JSON-string compatibility inputs. Only remove duplicate alternatives.
      result.anyOf = [
        ...new Map(branches.map((branch) => [JSON.stringify(branch), branch])).values(),
      ];
    }
    return result;
  };
  return compact(schema) as JsonSchema.JsonSchema;
}

export const advertisedJsonSchema = (tool: Tool.Any) => compactJsonSchema(Tool.getJsonSchema(tool));

/** Reuse Effect's registration and handlers, changing only the advertised input. */
export const compactToolkit = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
) =>
  Layer.effectDiscard(
    McpServer.registerToolkit(toolkit).pipe(
      Effect.updateService(McpServer.McpServer, (server) => ({
        ...server,
        addTool: (registration) =>
          server.addTool({
            ...registration,
            tool: new McpSchema.Tool({
              ...registration.tool,
              inputSchema: compactJsonSchema(registration.tool.inputSchema),
            }),
          }),
      })),
    ),
  ).pipe(Layer.provide(McpServer.McpServer.layer));
