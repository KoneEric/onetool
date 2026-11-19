// The fixed texts of the two tools: they name no real server and no real tool.

export const RUN_DESCRIPTION =
  "Runs a JavaScript program that calls the tools of the listed servers and gives back only what it returns or prints. " +
  "Call a tool as `await tools.<server>.<tool>(args)` (args an object); filter and count inside, so that only a small answer comes back. " +
  "The answer is the value of the last expression; `console.log` lines follow. " +
  "Put every step that needs no decision into one program. " +
  "`state` is kept from one call to the next. " +
  "`background: true` starts a job and answers at once with its id; `progress(...)` posts a line. " +
  "Use `search` first to find tools.";

// added to the description of `run`, after one space, when the shell is on
export const SHELL_DESCRIPTION =
  "Shell, in the listed folders: await $`command`.text() gives the output, $`command`.nothrow() does not throw; " +
  "read(path), write(path, text), edit(path, old, new) do files.";

export const CODE_DESCRIPTION = "The program: the body of an async function; `await` and `return` work.";

export const BACKGROUND_DESCRIPTION = "true: start the program as a job and answer at once with its id.";

export const JOB_DESCRIPTION = "The id of a job: says how it is doing, its lines and its answer.";

export const STOP_DESCRIPTION = "true, with job: stops the job.";

export const JOBS_DESCRIPTION = "true: lists the jobs.";

export const SEARCH_DESCRIPTION =
  "Finds tools and saved programs. With no words it counts them; with words it shows the matches, one line each: " +
  "`server.tool(arguments) - what it does`.";

export const WORDS_DESCRIPTION = "Words to look for in names, descriptions and arguments.";

export const TOOLS = [
  {
    name: "run",
    description: RUN_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: CODE_DESCRIPTION },
        background: { type: "boolean", description: BACKGROUND_DESCRIPTION },
        job: { type: "string", description: JOB_DESCRIPTION },
        stop: { type: "boolean", description: STOP_DESCRIPTION },
        jobs: { type: "boolean", description: JOBS_DESCRIPTION },
      },
    },
  },
  {
    name: "search",
    description: SEARCH_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: { words: { type: "string", description: WORDS_DESCRIPTION } },
    },
  },
];

/** The two tools: `run` says what the library holds (`libraryText`) and, with the shell on, what else the program finds. */
export const toolsWith = (libraryText, withShell) => [
  { ...TOOLS[0], description: `${RUN_DESCRIPTION} ${libraryText}${withShell ? ` ${SHELL_DESCRIPTION}` : ""}` },
  TOOLS[1],
];
