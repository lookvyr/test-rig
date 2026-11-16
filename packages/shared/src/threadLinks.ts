import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Thread links agents write in replies: `t3-thread://v2/<environmentId>/<threadId>`, or
 * `t3-thread://v1/<threadId>` without an environment. Chat renders them as thread chips.
 * The scheme matches upstream T3 Code so links stay readable across both apps.
 */
export const THREAD_LINK_PROTOCOL = "t3-thread";
const V1_PREFIX = `${THREAD_LINK_PROTOCOL}://v1/`;
const V2_PREFIX = `${THREAD_LINK_PROTOCOL}://v2/`;

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

/** A v1 link names no environment; the message's own stands in. */
export interface ThreadLink {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId;
}

/** The ids as written. Thread ids can hold percent escapes of their own, so they are not decoded. */
export function parseThreadLinkHref(href: string): ThreadLink | null {
  if (href.startsWith(V1_PREFIX)) {
    const threadId = Option.getOrNull(decodeThreadId(href.slice(V1_PREFIX.length)));
    return threadId === null ? null : { environmentId: null, threadId };
  }
  if (!href.startsWith(V2_PREFIX)) return null;
  const path = href.slice(V2_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const environmentId = Option.getOrNull(decodeEnvironmentId(path.slice(0, slash)));
  const threadId = Option.getOrNull(decodeThreadId(path.slice(slash + 1)));
  return environmentId === null || threadId === null ? null : { environmentId, threadId };
}

function threadLinkHref(link: ThreadLink): string {
  return link.environmentId === null
    ? `${V1_PREFIX}${link.threadId}`
    : `${V2_PREFIX}${link.environmentId}/${link.threadId}`;
}

const linkLabel = (label: string | undefined) =>
  label
    ?.replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A Markdown link to the thread. Without a label, an autolink: chat shows the current title. */
export function formatThreadLink(ref: ThreadLink, label?: string): string {
  const cleaned = linkLabel(label);
  const href = threadLinkHref(ref);
  const destination = /[()]/.test(href) ? `<${href}>` : href;
  return cleaned ? `[${cleaned}](${destination})` : `<${href}>`;
}
