import { useEffect, useMemo, useState } from "react";
import { runSingleFlight } from "../utils/singleFlight.js";
import { reportRendererError } from "../utils/rendererError.js";

export default function useWorkOptions({ apiAvailable, electronAPI, isRunning, projectId }) {
  const [options, setOptions] = useState({ projects: [], tasks: [] });

  useEffect(() => {
    if (!apiAvailable || isRunning) return;
    let active = true;
    runSingleFlight("work-options", () => electronAPI.getWorkOptions())
      .then((result) => {
        if (!active) return;
        if (result?.success) {
          setOptions({
            projects: Array.isArray(result.data?.projects) ? result.data.projects : [],
            tasks: Array.isArray(result.data?.tasks) ? result.data.tasks : [],
          });
        }
      })
      .catch((error) => {
        if (active) reportRendererError("No se pudieron cargar proyectos y tareas", error);
      });
    return () => {
      active = false;
    };
  }, [apiAvailable, electronAPI, isRunning]);

  const tasks = useMemo(
    () =>
      options.tasks.filter((task) => {
        const taskProjectId =
          typeof task.project === "string" ? task.project : task.project?._id;
        return taskProjectId === projectId;
      }),
    [options.tasks, projectId],
  );

  return { projects: options.projects, tasks };
}
