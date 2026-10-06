import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

// The V2 sidebar has no sortable-row sensor; native dragging carries the same
// scoped references that upstream's sidebar hands to its composer.
export const THREAD_CONTEXT_DRAG_TYPE = "application/x-test-rig-thread-context";
const decodeRefs = Schema.decodeUnknownOption(Schema.Array(ScopedThreadRef));

export function readThreadContextDrag(dataTransfer: Pick<DataTransfer, "getData">) {
  try {
    const decoded = decodeRefs(JSON.parse(dataTransfer.getData(THREAD_CONTEXT_DRAG_TYPE)));
    return decoded._tag === "Some" ? decoded.value : [];
  } catch {
    return [];
  }
}
