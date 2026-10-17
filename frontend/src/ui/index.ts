// The entry of the new interface's kit: fonts, tokens, then the components.
// It deliberately does not import reset.css; the entry that owns the page does.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/noto-sans-sc";
import "./tokens.css";

export * from "./theme";
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Spinner } from "./Spinner";
export { Kbd } from "./Kbd";
export { Floating, type DismissReason, type FloatingProps } from "./Floating";
export { Tooltip, type TooltipProps } from "./Tooltip";
export { Dialog, type DialogProps } from "./Dialog";
export {
  Menu,
  MenuList,
  type MenuEntry,
  type MenuListProps,
  type MenuProps,
  type MenuTriggerProps,
} from "./Menu";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./SegmentedControl";
export {
  placeFloating,
  type Align,
  type Placement,
  type Rect,
  type Side,
} from "./position";
export {
  TextArea,
  TextField,
  type TextAreaProps,
  type TextFieldProps,
} from "./Field";
export * from "./shortcut";
