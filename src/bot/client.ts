import { Client, Events, GatewayIntentBits, Collection, REST, Routes } from "discord.js";
import type { SlashCommandOptionsOnlyBuilder } from "discord.js";
import { qbitLogin } from '../services/qbittorrent/client.js';
import { addLogEntry } from '../utils/logUtils.js';
import { startSeedingManager } from '../managers/seedingManager.js';
import { registerCommands } from './commands/index.js';
import { createCommandHandlers } from './handlers/messageHandler.js';
import dotenv from 'dotenv';

dotenv.config();

// Extend Client to include a commands property
class DiscordClient extends Client {
    commands: Collection<string, any>; // You can define a more specific type for your commands

    constructor(options: any) {
        super(options);
        this.commands = new Collection();
    }
}

// Create a new Discord client instance.
export const client = new DiscordClient({
    // Define the intents for the client. Intents specify which events the bot will receive.
    intents: [
        GatewayIntentBits.Guilds, // Allows receiving guild-related events (e.g., server creation).
    ],
});

// Register an event listener for the ClientReady event.
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in to Discord as ${readyClient.user?.tag}!`); // Log Discord login
    addLogEntry('System', 'BotLogin', `Logged in as ${readyClient.user?.tag}`);

    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = readyClient.user.id;
    const guildId = process.env.DISCORD_GUILD_ID; // Read the Guild ID from .env

    if (!token) {
        console.error("DISCORD_BOT_TOKEN is missing. Cannot register slash commands.");
        addLogEntry('System', 'SlashCommandError', 'DISCORD_BOT_TOKEN is missing.');
        return;
    }

    const slashCommands = registerCommands();
    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (guildId) {
            console.log(`Started refreshing application (/) commands for guild: ${guildId}.`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId), // Register to specific guild
                { body: slashCommands.map((cmd: SlashCommandOptionsOnlyBuilder) => cmd.toJSON()) },
            );
            console.log(`Successfully reloaded application (/) commands for guild: ${guildId}.`);
            addLogEntry('System', 'SlashCommand', `Successfully registered commands for guild: ${guildId}.`);
        } else {
            console.log('Started refreshing global application (/) commands.');
            await rest.put(
                Routes.applicationCommands(clientId), // Fallback to global registration
                { body: slashCommands.map((cmd: SlashCommandOptionsOnlyBuilder) => cmd.toJSON()) },
            );
            console.log('Successfully reloaded global application (/) commands.');
            addLogEntry('System', 'SlashCommand', 'Successfully registered global application commands.');
        }
    } catch (error) {
        console.error("Error registering slash commands:", error);
        addLogEntry('System', 'SlashCommandError', `Error registering commands: ${error instanceof Error ? error.message : String(error)}`);
    }

    const qbitLoggedIn = await qbitLogin();
    if (qbitLoggedIn) {
        console.log("Successfully logged into qBittorrent."); // Log qBittorrent login success
        addLogEntry('System', 'QbitLogin', 'Successfully logged into qBittorrent WebUI.');
        
        // Start the seeding manager
        startSeedingManager();
    } else {
        console.warn("Initial login to qBittorrent failed. Check .env configuration and qBittorrent status.");
        addLogEntry('System', 'QbitLoginFailure', 'Failed to login to qBittorrent WebUI. Check config and qBit status.');
    }
});

// Set up command handlers
createCommandHandlers(client);

export function startDiscordBot() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error("DISCORD_BOT_TOKEN is missing. Cannot start the bot.");
        addLogEntry('System', 'BotStartError', 'DISCORD_BOT_TOKEN is missing.');
        return;
    }

    client.login(token);
} 