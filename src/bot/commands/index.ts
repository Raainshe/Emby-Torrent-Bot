import { SlashCommandBuilder } from 'discord.js';

export function registerCommands() {
    const slashCommands = [
        new SlashCommandBuilder().setName('torrents').setDescription('Lists all current torrents with their status and progress.'),
        new SlashCommandBuilder().setName('seed').setDescription('Lists all torrents that are currently seeding.'),
        new SlashCommandBuilder().setName('seedstatus').setDescription('Shows seeding time management status for all tracked torrents.'),
        new SlashCommandBuilder().setName('stopallseeds').setDescription('Stops seeding for all currently seeding torrents (with confirmation).'),
        new SlashCommandBuilder().setName('stopspecificseeds').setDescription('Select and stop seeding for specific torrents.'),
        new SlashCommandBuilder().setName('addmagnet')
            .setDescription('Adds a new torrent using the provided magnet link.')
            .addStringOption(option =>
                option.setName('link')
                    .setDescription('The magnet link of the torrent to add.')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('The category for the download (determines save path).')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Series', value: 'series' },
                        { name: 'Movie', value: 'movie' },
                        { name: 'Anime', value: 'anime' }
                    )),
        new SlashCommandBuilder().setName('delete')
            .setDescription('Deletes a torrent from qBittorrent, optionally with files.')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('The category of torrents to list for deletion.')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Series', value: 'series' },
                        { name: 'Movie', value: 'movie' },
                        { name: 'Anime', value: 'anime' }
                    ))
            .addBooleanOption(option =>
                option.setName('delete_files')
                    .setDescription('Whether to delete the files from disk as well.')
                    .setRequired(true)),
        new SlashCommandBuilder().setName('diskspace')
            .setDescription('Shows disk space usage for a specified path or default path.')
            .addStringOption(option =>
                option.setName('path')
                    .setDescription('The path to check disk space for (e.g., /mnt/c/downloads or C:\\\\Downloads).')
                    .setRequired(false)),
        new SlashCommandBuilder().setName('logs').setDescription('Displays the most recent bot activity logs.'),
        new SlashCommandBuilder().setName('help').setDescription('Displays a list of all available slash commands and their descriptions.')
    ];

    return slashCommands;
}

export const availableCommandHelp = [
    { name: '/torrents', description: 'Lists all current torrents with their status and progress.' },
    { name: '/seed', description: 'Lists all torrents that are currently seeding.' },
    { name: '/seedstatus', description: 'Shows seeding time management status for all tracked torrents.' },
    { name: '/stopallseeds', description: 'Stops seeding for all currently seeding torrents (with confirmation).' },
    { name: '/stopspecificseeds', description: 'Select and stop seeding for specific torrents.' },
    { name: '/addmagnet', description: 'Adds a new torrent using the provided magnet link.' },
    { name: '/delete', description: 'Deletes a torrent from qBittorrent, optionally with files.' },
    { name: '/diskspace', description: 'Shows disk space usage for a specified path or default path.' },
    { name: '/logs', description: 'Displays the most recent bot activity logs.' },
    { name: '/help', description: 'Displays a list of all available slash commands and their descriptions.' }
]; 