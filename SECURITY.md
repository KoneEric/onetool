# Security

## Reporting a weakness

Please report a weakness in private, not in a public issue. Use GitHub's private advisory form:

https://github.com/KoneEric/onetool/security/advisories/new

Say what you did, what you expected and what happened. A short program or settings file that shows it is the
best report.

## What counts

- A program that gets out of its walls: it reaches a file, a process, a variable of the environment or a
  connection that onetool did not hand it.
- A call that passes a rule that should refuse it: a tool under `deny`, a call that should have been asked
  about, a path outside the listed folders.
- A value of the settings file in an answer or in a log.

## What does not count

When the shell is switched on, a shell command is not walled. The listed folders hold the file tools, not the
commands: a command runs with the rights of the person who started onetool. That is the person's choice, not a
weakness. Leave the shell off if you do not want it.
