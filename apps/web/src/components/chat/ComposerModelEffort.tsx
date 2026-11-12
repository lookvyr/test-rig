import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import { CheckIcon, ZapIcon } from "lucide-react";
import { createContext, type KeyboardEvent, type ReactNode, use } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerTraitsInput } from "./composerProviderState";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig";
import {
  getComposerEffortSummary,
  getReasoningDescriptor,
  useTraitsSelection,
} from "./TraitsPicker";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

/** What a docked effort column needs from its picker: the model it serves. */
export const DockedPickerContext = createContext<{ modelLabel: string }>({ modelLabel: "" });

/** Service tiers and Claude's Fast mode sit in the footer; every other trait sits in the column. */
function isSpeedDescriptor(descriptor: ProviderOptionDescriptor) {
  return (
    (descriptor.type === "select" && descriptor.id === "serviceTier") ||
    (descriptor.type === "boolean" && descriptor.id === "fastMode")
  );
}

/**
 * What the model trigger shows after the model name: the effort word, a bolt for Fast, and the
 * context window. `detail` names every trait for the tooltip and screen readers.
 */
export function describeComposerEffort(traits: ComposerTraitsInput | null): {
  suffix: ReactNode;
  detail: string | null;
} {
  const summary = traits ? getComposerEffortSummary(traits) : null;
  if (!summary) return { suffix: null, detail: null };
  if (!summary.word && !summary.fast && !summary.contextWindow) {
    return { suffix: null, detail: summary.detail || null };
  }
  return {
    detail: summary.detail || null,
    suffix: (
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {summary.word ? <span className="max-w-24 truncate">{summary.word}</span> : null}
        {summary.fast ? (
          <>
            <ZapIcon aria-hidden="true" className="size-3 fill-current" />
            <span className="sr-only">Fast mode on</span>
          </>
        ) : null}
        {summary.contextWindow ? (
          <span className="max-w-24 truncate text-xs">{summary.contextWindow}</span>
        ) : null}
      </span>
    ),
  };
}

const COLUMN_ROW =
  "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-64";
const COLUMN_LABEL = "px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs";

function ColumnRow(props: {
  label: string;
  selected: boolean;
  isDefault?: boolean | undefined;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      disabled={props.disabled}
      data-effort-row
      className={COLUMN_ROW}
      onClick={props.onPick}
    >
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.selected ? (
        <>
          {props.isDefault ? <span className="sr-only">Default</span> : null}
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </>
      ) : props.isDefault ? (
        <span className="text-muted-foreground/70 text-xs">Default</span>
      ) : null}
    </button>
  );
}

/** Up and Down move between the column's rows. */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-effort-row]:not(:disabled)"),
  );
  const index = rows.findIndex((row) => row === document.activeElement);
  const next =
    rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

type TraitsSelection = ReturnType<typeof useTraitsSelection>;

function SelectRows(props: {
  descriptor: SelectDescriptor;
  traits: TraitsSelection;
  showLabel: boolean;
}) {
  const { descriptor, traits } = props;
  const { selected } = traits;
  const locked =
    descriptor.id === selected.primarySelectDescriptor?.id && selected.ultrathinkInBodyText;
  const value = traits.selectValue(descriptor);
  return (
    <div role="radiogroup" aria-label={descriptor.label} className="flex flex-col gap-0.5">
      {props.showLabel ? <div className={COLUMN_LABEL}>{descriptor.label}</div> : null}
      {locked ? (
        <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
          Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change this option.
        </div>
      ) : null}
      {descriptor.options.map((option) => (
        <ColumnRow
          key={option.id}
          label={option.label}
          selected={option.id === value}
          isDefault={option.isDefault}
          disabled={locked}
          onPick={() => traits.changeSelect(descriptor, option.id)}
        />
      ))}
    </div>
  );
}

function BooleanRows(props: {
  descriptor: BooleanDescriptor;
  traits: TraitsSelection;
  showLabel: boolean;
}) {
  const { descriptor, traits } = props;
  return (
    <div role="radiogroup" aria-label={descriptor.label} className="flex flex-col gap-0.5">
      {props.showLabel ? <div className={COLUMN_LABEL}>{descriptor.label}</div> : null}
      {([true, false] as const).map((value) => (
        <ColumnRow
          key={String(value)}
          label={value ? "On" : "Off"}
          selected={(descriptor.currentValue === true) === value}
          onPick={() => traits.changeBoolean(descriptor.id, value)}
        />
      ))}
    </div>
  );
}

function DescriptorRows(props: {
  descriptor: ProviderOptionDescriptor;
  traits: TraitsSelection;
  showLabel: boolean;
}) {
  return props.descriptor.type === "select" ? (
    <SelectRows descriptor={props.descriptor} traits={props.traits} showLabel={props.showLabel} />
  ) : (
    <BooleanRows descriptor={props.descriptor} traits={props.traits} showLabel={props.showLabel} />
  );
}

function NoEffortRow() {
  return (
    <div className="flex h-8 items-center px-2 text-muted-foreground text-sm">No effort levels</div>
  );
}

function EffortColumnBody(props: { traits: ComposerTraitsInput }) {
  const traits = useTraitsSelection(props.traits);
  const reasoning = getReasoningDescriptor(traits.selected);
  const others = traits.selected.descriptors.filter(
    (descriptor) => descriptor !== reasoning && !isSpeedDescriptor(descriptor),
  );
  if (!reasoning && others.length === 0) return <NoEffortRow />;
  return (
    <>
      {reasoning ? (
        <DescriptorRows descriptor={reasoning} traits={traits} showLabel={false} />
      ) : null}
      {others.map((descriptor, index) => (
        <div
          key={descriptor.id}
          className={cn((reasoning || index > 0) && "mt-1 border-t border-border/70 pt-1")}
        >
          <DescriptorRows descriptor={descriptor} traits={traits} showLabel />
        </div>
      ))}
    </>
  );
}

/** The model picker's effort column: the selected model's reasoning levels and other traits. */
export function ComposerEffortColumn(props: { traits: ComposerTraitsInput | null }) {
  const picker = use(DockedPickerContext);
  return (
    <>
      <div className="shrink-0 px-3 pt-2.5">
        <div className="flex h-8.25 items-center gap-2 border-b border-border/70 pb-1.5 text-sm">
          <span className="text-muted-foreground">Effort</span>
          <span className="ms-auto min-w-0 truncate text-muted-foreground text-xs">
            {picker.modelLabel}
          </span>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2.5 pb-1.5"
        onKeyDownCapture={moveBetweenRows}
      >
        {props.traits ? <EffortColumnBody traits={props.traits} /> : <NoEffortRow />}
      </div>
    </>
  );
}

const FOOTER_SEGMENT =
  "flex h-6 cursor-pointer items-center justify-center gap-1 px-2 text-muted-foreground text-xs outline-none first:rounded-l-md last:rounded-r-md hover:text-foreground data-checked:bg-input/72 data-checked:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function Segment(props: {
  checked: boolean;
  label: string;
  tooltip?: string | undefined;
  children: ReactNode;
  onPick: () => void;
}) {
  const buttonProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.checked,
    "aria-label": props.label,
    "data-checked": props.checked || undefined,
    className: FOOTER_SEGMENT,
    onClick: props.onPick,
  } as const;
  if (!props.tooltip) return <button {...buttonProps}>{props.children}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...buttonProps} />}>{props.children}</TooltipTrigger>
      <TooltipPopup side="top" className="max-w-64">
        {props.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

function SpeedControl(props: { traits: ComposerTraitsInput }) {
  const traits = useTraitsSelection(props.traits);
  const speed = traits.selected.descriptors.find(isSpeedDescriptor);
  if (!speed) return null;
  return (
    <div role="radiogroup" aria-label={speed.label} className="flex rounded-lg bg-input/40 p-0.5">
      {speed.type === "select"
        ? speed.options.map((option) => (
            <Segment
              key={option.id}
              checked={option.id === traits.selectValue(speed)}
              label={option.label}
              onPick={() => traits.changeSelect(speed, option.id)}
            >
              {option.label === "Fast" ? (
                <ZapIcon aria-hidden="true" className="size-3 fill-current" />
              ) : null}
              {option.label}
            </Segment>
          ))
        : ([false, true] as const).map((value) => (
            <Segment
              key={String(value)}
              checked={(speed.currentValue === true) === value}
              label={value ? "Fast" : "Standard"}
              onPick={() => traits.changeBoolean(speed.id, value)}
            >
              {value ? <ZapIcon aria-hidden="true" className="size-3 fill-current" /> : null}
              {value ? "Fast" : "Standard"}
            </Segment>
          ))}
    </div>
  );
}

/** The thread's permission mode as one row of icons, with the current mode named beside it. */
function PermissionsControl(props: {
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const current = runtimeModeConfig[props.runtimeMode];
  return (
    <div className="ms-auto flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{current.label}</span>
      <div role="radiogroup" aria-label="Permissions" className="flex rounded-lg bg-input/40 p-0.5">
        {runtimeModeOptions.map((mode) => {
          const option = runtimeModeConfig[mode];
          const OptionIcon = option.icon;
          return (
            <Segment
              key={mode}
              checked={mode === props.runtimeMode}
              label={option.label}
              tooltip={`${option.label}: ${option.description}`}
              onPick={() => {
                if (mode !== props.runtimeMode) props.onRuntimeModeChange(mode);
              }}
            >
              <OptionIcon aria-hidden="true" className="size-3.5" />
            </Segment>
          );
        })}
      </div>
    </div>
  );
}

/** The model picker's footer: speed where the model has it, and the thread's permissions. */
export function ComposerPickerFooter(props: {
  traits: ComposerTraitsInput | null;
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/40 px-3 py-2">
      {props.traits ? <SpeedControl traits={props.traits} /> : null}
      <PermissionsControl
        runtimeMode={props.runtimeMode}
        onRuntimeModeChange={props.onRuntimeModeChange}
      />
    </div>
  );
}
