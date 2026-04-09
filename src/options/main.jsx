import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Badge, Heading, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { PROVIDERS } from "@/shared/providers";
import { formatServiceStatus } from "@/shared/i18n/index";
import { mountToastHost, showToast } from "@/options/toastHost";
import { WrapperSourcesSection } from "@/options/components/WrapperSourcesSection";
import { TwitchSection } from "@/options/components/TwitchSection";
import { StatusSection } from "@/options/components/StatusSection";
import { ObsSection } from "@/options/components/ObsSection";
import { PersonalizationSection } from "@/options/components/PersonalizationSection";
import { DebugSection } from "@/options/components/DebugSection";
import {
  RADIX_ACCENTS,
  normalizeAccentColor,
  normalizeAppearance,
  normalizeUiLocale,
  resolveAppearance,
} from "@/options/optionsModel";
import { useOptionsSettings } from "@/options/hooks/useOptionsSettings";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function formatTwitchStatus(status, locale) {
  return formatServiceStatus("twitch", status, locale);
}

function formatTwitchLog(entries, locale) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return entries
    .slice(0, 30)
    .map((entry) => {
      const time = new Date(entry.at || Date.now()).toLocaleTimeString(locale);
      return `[${time}] ${String(entry.level || "info").toUpperCase()} ${entry.text || ""}`;
    })
    .join("\n");
}

function OptionsApp() {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(COLOR_SCHEME_QUERY).matches);
  const {
    model,
    obsStatus,
    twitchStatus,
    twitchLog,
    diagnostics,
    activeSnapshot,
    routerValidation,
    connectionError,
    resolvedUiLocale,
    t,
    updateModel,
    updateObs,
    updateTwitch,
    updateRouter,
    updateCommand,
    onObsReconnect,
    onTwitchReconnect,
    onStartTwitchOAuth,
  } = useOptionsSettings({ showToast });

  const resolvedAppearance = useMemo(
    () => resolveAppearance(model.themeAppearance, systemDark),
    [model.themeAppearance, systemDark]
  );

  useEffect(() => {
    document.body.dataset.accentColor = normalizeAccentColor(model.themeAccentColor);
    try {
      localStorage.setItem("nph.themeAppearance", normalizeAppearance(model.themeAppearance));
      localStorage.setItem("nph.themeAccentColor", normalizeAccentColor(model.themeAccentColor));
    } catch {
      // ignore
    }
  }, [model.themeAppearance, model.themeAccentColor]);

  useEffect(() => {
    const mq = window.matchMedia(COLOR_SCHEME_QUERY);
    const onChange = () => setSystemDark(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const sourceOptions = useMemo(
    () =>
      PROVIDERS.map((provider) => ({
        value: provider.id,
        label: provider.label || provider.id,
      })),
    []
  );

  return (
    <Theme
      appearance={resolvedAppearance}
      accentColor={normalizeAccentColor(model.themeAccentColor)}
      grayColor="slate"
      panelBackground="solid"
      scaling="95%"
      radius="medium"
      hasBackground
    >
      <main className="c-page c-stack c-stack--lg">
        <section className="c-cluster c-cluster--space">
          <Heading size="8">{t("options.title")}</Heading>
          {connectionError ? <Badge color="red">{connectionError}</Badge> : null}
        </section>

        <StatusSection
          trackingEnabled={model.trackingEnabled}
          onTrackingChange={(checked) => updateModel({ trackingEnabled: checked })}
          obsStatus={obsStatus}
          twitchStatus={twitchStatus}
          activeSnapshot={activeSnapshot}
          locale={resolvedUiLocale}
          t={t}
        />

        <PersonalizationSection
          uiLocale={normalizeUiLocale(model.uiLocale)}
          themeAppearance={normalizeAppearance(model.themeAppearance)}
          themeAccentColor={model.themeAccentColor}
          showNowPlayingBlockInPopup={model.showNowPlayingBlockInPopup}
          liveVideoCoversInPopup={model.liveVideoCoversInPopup}
          allowGenericWebInjection={model.allowGenericWebInjection}
          accentColors={RADIX_ACCENTS}
          onUiLocaleChange={(value) => updateModel({ uiLocale: normalizeUiLocale(value) })}
          onThemeAppearanceChange={(value) => updateModel({ themeAppearance: value })}
          onThemeAccentColorChange={(value) => updateModel({ themeAccentColor: normalizeAccentColor(value) })}
          onShowNowPlayingBlockChange={(checked) => updateModel({ showNowPlayingBlockInPopup: checked })}
          onLiveVideoCoversInPopupChange={(checked) => updateModel({ liveVideoCoversInPopup: checked })}
          onAllowGenericWebInjectionChange={(checked) => updateModel({ allowGenericWebInjection: checked })}
          t={t}
        />

        <WrapperSourcesSection
          wrapperRules={model.wrapperRules}
          primarySourceAutoPickMap={model.primarySourceAutoPickMap}
          sourceBulkMuteIgnoreMap={model.sourceBulkMuteIgnoreMap}
          sourceMinDurationSecMap={model.sourceMinDurationSecMap}
          sourceOptions={sourceOptions}
          updateModel={updateModel}
          t={t}
          showToast={showToast}
        />

        <ObsSection
          obs={model.obs}
          obsStatus={obsStatus}
          locale={resolvedUiLocale}
          onUpdateObs={updateObs}
          onObsReconnect={onObsReconnect}
          t={t}
        />

        <TwitchSection
          twitch={model.twitch}
          sourceOptions={sourceOptions}
          routerValidation={routerValidation}
          onUpdateTwitch={updateTwitch}
          onUpdateRouter={updateRouter}
          onUpdateCommand={updateCommand}
          onStartTwitchOAuth={onStartTwitchOAuth}
          onTwitchReconnect={onTwitchReconnect}
          statusText={formatTwitchStatus(twitchStatus, resolvedUiLocale)}
          logText={formatTwitchLog(twitchLog, resolvedUiLocale)}
          t={t}
        />

        <DebugSection
          debugMode={model.debugMode}
          diagnostics={diagnostics}
          locale={resolvedUiLocale}
          onDebugModeChange={(checked) => updateModel({ debugMode: checked })}
          t={t}
        />
      </main>
    </Theme>
  );
}

mountToastHost();

const root = document.getElementById("app");
if (root) {
  render(<OptionsApp />, root);
}
