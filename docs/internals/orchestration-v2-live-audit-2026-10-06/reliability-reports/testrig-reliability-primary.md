# Contracts and styled composer boundary repairs

R25: Added stored-mark stepping at an inline formatting boundary to the existing editor's Left/Right handling. Native Code's default space-inserting exit is disabled; no marker-decoration framework was imported. Selection ranges and explicitly chosen marks retain their behavior. Thirty-six document-model tests pass. Integrated browser keyboard proof at both paragraph boundaries produced `<p>plain <strong>bold</strong> tail</p>` and `<p>tail <strong>bold</strong> plain</p>`; the unsent fixture was cleared afterward.

R32: TrimmedNonEmptyString validates trimmed length when making/encoding as well as decoding, preventing whitespace-only identifiers from encoding into undecodable empty strings.

R33: ForwardCompatibleArray retains explicit element transformations, catches per-element encoding/decoding failures, rejects holes as application values, and filters wire holes. The outer unknown-array wire boundary is retained because installed Effect rc115 RPC Exit JSON decoding validates its representation before tolerant member decoding. Tests cover explicit DateTimeUtcFromString and finite numeric transforms through direct JSON and RPC Exit boundaries. All current production members use JSON-native fields. Automatic native-DateTime JSON derivation behind this pre-existing unknown boundary is not a newly promised feature.

Composer optional record fields use optionalKey so explicit undefined does not discard a valid record. Unknown records must contain bounded JSON values; NaN, Date, bigint, and undefined object values do not silently pass through stringify. Actual message.dispatch encode/decode tests prove one malformed record does not cost a valid mention sibling. No new unknown-union framework or dependency upgrade was added.

The previous filePreview failures were stale fixtures. Owning callsites supply literal paths, so query/hash-looking suffixes stay part of the filename and do not turn an unsupported extension into a supported one. Eighteen tests pass without production changes.

Focused primary verification: 126 tests in seven contracts/RPC files passed; 36 composer-document tests and18 filePreview tests passed separately. Integrated frontend/shared/contracts verification later passed642 tests in54 changed test files. Scoped web, desktop, contracts, client-runtime, and shared typechecks passed. Independent source review cleared the final contract composition and stored-mark changes. Final server/live acceptance is recorded by the aggregate report.
