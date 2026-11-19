import { useGT } from "gt-react";
import { ListPlusIcon } from "lucide-react";

import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";

export function NewSectionButton(props: { onClick: () => void }) {
  const gt = useGT();
  return (
    <SidebarHeaderIconButton label={gt("New section")} onClick={props.onClick}>
      <ListPlusIcon />
    </SidebarHeaderIconButton>
  );
}
