import type { ServerSettings } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { Switch } from "../ui/switch";
import { useScopedSettingsMixed } from "./useScopedSettings";

/** A switch for a scoped server setting; it reads off while the selected targets disagree. */
export function ScopedSwitch({
  settingKeys,
  checked,
  ...props
}: ComponentProps<typeof Switch> & { settingKeys: readonly (keyof ServerSettings)[] }) {
  const mixed = useScopedSettingsMixed(settingKeys);
  return <Switch {...props} data-mixed={mixed || undefined} checked={mixed ? false : checked} />;
}
