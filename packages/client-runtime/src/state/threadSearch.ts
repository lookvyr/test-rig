import {
  EnvironmentId,
  OrchestrationSearchThreadsInput,
  ProjectId,
  type OrchestrationThreadSearchMatch,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2SearchThreadsResult,
  type OrchestrationV2ThreadFamily,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface EnvironmentThreadSearchMatch extends OrchestrationThreadSearchMatch {
  readonly environmentId: EnvironmentId;
}

export interface ThreadSearchResultsState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isLoading: boolean;
  /** Rows of matching older settled threads, which shells that omit them do not hold. */
  readonly rows: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly read: OrchestrationV2ThreadFamily;
  }>;
}

/**
 * How a search reaches environments whose shells omit older settled threads (others ignore it):
 * the caller's project scope and its names for environments, which its own ranking matches, and
 * whether to skip message search.
 */
export const ThreadSearchScope = Schema.Struct({
  projectIds: Schema.optionalKey(Schema.Array(ProjectId)),
  environmentLabels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  titlesOnly: Schema.optionalKey(Schema.Boolean),
});
export type ThreadSearchScope = typeof ThreadSearchScope.Type;

const ThreadSearchKey = Schema.fromJsonString(
  Schema.Union([
    Schema.Tuple([Schema.Array(EnvironmentId), OrchestrationSearchThreadsInput.fields.query]),
    Schema.Tuple([
      Schema.Array(EnvironmentId),
      OrchestrationSearchThreadsInput.fields.query,
      ThreadSearchScope,
    ]),
  ]),
);
const decodeThreadSearchKey = Schema.decodeUnknownOption(ThreadSearchKey);
const EMPTY_SEARCH_ROWS: ThreadSearchResultsState["rows"] = [];
const EMPTY_READS: ReadonlyArray<OrchestrationV2ThreadFamily> = [];

export function makeThreadSearchKey(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
  scope: ThreadSearchScope = {},
): string {
  const sorted = [...environmentIds].sort((left, right) => left.localeCompare(right));
  return JSON.stringify(Object.keys(scope).length === 0 ? [sorted, query] : [sorted, query, scope]);
}

function parseThreadSearchKey(key: string) {
  return decodeThreadSearchKey(key);
}

export function threadSearchMatchKey(
  match: Pick<EnvironmentThreadSearchMatch, "environmentId" | "threadId">,
): string {
  return JSON.stringify([match.environmentId, match.threadId]);
}

/**
 * Message matches from every environment, plus, from environments whose shells omit older settled
 * threads (`olderSettledBefore` is set), the rows of the best older matches. Callers mount those
 * rows (`rows`) so their own ranking sees them, as it sees shell rows.
 */
export function createThreadSearchResultsAtomFamily<E>(options: {
  readonly getSearchAtom: (
    environmentId: EnvironmentId,
    input: OrchestrationV2SearchThreadsInput,
  ) => Atom.Atom<AsyncResult.AsyncResult<OrchestrationV2SearchThreadsResult, E>>;
  readonly olderSettledBefore?: (environmentId: EnvironmentId) => Atom.Atom<string | null>;
  readonly labelPrefix: string;
}) {
  const results = Atom.family((key: string) =>
    Atom.make((get): ThreadSearchResultsState => {
      const parsedKey = parseThreadSearchKey(key);
      if (Option.isNone(parsedKey)) {
        return { matches: [], isLoading: false, rows: EMPTY_SEARCH_ROWS };
      }

      const [environmentIds, query, scope = {}] = parsedKey.value;
      const searchMessages = scope.titlesOnly !== true;
      const matches: EnvironmentThreadSearchMatch[] = [];
      const rows: Array<ThreadSearchResultsState["rows"][number]> = [];
      let isLoading = false;

      for (const environmentId of environmentIds) {
        const before = options.olderSettledBefore
          ? get(options.olderSettledBefore(environmentId))
          : null;
        if (!searchMessages && before === null) continue;
        const label = scope.environmentLabels?.[environmentId];
        const result = get(
          options.getSearchAtom(environmentId, {
            query,
            ...(before === null
              ? {}
              : {
                  olderSettledBefore: before,
                  ...(scope.projectIds === undefined ? {} : { projectIds: scope.projectIds }),
                  ...(label === undefined ? {} : { environmentLabel: label }),
                  ...(searchMessages ? {} : { titlesOnly: true }),
                }),
          }),
        );
        isLoading ||= result.waiting;
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) {
          matches.push(...value.matches.map((match) => ({ ...match, environmentId })));
          if (value.threads !== undefined && value.threads.length > 0) {
            rows.push({
              environmentId,
              read: { snapshotSequence: value.snapshotSequence ?? 0, threads: value.threads },
            });
          }
        }
      }

      return { matches, isLoading, rows: rows.length === 0 ? EMPTY_SEARCH_ROWS : rows };
    }).pipe(Atom.withLabel(`${options.labelPrefix}:${key}`)),
  );
  const rowsAtom = Atom.family((rowsKey: string) => {
    const [key, environmentId] = JSON.parse(rowsKey) as [string, EnvironmentId];
    let previous = EMPTY_READS;
    return Atom.make((get) => {
      const next = get(results(key)).rows.flatMap((row) =>
        row.environmentId === environmentId ? [row.read] : [],
      );
      if (next.length === previous.length && next.every((read, index) => read === previous[index]))
        return previous;
      previous = next.length === 0 ? EMPTY_READS : next;
      return previous;
    }).pipe(Atom.withLabel(`${options.labelPrefix}-rows:${rowsKey}`));
  });
  return {
    results,
    /** One environment's older settled rows for a search key, for `mountRows`. */
    rows: (key: string, environmentId: EnvironmentId) =>
      rowsAtom(JSON.stringify([key, environmentId])),
  };
}
