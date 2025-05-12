// Import dotenv to load environment variables
import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

// Import utility functions
import { logIpAddresses } from './utils/networkUtils';

// Import Discord client and startup function
import { startDiscordBot } from './discordClient';

// Log IP addresses before starting the application
logIpAddresses();

// Log a message to the console indicating the application is starting.
console.log("Starting the application...");

// Start the Discord bot
startDiscordBot();



