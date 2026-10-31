import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Popover, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipTrigger } from "./ui/tooltip";

describe("context chip composition", () => {
  it("keeps its styling marker when a tooltip owns the link's data-slot", () => {
    const markup = renderToStaticMarkup(
      <Tooltip>
        <TooltipTrigger render={<ContextChip kind="thread" render={<a href="/thread" />} />}>
          <ContextChipLabel>Related thread</ContextChipLabel>
        </TooltipTrigger>
      </Tooltip>,
    );
    const trigger = markup.match(/<a\b[^>]*>/)?.[0];
    expect(trigger).toContain('data-slot="tooltip-trigger"');
    expect(trigger).toContain('data-context-chip=""');
  });

  it("keeps its styling marker when a popover owns the button's data-slot", () => {
    const markup = renderToStaticMarkup(
      <Popover>
        <PopoverTrigger render={<ContextChip kind="terminal" render={<button type="button" />} />}>
          <ContextChipLabel>Terminal excerpt</ContextChipLabel>
        </PopoverTrigger>
      </Popover>,
    );
    const trigger = markup.match(/<button\b[^>]*>/)?.[0];
    expect(trigger).toContain('data-slot="popover-trigger"');
    expect(trigger).toContain('data-context-chip=""');
  });
});
