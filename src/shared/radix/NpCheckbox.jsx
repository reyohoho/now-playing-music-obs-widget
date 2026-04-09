import { Checkbox, Text } from "@radix-ui/themes";

export function NpCheckbox({ checked, onCheckedChange, label, disabled = false }) {
  return (
    <label className="np-field-checkbox">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        disabled={disabled}
        variant="classic"
      />
      {label ? <Text>{label}</Text> : null}
    </label>
  );
}
