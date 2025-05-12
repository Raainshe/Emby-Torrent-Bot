# emby-torrent-bot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.13. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Project Structure

```
.
├── bun.lockb
├── package.json
├── README.md
├── tsconfig.json
├── songs/                  # Default download location for torrents (can be configured)
└── src/
    ├── discordClient.ts    # Handles all Discord bot interaction, client setup, and event handling
    ├── index.ts            # Main entry point for the application
    ├── qbittorrent.ts      # Handles all qBittorrent Web API communication
    └── utils/
        └── networkUtils.ts # Utility functions (e.g., IP address logging)
```
