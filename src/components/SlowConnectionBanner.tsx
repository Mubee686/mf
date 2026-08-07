/**
 * SlowConnectionBanner — small, dismissible notice shown when the user's
 * network looks slow. Non-blocking; auto-hides once the connection recovers.
 */
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { WifiOff, X } from "lucide-react";

import {
  getIsSlowConnection,
  getIsSlowConnectionServer,
  subscribeNetworkStatus,
} from "@/lib/network-status";

export const SlowConnectionBanner = memo(function SlowConnectionBanner() {
  const isSlow = useSyncExternalStore(
    subscribeNetworkStatus,
    getIsSlowConnection,
    getIsSlowConnectionServer,
  );
  const [dismissed, setDismissed] = useState(false);

  // Re-arm the banner whenever the connection recovers, so a later slowdown
  // is announced again even if the user dismissed the previous notice.
  useEffect(() => {
    if (!isSlow) setDismissed(false);
  }, [isSlow]);

  if (!isSlow || dismissed) return null;

  return (
    <div
      role="status"
      className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-300"
    >
      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Your internet connection is slow — you may experience delays loading prices or charts.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss slow connection notice"
        className="shrink-0 rounded p-0.5 text-amber-300/80 transition-colors hover:bg-amber-500/20 hover:text-amber-200"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});
