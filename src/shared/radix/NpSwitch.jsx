import { Switch, Text } from "@radix-ui/themes";

export function NpSwitch({ checked, onCheckedChange, label, disabled = false }) {
  return (
    <label className="np-field-switch">
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        variant="classic"
        radius="full"
      />
      <Text>{label}</Text>
    </label>
  );
}
