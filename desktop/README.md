# Open Research Agent for macOS

The desktop app: the local build (`backend/local`) in its own window, with
its own Python and, through Electron, its own Node for the assistant runtime.
The interface is the same web app the browser and the hosted site show.

```bash
make desktop-dev    # open it from the source tree
make desktop        # build desktop/dist/Open-Research-Agent-<version>-<arch>.dmg
```

See "桌面版" in [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) for how it starts
the backend, where its log is, how it is packaged and how releases are signed.
