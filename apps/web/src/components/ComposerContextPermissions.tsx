import type { RuntimeMode } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";

import { runtimeModeConfig, runtimeModeOptions } from "./chat/runtimeModeConfig";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";

/**
 * The new-thread strip's permissions control. It names the mode the first send uses, so the
 * composer footer hides its own permissions chip while the strip shows this one.
 */
export function ComposerContextPermissions(props: {
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const { icon: Icon, label } = runtimeModeConfig[props.runtimeMode];
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="ms-auto min-w-0 shrink-0 text-muted-foreground/70 hover:text-foreground/80"
            aria-label={`Permissions: ${label}`}
          />
        }
      >
        <Icon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
        <span
          data-composer-label
          className="min-w-0 max-w-[240px] truncate transition-[max-width,opacity] duration-300 ease-out group-data-[compact]/composer-context:max-w-0 group-data-[compact]/composer-context:opacity-0"
        >
          {label}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup side="top" align="end">
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Permissions</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (value !== props.runtimeMode) props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <MenuRadioItem key={mode} value={mode} closeOnClick className="min-w-64 py-2">
                <span className="grid min-w-0 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    {option.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {option.description}
                  </span>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
