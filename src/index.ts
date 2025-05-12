// Import dotenv to load environment variables
import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

// Log a message to the console indicating the application is starting.
console.log("Starting the application...");

// Import necessary classes and types from the discord.js library.
import {Client, Events, GatewayIntentBits} from "discord.js";
// Import qBittorrent functions
import { qbitLogin, qbitGetTorrents, qbitGetSeedingTorrents } from './qbittorrent'; // Added qbitGetSeedingTorrents

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
// This event fires once when the client successfully logs in and is ready.
client.once(Events.ClientReady, async (readyClient) => {
    // Log a message to the console indicating the bot has logged in and its tag.
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
// This event fires every time a new message is created in a channel the bot has access to.
client.on(Events.MessageCreate, async (message) => {
    // Log the author's tag and the content of the received message.
    console.log(`${message.author.tag} said: ${message.content}`);

    // Ignore messages from bots
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
            // Discord has a message length limit of 2000 characters.
            // For very long lists, you might need to paginate or send multiple messages.
            if (reply.length > 1950) { // Leave some buffer
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
            // Discord has a message length limit of 2000 characters.
            // For very long lists, you might need to paginate or send multiple messages.
            if (reply.length > 1950) { // Leave some buffer
                reply = reply.substring(0, 1950) + '... (list truncated)';
            }
            message.reply(reply);
        } else {
            message.reply('No torrents are currently being seeded, or an issue occurred.');
        }
    }
});

// Log in to Discord with the bot token.
// The token is retrieved from the environment variables.
if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("Error: DISCORD_BOT_TOKEN is not defined in the .env file.");
    process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error("Failed to login to Discord:", error);
    process.exit(1);
});



