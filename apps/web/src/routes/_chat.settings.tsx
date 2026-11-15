import { RotateCcwIcon } from "lucide-react";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import { MOVED_SETTINGS_PATHS } from "../components/settings/settingsSearch";
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

function SettingsContentLayout() {
  const location = useLocation();
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
          <div key={restoreSignal} className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        </div>
      </div>
    </AppRouteModal>
  );
}

function SettingsRouteLayout() {
  return <SettingsContentLayout />;
}

export const Route = createFileRoute("/_chat/settings")({
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
