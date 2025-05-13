// Import necessary classes and types from the discord.js library.
import { Client, Events, GatewayIntentBits, Message } from "discord.js";
// Import qBittorrent functions
import { qbitLogin, qbitGetTorrents, qbitGetSeedingTorrents, qbitAddTorrentByMagnet } from './qbittorrent';

// Create a new Discord client instance.
const client = new Client({
    // Define the intents for the client. Intents specify which events the bot will receive.
    intents: [
        GatewayIntentBits.Guilds, // Allows receiving guild-related events (e.g., server creation).
        GatewayIntentBits.GuildMessages, // Allows receiving messages sent in guilds (servers).
        GatewayIntentBits.MessageContent, // Allows accessing the content of messages. This is a privileged intent.
    ],
});

// Register an event listener for the ClientReady event.
client.once(Events.ClientReady, async (readyClient) => {
    // Attempt to log in to qBittorrent when the bot is ready
    const qbitLoggedIn = await qbitLogin();
    if (qbitLoggedIn) {
    } else {
        console.warn("Initial login to qBittorrent failed. Check .env configuration and qBittorrent status."); // Kept this warn as it's a startup issue
    }
});

// Register an event listener for the MessageCreate event.
client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.DISCORD_PREFIX || '!')) return;

    const args = message.content.slice((process.env.DISCORD_PREFIX || '!').length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // Command to list torrents
    if (command === 'torrents') {
        const result = await qbitGetTorrents();
        if (result.error) {
            message.reply(`Error fetching torrents: ${result.error}`);
            return;
        }
        if (result.torrents && result.torrents.length > 0) {
            let reply = '**Current Torrents:**\n';
            result.torrents.forEach(torrent => {
                reply += `- ${torrent.name} (State: ${torrent.state})\n`;
            });
            if (reply.length > 1950) {
                reply = reply.substring(0, 1950) + '... (list truncated)';
            }
            message.reply(reply);
        } else {
            message.reply('No torrents found or an issue occurred.');
        }
    }

    // Command to list seeding torrents
    if (command === 'seed') {
        const result = await qbitGetSeedingTorrents();
        if (result.error) {
            message.reply(`Error fetching seeding torrents: ${result.error}`);
            return;
        }
        if (result.torrents && result.torrents.length > 0) {
            let reply = '**Currently Seeding Torrents:**\n';
            result.torrents.forEach(torrent => {
                reply += `- ${torrent.name} (State: ${torrent.state})\n`;
            });
            if (reply.length > 1950) {
                reply = reply.substring(0, 1950) + '... (list truncated)';
            }
            message.reply(reply);
        } else {
            message.reply('No torrents are currently being seeded, or an issue occurred.');
        }
    }

    // Command to add a torrent via magnet URL
    if (command === 'addmagnet') {
        if (!args.length) {
            message.reply('Please provide a magnet URL. Usage: !addmagnet <magnet_url>');
            return;
        }
        const magnetUrl = args[0];
        // Use the default save path from .env, or undefined if not set
        const defaultSavePath = process.env.QBITTORRENT_DEFAULT_SAVE_PATH ?? '';

        message.reply(`Attempting to add magnet: ${magnetUrl}` + (defaultSavePath ? ` with save path: ${defaultSavePath}` : ''));
        
        // Pass defaultSavePath directly. If it's undefined, qbitAddTorrentByMagnet will handle it.
        const result = await qbitAddTorrentByMagnet(magnetUrl, defaultSavePath || '');
        if (result.success) {
            message.reply('Successfully sent magnet link to qBittorrent.');
        } else {
            message.reply(`Failed to add torrent: ${result.error}`);
        }
    }
});

export function startDiscordBot() {
    if (!process.env.DISCORD_BOT_TOKEN) {
        console.error("Error: DISCORD_BOT_TOKEN is not defined in the .env file."); // Kept this error as it's critical
        process.exit(1);
    }
    client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
        console.error("Failed to login to Discord:", error); // Kept this error as it's critical
        process.exit(1);
    });
}
