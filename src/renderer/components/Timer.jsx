import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import TimeControlPanel from "./TimeControlPanel.jsx";
import TimerHeader from "./TimerHeader.jsx";
import {
  IdleCountdownNotice,
  IdleNotificationNotice,
  SessionResultNotice,
  TimerErrorNotice,
} from "./TimerFeedback.jsx";
import { SyncStatusNotice, UpdateNotice } from "./TimerNotices.jsx";
import WorkSelection from "./WorkSelection.jsx";
import useActivityEvents from "../hooks/useActivityEvents.js";
import useAutoUpdater from "../hooks/useAutoUpdater.js";
import useBreakControl from "../hooks/useBreakControl.js";
import useSyncStatus from "../hooks/useSyncStatus.js";
import useTimerSession from "../hooks/useTimerSession.js";
import useTodaySummary from "../hooks/useTodaySummary.js";
import useWorkOptions from "../hooks/useWorkOptions.js";

function Timer() {
  const electronAPI = window.electronAPI;

  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [activeBreak, setActiveBreak] = useState(null);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(0);

  const {
    dismiss: dismissUpdate,
    notice: updateNotice,
    startUpdate: handleUpdate,
  } = useAutoUpdater(electronAPI?.update);

  const mountedRef = useRef(true);
  const operationRef = useRef("");

  const apiAvailable = Boolean(
    electronAPI &&
    typeof electronAPI.getTimerStatus === "function" &&
    electronAPI.events,
  );

  const { setSyncStatus, syncStatus } = useSyncStatus({
    apiAvailable,
    electronAPI,
    mountedRef,
  });

  const {
    activityStatus,
    clearTransientStates,
    idleCountdown,
    idleNotification,
    setActivityStatus,
  } = useActivityEvents({ apiAvailable, electronAPI, mountedRef });

  const {
    commitClosedSession,
    reload: loadTodayTotal,
    sessionCount: todaySessions,
    total: todayTotal,
  } = useTodaySummary({ apiAvailable, electronAPI, mountedRef });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeBreak?.expiresAt) {
      setBreakRemainingSeconds(0);
      return undefined;
    }
    const update = () => setBreakRemainingSeconds(Math.max(0, Math.ceil((new Date(activeBreak.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [activeBreak]);

  const {
    elapsedSeconds,
    error,
    isLoading,
    isRunning,
    lastResult,
    pendingAction,
    setError,
    setIsLoading,
    setPendingAction,
    start: handleStart,
    stop: handleStop,
  } = useTimerSession({
    apiAvailable,
    clearTransientStates,
    commitClosedSession,
    electronAPI,
    loadTodayTotal,
    mountedRef,
    operationRef,
    projectId,
    setActiveBreak,
    setActivityStatus,
    setSyncStatus,
    taskId,
  });

  const {
    breakTypes,
    selectedBreakTypeId,
    setSelectedBreakTypeId,
    toggleBreak,
  } = useBreakControl({
    activeBreak,
    apiAvailable,
    electronAPI,
    isLoading,
    isRunning,
    mountedRef,
    operationRef,
    setActiveBreak,
    setError,
    setIsLoading,
    setPendingAction,
  });

  const { projects, tasks } = useWorkOptions({
    apiAvailable,
    electronAPI,
    isRunning,
    projectId,
  });

  const currentTime = todayTotal + (isRunning ? elapsedSeconds : 0);

  const actionDisabled =
    isLoading ||
    !apiAvailable ||
    Boolean(activeBreak);

  const handlePrimaryAction = () => {
    if (!isRunning) return handleStart();
    return handleStop();
  };

  return (
    <section className="w-full max-w-md overflow-hidden rounded-[24px] border border-[#ded9cd] bg-[#fbf9f4] shadow-[0_24px_65px_rgba(34,32,27,0.18)]">
      <TimerHeader isRunning={isRunning} />


      <div className="p-4 sm:p-5">
        <UpdateNotice
          notice={updateNotice}
          onDismiss={dismissUpdate}
          onUpdate={handleUpdate}
        />
        <SyncStatusNotice status={syncStatus} />
        <TimeControlPanel
          activeBreak={activeBreak}
          actionDisabled={actionDisabled}
          breakTypes={breakTypes}
          breakRemainingSeconds={breakRemainingSeconds}
          currentTime={formatTime(currentTime)}
          isLoading={isLoading}
          isRunning={isRunning}
          loadingText={getLoadingText(pendingAction)}
          onBreakTypeChange={(event) => setSelectedBreakTypeId(event.target.value)}
          onBreakAction={() =>
            toggleBreak(activeBreak ? undefined : selectedBreakTypeId)
          }
          onPrimaryAction={handlePrimaryAction}
          selectedBreakTypeId={selectedBreakTypeId}
          todaySessions={todaySessions}
        />
        <TimerErrorNotice apiAvailable={apiAvailable} message={error} />
        <SessionResultNotice isRunning={isRunning} result={lastResult} />
        <WorkSelection
          isRunning={isRunning}
          onProjectChange={(value) => {
            setProjectId(value);
            setTaskId("");
          }}
          onTaskChange={setTaskId}
          projectId={projectId}
          projects={projects}
          taskId={taskId}
          tasks={tasks}
        />

        <IdleCountdownNotice
          activityStatus={activityStatus}
          countdown={idleCountdown}
          isRunning={isRunning}
        />
        <IdleNotificationNotice notification={idleNotification} />
      </div>
    </section>
  );
}

function getLoadingText(action) {
  if (action === "start") {
    return "Iniciando...";
  }

  if (action === "stop") {
    return "Guardando sesión...";
  }

  if (action === "pause") {
    return "Pausando...";
  }

  if (action === "resume") {
    return "Reanudando...";
  }

  return "Cargando...";
}

function normalizeNonNegativeNumber(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.floor(numericValue));
}

function normalizeSeconds(value) {
  return normalizeNonNegativeNumber(value);
}

function formatTime(seconds) {
  const safeSeconds = normalizeSeconds(seconds);

  const hours = Math.floor(safeSeconds / 3600);

  const minutes = Math.floor((safeSeconds % 3600) / 60);

  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export default Timer;
