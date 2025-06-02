import axios from 'axios';
import { load } from 'cheerio';
import type { TorrentSearchResult, TorrentSearchResponse, SearchOptions } from './types.js';

const BASE_URL = 'https://1337x.to';
const SEARCH_URL = `${BASE_URL}/search`;
const CATEGORY_MAP: Record<string, string> = {
    'movies': '/Movies/',
    'tv': '/TV/',
    'anime': '/Anime/',
    'all': '/'
};

// Rotate between different user agents to avoid detection
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

let userAgentIndex = 0;

function getRandomUserAgent(): string {
    userAgentIndex = (userAgentIndex + 1) % USER_AGENTS.length;
    return USER_AGENTS[userAgentIndex]!;
}

/**
 * Add delay between requests to avoid rate limiting
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search torrents on 1337x with enhanced protection bypass
 */
export async function search1337x(options: SearchOptions): Promise<TorrentSearchResponse> {
    try {
        const { query, category = 'all', page = 1, sortBy = 'seeders', sortOrder = 'desc' } = options;
        
        // Add delay to avoid rate limiting
        await delay(1000 + Math.random() * 2000); // 1-3 second random delay
        
        // Build search URL
        const categoryPath = CATEGORY_MAP[category] || '/';
        const searchQuery = encodeURIComponent(query);
        const url = `${SEARCH_URL}${categoryPath}${searchQuery}/${page}/`;
        
        console.log(`Searching 1337x: ${url}`);
        
        const userAgent = getRandomUserAgent();
        console.log(`Using user agent: ${userAgent.substring(0, 50)}...`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            },
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Only accept 2xx status codes
            }
        });

        // Check if we got a Cloudflare challenge page
        if (response.data.includes('Just a moment...') || response.data.includes('challenge-platform')) {
            console.error('1337x is blocking requests with Cloudflare protection');
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0,
                error: 'Site is currently blocking automated requests. Please try again later or use a different search method.'
            };
        }

        const $ = load(response.data);
        const results: TorrentSearchResult[] = [];

        // Parse search results - try multiple selectors as sites may change structure
        const rowSelectors = ['tbody tr', '.table-list tbody tr', 'table tr'];
        let foundResults = false;

        for (const selector of rowSelectors) {
            const rows = $(selector);
            if (rows.length > 1) { // More than just header row
                rows.each((_index: number, element: any) => {
                    try {
                        const $row = $(element);
                        
                        // Skip header row
                        if ($row.find('th').length > 0) return;
                        
                        // Extract name and link - try multiple patterns
                        const nameCell = $row.find('td:nth-child(1), td:first-child');
                        const nameLinks = nameCell.find('a');
                        
                        let torrentLink = '';
                        let title = '';
                        
                        // Try different link patterns
                        if (nameLinks.length >= 2) {
                            torrentLink = nameLinks.eq(1).attr('href') || '';
                            title = nameLinks.eq(1).text().trim();
                        } else if (nameLinks.length === 1) {
                            torrentLink = nameLinks.first().attr('href') || '';
                            title = nameLinks.first().text().trim();
                        }
                        
                        if (!title || !torrentLink) return;
                        
                        // Extract seeders, leechers, and size - positions may vary
                        const cells = $row.find('td');
                        let seeders = 0;
                        let leechers = 0;
                        let uploadDate = '';
                        let size = '';
                        let uploader = '';
                        
                        // Try to parse based on common patterns
                        if (cells.length >= 6) {
                            seeders = parseInt($(cells[1]).text().trim()) || 0;
                            leechers = parseInt($(cells[2]).text().trim()) || 0;
                            uploadDate = $(cells[3]).text().trim();
                            size = $(cells[4]).text().trim();
                            uploader = $(cells[5]).text().trim();
                        } else if (cells.length >= 5) {
                            seeders = parseInt($(cells[1]).text().trim()) || 0;
                            leechers = parseInt($(cells[2]).text().trim()) || 0;
                            uploadDate = $(cells[3]).text().trim();
                            size = $(cells[4]).text().trim();
                        }
                        
                        // Skip if essential data is missing
                        if (!size || seeders === 0) return;
                        
                        results.push({
                            title,
                            size,
                            seeds: seeders,
                            leeches: leechers,
                            magnetLink: '', // Will be fetched separately
                            category: category,
                            uploadDate,
                            uploader,
                            site: '1337x',
                            detailUrl: `${BASE_URL}${torrentLink}`
                        });
                        
                        foundResults = true;
                        
                    } catch (error) {
                        console.error('Error parsing torrent row:', error);
                    }
                });
                
                if (foundResults) break; // Found results with this selector, stop trying others
            }
        }

        // Sort results if needed
        if (sortBy === 'seeders') {
            results.sort((a, b) => sortOrder === 'desc' ? b.seeds - a.seeds : a.seeds - b.seeds);
        } else if (sortBy === 'leechers') {
            results.sort((a, b) => sortOrder === 'desc' ? b.leeches - a.leeches : a.leeches - b.leeches);
        }

        console.log(`Found ${results.length} results from 1337x`);

        return {
            results: results.slice(0, 20), // Limit to 20 results
            totalResults: results.length,
            page,
            totalPages: Math.ceil(results.length / 20),
        };

    } catch (error) {
        console.error('Error searching 1337x:', error);
        
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 403) {
                return {
                    results: [],
                    totalResults: 0,
                    page: 1,
                    totalPages: 0,
                    error: 'Site is blocking requests (403 Forbidden). This is likely due to bot protection. Please try again later.'
                };
            } else if (error.response?.status === 429) {
                return {
                    results: [],
                    totalResults: 0,
                    page: 1,
                    totalPages: 0,
                    error: 'Rate limited. Please wait before searching again.'
                };
            }
        }
        
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: error instanceof Error ? error.message : 'Unknown error occurred while searching'
        };
    }
}

/**
 * Get magnet link from torrent detail page with enhanced protection bypass
 */
export async function getMagnetLink1337x(detailUrl: string): Promise<string | null> {
    try {
        // Add delay before fetching magnet link
        await delay(2000 + Math.random() * 3000); // 2-5 second delay
        
        const userAgent = getRandomUserAgent();
        console.log(`Fetching magnet link from: ${detailUrl}`);
        
        const response = await axios.get(detailUrl, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Referer': 'https://1337x.to/',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        // Check for Cloudflare protection
        if (response.data.includes('Just a moment...') || response.data.includes('challenge-platform')) {
            console.error('Cloudflare protection detected when fetching magnet link');
            return null;
        }

        const $ = load(response.data);
        
        // Look for magnet link with multiple selectors
        const magnetSelectors = [
            'a[href^="magnet:"]',
            '.download-links a[href^="magnet:"]',
            '.torrent-download a[href^="magnet:"]',
            'ul.download-links a[href^="magnet:"]'
        ];
        
        for (const selector of magnetSelectors) {
            const magnetLink = $(selector).first().attr('href');
            if (magnetLink && magnetLink.startsWith('magnet:')) {
                console.log('Successfully found magnet link');
                return magnetLink;
            }
        }
        
        console.warn('No magnet link found on the page');
        return null;
        
    } catch (error) {
        console.error('Error fetching magnet link:', error);
        return null;
    }
} 