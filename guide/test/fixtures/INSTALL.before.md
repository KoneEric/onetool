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

## Try it first

You can try everything with no account and no network, from the root of the repository, with three scripts.
Each one starts the real command and the real practice server and prints what happened.

- `sh steps/1.sh` shows `search` and `run` on the practice server, a long answer cut at its limit, and a tool
  refused by a `deny` rule.
- `sh steps/2.sh` shows servers reached at an address, one of them refused for a wrong header, and `state`
  kept from one call of `run` to the next.
- `sh steps/3.sh` shows the rules `ask`, with a host program that can ask the person and with one that
  cannot, and runs the example settings file of this page.

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

The file is read once, at the start. To change it, end onetool and start it again (for a host program, start
the host program again). A key of `onetool` that onetool does not know stops the start, with a line on
standard error. onetool never puts a value of the file, such as a key, a header or an environment value, in an
answer or on standard error. It may name a server, and the pattern of a rule when it refuses a call.

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

This page does not say which host programs can ask: that changes with their versions. `sh steps/3.sh` shows
both cases, so you can see what yours is likely to meet.

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
  not list its tools in time. Make sure it starts, or raise `connectSeconds`.

Each of these lines has the form `onetool: server <name>: not connected (<reason>)`. A server that fails does
not stop the others, and does not stop onetool.

To see all of this from the assistant, ask `search` with no words. It lists every server with its count of
tools, or with the reason it is not connected.

## What onetool does not do

- It does not change the settings file of another program.
- It does not speak the old SSE transport of MCP, the one with two addresses.
- It does not sign in by OAuth: a server that wants it is not connected.
- It does not connect again to a server that went away, and it does not follow a change of a server's list of
  tools. Both need a new start.
- It writes no file.
- It remembers `state` only as long as its process lives.
