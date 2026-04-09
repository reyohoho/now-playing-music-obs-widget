import { Card, Heading, RadioGroup, Text } from "@radix-ui/themes";
import { NpCheckbox, NpSelect } from "@/shared/radix";

export function PersonalizationSection({
  uiLocale,
  themeAppearance,
  themeAccentColor,
  showNowPlayingBlockInPopup,
  liveVideoCoversInPopup,
  allowGenericWebInjection,
  accentColors = [],
  onUiLocaleChange,
  onThemeAppearanceChange,
  onThemeAccentColorChange,
  onShowNowPlayingBlockChange,
  onLiveVideoCoversInPopupChange,
  onAllowGenericWebInjectionChange,
  t,
}) {
  return (
    <Card className="panel c-stack">
      <Heading size="5">{t("options.sections.personalization")}</Heading>
      <label className="field">
        <Text color="gray">{t("options.personalization.language")}</Text>
        <NpSelect
          value={uiLocale}
          onValueChange={onUiLocaleChange}
          options={[
            { value: "ru", label: t("options.personalization.languages.ru") },
            { value: "en", label: t("options.personalization.languages.en") },
          ]}
        />
      </label>

      <label className="field">
        <Text color="gray">{t("options.personalization.themeMode")}</Text>
        <NpSelect
          value={themeAppearance}
          onValueChange={onThemeAppearanceChange}
          options={[
            { value: "system", label: t("options.personalization.themeModes.system") },
            { value: "light", label: t("options.personalization.themeModes.light") },
            { value: "dark", label: t("options.personalization.themeModes.dark") },
          ]}
        />
      </label>

      <NpCheckbox
        checked={showNowPlayingBlockInPopup !== false}
        onCheckedChange={onShowNowPlayingBlockChange}
        label={t("options.personalization.showNowPlayingBlockInPopup")}
      />
      <NpCheckbox
        checked={liveVideoCoversInPopup === true}
        onCheckedChange={onLiveVideoCoversInPopupChange}
        label={t("options.personalization.liveVideoCoversInPopup")}
      />
      <NpCheckbox
        checked={allowGenericWebInjection !== false}
        onCheckedChange={onAllowGenericWebInjectionChange}
        label={t("options.personalization.allowGenericWebInjection")}
      />
      <Text as="span" size="1" color="gray">
        {t("options.personalization.allowGenericWebInjectionHint")}
      </Text>

      <div className="field">
        <Text color="gray">{t("options.personalization.accentColor")}</Text>
        <RadioGroup.Root
          id="themeAccentSwatches"
          className="accent-grid"
          value={themeAccentColor}
          onValueChange={onThemeAccentColorChange}
          aria-label={t("options.personalization.accentColor")}
        >
          {accentColors.map((color) => (
            <RadioGroup.Item
              key={color}
              className="accent-swatch__item"
              value={color}
              title={color}
              aria-label={color}
              style={{
                "--np-accent-swatch-bg": `var(--${color}-3)`,
                "--np-accent-swatch-dot": `var(--${color}-9)`,
              }}
            >
              <span className="accent-swatch__dot" />
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>
    </Card>
  );
}
