import { NpMultiSelect } from "@/shared/radix/NpMultiSelect";

export function NpRolesMultiSelect({ value = [], options = [], onChange, disabled = false }) {
  return (
    <NpMultiSelect
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      placeholder="—"
    />
  );
}
