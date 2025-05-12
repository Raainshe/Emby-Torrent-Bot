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
    console.log("Logged in as " + readyClient.user?.tag);

    // Attempt to log in to qBittorrent when the bot is ready
    console.log("Attempting to login to qBittorrent...");
    const qbitLoggedIn = await qbitLogin();
    if (qbitLoggedIn) {
        console.log("Initial login to qBittorrent successful.");
    } else {
        console.warn("Initial login to qBittorrent failed. Check .env configuration and qBittorrent status.");
    }
});

// Register an event listener for the MessageCreate event.
client.on(Events.MessageCreate, async (message: Message) => {
    console.log(`${message.author.tag} said: ${message.content}`);

    if (message.author.bot) return;

    // Command to list torrents
    if (message.content.toLowerCase() === '!torrents') {
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
    if (message.content.toLowerCase() === '/seed' || message.content.toLowerCase() === '!seed') {
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
    const addMagnetPrefix = '!addmagnet ';
    if (message.content.toLowerCase().startsWith(addMagnetPrefix)) {
        const magnetUrl = message.content.substring(addMagnetPrefix.length).trim();
        if (!magnetUrl) {
            message.reply('Please provide a magnet URL after the command. Usage: `!addmagnet <magnet_url>`');
            return;
        }
        if (!magnetUrl.startsWith('magnet:?xt=urn:btih:')) {
            message.reply('Invalid magnet URL format. It should start with `magnet:?xt=urn:btih:`');
            return;
        }
        message.reply(`Attempting to add torrent: ${magnetUrl} (using default save path)`);
        const result = await qbitAddTorrentByMagnet(magnetUrl);
        if (result.success) {
            message.reply(`Successfully added torrent to qBittorrent. It will be saved in the default location.`);
        } else {
            message.reply(`Failed to add torrent: ${result.error || 'Unknown error'}`);
        }
    }
});

export function startDiscordBot() {
    if (!process.env.DISCORD_BOT_TOKEN) {
        console.error("Error: DISCORD_BOT_TOKEN is not defined in the .env file.");
        process.exit(1);
    }
    client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
        console.error("Failed to login to Discord:", error);
        process.exit(1);
    });
}
