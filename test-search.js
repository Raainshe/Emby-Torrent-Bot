// Simple test script to verify search functionality
import { searchTorrentsWithMetadata } from './src/services/search/integration.js';

async function testSearch() {
    console.log('Testing torrent search functionality...');
    
    try {
        const results = await searchTorrentsWithMetadata({
            query: 'The Matrix',
            category: 'movies',
            page: 1
        });
        
        console.log(`Found ${results.results.length} results`);
        
        if (results.results.length > 0) {
            const firstResult = results.results[0];
            console.log('First result:');
            console.log(`- Title: ${firstResult.title}`);
            console.log(`- Size: ${firstResult.size}`);
            console.log(`- Seeds: ${firstResult.seeds}`);
            console.log(`- Site: ${firstResult.site}`);
            
            if (firstResult.tmdb) {
                console.log(`- TMDB Title: ${firstResult.tmdb.title || firstResult.tmdb.name}`);
                console.log(`- TMDB Rating: ${firstResult.tmdb.vote_average}/10`);
                console.log(`- Has Poster: ${!!firstResult.posterUrl}`);
            } else {
                console.log('- No TMDB metadata found');
            }
        }
        
        console.log('Search test completed successfully!');
    } catch (error) {
        console.error('Search test failed:', error);
    }
}

testSearch(); 