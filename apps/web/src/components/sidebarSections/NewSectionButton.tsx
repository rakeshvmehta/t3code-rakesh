import { ListPlusIcon } from "lucide-react";

import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";

export function NewSectionButton(props: { onClick: () => void }) {
  return (
    <SidebarHeaderIconButton label="New section" onClick={props.onClick}>
      <ListPlusIcon />
    </SidebarHeaderIconButton>
  );
}
