import os from 'os';

export function getIPAddress(): string | undefined {
    const networkInterfaces = os.networkInterfaces();
    // console.log('Available network interfaces:', networkInterfaces); // Debugging line

    for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        if (interfaces) { // Check if interfaces is not undefined
            for (const iface of interfaces) {
                // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                // For WSL, the host IP is often on an Ethernet adapter that might not be 'eth0'
                // and might not be the first one listed.
                if (!iface.internal && iface.family === 'IPv4') {
                    // console.log(`Found IPv4 address: ${iface.address} on interface ${interfaceName}`); // Debugging line
                    // Heuristic: Prefer addresses that are likely to be the host IP from WSL
                    // This is a simple heuristic and might need adjustment based on specific WSL network configurations.
                    // Common WSL host IP ranges are 172.16.0.0/12, 192.168.0.0/16.
                    // The specific IP 172.31.64.1 was mentioned, so we can check for that range.
                    if (iface.address.startsWith('172.') || iface.address.startsWith('192.168.')) {
                        return iface.address;
                    }
                }
            }
        }
    }
    // Fallback or more specific logic might be needed if the above doesn't work reliably
    return undefined;
}
