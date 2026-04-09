import { Select } from "@radix-ui/themes";

export function NpSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "—",
  size = "2",
  contentClassName = "",
  contentPosition,
  contentSide,
  contentAlign,
  contentSideOffset,
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger size={size} placeholder={placeholder} />
      <Select.Content
        className={contentClassName}
        position={contentPosition}
        side={contentSide}
        align={contentAlign}
        sideOffset={contentSideOffset}
      >
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
