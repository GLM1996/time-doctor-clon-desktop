import { useCallback, useEffect, useRef, useState } from "react";
import { getRendererErrorMessage, reportRendererError } from "../utils/rendererError.js";

const DISMISSED_VERSION_KEY = "logyourtime:dismissed-update-version";

export default function useAutoUpdater(updateAPI) {
  const [notice, setNotice] = useState(null);
  const [dismissedVersion, setDismissedVersion] = useState(readDismissedVersion);
  const installRequestedRef = useRef(false);
  const installStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    try {
      // Migración: versiones anteriores persistían el descarte indefinidamente.
      window.localStorage.removeItem(DISMISSED_VERSION_KEY);
    } catch {
      // El almacenamiento puede no estar disponible en entornos restringidos.
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const install = useCallback(
    async (version) => {
      if (installStartedRef.current || !updateAPI) return;

      installStartedRef.current = true;
      setNotice((current) => ({
        ...(current || {}),
        version,
        phase: "installing",
        percent: 100,
        message: "Preparando la instalación y el reinicio...",
      }));

      try {
        const result = await updateAPI.install();
        if (result?.success === false) {
          throw new Error(result.message || "No se pudo instalar la actualización.");
        }
      } catch (error) {
        installStartedRef.current = false;
        installRequestedRef.current = false;
        if (!mountedRef.current) return;
        setNotice((current) => ({
          ...(current || {}),
          version,
          phase: "error",
          message: getRendererErrorMessage(error, "No se pudo instalar la actualización."),
        }));
      }
    },
    [updateAPI],
  );

  useEffect(() => {
    if (!updateAPI) return undefined;

    let active = true;
    const unsubscribers = [];
    const updateNotice = (updater) => active && setNotice(updater);
    const showAvailable = (data = {}) => {
      const version = data.version || data.availableVersion || "";
      if (!active || !version || dismissedVersion === version) return;
      setNotice({
        version,
        phase: "available",
        percent: 0,
        message: "Hay una nueva versión lista para descargar.",
      });
    };

    updateAPI
      .getStatus()
      .then((status) => {
        if (!active) return;

        if (["install-failed", "recovery-required"].includes(status?.health?.status)) {
          setNotice({
            version: status.health.targetVersion || status.currentVersion || "",
            phase: "error",
            percent: 0,
            message:
              status.health.status === "install-failed"
                ? "La instalación falló y se conservó la versión anterior."
                : "Esta versión no superó la verificación de estabilidad. Contacta a soporte.",
          });
          return;
        }

        if (!status?.updateAvailable) return;
        const version = status.availableVersion || "";
        if (!version || dismissedVersion === version) return;

        setNotice({
          version,
          phase: status.updateDownloaded
            ? "ready"
            : status.isDownloading
              ? "downloading"
              : "available",
          percent: status.downloadProgress?.percent || 0,
          message: status.updateDownloaded
            ? "La actualización está lista para instalar."
            : status.isDownloading
              ? "Descargando la actualización..."
              : "Hay una nueva versión lista para descargar.",
        });
      })
      .catch((error) => reportRendererError("No se pudo consultar el actualizador", error));

    unsubscribers.push(
      updateAPI.onAvailable(showAvailable),
      updateAPI.onDownloading((data = {}) =>
        updateNotice((current) => ({
          ...(current || {}),
          phase: "downloading",
          percent: data.percent || 0,
          message: "Descargando la actualización...",
        })),
      ),
      updateAPI.onDownloadProgress((data = {}) =>
        updateNotice((current) => ({
          ...(current || {}),
          phase: "downloading",
          percent: clampPercentage(data.percent),
          message: "Descargando la actualización...",
        })),
      ),
      updateAPI.onDownloaded((data = {}) => {
        if (!active) return;
        const version = data.version || "";
        setNotice((current) => ({
          ...(current || {}),
          version: version || current?.version,
          phase: "ready",
          percent: 100,
          message: "La actualización está lista para instalar.",
        }));
        if (installRequestedRef.current) install(version);
      }),
      updateAPI.onError((data = {}) => {
        if (!active) return;
        installRequestedRef.current = false;
        installStartedRef.current = false;
        setNotice((current) => ({
          ...(current || {}),
          phase: "error",
          message: getRendererErrorMessage(
            { message: data.message },
            "No se pudo completar la actualización.",
          ),
        }));
      }),
    );

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [dismissedVersion, install, updateAPI]);

  const startUpdate = useCallback(async () => {
    if (!notice || !updateAPI) return;

    if (notice.phase === "ready") {
      installRequestedRef.current = true;
      await install(notice.version);
      return;
    }

    installRequestedRef.current = true;
    installStartedRef.current = false;
    setNotice((current) => ({
      ...current,
      phase: "downloading",
      percent: 0,
      message: "Descargando la actualización...",
    }));

    try {
      const result = await updateAPI.download();
      if (result?.success === false) {
        throw new Error(result.message || "No se pudo descargar la actualización.");
      }
      if (result?.downloaded) await install(notice.version);
    } catch (error) {
      installRequestedRef.current = false;
      if (!mountedRef.current) return;
      setNotice((current) => ({
        ...current,
        phase: "error",
        message: getRendererErrorMessage(error, "No se pudo descargar la actualización."),
      }));
    }
  }, [install, notice, updateAPI]);

  const dismiss = useCallback(() => {
    if (!notice) return;
    setDismissedVersion(notice.version);
    try {
      window.sessionStorage.setItem(DISMISSED_VERSION_KEY, notice.version);
    } catch {
      // El estado de React conserva el descarte durante esta ejecución.
    }
    setNotice(null);
  }, [notice]);

  return { dismiss, notice, startUpdate };
}

function readDismissedVersion() {
  try {
    return window.sessionStorage.getItem(DISMISSED_VERSION_KEY) || "";
  } catch {
    return "";
  }
}

function clampPercentage(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}
