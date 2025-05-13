// Import necessary classes and types from the discord.js library.
import { Client, Events, GatewayIntentBits, Message, SlashCommandBuilder, REST, Routes, Collection, type Interaction, type CacheType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
// Import qBittorrent functions
import { qbitLogin, qbitGetTorrents, qbitGetSeedingTorrents, qbitAddTorrentByMagnet, qbitGetTorrentByHash, type TorrentInfo, qbitDeleteTorrents } from './qbittorrent';
// Import utility functions
import { createProgressBar, formatDuration, formatSpeed } from './utils/displayUtils';
import { addLogEntry, getRecentLogs } from './utils/logUtils'; // Import logging functions
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

// Define an interface for the object stored in activeTorrentMessages
interface TrackedTorrentInfo {
    message: Message; // The Discord message to update
    lastProgress: number;
    isCompleted: boolean;
    addedOn: number; // Timestamp when the torrent was added
    torrentName: string;
}

// Store active torrent messages for updates: Map<torrentHash, TrackedTorrentInfo>
const activeTorrentMessages = new Map<string, TrackedTorrentInfo>();
const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds, adjust as needed

// Map to store pending deletion operations <interactionId, { hashes: string[], deleteFiles: boolean }>
const pendingDeletions = new Map<string, { hashes: string[], deleteFiles: boolean }>();

// Helper function to normalize paths for comparison, especially between WSL and Windows
function normalizePathForComparison(path: string): string {
    let normalized = path;
    // Convert WSL /mnt/c/ style paths to C:/ style
    // Matches /mnt/x/ where x is a single letter, case-insensitive, and replaces with x:/
    normalized = normalized.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, '$1:/$2'); 
    // Replace all backslashes with forward slashes
    normalized = normalized.replace(/\\/g, '/');
    // Collapse multiple consecutive slashes into a single slash
    normalized = normalized.replace(/\/+/g, '/');
    // Ensure it ends with a single trailing slash
    if (!normalized.endsWith('/')) {
        normalized += '/';
    }
    // Convert to lowercase for case-insensitive comparison
    return normalized.toLowerCase();
}

// Helper function to extract display name (dn) from magnet link
function getDisplayNameFromMagnet(magnetLink: string): string | null {
    try {
        const urlParams = new URLSearchParams(magnetLink.substring(magnetLink.indexOf('?') + 1));
        return urlParams.get('dn');
    } catch (e) {
        console.error('Error parsing magnet link for dn:', e);
        return null;
    }
}

// Create a new Discord client instance.
const client = new DiscordClient({
    // Define the intents for the client. Intents specify which events the bot will receive.
    intents: [
        GatewayIntentBits.Guilds, // Allows receiving guild-related events (e.g., server creation).
    ],
});

const slashCommands = [
    new SlashCommandBuilder().setName('torrents').setDescription('Lists all current torrents with their status and progress.'),
    new SlashCommandBuilder().setName('seed').setDescription('Lists all torrents that are currently seeding.'),
    new SlashCommandBuilder().setName('addmagnet')
        .setDescription('Adds a new torrent using the provided magnet link.')
        .addStringOption(option =>
            option.setName('link')
                .setDescription('The magnet link')
                .setRequired(true))
        .addStringOption(option => // New category option
            option.setName('category')
                .setDescription('The category of the torrent (defaults to series)')
                .setRequired(false)
                .addChoices(
                    { name: 'Series', value: 'series' },
                    { name: 'Movie', value: 'movie' },
                    { name: 'Anime', value: 'anime' }
                )),
    new SlashCommandBuilder().setName('delete')
        .setDescription('Deletes torrents from qBittorrent.')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('The category of torrents to list for deletion')
                .setRequired(true)
                .addChoices(
                    { name: 'Series', value: 'series' },
                    { name: 'Movie', value: 'movie' },
                    { name: 'Anime', value: 'anime' }
                ))
        .addBooleanOption(option =>
            option.setName('delete_files')
                .setDescription('Whether to delete the files from disk along with the torrent')
                .setRequired(true)),
    new SlashCommandBuilder().setName('logs').setDescription('Displays the last 20 log entries.'),
    new SlashCommandBuilder().setName('help').setDescription('Displays the list of available commands.')
];

const availableCommandHelp = slashCommands.map(cmd => ({ name: `/${cmd.name}`, description: cmd.description }));

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

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (guildId) {
            console.log(`Started refreshing application (/) commands for guild: ${guildId}.`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId), // Register to specific guild
                { body: slashCommands.map(cmd => cmd.toJSON()) },
            );
            console.log(`Successfully reloaded application (/) commands for guild: ${guildId}.`);
            addLogEntry('System', 'SlashCommand', `Successfully registered commands for guild: ${guildId}.`);
        } else {
            console.log('Started refreshing global application (/) commands.');
            await rest.put(
                Routes.applicationCommands(clientId), // Fallback to global registration
                { body: slashCommands.map(cmd => cmd.toJSON()) },
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
    } else {
        console.warn("Initial login to qBittorrent failed. Check .env configuration and qBittorrent status.");
        addLogEntry('System', 'QbitLoginFailure', 'Failed to login to qBittorrent WebUI. Check config and qBit status.');
    }

    // Start polling for torrent updates
    setInterval(updateTrackedTorrents, POLLING_INTERVAL_MS);
});

// New InteractionCreate event listener for slash commands
client.on(Events.InteractionCreate, async (interaction: Interaction<CacheType>) => {
    const user = interaction.user.tag;

    if (interaction.isChatInputCommand()) {
        const commandName = interaction.commandName;

        // ... existing command handlers for 'torrents', 'seed', 'addmagnet' ...
        if (commandName === 'torrents') {
            addLogEntry(user, `/${commandName}`, 'Fetching all torrents');
            await interaction.deferReply();
            const result = await qbitGetTorrents();
            if (result.error) {
                await interaction.editReply(`Error fetching torrents: ${result.error}`);
                addLogEntry(user, `/${commandName}`, `Error fetching torrents: ${result.error}`);
                return;
            }
            if (result.torrents && result.torrents.length > 0) {
                let reply = '**Current Torrents:**\n';
                result.torrents.forEach(torrent => {
                    const downloadingStates = ['downloading', 'stalldl', 'checkingdl', 'pauseddl', 'metadl'];
                    const completedStates = ['uploading', 'stalledup', 'checkingup', 'forcedup', 'queuedup', 'moving'];

                    reply += `- ${torrent.name} (State: ${torrent.state})\n`;
                    if (downloadingStates.includes(torrent.state.toLowerCase())) {
                        reply += `  ${createProgressBar(torrent.progress, torrent.dlspeed, torrent.num_seeds, torrent.num_leechs)}\n`;
                    } else if (completedStates.includes(torrent.state.toLowerCase()) && torrent.progress === 1) {
                        reply += `  ${createProgressBar(1, 0, torrent.num_seeds, torrent.num_leechs)} \n`; // Progress is 1 (100%), speed is 0 for completed
                    } else {
                        reply += `  (S: ${torrent.num_seeds ?? 'N/A'} | L: ${torrent.num_leechs ?? 'N/A'})\n`;
                    }
                });
                if (reply.length > 1950) {
                    const cutOffMessage = '... (list truncated due to length)';
                    reply = reply.substring(0, 1950 - cutOffMessage.length) + cutOffMessage;
                }
                await interaction.editReply(reply);
                addLogEntry(user, `/${commandName}`, 'Successfully fetched and displayed torrents.');
            } else {
                await interaction.editReply('No torrents found or an issue occurred.');
                addLogEntry(user, `/${commandName}`, 'No torrents found or an issue occurred.');
            }
        } else if (commandName === 'seed') {
            addLogEntry(user, `/${commandName}`, 'Fetching seeding torrents');
            await interaction.deferReply();
            const result = await qbitGetSeedingTorrents();
            if (result.error) {
                await interaction.editReply(`Error fetching seeding torrents: ${result.error}`);
                addLogEntry(user, `/${commandName}`, `Error fetching seeding torrents: ${result.error}`);
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
                await interaction.editReply(reply);
                addLogEntry(user, `/${commandName}`, 'Successfully fetched and displayed seeding torrents.');
            } else {
                await interaction.editReply('No torrents are currently being seeded, or an issue occurred.');
                addLogEntry(user, `/${commandName}`, 'No torrents are currently being seeded, or an issue occurred.');
            }
        } else if (commandName === 'addmagnet') {
            const magnetUrl = interaction.options.getString('link', true);
            const category = interaction.options.getString('category') || 'series'; // Default to 'series' if not provided
    
            addLogEntry(user, `/${commandName}`, `Attempting to add magnet: ${magnetUrl.substring(0, 70)}... Category: ${category}`);
    
            if (!magnetUrl.startsWith('magnet:?')) {
                await interaction.reply({ content: 'Invalid magnet link provided. It must start with "magnet:?".', ephemeral: true });
                addLogEntry(user, `/${commandName}`, `Invalid magnet link: ${magnetUrl}`);
                return;
            }
    
            const displayName = getDisplayNameFromMagnet(magnetUrl);
            addLogEntry(user, `/${commandName}`, `Parsed display name (if any): ${displayName}`);
    
            let savePath: string | undefined;
            let categoryDisplay = category.charAt(0).toUpperCase() + category.slice(1);
    
            switch (category) {
                case 'movie':
                    savePath = process.env.QBITTORRENT_MOVIES_SAVE_PATH;
                    break;
                case 'anime':
                    savePath = process.env.QBITTORRENT_ANIME_SAVE_PATH;
                    break;
                case 'series':
                default:
                    savePath = process.env.QBITTORRENT_SERIES_SAVE_PATH || process.env.QBITTORRENT_DEFAULT_SAVE_PATH;
                    categoryDisplay = 'Series (Default)';
                    break;
            }
            
            if (!savePath) {
                addLogEntry(user, `/${commandName}`, `Save path for category '${category}' is not configured in .env. Using qBittorrent default.`);
            }
    
            const initialReplyMessage = displayName
                ? `Attempting to add torrent: **${displayName}**`
                : `Attempting to add magnet link...`;
    
            await interaction.reply(initialReplyMessage + ` (Category: ${categoryDisplay}` + (savePath ? `, Save Path: ${savePath}` : ', Save Path: qBittorrent Default') + ')');
            
            const result = await qbitAddTorrentByMagnet(magnetUrl, savePath); 
            if (result.success) {
                if (result.torrent && result.torrent.hash) {
                    let replyText = `Successfully added torrent: **${result.torrent.name}**\n`;
                    replyText += `  ${createProgressBar(result.torrent.progress, result.torrent.dlspeed, result.torrent.num_seeds, result.torrent.num_leechs)}\n`;
                    
                    const sentMessage = await interaction.followUp({ content: replyText, fetchReply: true });
                    
                    if (result.torrent.progress < 1) {
                        activeTorrentMessages.set(result.torrent.hash, {
                            message: sentMessage,
                            lastProgress: result.torrent.progress,
                            isCompleted: false,
                            addedOn: result.torrent.added_on, 
                            torrentName: result.torrent.name
                        });
                    }
                    addLogEntry(user, `/${commandName}`, `Successfully added torrent: ${result.torrent.name} (Hash: ${result.torrent.hash})`);
                } else {
                    await interaction.followUp('Successfully sent magnet link to qBittorrent, but could not immediately retrieve torrent details for live updates.');
                    addLogEntry(user, `/${commandName}`, `Failed to add torrent (no valid torrent info returned): ${magnetUrl.substring(0,50)}...`);
                }
            } else {
                await interaction.followUp(`Failed to add torrent: ${result.error}`);
                addLogEntry(user, `/${commandName}`, `Error adding torrent by magnet: ${result.error}`);
            }
        } else if (commandName === 'delete') {
            const category = interaction.options.getString('category', true);
            const deleteFiles = interaction.options.getBoolean('delete_files', true);
            addLogEntry(user, `/${commandName}`, `Initiated. Category: ${category}, Delete Files: ${deleteFiles}`);
            await interaction.deferReply({ ephemeral: true });

            let categoryPathEnv: string | undefined;
            switch (category) {
                case 'series': categoryPathEnv = process.env.QBITTORRENT_SERIES_SAVE_PATH; break;
                case 'movie': categoryPathEnv = process.env.QBITTORRENT_MOVIES_SAVE_PATH; break;
                case 'anime': categoryPathEnv = process.env.QBITTORRENT_ANIME_SAVE_PATH; break;
                default:
                    await interaction.editReply('Invalid category specified.');
                    addLogEntry(user, `/${commandName}`, `Invalid category: ${category}`);
                    return;
            }

            if (!categoryPathEnv) {
                await interaction.editReply(`Save path for category '${category}' is not configured in the bot's .env file.`);
                addLogEntry(user, `/${commandName}`, `Missing .env path for category: ${category}`);
                return;
            }
            
            // Normalize the category path from .env
            addLogEntry(user, `/${commandName}`, `Raw categoryPathEnv for ${category}: ${categoryPathEnv}`);
            const normalizedCategoryPath = normalizePathForComparison(categoryPathEnv);
            addLogEntry(user, `/${commandName}`, `Normalized category path for ${category} (for comparison): ${normalizedCategoryPath}`);

            const torrentResult = await qbitGetTorrents();
            if (torrentResult.error || !torrentResult.torrents) {
                await interaction.editReply(`Error fetching torrents: ${torrentResult.error || 'No torrents data'}`);
                addLogEntry(user, `/${commandName}`, `Error fetching torrents: ${torrentResult.error || 'No torrents data'}`);
                return;
            }

            const filteredTorrents = torrentResult.torrents.filter(t => {
                // Normalize the torrent's save_path for comparison
                addLogEntry(user, `/${commandName}`, `Torrent: ${t.name}, Original save_path: ${t.save_path}`);
                const normalizedTorrentSavePath = normalizePathForComparison(t.save_path);
                addLogEntry(user, `/${commandName}`, `Torrent: ${t.name}, Normalized save_path (for comparison): ${normalizedTorrentSavePath}`);
                
                // Perform a case-insensitive startsWith check now that both paths are lowercased by normalizePathForComparison
                const isMatch = normalizedTorrentSavePath.startsWith(normalizedCategoryPath);
                if (!isMatch) {
                    addLogEntry(user, `/${commandName}`, `NO MATCH: Normalized Torrent Path (${normalizedTorrentSavePath}) vs Normalized Category Path (${normalizedCategoryPath})`);
                }
                return isMatch;
            });

            if (filteredTorrents.length === 0) {
                await interaction.editReply(`No torrents found in the '${category}' category (path: ${normalizedCategoryPath}).`);
                addLogEntry(user, `/${commandName}`, `No torrents found for category ${category} at path ${normalizedCategoryPath}`);
                return;
            }

            const options = filteredTorrents.slice(0, 25).map(torrent => ({
                label: torrent.name.substring(0, 100), // Max label length is 100
                description: `Size: ${(torrent.size / (1024 * 1024 * 1024)).toFixed(2)} GB, State: ${torrent.state}`.substring(0,100),
                value: torrent.hash,
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`delete-select:${deleteFiles}:${interaction.id}`) // Pass deleteFiles and original interaction ID
                .setPlaceholder('Select torrent(s) to delete')
                .setMinValues(1)
                .setMaxValues(Math.min(options.length, 25))
                .addOptions(options);
            
            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

            const cancelInitialButton = new ButtonBuilder()
                .setCustomId(`delete-cancel-initial:${interaction.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);
            const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelInitialButton);

            let replyContent = `Found ${filteredTorrents.length} torrent(s) in '${category}'. Select which to delete:`;
            if (filteredTorrents.length > 25) {
                replyContent += `\n(Showing first 25 torrents. Deletion of more than 25 at once is not currently supported via this menu.)`;
            }
            
            await interaction.editReply({
                content: replyContent,
                components: [row, buttonRow],
            });
            addLogEntry(user, `/${commandName}`, `Presented ${options.length} torrents for deletion selection in category ${category}.`);

        } else if (commandName === 'logs') {
            addLogEntry(user, `/${commandName}`, 'Requesting last 20 log entries');
            await interaction.deferReply();
            try {
                const logs = getRecentLogs(20);
                if (logs.length > 0) {
                    let logOutput = "```\n";
                    logs.forEach(log => {
                        if (logOutput.length + log.length + 4 > 1990) { 
                            interaction.followUp(logOutput + "```"); 
                            logOutput = "```\n"; 
                        }
                        logOutput += log + "\n";
                    });
                    if (interaction.replied || interaction.deferred) {
                        await interaction.editReply(logOutput + "```");
                    } else {
                         await interaction.reply(logOutput + "```");
                    }
                    addLogEntry(user, `/${commandName}`, 'Successfully displayed last 20 log entries.');
                } else {
                    await interaction.editReply('No log entries to display.');
                    addLogEntry(user, `/${commandName}`, 'No log entries found to display.');
                }
            } catch (error) {
                console.error('Error fetching logs:', error);
                await interaction.editReply('Failed to fetch logs.');
                addLogEntry(user, `/${commandName}`, `Error fetching logs: ${error instanceof Error ? error.message : String(error)}`);
            }
        } else if (commandName === 'help') {
            addLogEntry(user, `/${commandName}`, 'Requesting command list');
            let reply = 'Here are the available commands:\n';
            availableCommandHelp.forEach(cmd => {
                reply += `**${cmd.name}**: ${cmd.description}\n`;
            });
            await interaction.reply({ content: reply, ephemeral: true });
            addLogEntry(user, `/${commandName}`, 'Successfully displayed command list.');
        }
    } else if (interaction.isStringSelectMenu()) {
        const [actionPrefix, deleteFilesStr, originalInteractionId] = interaction.customId.split(':');
        
        if (actionPrefix === 'delete-select' && originalInteractionId) {
            const deleteFiles = deleteFilesStr === 'true';
            const selectedHashes = interaction.values;
            addLogEntry(user, `/delete (select)`, `Selected ${selectedHashes.length} torrents. Delete files: ${deleteFiles}. Original interaction: ${originalInteractionId}`);

            if (selectedHashes.length === 0) {
                await interaction.update({ content: 'No torrents selected. Operation cancelled.', components: [] });
                return;
            }

            // Store for confirmation step
            pendingDeletions.set(originalInteractionId, { hashes: selectedHashes, deleteFiles });

            const torrentResult = await qbitGetTorrents(); // Re-fetch to get names for confirmation
            const selectedTorrentNames = selectedHashes.map(hash => {
                const torrent = torrentResult.torrents?.find(t => t.hash === hash);
                return torrent ? torrent.name : `Unknown torrent (hash: ${hash.substring(0,8)}...)`;
            });

            const confirmButton = new ButtonBuilder()
                .setCustomId(`delete-confirm-final:${originalInteractionId}`)
                .setLabel('Confirm Delete')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`delete-cancel-final:${originalInteractionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

            await interaction.update({
                content: `Are you sure you want to delete the following ${selectedHashes.length} torrent(s)?\n- ${selectedTorrentNames.join('\n- ')}\n\n**Files will ${deleteFiles ? '' : 'NOT '}be deleted from disk.**`,
                components: [row],
            });
            addLogEntry(user, `/delete (select)`, `Confirmation presented for ${selectedHashes.length} torrents.`);
        }
    } else if (interaction.isButton()) {
        const [actionPrefix, ...params] = interaction.customId.split(':');
        const originalInteractionId = params[params.length -1]; // last param is usually the ID

        if (actionPrefix === 'delete-cancel-initial' && originalInteractionId) {
             addLogEntry(user, `/delete (cancel initial)`, `Cancelled deletion process for interaction ${originalInteractionId}`);
            await interaction.update({ content: 'Torrent deletion process cancelled.', components: [] });
        } else if (actionPrefix === 'delete-confirm-final' && originalInteractionId) {
            const details = pendingDeletions.get(originalInteractionId);
            if (!details) {
                await interaction.update({ content: 'Error: Could not find deletion details. The request may have timed out. Please try again.', components: [] });
                addLogEntry(user, `/delete (confirm error)`, `No pending deletion details found for ${originalInteractionId}`);
                return;
            }
            addLogEntry(user, `/delete (confirm)`, `Confirmed deletion for ${details.hashes.length} torrents. Delete files: ${details.deleteFiles}. Interaction: ${originalInteractionId}`);

            await interaction.update({ content: `Deleting ${details.hashes.length} torrent(s)... (Files ${details.deleteFiles ? 'WILL' : 'WILL NOT'} be deleted)`, components: [] });

            const success = await qbitDeleteTorrents(details.hashes, details.deleteFiles);
            pendingDeletions.delete(originalInteractionId);

            if (success) {
                await interaction.followUp({ content: `Successfully deleted ${details.hashes.length} torrent(s).`, ephemeral: true });
                addLogEntry(user, `/delete (confirm success)`, `Successfully deleted ${details.hashes.length} torrents. Files deleted: ${details.deleteFiles}`);
            } else {
                await interaction.followUp({ content: 'Failed to delete some or all selected torrent(s). Check qBittorrent and bot logs.', ephemeral: true });
                addLogEntry(user, `/delete (confirm failure)`, `Failed to delete torrents. Hashes: ${details.hashes.join(', ')}. Files deleted: ${details.deleteFiles}`);
            }
        } else if (actionPrefix === 'delete-cancel-final' && originalInteractionId) {
            addLogEntry(user, `/delete (cancel final)`, `Cancelled final deletion confirmation for interaction ${originalInteractionId}`);
            pendingDeletions.delete(originalInteractionId);
            await interaction.update({ content: 'Torrent deletion cancelled.', components: [] });
        }
    }
});

async function updateTrackedTorrents() {
    if (activeTorrentMessages.size === 0) return;

    for (const [hash, trackedInfo] of activeTorrentMessages.entries()) {
        if (trackedInfo.isCompleted) continue;

        const torrentInfo = await qbitGetTorrentByHash(hash);

        if (torrentInfo) { // torrentInfo is TorrentInfo if found, otherwise undefined
            const torrent = torrentInfo; // Assign to 'torrent' for clarity and minimal changes below
            let messageContent = `**${trackedInfo.torrentName}** (State: ${torrent.state})\n`;
            messageContent += `  ${createProgressBar(torrent.progress, torrent.dlspeed, torrent.num_seeds, torrent.num_leechs)}\n`;

            if (torrent.progress >= 1 && !trackedInfo.isCompleted) {
                const completionTime = Date.now();
                const durationSeconds = (completionTime - (trackedInfo.addedOn * 1000)) / 1000; // addedOn is in seconds
                messageContent += `Status: Completed! Total time: ${formatDuration(durationSeconds)}\n`;
                addLogEntry('System', 'TorrentComplete', `${trackedInfo.torrentName} completed. Total time: ${formatDuration(durationSeconds)}`);
                trackedInfo.isCompleted = true; // Mark as completed to stop further updates
                activeTorrentMessages.delete(hash); // Remove from active tracking
            } else if (torrent.state.toLowerCase().includes('error') || torrent.state.toLowerCase().includes('stalled')) {
                messageContent += `Status: Stalled or Errored. Last known progress: ${(torrent.progress * 100).toFixed(1)}%\n`;
                addLogEntry('System', 'TorrentError', `${trackedInfo.torrentName} stalled or errored. State: ${torrent.state}`);
                trackedInfo.isCompleted = true; // Stop tracking problematic torrents
                activeTorrentMessages.delete(hash);
            }

            try {
                await trackedInfo.message.edit(messageContent);
                trackedInfo.lastProgress = torrent.progress;
            } catch (error) {
                console.error(`Failed to edit message for torrent ${hash}:`, error);
                addLogEntry('System', 'DiscordError', `Failed to edit message for ${trackedInfo.torrentName}: ${error instanceof Error ? error.message : String(error)}`);
                activeTorrentMessages.delete(hash); // Stop tracking if message editing fails
            }
        } else {
            // Torrent not found by qbitGetTorrentByHash (returned undefined)
            // This could be due to login failure within qbitGetTorrentByHash or torrent truly not existing.
            console.log(`Torrent ${hash} (${trackedInfo.torrentName}) not found by qbitGetTorrentByHash. Assuming removed or login issue, stopping updates.`);
            addLogEntry('System', 'TorrentNotFoundOrLoginIssue', `${trackedInfo.torrentName} (hash: ${hash}) not found by API. Assuming removed or qBit login issue.`);
            try {
                await trackedInfo.message.edit(`**${trackedInfo.torrentName}** - No longer found in qBittorrent or connection issue. Updates stopped.`);
            } catch (editError) {
                console.error(`Failed to edit message for removed/unreachable torrent ${hash}:`, editError);
            }
            activeTorrentMessages.delete(hash);
        }
    }
}

export function startDiscordBot() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error('DISCORD_BOT_TOKEN is not set in .env file');
        addLogEntry('System', 'BotStartupError', 'DISCORD_BOT_TOKEN not set.');
        process.exit(1);
    }
    client.login(token);
}
