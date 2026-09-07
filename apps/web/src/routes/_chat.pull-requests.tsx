import { createFileRoute } from "@tanstack/react-router";
import { PullRequestWorkspace } from "../components/pull-requests/PullRequestWorkspace";

export const Route = createFileRoute("/_chat/pull-requests")({ component: PullRequestWorkspace });
