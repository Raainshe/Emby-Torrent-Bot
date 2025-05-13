# qBittorrent Discord Bot

This Discord bot allows users to interact with a qBittorrent client through Discord commands. It can list current torrents, add new torrents via magnet links, display download progress with speed and peer information, and log bot activities.

## Features

*   **List Torrents (`!torrents`):** Displays all current torrents, their status, progress, download speed, and connected seeders/leechers.
*   **List Seeding Torrents (`!seed`):** Shows only torrents that are currently seeding.
*   **Add Magnet Link (`!addmagnet <magnet_link>`):** Adds a new torrent to qBittorrent using the provided magnet link. The bot will then post a message with the torrent's progress and update it dynamically until completion or failure.
*   **Download Duration:** When a torrent completes, the bot displays how long it took to download.
*   **View Logs (`!logs`):** Shows the last 20 entries from the bot activity log.
*   **List Commands (`!commands`):** Displays all available bot commands.
*   **Activity Logging:** Logs command usage, torrent additions, completions, and errors to `bot_activity.log`.
*   **Configurable Save Path:** A default save path for new torrents can be configured in the `.env` file.

## How It Works

The bot connects to Discord and listens for commands. When a command is received, it interacts with the qBittorrent WebUI API to perform actions like fetching torrent information or adding new torrents. For torrents added via `!addmagnet`, the bot periodically polls the qBittorrent API to get progress updates and edits its original Discord message to reflect these changes in real-time.

## Setup

1.  **Prerequisites:**
    *   [Bun](https://bun.sh/) (JavaScript runtime)
    *   A running qBittorrent instance with the WebUI enabled.

2.  **Installation:**
    ```bash
    bun install
    ```

3.  **Configuration:**
    Create a `.env` file in the root of the project and fill in the necessary details. See the example below.

4.  **Running the Bot:**
    ```bash
    bun run src/index.ts
    ```

## Environment Variables (`.env` example)

Create a `.env` file in the project root with the following variables:

```env
# Discord Bot Configuration
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_PREFIX=!

# qBittorrent WebUI Configuration
QBITTORRENT_URL=http://localhost:8080
QBITTORRENT_USERNAME=your_qbittorrent_username
QBITTORRENT_PASSWORD=your_qbittorrent_password
QBITTORRENT_DEFAULT_SAVE_PATH=C:\\Users\\YourUser\\Downloads # Optional: Default path for new torrents (use double backslashes for Windows)
```

**Note:**
*   Replace placeholders with your actual credentials and paths.
*   Ensure the qBittorrent WebUI is accessible at the `QBITTORRENT_URL`.
*   The `QBITTORRENT_DEFAULT_SAVE_PATH` is optional. If not provided, qBittorrent's default save path will be used.

## Project Structure

```
.
├── .env                    # Environment variables (create this file)
├── bot_activity.log        # Log file for bot activities
├── bun.lockb
├── package.json
├── README.md
├── tsconfig.json
├── downloads/                  # Example download location (can be configured via QBITTORRENT_DEFAULT_SAVE_PATH)
└── src/
    ├── discordClient.ts    # Handles all Discord bot interaction, client setup, and event handling
    ├── index.ts            # Main entry point for the application
    ├── qbittorrent.ts      # Handles all qBittorrent Web API communication
    └── utils/
        ├── displayUtils.ts # Utility functions for creating progress bars and formatting data
        ├── logUtils.ts     # Utility functions for logging bot activity
        └── networkUtils.ts # (Currently unused, was for IP logging)
```

This project was created using `bun init`. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
