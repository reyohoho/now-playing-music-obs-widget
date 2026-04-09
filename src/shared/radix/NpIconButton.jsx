import { IconButton } from "@radix-ui/themes";

export function NpIconButton({ children, ...props }) {
  return (
    <IconButton variant="ghost" radius="full" {...props}>
      {children}
    </IconButton>
  );
}
