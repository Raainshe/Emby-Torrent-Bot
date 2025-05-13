// Import necessary classes and types from the discord.js library.
import { Client, Events, GatewayIntentBits, Message } from "discord.js";
// Import qBittorrent functions
import { qbitLogin, qbitGetTorrents, qbitGetSeedingTorrents, qbitAddTorrentByMagnet, qbitGetTorrentByHash } from './qbittorrent';
import type { TorrentInfo } from './qbittorrent';
// Import the progress bar utility
import { createProgressBar, formatDuration } from './utils/displayUtils'; // Added formatDuration
import { addLogEntry, getRecentLogs } from './utils/logUtils'; // Import logging functions
import dotenv from 'dotenv';

dotenv.config();

// Store active torrent messages for updates: Map<torrentHash, MessageToUpdate>
interface MessageToUpdate {
    message: Message;
    lastProgress: number;
    isCompleted: boolean; // To prevent multiple "completed" updates
    addedOn: number; // Timestamp (seconds) when the torrent was added by qBittorrent
    torrentName: string; // Store the torrent name directly
}
const activeTorrentMessages = new Map<string, MessageToUpdate>();
const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds, adjust as needed

// Create a new Discord client instance.
const client = new Client({
    // Define the intents for the client. Intents specify which events the bot will receive.
    intents: [
        GatewayIntentBits.Guilds, // Allows receiving guild-related events (e.g., server creation).
        GatewayIntentBits.GuildMessages, // Allows receiving messages sent in guilds (servers).
        GatewayIntentBits.MessageContent, // Allows accessing the content of messages. This is a privileged intent.
    ],
});

// Define available commands
const availableCommands = [
    { name: '!torrents', description: 'Lists all current torrents with their status and progress.' },
    { name: '!seed', description: 'Lists all torrents that are currently seeding.' },
    { name: '!addmagnet <magnet_link>', description: 'Adds a new torrent using the provided magnet link.' },
    { name: '!logs', description: 'Displays the last 20 log entries.' },
    { name: '!commands', description: 'Displays this list of available commands.' }
];

// Register an event listener for the ClientReady event.
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in to Discord as ${readyClient.user?.tag}!`); // Log Discord login
    addLogEntry('System', 'BotLogin', `Logged in as ${readyClient.user?.tag}`);
    const qbitLoggedIn = await qbitLogin();
    if (qbitLoggedIn) {
        console.log("Successfully logged into qBittorrent."); // Log qBittorrent login success
        addLogEntry('System', 'QbitLogin', 'Successfully logged into qBittorrent WebUI.');
    } else {
        console.warn("Initial login to qBittorrent failed. Check .env configuration and qBittorrent status."); // Kept this warn as it's a startup issue
        addLogEntry('System', 'QbitLoginFailure', 'Failed to login to qBittorrent: ${error instanceof Error ? error.message : String(error)}');
    }

    // Start polling for torrent updates
    setInterval(updateTrackedTorrents, POLLING_INTERVAL_MS);
});

// Register an event listener for the MessageCreate event.
client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.DISCORD_PREFIX || '!')) return;

    const args = message.content.slice((process.env.DISCORD_PREFIX || '!').length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const user = message.author.tag;

    // Command to list torrents
    if (command === 'torrents') {
        addLogEntry(user, command, 'Fetching all torrents');
        const result = await qbitGetTorrents();
        if (result.error) {
            message.reply(`Error fetching torrents: ${result.error}`);
            addLogEntry(user, command, `Error fetching torrents: ${result.error}`);
            return;
        }
        if (result.torrents && result.torrents.length > 0) {
            let reply = '**Current Torrents:**\n';
            result.torrents.forEach(torrent => {
                // States where progress is most relevant
                const downloadingStates = ['downloading', 'stalledDL', 'checkingDL', 'pausedDL', 'metaDL'];
                // States that are effectively 100% or where progress isn't displayed as a bar
                const completedStates = ['uploading', 'stalledUP', 'checkingUP', 'forcedUP', 'queuedUP', 'moving'];

                reply += `- ${torrent.name} (State: ${torrent.state})\n`;
                if (downloadingStates.includes(torrent.state.toLowerCase())) {
                    reply += `  ${createProgressBar(torrent.progress, torrent.dlspeed, torrent.num_seeds, torrent.num_leechs)}\n`;
                } else if (completedStates.includes(torrent.state.toLowerCase()) && torrent.progress === 1) {
                    reply += `  ${createProgressBar(1, 0, torrent.num_seeds, torrent.num_leechs)} \n`; // Show 100% for completed/seeding, dlspeed is 0
                } else {
                    // For other states, show basic info without progress bar or specific S/L if not relevant
                    reply += `  (S: ${torrent.num_seeds ?? 'N/A'} | L: ${torrent.num_leechs ?? 'N/A'})\n`;
                }
            });
            if (reply.length > 1950) { // Discord message limit is 2000 characters
                const cutOffMessage = '... (list truncated due to length)';
                reply = reply.substring(0, 1950 - cutOffMessage.length) + cutOffMessage;
            }
            message.reply(reply);
            addLogEntry(user, command, 'Successfully fetched and displayed torrents.');
        } else {
            message.reply('No torrents found or an issue occurred.');
            addLogEntry(user, command, 'No torrents found or an issue occurred.');
        }
    }

    // Command to list seeding torrents
    if (command === 'seed') {
        addLogEntry(user, command, 'Fetching seeding torrents');
        const result = await qbitGetSeedingTorrents();
        if (result.error) {
            message.reply(`Error fetching seeding torrents: ${result.error}`);
            addLogEntry(user, command, `Error fetching seeding torrents: ${result.error}`);
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
            addLogEntry(user, command, 'Successfully fetched and displayed seeding torrents.');
        } else {
            message.reply('No torrents are currently being seeded, or an issue occurred.');
            addLogEntry(user, command, 'No torrents are currently being seeded, or an issue occurred.');
        }
    }

    // Command to add a torrent via magnet URL
    if (command === 'addmagnet') {
        const magnetUrl = args[0];
        if (!magnetUrl) {
            message.reply('Please provide a magnet link. Usage: !addmagnet <magnet_link>');
            addLogEntry(user, command, 'Missing magnet link argument');
            return;
        }
        if (!magnetUrl.startsWith('magnet:?')) {
            message.reply('Invalid magnet link provided. It must start with "magnet:?".');
            addLogEntry(user, command, `Invalid magnet link: ${magnetUrl}`);
            return;
        }

        addLogEntry(user, command, `Attempting to add magnet: ${magnetUrl.substring(0, 50)}...`); // Log part of magnet to avoid overly long logs

        // Use the default save path from .env; it will be undefined if not set, which is correct for qbitAddTorrentByMagnet
        const defaultSavePath = process.env.QBITTORRENT_DEFAULT_SAVE_PATH;

        message.reply(`Attempting to add magnet: ${magnetUrl}` + (defaultSavePath ? ` with save path: ${defaultSavePath}` : ''));
        
        const result = await qbitAddTorrentByMagnet(magnetUrl, defaultSavePath);
        if (result.success) {
            if (result.torrent && result.torrent.hash) {
                let replyText = `Successfully added torrent: **${result.torrent.name}**\n`;
                replyText += `  ${createProgressBar(result.torrent.progress, result.torrent.dlspeed, result.torrent.num_seeds, result.torrent.num_leechs)}\n`;
                
                const sentMessage = await message.reply(replyText);
                // Start tracking this torrent for progress updates if it's not already completed
                if (result.torrent.progress < 1) {
                    activeTorrentMessages.set(result.torrent.hash, { 
                        message: sentMessage, 
                        lastProgress: result.torrent.progress,
                        isCompleted: false,
                        addedOn: result.torrent.added_on, // Store the added_on timestamp
                        torrentName: result.torrent.name // Store the torrent name
                    });
                }
                addLogEntry(user, command, `Successfully added torrent: ${result.torrent.name} (Hash: ${result.torrent.hash})`);
            } else {
                message.reply('Successfully sent magnet link to qBittorrent, but could not immediately retrieve torrent details for live updates.');
                addLogEntry(user, command, `Failed to add torrent (no valid torrent info returned): ${magnetUrl.substring(0,50)}...`);
            }
        } else {
            message.reply(`Failed to add torrent: ${result.error}`);
            addLogEntry(user, command, `Error adding torrent by magnet: ${result.error}`);
        }
    }

    // Command to display the last 20 log entries
    if (command === 'logs') {
        addLogEntry(user, command, 'Requesting last 20 log entries');
        try {
            const logs = getRecentLogs(20);
            if (logs.length > 0) {
                // Discord has a 2000 character limit per message.
                // We'll send logs in chunks if necessary, though 20 lines is usually fine.
                let logOutput = "```\n";
                logs.forEach(log => {
                    if (logOutput.length + log.length + 4 > 1990) { // Check before adding next log
                        message.reply(logOutput + "```");
                        logOutput = "```\n";
                    }
                    logOutput += log + "\n";
                });
                message.reply(logOutput + "```");
                addLogEntry(user, command, 'Successfully displayed last 20 log entries.');
            } else {
                message.reply('No log entries to display.');
                addLogEntry(user, command, 'No log entries found to display.');
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            message.reply('Failed to fetch logs.');
            addLogEntry(user, command, `Error fetching logs: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Command to display the list of available commands
    if (command === 'commands') {
        addLogEntry(user, command, 'Requesting command list');
        let reply = 'Here are the available commands:\n';
        availableCommands.forEach(cmd => {
            reply += `**${cmd.name}**: ${cmd.description}\n`;
        });
        message.reply(reply);
        addLogEntry(user, command, 'Successfully displayed command list.');
    }
});

async function updateTrackedTorrents() {
    if (activeTorrentMessages.size === 0) {
        return; // No torrents to track
    }

    // console.log(`[Polling] Checking ${activeTorrentMessages.size} active torrents for updates...`);

    for (const [hash, trackedInfo] of activeTorrentMessages.entries()) {
        if (trackedInfo.isCompleted) continue; // Skip already completed torrents

        const currentTorrentInfo = await qbitGetTorrentByHash(hash);

        if (!currentTorrentInfo) {
            // Torrent might have been removed or an error occurred
            try {
                // Use the stored torrentName directly
                await trackedInfo.message.edit(`Torrent **${trackedInfo.torrentName}** is no longer accessible or has been removed.`);
            } catch (editError) {
                // console.error(`Error editing message for removed torrent ${hash}:`, editError);
                addLogEntry('System', 'TorrentUpdateError', `Error editing message for removed/missing torrent ${trackedInfo.torrentName} (Hash: ${hash}): ${editError instanceof Error ? editError.message : String(editError)}`);
            }
            activeTorrentMessages.delete(hash);
            addLogEntry('System', 'TorrentUpdate', `Torrent removed/missing, stopped tracking: ${trackedInfo.torrentName} (Hash: ${hash})`);
            continue;
        }

        const progressChanged = (currentTorrentInfo?.progress ?? 0) !== trackedInfo.lastProgress;
        const isNowCompleted = currentTorrentInfo.progress >= 1;
        // Define states that mean downloading is finished and it might be seeding/completed
        const finishedStates = ['uploading', 'stalledUP', 'checkingUP', 'forcedUP', 'queuedUP', 'completed', 'forcedDL']; // forcedDL can sometimes be 100%
        const isEffectivelyComplete = isNowCompleted || finishedStates.includes(currentTorrentInfo.state.toLowerCase());

        if (progressChanged || (isEffectivelyComplete && !trackedInfo.isCompleted)) {
            let newContent = `Torrent: **${currentTorrentInfo.name}** (State: ${currentTorrentInfo.state})\n`;
            if (isEffectivelyComplete) {
                newContent += `  ${createProgressBar(1, 0, currentTorrentInfo.num_seeds, currentTorrentInfo.num_leechs)}\n`; // dlspeed is 0 for completed
                
                // Calculate and add download duration
                if (currentTorrentInfo.completion_on && trackedInfo.addedOn) {
                    const durationSeconds = currentTorrentInfo.completion_on - trackedInfo.addedOn;
                    if (durationSeconds > 0) {
                        newContent += `Download complete! 🎉 (Took: ${formatDuration(durationSeconds)})\n`;
                    } else {
                        newContent += 'Download complete! 🎉\n'; // Fallback if timestamps are unusual
                    }
                } else {
                    newContent += 'Download complete! 🎉\n';
                }
                trackedInfo.isCompleted = true; // Mark as completed to stop further updates for this specific message state
            } else {
                newContent += `  ${createProgressBar(currentTorrentInfo.progress, currentTorrentInfo.dlspeed, currentTorrentInfo.num_seeds, currentTorrentInfo.num_leechs)}\n`;
            }

            try {
                await trackedInfo.message.edit(newContent);
                trackedInfo.lastProgress = currentTorrentInfo.progress;
            } catch (editError) {
                // console.error(`Error editing message for torrent ${hash}:`, editError);
                // If message is deleted or inaccessible, stop tracking
                if ((editError as any).code === 10008) { // Unknown Message
                    activeTorrentMessages.delete(hash);
                }
            }
        }

        // If it's marked completed by our logic, remove from active tracking to save API calls
        if (trackedInfo.isCompleted) {
            activeTorrentMessages.delete(hash);
        }
    }
}

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
