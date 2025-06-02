import type { Client, Interaction, CacheType, Message } from 'discord.js';
import { Events, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } from 'discord.js';
import { qbitGetTorrents, qbitGetSeedingTorrents, qbitAddTorrentByMagnet, qbitGetTorrentByHash, qbitDeleteTorrents, qbitPauseTorrents } from '../../services/qbittorrent/client.js';
import type { TorrentInfo } from '../../services/qbittorrent/types.js';
import { createProgressBar, formatDuration, formatSpeed, formatSize } from '../../utils/displayUtils.js';
import { addLogEntry, getRecentLogs } from '../../utils/logUtils.js';
import { getSeedingStatus, markTorrentCompleted, trackTorrentForSeeding, removeTorrentTracking, manuallyStopSeeding } from '../../managers/seedingManager.js';
import { normalizePathForComparison, convertWindowsPathToWslPath, getDisplayNameFromMagnet } from '../../utils/pathUtils.js';
import { availableCommandHelp } from '../commands/index.js';
import * as diskusage from 'diskusage';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import os from 'os';

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

// Map to store pending seed stop operations <interactionId, string[]>
const pendingSeedStops = new Map<string, string[]>();

export function createCommandHandlers(client: Client) {
    // Handle slash command interactions
    client.on(Events.InteractionCreate, async (interaction: Interaction<CacheType>) => {
        const user = interaction.user.tag;

        try {
            if (interaction.isChatInputCommand()) {
                const commandName = interaction.commandName;

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
                } else if (commandName === 'seedstatus') {
                    addLogEntry(user, `/${commandName}`, 'Fetching seeding time management status');
                    await interaction.deferReply();
                    
                    try {
                        const seedingStatus = getSeedingStatus();
                        
                        if (seedingStatus.length === 0) {
                            await interaction.editReply('No torrents are currently being tracked for seeding time management.');
                            addLogEntry(user, `/${commandName}`, 'No torrents being tracked for seeding.');
                            return;
                        }
                        
                        let reply = '**Seeding Time Management Status:**\n';
                        const now = Math.floor(Date.now() / 1000);
                        
                        for (const tracking of seedingStatus) {
                            reply += `\n**${tracking.name}**\n`;
                            
                            if (tracking.downloadCompletionTime && tracking.downloadDuration && tracking.seedingStopTime) {
                                const timeRemaining = tracking.seedingStopTime - now;
                                const downloadMinutes = Math.round(tracking.downloadDuration / 60);
                                const seedingHours = Math.round(tracking.downloadDuration * 10 / 3600);
                                
                                if (tracking.stopped) {
                                    reply += `  ✅ Seeding stopped (exceeded 10x download time)\n`;
                                    reply += `  📥 Download time: ${downloadMinutes} minutes\n`;
                                    reply += `  📤 Seeded for: ${seedingHours} hours\n`;
                                } else if (timeRemaining <= 0) {
                                    reply += `  ⏰ Should be stopped (time exceeded)\n`;
                                    reply += `  📥 Download time: ${downloadMinutes} minutes\n`;
                                    reply += `  📤 Target seeding time: ${seedingHours} hours\n`;
                                } else {
                                    const hoursRemaining = Math.round(timeRemaining / 3600);
                                    reply += `  🌱 Currently seeding\n`;
                                    reply += `  📥 Download time: ${downloadMinutes} minutes\n`;
                                    reply += `  ⏳ Time remaining: ${hoursRemaining} hours\n`;
                                }
                            } else {
                                const downloadStartedAgo = Math.round((now - tracking.downloadStartTime) / 3600);
                                reply += `  📥 Downloading (started ${downloadStartedAgo} hours ago)\n`;
                            }
                        }
                        
                        if (reply.length > 1950) {
                            const cutOffMessage = '... (list truncated due to length)';
                            reply = reply.substring(0, 1950 - cutOffMessage.length) + cutOffMessage;
                        }
                        
                        await interaction.editReply(reply);
                        addLogEntry(user, `/${commandName}`, `Successfully displayed seeding status for ${seedingStatus.length} torrents.`);
                        
                    } catch (error) {
                        await interaction.editReply('Error fetching seeding status.');
                        addLogEntry(user, `/${commandName}`, `Error fetching seeding status: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'stopallseeds') {
                    addLogEntry(user, `/${commandName}`, 'Initiated stop all seeds command');
                    await interaction.deferReply({ ephemeral: true });

                    try {
                        const result = await qbitGetSeedingTorrents();
                        if (result.error || !result.torrents) {
                            await interaction.editReply(`Error fetching seeding torrents: ${result.error || 'No torrents data'}`);
                            addLogEntry(user, `/${commandName}`, `Error fetching seeding torrents: ${result.error || 'No torrents data'}`);
                            return;
                        }

                        if (result.torrents.length === 0) {
                            await interaction.editReply('No torrents are currently seeding.');
                            addLogEntry(user, `/${commandName}`, 'No seeding torrents found');
                            return;
                        }

                        const seedingHashes = result.torrents.map(t => t.hash);
                        
                        // Store for confirmation
                        pendingSeedStops.set(interaction.id, seedingHashes);

                        const confirmButton = new ButtonBuilder()
                            .setCustomId(`stopallseeds-confirm:${interaction.id}`)
                            .setLabel('Confirm Stop All')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId(`stopallseeds-cancel:${interaction.id}`)
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

                        await interaction.editReply({
                            content: `⚠️ **Stop All Seeds Confirmation**\n\nAre you sure you want to stop seeding for **${result.torrents.length}** torrents?\n\nTorrents that will be stopped:\n${result.torrents.map(t => `• ${t.name}`).slice(0, 10).join('\n')}${result.torrents.length > 10 ? `\n... and ${result.torrents.length - 10} more` : ''}`,
                            components: [row],
                        });
                        addLogEntry(user, `/${commandName}`, `Confirmation presented for stopping ${result.torrents.length} seeding torrents`);

                    } catch (error) {
                        await interaction.editReply('Error processing stop all seeds command.');
                        addLogEntry(user, `/${commandName}`, `Error processing command: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'stopspecificseeds') {
                    addLogEntry(user, `/${commandName}`, 'Initiated stop specific seeds command');
                    await interaction.deferReply({ ephemeral: true });

                    try {
                        const result = await qbitGetSeedingTorrents();
                        if (result.error || !result.torrents) {
                            await interaction.editReply(`Error fetching seeding torrents: ${result.error || 'No torrents data'}`);
                            addLogEntry(user, `/${commandName}`, `Error fetching seeding torrents: ${result.error || 'No torrents data'}`);
                            return;
                        }

                        if (result.torrents.length === 0) {
                            await interaction.editReply('No torrents are currently seeding.');
                            addLogEntry(user, `/${commandName}`, 'No seeding torrents found');
                            return;
                        }

                        const options = result.torrents.slice(0, 25).map(torrent => ({
                            label: torrent.name.substring(0, 100), // Max label length is 100
                            description: `Ratio: ${torrent.ratio.toFixed(2)} | Upload: ${(torrent.uploaded / (1024 * 1024 * 1024)).toFixed(2)} GB`.substring(0, 100),
                            value: torrent.hash,
                        }));

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`stopseeds-select:${interaction.id}`)
                            .setPlaceholder('Select torrent(s) to stop seeding')
                            .setMinValues(1)
                            .setMaxValues(Math.min(options.length, 25))
                            .addOptions(options);
                        
                        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId(`stopseeds-cancel:${interaction.id}`)
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

                        await interaction.editReply({
                            content: '**Select Torrents to Stop Seeding:**\nChoose one or more torrents from the dropdown below.',
                            components: [row, buttonRow],
                        });
                        addLogEntry(user, `/${commandName}`, `Presented selection menu for ${result.torrents.length} seeding torrents`);

                    } catch (error) {
                        await interaction.editReply('Error processing stop specific seeds command.');
                        addLogEntry(user, `/${commandName}`, `Error processing command: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'addmagnet') {
                    const magnetLink = interaction.options.getString('link', true);
                    const category = interaction.options.getString('category') || 'series';
                    addLogEntry(user, `/${commandName}`, `Adding magnet link with category: ${category}`);
                    await interaction.deferReply();

                    const savePath = getSavePathByCategory(category);
                    const result = await qbitAddTorrentByMagnet(magnetLink, savePath);

                    if (result.success) {
                        let displayName = getDisplayNameFromMagnet(magnetLink) || 'Unknown Torrent';
                        await interaction.editReply(`Torrent "${displayName}" added successfully! Tracking progress...`);
                        addLogEntry(user, `/${commandName}`, `Magnet link added successfully for category: ${category}`);

                        if (result.torrent) {
                            trackTorrentForSeeding(result.torrent);
                            trackTorrentProgress(result.torrent.hash, interaction.followUp.bind(interaction), displayName, result.torrent.added_on);
                        } else {
                            setTimeout(async () => {
                                const torrentsResult = await qbitGetTorrents();
                                if (torrentsResult.torrents && torrentsResult.torrents.length > 0) {
                                    const latestTorrent = torrentsResult.torrents.reduce((latest, current) => {
                                        return (latest.added_on > current.added_on) ? latest : current;
                                    });
                                    const now = Math.floor(Date.now() / 1000);
                                    if (latestTorrent && (now - latestTorrent.added_on < 30)) {
                                        trackTorrentForSeeding(latestTorrent);
                                        trackTorrentProgress(latestTorrent.hash, interaction.followUp.bind(interaction), latestTorrent.name, latestTorrent.added_on);
                                    }
                                }
                            }, 2000);
                        }
                    } else {
                        await interaction.editReply(`Failed to add magnet link: ${result.error}`);
                        addLogEntry(user, `/${commandName}`, `Failed to add magnet link: ${result.error}`);
                    }
                } else if (commandName === 'delete') {
                    const category = interaction.options.getString('category', true);
                    const deleteFiles = interaction.options.getBoolean('delete_files', true);
                    addLogEntry(user, `/${commandName}`, `Initiated delete command for category: ${category}, deleteFiles: ${deleteFiles}`);
                    await interaction.deferReply({ ephemeral: true });

                    try {
                        const result = await qbitGetTorrents();
                        if (result.error || !result.torrents) {
                            await interaction.editReply(`Error fetching torrents: ${result.error || 'No torrents data'}`);
                            addLogEntry(user, `/${commandName}`, `Error fetching torrents: ${result.error || 'No torrents data'}`);
                            return;
                        }

                        const savePath = getSavePathByCategory(category);
                        const normalizedTargetPath = normalizePathForComparison(savePath);
                        
                        const filteredTorrents = result.torrents.filter(torrent => {
                            const normalizedTorrentPath = normalizePathForComparison(torrent.save_path);
                            return normalizedTorrentPath.startsWith(normalizedTargetPath);
                        });

                        if (filteredTorrents.length === 0) {
                            await interaction.editReply(`No torrents found in the "${category}" category.`);
                            addLogEntry(user, `/${commandName}`, `No torrents found for category: ${category}`);
                            return;
                        }

                        const options = filteredTorrents.slice(0, 25).map(torrent => ({
                            label: torrent.name.substring(0, 100),
                            description: `State: ${torrent.state} | Progress: ${(torrent.progress * 100).toFixed(1)}%`.substring(0, 100),
                            value: torrent.hash,
                        }));

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`delete-select:${interaction.id}`)
                            .setPlaceholder('Select torrent(s) to delete')
                            .setMinValues(1)
                            .setMaxValues(Math.min(options.length, 25))
                            .addOptions(options);
                        
                        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

                        pendingDeletions.set(interaction.id, { hashes: [], deleteFiles });

                        await interaction.editReply({
                            content: `**Delete Torrents - ${category.charAt(0).toUpperCase() + category.slice(1)} Category**\n\nFound ${filteredTorrents.length} torrent(s).\nFiles will ${deleteFiles ? '**also be deleted**' : '**NOT be deleted**'} from disk.\n\nSelect torrent(s) to delete:`,
                            components: [row],
                        });
                        addLogEntry(user, `/${commandName}`, `Presented ${filteredTorrents.length} torrents for deletion in category: ${category}`);

                    } catch (error) {
                        await interaction.editReply('Error processing delete command.');
                        addLogEntry(user, `/${commandName}`, `Error processing command: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'diskspace') {
                    const customPath = interaction.options.getString('path');
                    addLogEntry(user, `/${commandName}`, `Checking disk space for path: ${customPath || 'default'}`);
                    await interaction.deferReply();

                    try {
                        let pathToCheck = customPath || process.env.DISK_SPACE_CHECK_PATH;
                        
                        if (!pathToCheck) {
                            pathToCheck = os.platform() === 'win32' ? 'C:\\' : '/';
                        }

                        if (pathToCheck.match(/^[a-zA-Z]:[\\\/]/)) {
                            pathToCheck = convertWindowsPathToWslPath(pathToCheck);
                        }

                        const info = await diskusage.check(pathToCheck);
                        const totalGB = (info.total / (1024 ** 3)).toFixed(2);
                        const freeGB = (info.free / (1024 ** 3)).toFixed(2);
                        const usedGB = ((info.total - info.free) / (1024 ** 3)).toFixed(2);
                        const usedPercentage = (((info.total - info.free) / info.total) * 100).toFixed(1);

                        const chartData = {
                            labels: ['Used', 'Free'],
                            datasets: [{
                                data: [info.total - info.free, info.free],
                                backgroundColor: ['#ff6384', '#36a2eb'],
                                borderWidth: 2,
                                borderColor: '#ffffff',
                            }]
                        };

                        const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 400, height: 400 });
                        const chartBuffer = await chartJSNodeCanvas.renderToBuffer({
                            type: 'pie',
                            data: chartData,
                            options: {
                                responsive: false,
                                plugins: {
                                    title: {
                                        display: true,
                                        text: `Disk Usage: ${pathToCheck}`,
                                        font: { size: 16 }
                                    },
                                    legend: {
                                        position: 'bottom',
                                        labels: { font: { size: 12 } }
                                    }
                                }
                            }
                        });

                        const attachment = new AttachmentBuilder(chartBuffer, { name: 'diskusage.png' });
                        
                        await interaction.editReply({
                            content: `**Disk Space Information**\n**Path:** \`${pathToCheck}\`\n**Total:** ${totalGB} GB\n**Used:** ${usedGB} GB (${usedPercentage}%)\n**Free:** ${freeGB} GB`,
                            files: [attachment],
                        });
                        addLogEntry(user, `/${commandName}`, `Successfully displayed disk space for: ${pathToCheck}`);

                    } catch (error) {
                        await interaction.editReply(`Error checking disk space: ${error instanceof Error ? error.message : String(error)}`);
                        addLogEntry(user, `/${commandName}`, `Error checking disk space: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'logs') {
                    addLogEntry(user, `/${commandName}`, 'Fetching recent logs');
                    await interaction.deferReply({ ephemeral: true });

                    try {
                        const logs = getRecentLogs(20);
                        let logText = '**Recent Bot Activity (Last 20 entries):**\n\n';
                        logs.forEach(log => {
                            logText += `${log}\n`;
                        });

                        if (logText.length > 1950) {
                            logText = logText.substring(0, 1950) + '... (truncated)';
                        }

                        await interaction.editReply(logText);
                        addLogEntry(user, `/${commandName}`, 'Successfully displayed recent logs');

                    } catch (error) {
                        await interaction.editReply('Error fetching logs.');
                        addLogEntry(user, `/${commandName}`, `Error fetching logs: ${error instanceof Error ? error.message : String(error)}`);
                    }
                } else if (commandName === 'help') {
                    addLogEntry(user, `/${commandName}`, 'Displaying help information');
                    await interaction.deferReply({ ephemeral: true });

                    let helpText = '**Available Commands:**\n\n';
                    availableCommandHelp.forEach(command => {
                        helpText += `**${command.name}**\n${command.description}\n\n`;
                    });

                    if (helpText.length > 1950) {
                        helpText = helpText.substring(0, 1950) + '... (truncated)';
                    }

                    await interaction.editReply(helpText);
                    addLogEntry(user, `/${commandName}`, 'Successfully displayed help information');
                }
            } else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                
                if (customId.startsWith('delete-select:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    const pendingDeletion = pendingDeletions.get(interactionId);
                    
                    if (!pendingDeletion) {
                        await interaction.reply({ content: 'This deletion request has expired. Please run the command again.', ephemeral: true });
                        return;
                    }

                    const selectedHashes = interaction.values;
                    pendingDeletion.hashes = selectedHashes;

                    const result = await qbitGetTorrents();
                    if (result.torrents) {
                        const selectedTorrents = result.torrents.filter(t => selectedHashes.includes(t.hash));
                        
                        const confirmButton = new ButtonBuilder()
                            .setCustomId(`delete-confirm:${interactionId}`)
                            .setLabel('Confirm Delete')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId(`delete-cancel:${interactionId}`)
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

                        await interaction.update({
                            content: `⚠️ **Confirm Deletion**\n\nAre you sure you want to delete ${selectedTorrents.length} torrent(s)?\nFiles will ${pendingDeletion.deleteFiles ? '**also be deleted**' : '**NOT be deleted**'} from disk.\n\n**Selected torrents:**\n${selectedTorrents.map(t => `• ${t.name}`).join('\n')}`,
                            components: [row],
                        });
                    }
                } else if (customId.startsWith('stopseeds-select:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    const selectedHashes = interaction.values;
                    
                    // Store the selected hashes
                    pendingSeedStops.set(interactionId, selectedHashes);

                    const result = await qbitGetSeedingTorrents();
                    if (result.torrents) {
                        const selectedTorrents = result.torrents.filter(t => selectedHashes.includes(t.hash));
                        
                        const confirmButton = new ButtonBuilder()
                            .setCustomId(`stopseeds-confirm:${interactionId}`)
                            .setLabel('Stop Seeding')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId(`stopseeds-cancel:${interactionId}`)
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

                        await interaction.update({
                            content: `⚠️ **Confirm Stop Seeding**\n\nAre you sure you want to stop seeding for ${selectedTorrents.length} torrent(s)?\n\n**Selected torrents:**\n${selectedTorrents.map(t => `• ${t.name}`).join('\n')}`,
                            components: [row],
                        });
                    }
                }
            } else if (interaction.isButton()) {
                const customId = interaction.customId;
                
                if (customId.startsWith('delete-confirm:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    const pendingDeletion = pendingDeletions.get(interactionId);
                    
                    if (!pendingDeletion) {
                        await interaction.reply({ content: 'This deletion request has expired.', ephemeral: true });
                        return;
                    }

                    await interaction.deferUpdate();
                    
                    const success = await qbitDeleteTorrents(pendingDeletion.hashes, pendingDeletion.deleteFiles);
                    
                    if (success) {
                        for (const hash of pendingDeletion.hashes) {
                            removeTorrentTracking(hash);
                            activeTorrentMessages.delete(hash);
                        }
                        
                        await interaction.editReply({
                            content: `✅ Successfully deleted ${pendingDeletion.hashes.length} torrent(s)${pendingDeletion.deleteFiles ? ' and their files' : ''}.`,
                            components: [],
                        });
                        addLogEntry(user, 'delete-confirm', `Successfully deleted ${pendingDeletion.hashes.length} torrents`);
                    } else {
                        await interaction.editReply({
                            content: '❌ Failed to delete some or all torrents. Check the logs for more details.',
                            components: [],
                        });
                        addLogEntry(user, 'delete-confirm', 'Failed to delete torrents');
                    }
                    
                    pendingDeletions.delete(interactionId);
                } else if (customId.startsWith('delete-cancel:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    pendingDeletions.delete(interactionId);
                    
                    await interaction.update({
                        content: '❌ Deletion cancelled.',
                        components: [],
                    });
                    addLogEntry(user, 'delete-cancel', 'User cancelled deletion');
                } else if (customId.startsWith('stopallseeds-confirm:') || customId.startsWith('stopseeds-confirm:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    const hashesToStop = pendingSeedStops.get(interactionId);
                    
                    if (!hashesToStop) {
                        await interaction.reply({ content: 'This stop seeds request has expired.', ephemeral: true });
                        return;
                    }

                    await interaction.deferUpdate();
                    
                    const success = await manuallyStopSeeding(hashesToStop);
                    
                    if (success) {
                        await interaction.editReply({
                            content: `✅ Successfully stopped seeding for ${hashesToStop.length} torrent(s).`,
                            components: [],
                        });
                        addLogEntry(user, 'stopseeds-confirm', `Successfully stopped seeding for ${hashesToStop.length} torrents`);
                    } else {
                        await interaction.editReply({
                            content: '❌ Failed to stop seeding for some or all torrents. Check the logs for more details.',
                            components: [],
                        });
                        addLogEntry(user, 'stopseeds-confirm', 'Failed to stop seeding for torrents');
                    }
                    
                    pendingSeedStops.delete(interactionId);
                } else if (customId.startsWith('stopallseeds-cancel:') || customId.startsWith('stopseeds-cancel:')) {
                    const interactionId = customId.split(':')[1];
                    if (!interactionId) return;
                    
                    pendingSeedStops.delete(interactionId);
                    
                    await interaction.update({
                        content: '❌ Stop seeding cancelled.',
                        components: [],
                    });
                    addLogEntry(user, 'stopseeds-cancel', 'User cancelled stop seeding');
                }
            }
        } catch (error) {
            console.error('Error handling interaction:', error);
            addLogEntry(user, 'InteractionError', `Error: ${error instanceof Error ? error.message : String(error)}`);
            
            if (interaction.isRepliable()) {
                if ('deferred' in interaction && interaction.deferred || 'replied' in interaction && interaction.replied) {
                    try {
                        await interaction.editReply('An error occurred while processing your request.');
                    } catch (e) {
                        console.error('Failed to edit reply after error:', e);
                    }
                } else {
                    try {
                        await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
                    } catch (e) {
                        console.error('Failed to reply after error:', e);
                    }
                }
            }
        }
    });

    // Start the polling for active torrent updates
    startTorrentPolling();
}

// Helper function to get save path by category
function getSavePathByCategory(category: string): string {
    switch (category.toLowerCase()) {
        case 'series':
            return process.env.QBITTORRENT_SERIES_SAVE_PATH || process.env.QBITTORRENT_DEFAULT_SAVE_PATH || '/downloads/torrents/series';
        case 'movie':
            return process.env.QBITTORRENT_MOVIES_SAVE_PATH || process.env.QBITTORRENT_DEFAULT_SAVE_PATH || '/downloads/torrents/movies';
        case 'anime':
            return process.env.QBITTORRENT_ANIME_SAVE_PATH || process.env.QBITTORRENT_DEFAULT_SAVE_PATH || '/downloads/torrents/anime';
        default:
            return process.env.QBITTORRENT_DEFAULT_SAVE_PATH || '/downloads/torrents/default';
    }
}

// Function to track torrent progress and update Discord messages
async function trackTorrentProgress(hash: string, followUp: any, displayName: string, addedOn: number): Promise<void> {
    try {
        const initialMessage = await followUp({
            content: `🌱 **${displayName}**\nInitializing torrent...`,
            ephemeral: false,
        });

        activeTorrentMessages.set(hash, {
            message: initialMessage,
            lastProgress: 0,
            isCompleted: false,
            addedOn: addedOn,
            torrentName: displayName,
        });

        addLogEntry('System', 'TorrentTracking', `Started tracking progress for: ${displayName} (Hash: ${hash})`);
    } catch (error) {
        console.error('Error setting up torrent tracking:', error);
        addLogEntry('System', 'TorrentTrackingError', `Failed to set up tracking for: ${displayName}`);
    }
}

// Function to update tracked torrents periodically
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
                
                // Mark torrent as completed for seeding time management
                markTorrentCompleted(torrent);
                
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

// Start the polling interval for torrent updates
function startTorrentPolling() {
    setInterval(updateTrackedTorrents, POLLING_INTERVAL_MS);
    addLogEntry('System', 'TorrentPolling', `Started torrent polling every ${POLLING_INTERVAL_MS}ms`);
} 