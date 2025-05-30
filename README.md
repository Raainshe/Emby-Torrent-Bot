# qBittorrent Discord Bot

This Discord bot allows users to interact with a qBittorrent client through Discord slash commands. It can list current torrents, add new torrents via magnet links with category-based save paths, display download progress, delete torrents, show disk space usage with a pie chart, and log bot activities.

## Features

*   **List Torrents (`/torrents`):** Displays all current torrents, their status, progress, download speed, and connected seeders/leechers.
*   **List Seeding Torrents (`/seed`):** Shows only torrents that are currently seeding.
*   **Seeding Time Management (`/seedstatus`):** Shows the status of automatic seeding time limits for all tracked torrents.
*   **Add Magnet Link (`/addmagnet link:<magnet_link> [category:<category>]`):** Adds a new torrent to qBittorrent.
    *   `link`: The magnet link of the torrent to add.
    *   `category` (optional): Specifies the download category ('series', 'movie', 'anime'), which determines the save path based on environment variables. Defaults to 'series'.
    *   The bot will post a message with the torrent's progress and update it dynamically.
    *   **Automatic seeding tracking:** The bot automatically tracks download time and will stop seeding after 10x the download duration.
*   **Delete Torrents (`/delete category:<category> delete_files:<boolean>`):** Interactively select and delete torrents from qBittorrent.
    *   `category`: Filters torrents by category ('series', 'movie', 'anime') based on their save paths.
    *   `delete_files`: If true, torrent files will also be deleted from the disk.
*   **Show Disk Space (`/diskspace [path:<path>]`):** Displays disk usage for a specified path.
    *   `path` (optional): The path to check (e.g., `/mnt/data` or `D:\\Downloads`). If not provided, uses the path from the `DISK_SPACE_CHECK_PATH` environment variable, or an OS-specific default.
    *   Includes a pie chart visualization of used and available space.
*   **Download Duration:** When a torrent completes, the bot displays how long it took to download.
*   **Automatic Seeding Time Management:** The bot automatically tracks torrents and stops seeding them after they've been seeded for 10 times their download duration. This helps maintain good seeding ratios while preventing indefinite seeding.
*   **View Logs (`/logs`):** Shows the last 20 entries from the bot activity log.
*   **List Commands (`/help`):** Displays all available slash commands and their descriptions.
*   **Activity Logging:** Logs command usage, torrent additions, completions, and errors to `bot_activity.log`.
*   **Path Normalization:** Handles path differences when the bot is running in WSL but interacting with Windows paths for qBittorrent and disk space checks.

## How It Works

The bot connects to Discord and listens for slash commands. When a command is received, it interacts with the qBittorrent WebUI API to perform actions. For torrents added via `/addmagnet`, the bot periodically polls the qBittorrent API to get progress updates and edits its original Discord message to reflect these changes.

### Automatic Seeding Time Management

The bot includes an intelligent seeding time management system that automatically stops seeding torrents after an appropriate duration:

1. **Tracking:** When a torrent is added via `/addmagnet`, the bot automatically starts tracking its download time.
2. **Completion Detection:** When a torrent completes downloading, the bot calculates the total download duration.
3. **Seeding Time Calculation:** The bot sets a seeding stop time based on a configurable multiplier of the download duration (default: 10x, configurable via `SEEDING_TIME_MULTIPLIER` environment variable).
4. **Automatic Stopping:** The bot checks every 5 minutes for torrents that have exceeded their seeding time limit and automatically pauses them.
5. **Status Monitoring:** Use `/seedstatus` to view the current seeding time management status for all tracked torrents.

**Example:** If a torrent takes 30 minutes to download and `SEEDING_TIME_MULTIPLIER=10`, it will be automatically stopped from seeding after 5 hours (30 minutes × 10) of seeding time. If you set `SEEDING_TIME_MULTIPLIER=5`, it would stop after 2.5 hours instead.

This system helps maintain good seeding ratios while preventing torrents from seeding indefinitely, which is especially useful for private trackers with ratio requirements.

## Setup

1.  **Prerequisites:**
    *   [Bun](https://bun.sh/) (JavaScript runtime)
    *   A running qBittorrent instance with the WebUI enabled.
    *   **For chart generation in `/diskspace` (if running on Linux/WSL):** System libraries for `canvas`.
        ```bash
        sudo apt-get update && sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
        ```

2.  **Installation:**
    Clone the repository and install dependencies:
    ```bash
    # If you haven't cloned yet:
    # git clone <repository_url>
    # cd <repository_directory>
    bun install
    ```
    This will install `discord.js`, `dotenv`, `qbittorrent-api-v2`, `diskusage`, `chart.js`, `chartjs-node-canvas`, and `chartjs-adapter-date-fns`.

3.  **Configuration:**
    Create a `.env` file in the root of the project and fill in the necessary details. See the example below.
    Ensure your bot has the `applications.commands` scope enabled in its OAuth2 settings in the Discord Developer Portal for slash commands to work. You might also need to re-invite the bot to your server with this scope. For development, providing a `DISCORD_GUILD_ID` can make commands register faster.

4.  **Running the Bot:**
    ```bash
    bun run src/index.ts
    ```

## Environment Variables (`.env` example)

Create a `.env` file in the project root with the following variables:

```env
# Discord Bot Configuration
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=YOUR_BOTS_CLIENT_ID_HERE # Used for registering slash commands
DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID_HERE # Optional: For faster command registration in a specific guild during development

# qBittorrent WebUI Configuration
QBITTORRENT_URL=http://localhost:8080
QBITTORRENT_USERNAME=your_qbittorrent_username
QBITTORRENT_PASSWORD=your_qbittorrent_password

# qBittorrent Save Paths (use double backslashes for Windows paths, e.g., C:\\Torrents\\Series)
# These are used by the /addmagnet command's 'category' option.
# QBITTORRENT_DEFAULT_SAVE_PATH is still used by /addmagnet if category is 'series' and QBITTORRENT_SERIES_SAVE_PATH is not set.
QBITTORRENT_DEFAULT_SAVE_PATH=/downloads/torrents/default # Fallback/general path
QBITTORRENT_SERIES_SAVE_PATH=/downloads/torrents/series
QBITTORRENT_MOVIES_SAVE_PATH=/downloads/torrents/movies
QBITTORRENT_ANIME_SAVE_PATH=/downloads/torrents/anime

# Disk Space Command Configuration
DISK_SPACE_CHECK_PATH=/ # Optional: Default path for the /diskspace command (e.g., /mnt/c or C:\\)

# Seeding Time Management Configuration
SEEDING_TIME_MULTIPLIER=10 # Optional: Multiplier for seeding time (e.g., 10 means seed for 10x download time). Defaults to 10 if not set.
```

**Note:**
*   Replace placeholders with your actual credentials, IDs, and paths.
*   Ensure the qBittorrent WebUI is accessible at the `QBITTORRENT_URL`.
*   The save path variables are crucial for the `/addmagnet` and `/delete` commands to correctly categorize and locate torrents.
*   `DISK_SPACE_CHECK_PATH` is optional for `/diskspace`. If not provided, the command will use an OS-specific default (e.g., `/` on Linux, `C:\` on Windows).

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
        ├── networkUtils.ts # (Currently unused, was for IP logging)
        └── seedingManager.ts # Automatic seeding time management and torrent tracking
```

This project was created using `bun init`. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
