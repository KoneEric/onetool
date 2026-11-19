# onetool

One MCP server in front of all the others.

## What it is

onetool is an MCP server that stands in front of the MCP servers you already use. Your host program, the
assistant you talk to, sees two tools instead of hundreds: `run` and `search`.

- `search` finds the tools you have, by words.
- `run` takes a short JavaScript program that calls the real tools. The assistant writes the program, onetool
  runs it in a process of its own, and only the program's answer comes back. The long answers of the tools in
  between never reach the assistant.

You list your own servers in a settings file. onetool connects to them and offers their tools to the programs.

## Install

You need Node 22 or later. The first thing to do is to run this command once:

```sh
npx @koneeric/onetool init
```

It makes the settings file, `~/.config/onetool/settings.json`, when it is not there. When the command `claude`
is found on this machine, it proposes Claude Code as a server behind onetool. It then prints the entry to paste
into the MCP settings of your host program. It takes `--config` to set up another settings file than that one.

A host program starts onetool with one of these two commands:

```sh
npx @koneeric/onetool
# or straight from this repository:
npx github:KoneEric/onetool
```

The one option is `--config`, the path of the settings file. Add this entry to the MCP settings of your host
program:

```json
{
  "mcpServers": {
    "onetool": {
      "command": "npx",
      "args": ["-y", "@koneeric/onetool", "--config", "/absolute/path/to/settings.json"]
    }
  }
}
```

The settings file lists your own servers in the same `mcpServers` shape that host programs use. Paths in it are
given in full, not relative.

## Try it

You can try onetool with no account and no network once the package is installed (`npm ci` needs the network or
npm's cache):

```sh
git clone https://github.com/KoneEric/onetool.git
cd onetool
npm ci
npm test
node bin/onetool.js --config guide/pages/settings.example.json
```

The tests run the real command against the practice server, a table of 5,000 rows with five small tools. The
last command starts onetool with the example settings file, which lists the practice server. It then waits for a
host program to speak to it on its standard input; press Ctrl-C to end it.

## More

- [Install page](guide/pages/INSTALL.md): the settings file, rules that allow, deny or ask, the shell and files,
  the library of saved programs, the trail and the log, and what to do when something does not work.
- [Licence](LICENSE): MIT.
- [Security](SECURITY.md): how to report a weakness, and what counts as one.
- [Contributing](CONTRIBUTING.md): how to run the tests and send a change.
