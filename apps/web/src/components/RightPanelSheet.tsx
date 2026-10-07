import { type ReactNode } from "react";

import { RIGHT_PANEL_SHEET_CLASS_NAME, RIGHT_PANEL_SHEET_LAYER } from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  /** The desktop guest lives outside the portal and must remain interactive. */
  modal?: boolean;
}) {
  return (
    <Sheet
      open={props.open}
      modal={props.modal ?? true}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="right"
        layer={RIGHT_PANEL_SHEET_LAYER}
        showCloseButton={false}
        keepMounted
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
