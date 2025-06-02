import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import { startDiscordBot } from './bot/client.js';
import { getIPAddress } from './utils/networkUtils.js'; // Corrected import path

// Log the IP address at startup
const ipAddress = getIPAddress();
// if (ipAddress) {
//     console.log(`Local IP Address: ${ipAddress}`);
// } else {
//     console.log("Could not determine local IP address.");
// }

// Start the Discord bot
startDiscordBot();



