# Installing onetool

onetool is one MCP server that stands in front of your other MCP servers. Your host program (the assistant
you talk to) sees two tools, `run` and `search`, instead of every tool of every server. The assistant finds a
tool with `search`, then writes a short JavaScript program for `run` that calls the tools it needs. Only what
the program returns or prints comes back to the assistant.

This page takes you from nothing to a working setup. It follows the order of the work: check what you need,
try onetool on the practice server, add it to your host program, then write your own settings file.

## What you need

- Node 22 or later. Check with `node --version`.
- The repository of onetool on your machine.
- The MCP package, installed once. In the root of the repository, run:

```sh
npm ci
```

This one command needs the network or npm's cache. After it, onetool itself opens no connection except to
the address of a listed server that you gave as a `url`. Servers started by a command, such as the practice
server, need no network at all.

## Start with onetool init

The first thing to do is run one command. In a terminal:

```sh
npx @koneeric/onetool init
```

From the repository, `node bin/onetool.js init` is the same command. It sets up your settings file, then ends by
itself. It starts no server and connects to nothing.

**The file.** It makes the settings file when it is not there, with no server in it:
`~/.config/onetool/settings.json`. Give `--config` and a path to use another place. It never removes or changes what the file already holds.

**Claude Code.** When the command `claude` is found on your machine, and the file has no server that is Claude
Code, `init` proposes to add Claude Code as a server behind onetool. The answer by default is yes. What this
gives: the assistant's programs can run commands and read, search and edit files through Claude Code's own
tools. What it costs: Claude Code as a server asks no permission question: the rules of onetool are the control.

Two options answer for you. `--yes` adds it without asking. `--no-claude` proposes nothing. With nobody to ask (no
terminal) and no `--yes`, nothing is added, and the command says how to accept.

**What it adds.** This, to the file:

```json
{
  "mcpServers": {
    "claude": { "command": "/absolute/path/to/claude", "args": ["mcp", "serve"], "tools": ["Bash", "Read", "Edit", "Write", "Grep", "Glob"] }
  },
  "onetool": { "hostServers": ["claude"] }
}
```

The command is written with the full path where `claude` was found. The key `tools` keeps six of its tools,
and closes no tool of the other servers. The key `hostServers` makes onetool apply the host program's own rules
to them: see "Folders and rules from the host program".

**The entry.** `init` ends by printing the entry to paste into your host program's MCP settings, with the full
path of the settings file. It changes no file of your host program: you paste it yourself, as the next sections
say.

**Again.** Run it again on a file that has Claude Code already, and it proposes nothing and says so.

### Codex as a listed server

From this checkout, with Node 22+, Codex CLI, Bash and ripgrep (`rg`) on PATH:

```sh
npm ci
node bin/onetool.js init --codex "/absolute/path/to/project"
```

The folder must exist. The command adds a server named `codex` to the default onetool settings,
`~/.config/onetool/settings.json`. Use `--config /absolute/path/to/settings.json` to choose
another file. Setup keeps existing servers, including Claude. If the name `codex` is already taken,
setup leaves that entry in place. The entry points to this checkout and the Codex executable it
found. Keep the checkout in place, or update the paths after moving it.

Restart onetool. Run `search` with `words: "codex"` to see the tools.
Your usual onetool allow, deny and ask rules apply to their names. For example, use
`"ask": ["codex.Bash", "codex.Write", "codex.Edit"]` under `onetool` to require confirmation.
When running Claude as the host, leave Codex out of `hostServers`, which is for Claude's own tools.

| Tool | Example inside an onetool program | Result |
| --- | --- | --- |
| Bash | `await tools.codex.Bash({command:"git status --short"})` | stdout, stderr, exitCode |
| Read | `await tools.codex.Read({file_path:"notes.txt"})` | content |
| Write | `await tools.codex.Write({file_path:"notes.txt",content:"first draft"})` | file_path, bytes |
| Edit | `await tools.codex.Edit({file_path:"notes.txt",old_string:"first",new_string:"second"})` | file_path, bytes |
| Grep | `await tools.codex.Grep({pattern:"draft",glob:"*.txt"})` | matching lines in stdout |
| Glob | `await tools.codex.Glob({pattern:"*.txt"})` | matching paths in stdout |
| GitHubLookup | `await tools.codex.GitHubLookup({repository_full_name:"KoneEric/onetool"})` | repository metadata from the signed-in GitHub connection |

These are the adapter's input fields. Read, Write and Edit work on regular UTF-8 files under the project;
the parent directory must exist. Read and Edit accept files up to 1 MiB. Edit requires one literal match
unless `replace_all: true`. Grep and Glob accept an optional `path` within the project and follow
ripgrep's normal ignore rules. Bash starts in the project. Commands use Codex's `:workspace` permission
profile. To select another installed profile (for example `:read-only`), set `ONETOOL_CODEX_PERMISSIONS`
in the listed server's `env`. Bash has all access granted by that profile. Commands time out after 30 seconds.

GitHubLookup uses the GitHub connection already signed in to Codex. It opens a temporary Codex chat and calls
the repository lookup directly. It does not start a model turn. The adapter returns an error if the
connection is unavailable or needs interactive approval. Connect GitHub in Codex before using it.

**Test your installation.**

With GitHub connected, run from the checkout:

```sh
ONETOOL_LIVE_CODEX=1 node --test server/test/codex.test.js
```

The live test creates a temporary settings file, calls all seven tools through onetool, checks the changed
file on disk and checks the GitHub result. The ordinary test suite runs offline and skips this live check.
Tested with Codex CLI 0.171.0-alpha.13 on macOS. The Codex app-server interface is experimental.

## Try it first

You can try everything with no account and no network, from the root of the repository, once `npm ci` has run.
`npm test` runs every test of onetool, many of them through the real command and the real practice server.

The example settings file is `guide/pages/settings.example.json`. It lists the practice server, refuses the
tool `practice.fail` and asks the person before `practice.wipe`. It works from the root of the repository
only: the path of the practice server in it is relative, and onetool starts a listed server in its own
working folder, so the path means something only when onetool itself is started in the root of the
repository. From any other folder, give the path in full.

To start it by hand, from the root of the repository:

```sh
node bin/onetool.js --config guide/pages/settings.example.json
```

onetool then waits for a host program on its standard input. Press Ctrl-C to end it.

To try it in a host program, put the example file in the host program's settings as the next section says, then
ask the assistant to count the rows of Lyon with onetool. The answer is 625.

## Add onetool to your host program

You add one server, onetool, to the MCP settings of your host program, by hand. onetool never changes the
settings file of another program.

Add this entry to the `mcpServers` of your host program:

```json
{
  "mcpServers": {
    "onetool": {
      "command": "node",
      "args": ["/absolute/path/to/onetool/bin/onetool.js", "--config", "/absolute/path/to/settings.json"]
    }
  }
}
```

Both paths must be absolute, and both are your own: the first is where the repository is on your machine,
the second is your onetool settings file (see the next section). A relative path would be read from whatever
folder the host program was started in.

Your other servers move. Take each of them out of the host program's file and put it in the onetool settings
file instead. If you leave a server in both, the assistant still sees its tools twice: once by itself and once
through onetool.

`onetool init` prints this entry for you, with the full path of your settings file; you only paste it.

Then start the host program again, so that it reads its settings.

- **Claude desktop** reads `claude_desktop_config.json`. On macOS it is in
  `~/Library/Application Support/Claude/`. On Windows it is in `%APPDATA%\Claude\`. In JSON, write the
  backslashes of a Windows path twice.
- **Any other program that speaks MCP**: the same entry, in that program's own MCP settings. Look in its
  documentation for where they are.

onetool uses only what the MCP standard defines, so nothing of it is special to one host program.

## The settings file

The settings file is JSON. It has two top-level keys: `mcpServers`, the servers onetool connects to, and
`onetool`, its own options (optional). The names of servers are yours, but a name may not be empty and may
not hold a dot.

An entry may also have the key `tools`: the names of the tools of that server that onetool keeps. The others do
not exist for `search` or for a program. It closes no tool of another server.

A server is one of two kinds of entry. One is started by a command, with `command`, `args` and `env`; only
`command` is required:

```json
{
  "mcpServers": {
    "files": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "env": { "FILES_ROOT": "/absolute/path/to/folder" }
    }
  }
}
```

The other is reached at an address, with `url` and `headers`; only `url` is required, and it must be an http
or https address:

```json
{
  "mcpServers": {
    "far": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR-TOKEN" }
    }
  }
}
```

An entry may not have both `command` and `url`. An entry that breaks a rule is left out and does not stop the
others: onetool writes one line about it (see "When something does not work").

An entry reached at an address may also have the key `oauth`, for a server that asks you to sign in. It is
only needed when the server does not let a client register itself. See "Signing in".

The keys of `onetool`, all optional:

| Key | What it is | Default |
|---|---|---|
| `answerLimit` | The most characters any answer of onetool may have; a longer one is cut, with a notice | 8000 |
| `timeoutSeconds` | How long one program of `run` may take before it is stopped | 60 |
| `connectSeconds` | How long a server has to connect and list its tools | 30 |
| `searchLimit` | The most tools `search` lists in one answer | 10 |
| `stateLimit` | The most characters `state` may take as JSON between two calls of `run` | 10000000 |
| `allow` | Patterns of the tools a program may call; empty allows every tool | `[]` |
| `deny` | Patterns of the tools a program may not call | `[]` |
| `ask` | Patterns of the tools the person is asked about before each call | `[]` |
| `shell` | Switches the shell and files on for programs; its `folders`, the folders they may use, may be left out (see "The shell and files") | absent: the shell is off |
| `trail` | `true` or `false`: whether the answer of `run` ends with one line per call the program made | on |
| `log` | `true` or `false`: whether every call is written to the log file | `true` |
| `logFolder` | The full path of the folder of the log files | absent: the folder `logs` of onetool's own folder |
| `hostRules` | `true` or `false`: whether the host program's own permission rules are taken, only to tighten (see "Folders and rules from the host program") | on |
| `hostServers` | The names of the listed servers that are the host program itself, Claude Code started as a server | none |
| `backgroundSeconds` | How long a job, a program started in the background, may take before it is stopped (see "Background jobs") | 7200 |
| `maxJobs` | How many jobs may run at once; `0` lets none start | 3 |
| `libraryCap` | The most saved programs one library holds (see "The library") | 50 |
| `instructions` | `true` or `false`: whether onetool gives the host program its text for the session when it connects (see "Grouping the work") | on |

The file is read once, at the start. To change it, end onetool and start it again (for a host program, start
the host program again). A key of `onetool` that onetool does not know stops the start, with a line on
standard error. onetool never puts a value of the file, such as a key, a header or an environment value, in an
answer or on standard error. It may name a server, and the pattern of a rule when it refuses a call.

A server of yours may not be named `library`: that name is the built-in library's (see "The library"), and an
entry with it is not connected.

## Signing in

Some servers reached at an address ask you to sign in by OAuth. onetool can sit in front of such a server too.
It applies to a server reached at an address, with no `Authorization` header in the settings file. A server
with that header, and a server started by a command, never sign in this way. This entry is all it takes:

```json
{
  "mcpServers": {
    "notes": { "url": "https://example.com/mcp" }
  }
}
```

**What you see before you sign in.** `search` with no words lists the server as `notes: sign in needed`. A
call of one of its tools fails with a message that gives the command to run. The other servers work as usual.

**The command.** In a terminal, run:

```sh
node /absolute/path/to/onetool/bin/onetool.js login notes --config /absolute/path/to/settings.json
```

`npx @koneeric/onetool login notes --config ...` is the same command. It prints the address to open, opens it
in your browser, and listens on `127.0.0.1` for the browser to come back. It waits 300 seconds at most, then
says in one line that it worked or why not. Two options change it:

- `--no-browser`: the address is only printed. Use it on a machine with no browser of its own: open the
  address in a browser on that same machine, or forward the port.
- `--wait`, with a number of seconds: how long to wait for the browser, instead of 300.

**No restart.** A running onetool picks the sign-in up at the next `search` or `run`. A token that runs out
is refreshed by itself, with nothing asked. When the server refuses the refresh, it is `sign in needed` again,
and the same command repairs it.

**Where the sign-in is.** In `~/.onetool/auth`: one file per server, readable by you only (mode `600`). It is
tied to the name and the address of the server: when the address changes in the settings file, the sign-in is
not used, and you sign in again. Nothing of a sign-in is ever in an answer, in the trail, in the log or on
standard error.

**Forgetting it.** Run `onetool logout notes --config /absolute/path/to/settings.json`, in the same way. The
file is removed. Nothing is sent to the server.

**A server that does not let a client register itself.** Some services want you to get a client id from them
first. Put it in the key `oauth` of that server's entry. The keys are `clientId`, `clientSecret`, `scopes`
and `port`. You get the client id from the service. `port` is the port to listen on when the service wants a
fixed address to come back to, `http://127.0.0.1:<port>/callback`; by default any free port is used. The
key `redirectHost` is the host name written in that address: `127.0.0.1` by default, or `localhost` for a
service that wants `http://localhost:<port>/callback`. onetool listens on `127.0.0.1` either way, and you leave
the key out unless the service asks for the name. The
secret stays in the settings file and is never copied anywhere else.

```json
{
  "mcpServers": {
    "tracker": {
      "url": "https://example.com/tracker/mcp",
      "oauth": { "clientId": "your-client-id", "scopes": ["read"], "port": 8765 }
    }
  }
}
```

**What cannot be put behind onetool.** The connectors a host program signs in to itself cannot be put behind onetool.
They live in the host program, not in a settings file. Only servers you list by address can be signed in to
here.

**What it speaks to.** For a sign-in, and only then, onetool speaks to the sign-in server that the listed
server names. It writes nothing of OAuth itself: the official MCP package does all of it.

## Rules: allow, deny, ask

A pattern is matched against the whole id of a tool, `<server>.<tool>`, and upper and lower case count. A
`*` stands for any run of characters, dots included: `practice.*` is every tool of `practice`, `*.delete*`
every tool whose name starts with `delete`, and `*` is everything.

The three lists are applied in this order:

1. `deny`: a call that matches a pattern is refused.
2. `allow`: when the list is empty, every call is allowed. Otherwise only a call that matches a pattern is.
3. `ask`: a call that passed the first two and matches a pattern is made only after the person says yes.

`deny` wins over `allow`, and a refused call is never asked about. A tool that is refused is hidden from
`search`. A tool under `ask` is not hidden: it is listed like any other.

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": {
    "allow": ["practice.*"],
    "deny": ["practice.fail"],
    "ask": ["practice.wipe"]
  }
}
```

For `ask`, onetool asks the person through the host program, before each such call, each time: a yes is not
remembered, so two calls are two questions. The question names the tool, its arguments and the rule. When
the host program cannot ask, the call is refused. The time the person takes counts in the program's time
limit, so if you use `ask`, you may want a larger `timeoutSeconds`.

A program that is refused gets an error it can catch, and the answer of `run` says why. After the rule, the
cause is one of four:

- `the host program cannot ask the person`
- `the person said no`
- `the person gave no answer`
- `the question failed`

`the person gave no answer` is also what a program gets when the host program closes the question
without showing it to anyone. The usual case is a host program run with no person in front of it, such as a
script or a scheduled run: it says it can ask, then closes the question at once. The call was not made: the
tool behind the rule did nothing. For runs with no person, take the tool out of `ask` and put it under `allow` or `deny`
in the settings file of those runs.

This page does not say which host programs can ask: that changes with their versions.

## The shell and files

The shell is off by default. A program of `run` then has no shell and no files: it can only call the tools of
the listed servers. You switch it on with the key `shell` of `onetool` (named `onetool.shell` in messages),
with `folders`: one or more full paths. The first folder is where a command starts and where a relative path
begins. `folders` may be left out: the folders are then those the host program gives (see
"Folders and rules from the host program" below). A folder that does not exist stops the start. A server of yours named `shell` is not connected while
the shell is on, because onetool has a server of that name of its own.

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": {
    "shell": { "folders": ["/absolute/path/to/project"], "deny": ["rm *"], "ask": ["git push*"] }
  }
}
```

Inside `shell`, `allow`, `deny` and `ask` are lists of patterns matched against the text of a command; each is
optional. A program then gets four things:

- ``$`command` `` runs the text in the first folder with `/bin/sh` and gives back an object. `.text()` on it
  gives what the command wrote. A command that fails throws in the program, unless it ends with `.nothrow()`.
  A value put into a command with `${...}` is quoted as one word.
- `read(path)` gives the text of a file.
- `write(path, text)` writes a file.
- `edit(path, old, new)` replaces a text that must be in the file exactly once.

```js
const found = (await $`grep -l needle *.txt`.text()).trim().split("\n");
await edit(found[0], "needle", "thread");
```

The work is done by onetool's main process. The process of the program stays walled and gets no new right.

The folders limit `read`, `write` and `edit`. A path outside them is refused, also through `..` or a symbolic
link, and the message names the path and says it is outside the listed folders, as in
`onetool: shell.read is refused: ../x.txt is outside the listed folders`. Nothing is read or written.

The listed folders do not wall a shell command. A command can read, write and delete anywhere your own
account can, can use the network, and gets the environment of onetool's process. Switching the shell on is
your choice.

The four tools have the ids `shell.run`, `shell.read`, `shell.write` and `shell.edit`. They go in the lists
`allow`, `deny` and `ask` of `onetool` like any tool, and `search` lists them under `shell`. Rules on the text
of a command, the lists inside `shell`, are not the same thing. Rules on the text of a command are weak. A
denied command can be written another way: `rm *` does not stop `ls; rm x`. What is strong is `"deny":
["shell.run"]` in `onetool`, which allows no command at all, or `ask` on `shell.run`, which has the person read
each command before it runs.

A command is stopped with its program at the time limit, together with everything it started, and nothing a
command started keeps running after it. The shell is built for macOS and Linux.

### Another way: Claude Code as a listed server

Claude Code can itself be a listed server behind onetool. Started with `claude mcp serve`, it gives a program
its tools:

```json
{
  "mcpServers": {
    "claude": { "command": "claude", "args": ["mcp", "serve"], "tools": ["Bash", "Read", "Edit", "Write", "Grep", "Glob"] }
  },
  "onetool": { "hostServers": ["claude"] }
}
```

That server offers many more tools than you may want behind onetool (it names at least `Agent` and
`WebFetch`), so the list `tools` keeps six. It closes no tool of the other servers, which a list `allow` would
do. `onetool init` writes this for you: see "Start with onetool init".

No permission question was shown in the try. The rules of onetool, `allow`, `deny` and `ask`, are therefore your
control over these tools. `hostServers` makes onetool apply the `Bash`, `Read`, `Edit` and `Write` rules of
Claude Code's own settings files to them, when Claude Code is also the host program.

Which to prefer: the built-in shell needs nothing installed and limits files to the listed folders. Claude Code
as a server needs Claude Code installed and brings its own tools as they are.

## Folders and rules from the host program

The shell does not need `folders` in the settings file. MCP lets a host program say which folders the session
works in: its `roots`. When `onetool.shell` is there and has no `folders`, those are the folders. The first one
is where commands start and where relative paths begin, and a change of roots told by the host program is
followed. Folders given in the settings file win. With neither, the shell stays off, and `search` with no words
says why: `no folder: onetool.shell.folders is not set and the host program gave none`.

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "shell": {} }
}
```

onetool also takes the host program's own permission rules, where it can read them, and only to tighten.
A host rule can only tighten. A `deny` of the host refuses the call. An `ask` of the host asks the person, as
the `ask` of onetool does. An `allow` of the host changes nothing, and never undoes a `deny` or an `ask` of
onetool. The refusal names the file and the rule. This is on by default; `"hostRules": false` switches it off.

The host program gives its name when it connects. onetool knows Claude Code. For any other host program it
applies its own rules only, and says so once on standard error. For Claude Code it reads the lists `deny`,
`ask` and `allow` under `permissions` of three files: `~/.claude/settings.json`, `.claude/settings.json` and
`.claude/settings.local.json`, the last two in each folder the host gives. They are read again before each
program. A file that cannot be read is said once on standard error, and the others apply.

The rules apply to these pairs of names:

| Rule of the host program | Tool of the shell |
|---|---|
| `Bash` | `shell.run` |
| `Read` | `shell.read` |
| `Edit` | `shell.edit` |
| `Write` | `shell.write` |

An `Edit` rule also holds for `shell.write`. The same rules hold for the tools of those names of a listed
server named in `hostServers`.

The matching is onetool's own close copy of the host program's. It does not copy everything: not the
approvals given during the session, not the permission mode, not the hooks.

Rules on the text of a command are weak. It is the same sentence as in "The shell and files": a command can be
written another way.

## Background jobs

Some programs take longer than the assistant should wait. A program of `run` can be started in the background
instead: `run` is called with `background: true`, answers at once with the id of a job, and the program goes
on. The tools stay two, `run` and `search`: a job is one more way to call `run`, not a new tool.

Two limits are in the settings file. This block shows them at their defaults:

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "backgroundSeconds": 7200, "maxJobs": 3 }
}
```

The assistant asks for a job with `run` and the id, `job: "j1"`. The answer is the state of the job, the lines
the program posted and, once the job has ended, its answer. A program posts a line with `progress(text)`. The
state is one of four: `running`, `done`, `failed` or `stopped`. Of the lines posted, the last 10 are shown, and
a line says how many earlier ones are not. The answer is cut like any other answer, and asking again gives the
answer again. This is what asking answers for a job that has ended (the number of seconds is the job's own):

```text
job j1: done, 2 s
--- progress ---
half
--- answer ---
625
```

To stop a job, `run` is called with `job: "j1"` and `stop: true`; the job is stopped with every command it
started, and nothing it started keeps running. Stopping a job that has ended changes nothing. To see all the
jobs of the session, `run` is called with `jobs: true`: one line each, `j1: done, 2 s`, in the order they were
started.

Two limits hold the jobs. A job is stopped after `backgroundSeconds` (7200 by default), and `timeoutSeconds`
does not hold it: that key is the limit of a program that is not in the background. At most `maxJobs` jobs (3
by default) run at once; one more is refused with a message that says so, and `0` lets none start. The last 20
jobs that have ended are kept, so the list stays short.

The rest stays as it was. The rules `allow`, `deny` and `ask` apply to the calls of a job as to any other, and so
do the trail and the log. A question under `ask` may reach the person while the assistant is doing something
else; when the host program cannot ask, the call is refused. `state` is shared with the other programs.

Jobs end when onetool ends. Nothing of a job is kept for the next start.

## The library

onetool keeps a library of saved programs, so that a task done before is not written again. A program saves
one with `library.save(name, { about, params, code })`, and any later program calls it as
`await lib.<name>(args)`. The library is always there: no key switches it on or off.

A saved program is four things: a name (letters, digits and `_`, starting with a letter, at most 40
characters), one sentence that says what it does, the names of its arguments, and the text. The arguments are
given as one object, `lib.cityCount({ city: "Lyon" })`, and are variables in the text. Saved programs may call
each other.

This block sets the cap of programs at its default and asks the person before each save and each removal:

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "libraryCap": 50, "ask": ["library.save", "library.remove"] }
}
```

**Where the files are.** The project's library is in the folder `.onetool/library` of the first folder the
shell works in, when there is one. The user's library is in `~/.onetool/library`. Both are read, and the
project's wins on a same name. Each program is one plain file, `<name>.js`, that you can read, edit, delete
and keep in git. This is the file of a program that counts the rows of one city:

```js
// about: Counts the rows of one city.
// params: city
const { rows } = await tools.practice.rows({});
rows.filter((row) => row.city === city).length
```

A file that does not fit this form is left out, and said once on standard error. A project's library comes
with the project: read what a repository you did not write holds before an assistant calls it.

**Finding them.** `search` shows the matching saved programs first, one line each. With no words it counts
them, in a last line `library: <n> programs`. The description of `run` says how many there are and names the
five most used.

**What keeps it small.** Beside the programs onetool keeps `stats.json`: for each program, its uses, its last
use and its failures in a row.

- A save whose text names the same tools in the same order as a saved program is refused, with a message that
  names that program. `replace: true` in the arguments of the save puts the new program in its place.
  The same tools in the same order is read from the text, not from a run. So two programs that call one tool
  with different arguments count as the same, and one program with an argument serves both.
- A library holds at most `libraryCap` programs (50 by default). A save at the cap is refused, and the message
  names the three least used.
- A program that failed 5 times in a row is moved to the archive.

**Lines of the trail.** Three lines, in parentheses, may end the trail of a program: one when a sequence of
calls that is not saved has run 3 times in the session (`save it as a program` with `library.save`), one when
a program did what a saved one does (`does this`: call it), and one when a failing program was moved. They
are part of the trail: with the trail off, they are not shown.

**Removing, and the archive.** `library.remove(name)` moves a program to the folder `archive` beside the
library. What a save replaces goes there too. Each file has its date in its name. To bring one back, call
`library.restore(name)`: see "Tidying the library".

**The rules.** Nothing is saved without a call of library.save. The two ids `library.save` and
`library.remove` go in `allow`, `deny` and `ask` like any tool, so you can be asked before each save, as the
block above does. Every call inside a saved program goes through the rules, the trail and the log as any
other.

## Tidying the library

onetool has no model of its own. So the work of tidying a library that grew is split. onetool gives the
account and the means; the session of your host program reads, compares and proposes; you decide.

**The rules.** The three new ids, `library.report`, `library.restore` and `library.read`, go in `allow`,
`deny` and `ask` like any tool. This block asks you before each change of the library, so that nothing of a
tidy-up is applied without you, whatever the session does:

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "ask": ["library.save", "library.remove", "library.restore"] }
}
```

**The report.** A program that returns `library.report()` gets a compact account of the library, 6,000
characters at most (the default `answerLimit` of 8000 holds it whole). For each saved program it gives its
uses, its failures in a row and its last use, the least used first. It lists the pairs of programs that share
most of their tools, and the programs not used for 30 days; a program never used is not among them. It ends
with the sequences of calls that ran 3 times or more and are not saved. The report changes no file. This is
one, as a person would see it:

```text
Library report: 3 programs
--- programs: uses, failures in a row, last use ---
lib.cityShare (user): 0 uses, 0 failures, never
lib.old (user): 1 uses, 0 failures, 2026-10-09
lib.cityCount (user): 2 uses, 0 failures, 2026-11-18
--- programs that share most of their tools ---
lib.cityCount and lib.cityShare: 1 of 2 tools (practice.rows)
--- not used for 30 days ---
lib.old
--- sequences of calls run 3 times or more and not saved ---
3 times: practice.count
```

**Where the sequences come from.** One line per program that ended well and named a tool is added to
`~/.onetool/sequences.jsonl`, with the names of its tools and never its text. The file is kept from one
session to the next, for every project, so the report can count a sequence that ran in three different
sessions. It is not written when the log is switched off, and it is a file you may delete.

**Reading one program.** `library.read(name)` gives the text of a saved program as its file holds it, so
that the session opens only the programs worth comparing and not all of them.

**The prompt.** onetool offers one MCP prompt, `tidy-library`, that you start from your host program, where
the host shows prompts. How a host shows them is the host's business, and this page names no host as the
only one. The text of the prompt tells the session to read the report, to open only the programs worth
comparing, to propose what to merge, retire, rename or save, and to wait for your yes. Only then does it apply
what you agreed to, with `library.save` and `library.remove`. Nothing is changed before you say yes. A host
that shows no prompt changes nothing else: you ask for the same work in your own words.

**Bringing one back.** Whatever a save replaces or a removal takes is in the folder `archive` beside its
library, with its date. `library.restore(name)` brings the newest file of that name back, with its counts at
zero. It is refused when a program of that name is saved, or when the library is at its cap.

## Grouping the work

onetool saves context only when one program does several steps: a program that makes one call saves nothing.
So onetool leads the session to group its work. Put every step that needs no decision into one program.

**The instructions.** When the host program connects, onetool gives it a text for the session, the
instructions the MCP standard defines: 600 characters at most, the same whatever the servers. It asks the
assistant to list the steps before the first `run`, to put every step that needs no decision into one program,
to return only the small result needed to decide what comes next, to keep large results in `state`, and never
to use `run` for one tool call when the next call is already known. Whether the assistant reads it is the host
program's doing. `"instructions": false` switches the text off, and nothing else:

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "instructions": false }
}
```

**The line of the trail.** When three programs in a row, in the foreground, each made exactly one call, and
nobody was asked a question in between, the trail of the third ends with this line. It is said again only after
three more programs. A program that calls a saved program does not count.

```
(the last 3 programs each made one call: they could have been one program)
```

**The number.** `search` with no words ends with one line for the session. Nothing is shown before the first
program. A low number of calls per program means the work is not grouped.

```
this session: 3 programs, 3 calls, 1.0 calls per program
```

**A paragraph to paste.** A host program that does not pass on the instructions of a server may still be told:
paste this paragraph into the standing instructions of your assistant, the file or the setting where the host
program keeps what the assistant is always told.

```text
When you use onetool, group the work. Before the first run, list the steps of the task. Put every step that needs no decision into one program: loops, filters, several tools. Return only the small result you need to decide what comes next, and keep large results in state. Never use run for one tool call when the next call is already known.
```

## The trail and the log

Every call a program makes through `run` is recorded, a tool of a listed server and a tool of the shell alike,
made or refused. The record has two forms. Each works without the other.

The trail comes after the answer of `run`: the line `--- calls ---`, then one line per call the program made,
in the order the calls began, with its id, its milliseconds and the size of its answer, or `refused`,
`failed` or `unfinished` when it had none:

```text
--- calls ---
practice.count 12 ms 13 chars
shell.read 0 ms refused
```

With more than 20 calls, the first 20 are shown, then one line with the count of the rest. The trail counts in
`answerLimit`, and it is what is kept when an answer is cut: the answer is cut before it. A program that made
no call has no trail, unless a line of the library ends it. The key `trail` switches it on or off; it is on by default.

A trail may end with a line of the library, in parentheses, after the lines of the calls: see "The library".

The log is one JSON line per call, in a file per day named `calls-<date>.jsonl`, in the folder `logs` of
onetool's own folder unless `logFolder` says another. A line has eight keys: `time`, `session` (the same in
every line of one start of onetool), `id`, `args`, `decision` (what the rules said), `ms`, `size` and `fault`
(why a call did not end well, or null). The log never holds the answer of a call, the text written or edited
(the path and the sizes are there), or a value of the settings file. A log that cannot be written is said once
on standard error and stops nothing. `"log": false` switches it off, and then no folder is made. onetool
never deletes a log file: that is yours to do. Of a `library.save`, the log keeps the name and the size of the
code, never the text.

Beside the log of the calls, onetool keeps one line per program that ended well and named a tool, in the
file `~/.onetool/sequences.jsonl` of your home folder. A line holds the names of the tools the text of the
program names, and never the text, an argument or an answer. `"log": false` switches this file off with the
log. See "Tidying the library" for what it is for.

```json
{
  "mcpServers": {
    "practice": { "command": "node", "args": ["practice/src/server.js"] }
  },
  "onetool": { "trail": true, "log": true, "logFolder": "/absolute/path/to/logs" }
}
```

## When something does not work

onetool speaks to a person on standard error. A host program keeps it in its logs; look there first.
Standard output carries only MCP messages.

- `usage: onetool --config <settings file>`: the command was started with anything but `--config` and one
  path. Fix the `args` of the entry: exactly `--config` and then the path.
- `settings file not found`: the path after `--config` is not a readable file. Give the full path, and check
  the spelling.
- `not connected (could not start)`: the command of a listed server could not be started, or it ended before it
  listed its tools. Run that command yourself in a terminal to see why.
- `not connected (could not connect)`: a server reached at an address could not be reached, or did not answer
  as an MCP server does. Check the `url`, the `headers` and that the server runs.
- `not connected (refused the connection)`: the server answered with an error when onetool began. Check that
  the server is the one you meant and that it is configured as it asks.
- `not connected (bad entry:`, followed by a reason: the entry of that server in the settings file breaks a
  rule, for instance it has both `command` and `url`. Correct the entry.
- `no answer in`, followed by a number of seconds (the reason reads `no answer in 30 seconds`): the server did
  not list its tools in time. Make sure it starts, or raise `connectSeconds`. It also covers the `login` that
  waited for the browser: no browser came back in time. Run it again, with `--wait` if you need longer.
- `nobody to ask`, said by `onetool init` when it proposes Claude Code and no terminal is there to answer: nothing
  was added. Run the command the line gives, with `--yes`, or run `init` in a terminal.
- `sign in needed`, as `notes: sign in needed` in `search`, or in the message of a failed call: the server asks
  for a sign-in and you have none, or it is no longer valid. Run the `login` command the message gives, in a
  terminal. See "Signing in".
- `the sign-in could not be started`: the server names no sign-in server, or does not let a client register
  itself. Give it a client id in the key `oauth` of its entry. See "Signing in".

Each of these lines has the form `onetool: server <name>: not connected (<reason>)`. A server that fails does
not stop the others, and does not stop onetool.

With the shell switched on or off, four more texts:

- `the shell is not switched on`, in the answer of a program that used `$`, `read`, `write` or `edit`: the
  shell is off. Add `shell` with `folders` to `onetool` in the settings file, and start again.
- `is outside the listed folders`, in the answer of a program: a path given to `read`, `write` or `edit` is
  not under any listed folder. Use a path inside them, or add the folder to `folders`.
- `is not a folder`, on standard error at the start (`onetool: onetool.shell.folders: item <n> is not a
  folder`): the folder in that place of `folders` does not exist. Make it, or correct the path.
- `onetool: the log cannot be written`, once on standard error: the log folder could not be made or a file
  could not be written. Check `logFolder` and who may write there; calls go on without a log.

With the host program, three more texts:

- `no folder: onetool.shell.folders is not set and the host program gave none`, in the line of `shell` in the
  answer of `search`: `shell` has no `folders` and the host program gave none. Add `folders` to `shell`, or
  give the host program a folder to work in.
- `onetool: host rules: this host program is not known`, once on standard error: onetool applies its own rules
  only. Nothing is wrong; add the rules you want to the settings file of onetool.
- `cannot be read, its rules are not applied`, once on standard error after `onetool: host rules:` and a path:
  that settings file of the host program is not readable. Fix the file or who may read it; the other files
  apply.

With jobs, two more texts:

- `jobs may run at once`, in the answer of `run` when a job was not started: as many jobs as `maxJobs` allows
  are running. Wait for one to end, stop one, or raise `maxJobs`.
- `no job`, in the answer of `run` when it is asked for a job: `onetool: no job j99 in this session.` The id is
  not one of this session. Ask `run` with `jobs: true` for the ids.

With the library, six more texts:

- `calls the same tools in the same order`, in the answer of a refused `library.save`: a saved program does
  what the new one does. Call the program the message names, or save again with `replace: true`.
- `the limit is`, in the answer of a refused `library.save`: the library holds as many programs as
  `libraryCap`. The message names the three least used: remove one with `library.remove(name)`, replace one,
  or raise `libraryCap`.
- `is not a saved program`, once on standard error (`onetool: library: <path> is not a saved program, it is
  left out`): a file in a library folder is not of the form of a program file. Correct the file or delete it.
- `the name is taken by the built-in library`, as the reason a server is not connected: a server of yours is
  named `library`. Give it another name.
- `is in the archive`, in the answer of a refused `library.restore` (`no program named <name> is in the
  archive`): the archive holds no file of that name. Check the name; the archive is the folder `archive`
  beside the library.
- `remove it first`, in the answer of a refused `library.restore` (`a program named <name> is saved
  already: remove it first`): a program of that name is saved. Call `library.remove(name)` first, or keep the
  one that is saved.

To see all of this from the assistant, ask `search` with no words. It lists every server with its count of
tools, or with the reason it is not connected.

## What onetool does not do

- It does not change the settings file of another program.
- It does not speak the old SSE transport of MCP, the one with two addresses.
- It never opens a browser by itself. You sign in with `onetool login`, from a terminal (see "Signing in").
- It does not connect again to a server that went away, and it does not follow a change of a server's list of
  tools. Both need a new start.
- It writes its log; the settings file that `onetool init` is given, and only that one (see "Start with onetool
  init"); the sign-ins, one file per server, in the folder `~/.onetool/auth`; the file of the
  sequences, `sequences.jsonl`, in `~/.onetool`; the files of the library,
  which are the programs that calls of `library.save` keep, their `stats.json` and their archive, in the
  library folders; and, only with the shell switched on, what programs
  write in the listed folders. It writes nothing else.
- It does not wall a shell command: the listed folders limit `read`, `write` and `edit`, not what a command
  does.
- It does not copy everything of the host program's permissions: not the approvals given during the session,
  not the permission mode, not the hooks.
- It never writes a settings file of the host program. It only reads them.
- It does not keep a job after onetool itself ends. Jobs end when onetool ends. It writes nothing of a job to a
  file, except the lines of its calls in the log.
- It saves no program by itself. Nothing is saved without a call of library.save.
- It tidies nothing by itself. onetool has no model of its own.
- It remembers `state` only as long as its process lives.
