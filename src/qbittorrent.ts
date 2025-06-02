// Re-export qBittorrent functionality from the new structured services
// This file maintains backward compatibility during the restructuring process

export {
    qbitLogin,
    qbitGetTorrents,
    qbitGetSeedingTorrents,
    qbitGetTorrentByHash,
    qbitAddTorrentByMagnet,
    qbitDeleteTorrents,
    qbitPauseTorrents
} from './services/qbittorrent/client.js';

export type {
    TorrentInfo,
    GetTorrentsResult,
    AddTorrentResult
} from './services/qbittorrent/types.js';

export { SEEDING_STATES } from './services/qbittorrent/types.js';
