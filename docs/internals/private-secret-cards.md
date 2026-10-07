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
