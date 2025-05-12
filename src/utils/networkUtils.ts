import * as os from 'os';

// Function to get and log local IP addresses
export function logIpAddresses() {
    const networkInterfaces = os.networkInterfaces();
    console.log("Local IP Addresses:");
    for (const interfaceName in networkInterfaces) {
        const MynetworkInterface = networkInterfaces[interfaceName];
        if (MynetworkInterface) {
            for (const iface of MynetworkInterface) {
                // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                if (!iface.internal && iface.family === 'IPv4') {
                    console.log(`  ${interfaceName}: ${iface.address}`);
                }
            }
        }
    }
}
