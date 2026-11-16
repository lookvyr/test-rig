# Private secret cards

Adapted from upstream T3's `SecretRequests` and `SecretRequestCard` implementation.
Test Rig retains the request lifecycle but uses browser form entry as its first
consumer instead of upstream webhook signing.

`request_secret` records a metadata-only `secret_request` turn item and waits for
its saved, declined, or cancelled status. The authenticated `secrets.answerRequest`
RPC sends the value directly to `ServerSecretStore`. The internal record command
cannot be called through the client orchestration API. Pending cards participate
in the existing pending-input summary; inherited cards cannot be answered.

Stored refs are project-scoped, expire after 24 hours, and must be deleted before
consumption returns a value. Answers, consumption, and expiry cleanup share a
lock; saves use the store's atomic replacement. Files inherit the existing
permission-protected plaintext storage (0700 directory, 0600 files), not encryption.

## File delivery and pasted values

Ported from upstream T3. A card with `delivery: "file"` tells the user that the
agent's own commands can read the value. Once the user saves it, the server
writes the value to an owner-only file under `<secretsDir>/files` and returns the
path instead of a ref. Only a saved `file` card can be written out this way.

A secret the user already pasted in the thread goes to `request_secret` as
`value`, with no card. The server writes it straight to such a file and returns
the path; `delivery: "secretRef"` is refused for a pasted value, since the value
is already in the transcript.

Files are written to a `.partial` name with exclusive create and mode 0600 in a
0700 directory, then renamed. The stored copy of a card's value is removed only
after its file is complete, so the file is the one remaining copy. A retry with
the same `clientRequestId` returns the file the first call wrote, unchanged, so a
command that already holds the path never reads a different value. Files share
the store's lock and are deleted by the same sweep after 24 hours.

`preview_type_secret` accepts a ref plus explicit tab and locator. The server
derives the project from the authenticated calling thread and resolves the ref.
The distinct `typeSecret` operation requires a host advertising support; legacy
hosts cannot silently receive it as ordinary typing. Server and native hosts
reuse their existing typing implementation, suppress raw private errors before
recording action history, and return no value. Native typing disables inner
tracing before converting failures to a fixed safe error.

The private form does not use persisted composer state or general failure
reporting. Contract decoding errors use fixed messages; input values preserve
whitespace. Browser content itself remains observable: the feature does not
isolate a filled secret from later page evaluation, screenshots, or site behavior.
