import { fail, ok } from "@/sources/shared/control";

function defaultIsTimeoutResult(result) {
  return typeof result?.message === "string" && result.message.includes("bridge timeout");
}

function controlPayload(action, value, context) {
  return {
    action,
    value,
    href: context?.location?.href || (typeof location !== "undefined" ? location.href : ""),
  };
}

export async function executeBridgeControl({
  bridge,
  action,
  value,
  context,
  debugPrefix = "source",
  paths,
  unavailableMessage,
  failedMessage,
  isTimeoutResult = defaultIsTimeoutResult,
  verifyTimeout,
}) {
  const debugLog = context?.debugLog;
  const bridgePath = paths?.bridge || `${debugPrefix}-bridge`;
  const timeoutPath = paths?.timeoutVerified || `${debugPrefix}-timeout-verified`;
  const bridgeUnavailable = unavailableMessage || `${debugPrefix} bridge unavailable`;
  const bridgeFailed = failedMessage || `${debugPrefix} bridge control failed`;

  if (!bridge || typeof bridge.execute !== "function") {
    return fail(bridgeUnavailable);
  }

  debugLog?.(`${debugPrefix} control via bridge`, controlPayload(action, value, context));
  const bridgeResponse = await bridge.execute(action, value);
  debugLog?.(`${debugPrefix} bridge raw result`, { action, value, result: bridgeResponse });

  if (bridgeResponse?.ok) return ok(bridgePath);

  if (isTimeoutResult(bridgeResponse) && typeof verifyTimeout === "function") {
    const timeoutVerified = await verifyTimeout({ action, value, bridgeResponse, context });
    if (timeoutVerified) return ok(timeoutPath);
  }

  return bridgeResponse || fail(bridgeFailed);
}
