import { Button, Checkbox, Popover, Text } from "@radix-ui/themes";

const SOURCE_BADGE_TONES = {
  youtube: { bg: "var(--red-a4)", fg: "var(--red-11)" },
  "youtube-music": { bg: "var(--ruby-a4)", fg: "var(--ruby-11)" },
  spotify: { bg: "var(--green-a4)", fg: "var(--green-11)" },
  "yandex-music": { bg: "var(--amber-a4)", fg: "var(--amber-11)" },
  soundcloud: { bg: "var(--orange-a4)", fg: "var(--orange-11)" },
  vk: { bg: "var(--indigo-a4)", fg: "var(--indigo-11)" },
  zvuk: { bg: "var(--cyan-a4)", fg: "var(--cyan-11)" },
};

const GENERIC_BADGE_TONES = {
  broadcaster: { bg: "var(--red-a4)", fg: "var(--red-11)" },
  moderator: { bg: "var(--green-a4)", fg: "var(--green-11)" },
  vip: { bg: "var(--pink-a4)", fg: "var(--pink-11)" },
  subscriber: { bg: "var(--blue-a4)", fg: "var(--blue-11)" },
};

const FALLBACK_BADGE_TONE = {
  bg: "var(--gray-a4)",
  fg: "var(--gray-11)",
};

function normalizeMultiOptions(options = []) {
  return options
    .map((option) => {
      if (typeof option === "string") {
        const value = option.trim();
        return value ? { value, label: value } : null;
      }
      const value = String(option?.value || "").trim();
      if (!value) return null;
      const label = String(option?.label || value).trim() || value;
      return { value, label };
    })
    .filter(Boolean);
}

function summaryFromOptions(values, optionMap, placeholder) {
  const selected = Array.isArray(values) ? values : [];
  if (!selected.length) return placeholder;
  return selected.map((value) => optionMap.get(value) || value).join(", ");
}

function toneForValue(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key.startsWith("wrapper:")) {
    return { bg: "var(--blue-a4)", fg: "var(--blue-11)" };
  }
  return SOURCE_BADGE_TONES[key] || GENERIC_BADGE_TONES[key] || FALLBACK_BADGE_TONE;
}

export function NpMultiSelect({
  value = [],
  options = [],
  onChange,
  disabled = false,
  placeholder = "—",
  popoverClassName = "",
  popoverContainer,
}) {
  const selected = Array.isArray(value) ? value : [];
  const selectedSet = new Set(selected);
  const normalizedOptions = normalizeMultiOptions(options);
  const optionMap = new Map(normalizedOptions.map((option) => [option.value, option.label]));
  const popoverContentClassName = ["np-multi-popover", String(popoverClassName || "").trim()]
    .filter(Boolean)
    .join(" ");

  const toggleValue = (nextValue) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(nextValue)) next.delete(nextValue);
    else next.add(nextValue);
    onChange(Array.from(next));
  };

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="surface" color="gray" disabled={disabled} className="np-multi-trigger">
          {selected.length ? (
            <span className="np-multi-trigger__chips">
              {selected.map((itemValue) => {
                const tone = toneForValue(itemValue);
                return (
                  <span
                    key={itemValue}
                    className="np-multi-chip"
                    style={{
                      "--np-chip-bg": tone.bg,
                      "--np-chip-fg": tone.fg,
                    }}
                  >
                    {optionMap.get(itemValue) || itemValue}
                  </span>
                );
              })}
            </span>
          ) : (
            <span className="np-multi-trigger__placeholder">
              {summaryFromOptions(selected, optionMap, placeholder)}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        className={popoverContentClassName}
        sideOffset={6}
        container={popoverContainer}
      >
        <div className="np-multi-list">
          {normalizedOptions.map((option) => (
            <label key={option.value} className="np-field-checkbox">
              <Checkbox
                checked={selectedSet.has(option.value)}
                onCheckedChange={() => toggleValue(option.value)}
                variant="classic"
                disabled={disabled}
              />
              <Text size="2">{option.label}</Text>
            </label>
          ))}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
