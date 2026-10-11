# Contributing

Issues and pull requests are welcome.

- **Bugs and ideas:** open an issue. The forms ask for the host you use and the version.
- **Pull requests:** keep them small and run `npm test`. The widget is one file with no dependencies, and the server core has no host in it. Please keep it that way.
- **Adding a host:** write a short adapter in `server/` that supplies the five storage functions described at the top of `server/core.mjs`, and add a round-trip test in `test/adapters.test.mjs`.
