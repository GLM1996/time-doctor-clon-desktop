import { useEffect, useState } from "react";

const INITIAL_SYNC_STATUS = {
  state: "idle",
  pendingTotal: 0,
  pendingSessions: 0,
  pendingActivity: 0,
  pendingScreenshots: 0,
  lastError: null,
};

export default function useSyncStatus({ apiAvailable, electronAPI, mountedRef }) {
  const [syncStatus, setSyncStatus] = useState(INITIAL_SYNC_STATUS);

  useEffect(() => {
    if (!apiAvailable) return undefined;
    return electronAPI.events.onSyncUpdate((status = {}) => {
      if (mountedRef.current) {
        setSyncStatus((previous) => ({ ...previous, ...status }));
      }
    });
  }, [apiAvailable, electronAPI, mountedRef]);

  return { setSyncStatus, syncStatus };
}
