import axios from 'axios';
import { load } from 'cheerio';
import type { TorrentSearchResult, TorrentSearchResponse, SearchOptions } from './types.js';

const BASE_URL = 'https://thepiratebay.org';
const SEARCH_URL = `${BASE_URL}/search`;
const CATEGORY_MAP: Record<string, string> = {
    'movies': '/200', // Video > Movies
    'tv': '/205',     // Video > TV shows
    'anime': '/205',  // Video > TV shows (anime usually in TV)
    'all': '/0'       // All categories
};

// User agents for TPB
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

let userAgentIndex = 0;

function getRandomUserAgent(): string {
    userAgentIndex = (userAgentIndex + 1) % USER_AGENTS.length;
    return USER_AGENTS[userAgentIndex]!;
}

/**
 * Add delay between requests
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search torrents on The Pirate Bay
 */
export async function searchTPB(options: SearchOptions): Promise<TorrentSearchResponse> {
    try {
        const { query, category = 'all', page = 1 } = options;
        
        // Add delay to avoid rate limiting
        await delay(1500 + Math.random() * 2000);
        
        // Build search URL - TPB format: /search/query/page/99/categorycode
        const categoryCode = CATEGORY_MAP[category] || '/0';
        const searchQuery = encodeURIComponent(query);
        const url = `${SEARCH_URL}/${searchQuery}/${page - 1}/99${categoryCode}`;
        
        console.log(`Searching TPB: ${url}`);
        
        const userAgent = getRandomUserAgent();
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        // Check for blocked content
        if (response.data.includes('403 Forbidden') || response.data.includes('Access Denied')) {
            console.error('TPB is blocking requests');
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0,
                error: 'TPB is currently blocking requests'
            };
        }

        const $ = load(response.data);
        const results: TorrentSearchResult[] = [];

        // Parse TPB results - TPB uses #searchResult table
        $('#searchResult tbody tr, .searchResult tbody tr, table#searchResult tr').each((_index: number, element: any) => {
            try {
                const $row = $(element);
                
                // Skip header rows and ads
                if ($row.find('th').length > 0 || $row.hasClass('header')) return;
                
                // Get torrent name and detail link
                const nameCell = $row.find('td:nth-child(2) .detLink, td:nth-child(1) .detLink');
                const title = nameCell.text().trim();
                const detailLink = nameCell.attr('href');
                
                if (!title || !detailLink) return;
                
                // Get magnet link
                const magnetLink = $row.find('a[href^="magnet:"]').attr('href') || '';
                
                // Get seeders and leechers
                const seeders = parseInt($row.find('td:nth-child(3)').text().trim()) || 0;
                const leechers = parseInt($row.find('td:nth-child(4)').text().trim()) || 0;
                
                // Get size and upload info from description
                const descText = $row.find('td:nth-child(2) .detDesc').text();
                const sizeMatch = descText.match(/Size\s+([^,]+)/i);
                const uploaderMatch = descText.match(/ULed by\s+([^,\s]+)/i);
                const dateMatch = descText.match(/Uploaded\s+([^,]+)/i);
                
                const size = sizeMatch?.[1]?.trim() || 'Unknown';
                const uploader = uploaderMatch?.[1]?.trim() || 'Unknown';
                const uploadDate = dateMatch?.[1]?.trim() || 'Unknown';
                
                // Skip torrents with no seeders
                if (seeders === 0) return;
                
                results.push({
                    title,
                    size,
                    seeds: seeders,
                    leeches: leechers,
                    magnetLink,
                    category: category,
                    uploadDate,
                    uploader,
                    site: 'TPB',
                    detailUrl: detailLink.startsWith('http') ? detailLink : `${BASE_URL}${detailLink}`
                });
                
            } catch (error) {
                console.error('Error parsing TPB row:', error);
            }
        });

        // Sort by seeders (descending)
        results.sort((a, b) => b.seeds - a.seeds);

        console.log(`Found ${results.length} results from TPB`);

        return {
            results: results.slice(0, 20),
            totalResults: results.length,
            page,
            totalPages: Math.ceil(results.length / 20),
        };

    } catch (error) {
        console.error('Error searching TPB:', error);
        
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 403) {
                return {
                    results: [],
                    totalResults: 0,
                    page: 1,
                    totalPages: 0,
                    error: 'TPB is blocking requests (403 Forbidden)'
                };
            }
        }
        
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

/**
 * Get magnet link for TPB torrent (usually already available in search results)
 */
export async function getMagnetLinkTPB(torrent: TorrentSearchResult): Promise<string | null> {
    // TPB usually provides magnet links directly in search results
    if (torrent.magnetLink && torrent.magnetLink.startsWith('magnet:')) {
        return torrent.magnetLink;
    }
    
    // If not available, try to fetch from detail page
    if (torrent.detailUrl) {
        try {
            await delay(2000);
            
            const response = await axios.get(torrent.detailUrl, {
                headers: {
                    'User-Agent': getRandomUserAgent()
                },
                timeout: 10000
            });
            
            const $ = load(response.data);
            const magnetLink = $('a[href^="magnet:"]').first().attr('href');
            
            return magnetLink || null;
        } catch (error) {
            console.error('Error fetching magnet from TPB detail page:', error);
            return null;
        }
    }
    
    return null;
} 