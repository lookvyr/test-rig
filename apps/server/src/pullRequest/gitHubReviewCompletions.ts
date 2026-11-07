import type { PullRequestCompletions, PullRequestReferenceCandidate } from "@t3tools/contracts";
import { PullRequestActor } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export const REPOSITORY_MENTIONS_QUERY = `query($owner: String!, $name: String!, $query: String) {
  repository(owner: $owner, name: $name) {
    mentionableUsers(first: 20, query: $query) { nodes { login name avatarUrl } }
  }
}`;
const referenceFields = `
  ... on Issue { __typename number title issueState: state }
  ... on PullRequest { __typename number title prState: state }
`;
export const REPOSITORY_REFERENCES_QUERY = `query($search: String!, $owner: String!, $name: String!, $number: Int!, $exact: Boolean!) {
  repository(owner: $owner, name: $name) @include(if: $exact) {
    issueOrPullRequest(number: $number) { ${referenceFields} }
  }
  search(type: ISSUE, query: $search, first: 20) { nodes { ${referenceFields} } }
}`;

const mentionAnswer = decodeJsonResult(
  Schema.Struct({
    data: Schema.Struct({
      repository: Schema.Struct({
        mentionableUsers: Schema.Struct({ nodes: Schema.Array(PullRequestActor) }),
      }),
    }),
  }),
);
const issue = Schema.Struct({
  __typename: Schema.Literal("Issue"),
  number: Schema.Int,
  title: Schema.String,
  issueState: Schema.Literals(["OPEN", "CLOSED"]),
});
const pr = Schema.Struct({
  __typename: Schema.Literal("PullRequest"),
  number: Schema.Int,
  title: Schema.String,
  prState: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
});
const referenceAnswer = decodeJsonResult(
  Schema.Struct({
    data: Schema.Struct({
      repository: Schema.optional(
        Schema.NullOr(
          Schema.Struct({ issueOrPullRequest: Schema.NullOr(Schema.Union([issue, pr])) }),
        ),
      ),
      search: Schema.Struct({ nodes: Schema.Array(Schema.Union([issue, pr])) }),
    }),
  }),
);
export const decodeMentions = (raw: string) =>
  Result.map(mentionAnswer(raw), (answer): PullRequestCompletions => ({
    authors: answer.data.repository.mentionableUsers.nodes,
    references: [],
  }));
export const decodeReferences = (raw: string) =>
  Result.map(referenceAnswer(raw), ({ data }): PullRequestCompletions => {
    const exact = data.repository?.issueOrPullRequest;
    const nodes = exact
      ? [exact, ...data.search.nodes.filter((node) => node.number !== exact.number)]
      : data.search.nodes;
    return {
      authors: [],
      references: nodes.map((node): PullRequestReferenceCandidate => {
        const state = node.__typename === "Issue" ? node.issueState : node.prState;
        return {
          reference: `#${node.number}`,
          number: node.number,
          title: node.title,
          kind: node.__typename === "Issue" ? "issue" : "change-request",
          state: state === "MERGED" ? "merged" : state === "OPEN" ? "open" : "closed",
        };
      }),
    };
  });
