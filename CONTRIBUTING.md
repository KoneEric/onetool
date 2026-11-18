# Contributing

Thank you for helping. Here is what you need.

## Set up

You need Node 22 or later. In the root of the repository:

```sh
npm ci
npm test
```

`npm ci` needs the network or npm's cache. `npm test` runs every test, many of them through the real command and
the practice server, with no account and no network.

## How a change is made

- The tests use Node's own test runner (`node --test`). There is no build step: the source is what runs.
- A change comes with its tests. A fix comes with a test that fails without it.
- A new package needs a reason. onetool has one dependency on purpose; say in your change why another one is
  worth what it costs.

## Questions and problems

Open an issue: https://github.com/KoneEric/onetool/issues

To report a weakness, do not open an issue; follow [SECURITY.md](SECURITY.md).
