import React from "react";

export default function WorkSelection({
  isRunning,
  onProjectChange,
  onTaskChange,
  projectId,
  projects,
  taskId,
  tasks,
}) {
  if (isRunning) return null;

  return (
    <section
      className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[#e5e0d7] bg-[#fffdf8] p-3"
      aria-label="Asignación del tiempo"
    >
      <label className="text-[10px] font-semibold text-[#595b54]">
        Proyecto
        <select
          value={projectId}
          onChange={(event) => onProjectChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[#d8d3c9] bg-white px-2.5 py-2 text-xs text-[#292b26] focus:border-[#986126] focus:outline-none focus:ring-2 focus:ring-[#986126]/15"
        >
          <option value="">Sin proyecto</option>
          {projects.map((project) => (
            <option key={project._id} value={project._id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-[10px] font-semibold text-[#595b54]">
        Tarea
        <select
          value={taskId}
          disabled={!projectId}
          onChange={(event) => onTaskChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[#d8d3c9] bg-white px-2.5 py-2 text-xs text-[#292b26] focus:border-[#986126] focus:outline-none focus:ring-2 focus:ring-[#986126]/15 disabled:cursor-not-allowed disabled:bg-[#f1eee7] disabled:text-[#8a8b84]"
        >
          <option value="">Sin tarea</option>
          {tasks.map((task) => (
            <option key={task._id} value={task._id}>
              {task.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
