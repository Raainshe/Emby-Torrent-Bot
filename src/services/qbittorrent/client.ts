import { addLogEntry } from '../../utils/logUtils';
import axios from 'axios';
import FormData from 'form-data';
import type { TorrentInfo, GetTorrentsResult, AddTorrentResult } from './types';
import { SEEDING_STATES } from './types';

const QBIT_URL = process.env.QBITTORRENT_URL;
const QBIT_USERNAME = process.env.QBITTORRENT_USERNAME;
const QBIT_PASSWORD = process.env.QBITTORRENT_PASSWORD;

let sid = ''; // To store the session ID

async function login(): Promise<boolean> {
    if (!QBIT_URL || !QBIT_USERNAME || !QBIT_PASSWORD) {
        return false;
    }
    try {
        const response = await axios.post(
            `${QBIT_URL}/api/v2/auth/login`,
            `username=${encodeURIComponent(QBIT_USERNAME)}&password=${encodeURIComponent(QBIT_PASSWORD)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        if (response.status === 200 && response.data && response.data.trim() === "Ok.") {
             if (response.headers['set-cookie']) {
                const cookieHeader = Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [response.headers['set-cookie']!];
                const sidCookie = cookieHeader.find(cookie => cookie.startsWith('SID='));
                if (sidCookie) {
                    sid = sidCookie ? sidCookie.split(';')[0] || '' : ''; // Ensure sid is always a string
                    return true;
                }
            }
            return false;
        }
        return false;
    } catch (error: any) {
        return false;
    }
}

async function getTorrents(): Promise<GetTorrentsResult> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            return { error: 'Failed to login to qBittorrent. Check credentials and qBittorrent WebUI settings.' };
        }
    }
    if (!QBIT_URL) {
         return { error: 'qBittorrent URL not configured.' };
    }

    try {
        const response = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
            headers: {
                Cookie: sid,
            },
        });
        return { torrents: response.data }; // Array of torrent objects
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
                         headers: {
                            Cookie: sid,
                        },
                    });
                    return { torrents: retryResponse.data };
                } catch (retryError: any) {
                    return { error: 'Error getting torrents after re-login' };
                }
            } else {
                 return { error: 'Failed to re-login to qBittorrent after session expiry.' };
            }
        }
        return { error: 'Error fetching torrents' };
    }
}

async function getSeedingTorrents(): Promise<GetTorrentsResult> {
    const result = await getTorrents();

    if (result.error) {
        return { error: result.error };
    }

    if (result.torrents) {
        const seedingTorrents = result.torrents.filter(torrent =>
            SEEDING_STATES.includes(torrent.state.toLowerCase())
        );
        return { torrents: seedingTorrents };
    }

    return { torrents: [] }; // Should not happen if no error and no torrents
}

async function getTorrentByHash(hash: string): Promise<TorrentInfo | undefined> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            // Cannot log in, so cannot fetch torrent
            return undefined;
        }
    }
    if (!QBIT_URL) {
        return undefined;
    }

    try {
        const response = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
            params: {
                hashes: hash // qBittorrent API can filter by one or more hashes
            },
            headers: {
                Cookie: sid,
            },
        });

        if (response.data && response.data.length > 0) {
            return response.data[0]; // Return the first (and should be only) torrent
        }
        return undefined;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
                        params: {
                            hashes: hash // qBittorrent API can filter by one or more hashes
                        },
                        headers: {
                            Cookie: sid,
                        },
                    });
                    if (retryResponse.data && retryResponse.data.length > 0) {
                        return retryResponse.data[0]; // Return the first (and should be only) torrent
                    }
                    return undefined;
                } catch (retryError: any) {
                    return undefined;
                }
            } else {
                return undefined;
            }
        }
        return undefined;
    }
}

async function addTorrentByMagnet(magnetUrl: string, savePath?: string): Promise<AddTorrentResult> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            return { success: false, error: "Failed to login to qBittorrent. Check credentials and qBittorrent WebUI settings." };
        }
    }
    if (!QBIT_URL) {
        return { success: false, error: "qBittorrent URL not configured." };
    }

    const formData = new FormData();
    formData.append('urls', magnetUrl);
    if (savePath) {
        formData.append('savepath', savePath);
    }

    try {
        const response = await axios.post(`${QBIT_URL}/api/v2/torrents/add`, formData, {
            headers: {
                ...formData.getHeaders(),
                Cookie: sid,
            },
        });

        if (response.status === 200) {
            // qBittorrent should return "Ok." on success
            if (response.data && response.data.trim() === "Ok.") {
                // Extract hash from magnet link to get torrent info
                const magnetLinkParts = magnetUrl.split('&');
                const btihPart = magnetLinkParts.find(part => part.startsWith('xt=urn:btih:'));
                if (btihPart) {
                    const hashParts = btihPart.split(':');
                    const hash = hashParts[3]; // Extract the hash part
                    if (hash) {
                        // We'll try to fetch the torrent info, but it might not be immediately available
                        // Try a few times with short delays
                        let torrent: TorrentInfo | undefined;
                        for (let i = 0; i < 5; i++) {
                            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
                            torrent = await getTorrentByHash(hash);
                            if (torrent) break;
                        }
                        return { success: true, torrent };
                    }
                }
                return { success: true };
            } else {
                return { success: false, error: `Unexpected response from qBittorrent: ${response.data}` };
            }
        } else {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.post(`${QBIT_URL}/api/v2/torrents/add`, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            Cookie: sid,
                        },
                    });
                    if (retryResponse.status === 200) {
                        if (retryResponse.data && retryResponse.data.trim() === "Ok.") {
                            return { success: true };
                        } else {
                            return { success: false, error: `Unexpected response from qBittorrent: ${retryResponse.data}` };
                        }
                    } else {
                        return { success: false, error: `HTTP ${retryResponse.status}: ${retryResponse.statusText}` };
                    }
                } catch (retryError: any) {
                    return { success: false, error: "Error adding torrent after re-login" };
                }
            } else {
                return { success: false, error: "Failed to re-login to qBittorrent after session expiry." };
            }
        }
        return { success: false, error: "Error communicating with qBittorrent" };
    }
}

async function deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<boolean> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            return false;
        }
    }
    if (!QBIT_URL) {
        return false;
    }

    const hashesParam = hashes.join('|');
    const formData = new FormData();
    formData.append('hashes', hashesParam);
    formData.append('deleteFiles', deleteFiles ? 'true' : 'false');

    try {
        const response = await axios.post(`${QBIT_URL}/api/v2/torrents/delete`, formData, {
            headers: {
                ...formData.getHeaders(),
                Cookie: sid,
            },
        });

        return response.status === 200;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.post(`${QBIT_URL}/api/v2/torrents/delete`, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            Cookie: sid,
                        },
                    });
                    return retryResponse.status === 200;
                } catch (retryError: any) {
                    return false;
                }
            } else {
                return false;
            }
        }
        return false;
    }
}

async function pauseTorrents(hashes: string[]): Promise<boolean> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            return false;
        }
    }
    if (!QBIT_URL) {
        return false;
    }

    const hashesParam = hashes.join('|');
    const formData = new FormData();
    formData.append('hashes', hashesParam);

    try {
        const response = await axios.post(`${QBIT_URL}/api/v2/torrents/pause`, formData, {
            headers: {
                ...formData.getHeaders(),
                Cookie: sid,
            },
        });

        return response.status === 200;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.post(`${QBIT_URL}/api/v2/torrents/pause`, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            Cookie: sid,
                        },
                    });
                    return retryResponse.status === 200;
                } catch (retryError: any) {
                    return false;
                }
            } else {
                return false;
            }
        }
        return false;
    }
}

// Export functions with consistent naming
export {
    login as qbitLogin,
    getTorrents as qbitGetTorrents,
    getSeedingTorrents as qbitGetSeedingTorrents,
    getTorrentByHash as qbitGetTorrentByHash,
    addTorrentByMagnet as qbitAddTorrentByMagnet,
    deleteTorrents as qbitDeleteTorrents,
    pauseTorrents as qbitPauseTorrents
}; 