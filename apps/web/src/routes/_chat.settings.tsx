import { RotateCcwIcon } from "lucide-react";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import { MOVED_SETTINGS_PATHS } from "../components/settings/settingsSearch";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { SETTINGS_SCOPED_PATHS } from "../components/settings/SettingsScopeSentence";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { validateSettingsRouteSearch } from "../components/settings/settingsScopeNavigation";
import { useSettingsRestore } from "../components/settings/SettingsPanels";
import { Button } from "../components/ui/button";

function RestoreDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);

  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      <span className="max-sm:sr-only">Restore device defaults</span>
    </Button>
  );
}

/** A scope that cannot be written to replaces the page instead of silently writing elsewhere. */
function SettingsScopeBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  if (!SETTINGS_SCOPED_PATHS.has(pathname)) return children;
  if (scope.kind === "unavailable") {
    return (
      <SettingsPageContainer>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">{scope.message}</p>
      </SettingsPageContainer>
    );
  }
  if (scope.kind === "environment" && connectedEnvironments.length === 0) {
    return (
      <SettingsPageContainer>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          Reconnect {scope.label} to change its settings.
        </p>
      </SettingsPageContainer>
    );
  }
  return children;
}

function SettingsContentLayout() {
  const location = useLocation();
  const { search } = useSettingsScope();
  const [restoreSignal, setRestoreSignal] = useState(0);
  return (
    <AppRouteModal label="Settings">
      <div className="relative flex min-h-0 flex-1">
        <SettingsSidebarNav pathname={location.pathname} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            <SettingsBreadcrumb pathname={location.pathname} />
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {location.pathname === "/settings/general" ? (
                <RestoreDefaultsButton onRestored={() => setRestoreSignal((value) => value + 1)} />
              ) : null}
              <AppRouteModalClose />
            </div>
          </header>
          <div
            key={`${JSON.stringify(search)}:${restoreSignal}`}
            className="flex min-h-0 flex-1 flex-col"
          >
            <SettingsScopeBoundary pathname={location.pathname}>
              <Outlet />
            </SettingsScopeBoundary>
          </div>
        </div>
      </div>
    </AppRouteModal>
  );
}

function SettingsRouteLayout() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SettingsScopeProvider
      search={search}
      deviceOnly={!SETTINGS_SCOPED_PATHS.has(pathname)}
      onChange={(next) => {
        void navigate({
          to: pathname,
          search: () => ({
            project: next.project,
            machine: next.machine,
            checkout: next.checkout,
          }),
          hash: "",
          resetScroll: false,
        });
      }}
    >
      <SettingsContentLayout />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  validateSearch: validateSettingsRouteSearch,
  beforeLoad: async ({ context, location }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
    const moved = MOVED_SETTINGS_PATHS[location.pathname];
    if (moved) throw redirect({ to: moved, hash: true, replace: true });
  },
  component: SettingsRouteLayout,
});
