/* global URL, Buffer, setTimeout, clearTimeout */
const net = require("net");
const dns = require("dns");
const http = require("http");
const https = require("https");
const zlib = require("zlib");

class SecurityValidationError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "SecurityValidationError";
        this.isClientSecurityError = true;
    }
}

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "backend",
    "fast_api",
    "mongodb",
    "qdrant",
    "host.docker.internal",
]);

const ALLOWED_PORTS = new Set(["80", "443", ""]);

/**
 * Parses any RFC-compliant IPv6 string into an array of 8 x 16-bit numbers.
 * Handles shorthand ::, embedded IPv4 at the end, leading zeros, and brackets.
 * Returns null if invalid.
 */
const parseIpv6ToWords = (ip) => {
    if (!ip || typeof ip !== "string") return null;
    let clean = ip.trim().toLowerCase();
    if (clean.startsWith("[") && clean.endsWith("]")) {
        clean = clean.slice(1, -1);
    }

    // Handle embedded IPv4 at end (e.g. ::ffff:127.0.0.1, 0:0:0:0:0:ffff:127.0.0.1, ::127.0.0.1)
    const lastColon = clean.lastIndexOf(":");
    if (lastColon !== -1) {
        const potentialV4 = clean.slice(lastColon + 1);
        if (net.isIPv4(potentialV4)) {
            const v4Parts = potentialV4.split(".").map((p) => parseInt(p, 10));
            if (v4Parts.length !== 4 || v4Parts.some(isNaN)) return null;
            const w6 = (v4Parts[0] << 8) | v4Parts[1];
            const w7 = (v4Parts[2] << 8) | v4Parts[3];
            clean = clean.slice(0, lastColon) + `:${w6.toString(16)}:${w7.toString(16)}`;
        }
    }

    const doubleColonIndex = clean.indexOf("::");
    let allParts;
    if (doubleColonIndex !== -1) {
        if (clean.indexOf("::", doubleColonIndex + 2) !== -1) return null;
        const leftStr = clean.slice(0, doubleColonIndex);
        const rightStr = clean.slice(doubleColonIndex + 2);
        const leftParts = leftStr ? leftStr.split(":") : [];
        const rightParts = rightStr ? rightStr.split(":") : [];
        if (leftParts.length + rightParts.length > 7) return null;
        const missing = 8 - (leftParts.length + rightParts.length);
        allParts = leftParts.concat(new Array(missing).fill("0")).concat(rightParts);
    } else {
        allParts = clean.split(":");
    }

    if (allParts.length !== 8) return null;
    const words = [];
    for (const p of allParts) {
        if (!/^[0-9a-f]{1,4}$/i.test(p)) return null;
        words.push(parseInt(p, 16));
    }
    return words;
};

/**
 * Checks whether an IPv4 or IPv6 address is in a private, loopback, or reserved range.
 * @param {string} ip - IP address string
 * @returns {boolean} - true if private/reserved/loopback
 */
const isPrivateOrReservedIp = (ip) => {
    if (!ip || typeof ip !== "string") return true;

    const version = net.isIP(ip);
    if (version === 4) {
        const parts = ip.split(".").map((p) => parseInt(p, 10));
        if (parts.length !== 4 || parts.some(isNaN)) return true;

        const [b0, b1, b2, b3] = parts;

        // 0.0.0.0/8 (Current network)
        if (b0 === 0) return true;
        // 10.0.0.0/8 (Private)
        if (b0 === 10) return true;
        // 100.64.0.0/10 (Shared / CGNAT)
        if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
        // 127.0.0.0/8 (Loopback)
        if (b0 === 127) return true;
        // 169.254.0.0/16 (Link-Local, AWS/GCP Metadata)
        if (b0 === 169 && b1 === 254) return true;
        // 172.16.0.0/12 (Private)
        if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
        // 192.0.0.0/24 (IETF Protocol Assignments)
        if (b0 === 192 && b1 === 0 && b2 === 0) return true;
        // 192.0.2.0/24 (TEST-NET-1)
        if (b0 === 192 && b1 === 0 && b2 === 2) return true;
        // 192.88.99.0/24 (6to4 Relay)
        if (b0 === 192 && b1 === 88 && b2 === 99) return true;
        // 192.168.0.0/16 (Private)
        if (b0 === 192 && b1 === 168) return true;
        // 198.18.0.0/15 (Benchmarking)
        if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
        // 198.51.100.0/24 (TEST-NET-2)
        if (b0 === 198 && b1 === 51 && b2 === 100) return true;
        // 203.0.113.0/24 (TEST-NET-3)
        if (b0 === 203 && b1 === 0 && b2 === 113) return true;
        // 224.0.0.0/4 (Multicast)
        if (b0 >= 224 && b0 <= 239) return true;
        // 240.0.0.0/4 (Reserved)
        if (b0 >= 240) return true;
        // 255.255.255.255/32 (Broadcast)
        if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;

        return false;
    }

    if (version === 6) {
        const words = parseIpv6ToWords(ip);
        if (!words) return true; // Malformed IPv6 treated as restricted

        // ::/128 (Unspecified)
        if (words.every((w) => w === 0)) return true;

        // ::1/128 (Loopback)
        if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;

        // Multicast (ff00::/8)
        if ((words[0] & 0xff00) === 0xff00) return true;

        // Unique Local Addresses (fc00::/7 -> fc00 to fdff)
        if ((words[0] & 0xfe00) === 0xfc00) return true;

        // Link-Local Unicast (fe80::/10 -> fe80 to febf)
        if ((words[0] & 0xffc0) === 0xfe80) return true;

        // Site-Local deprecated (fec0::/10 -> fec0 to feff)
        if ((words[0] & 0xffc0) === 0xfec0) return true;

        // Discard-Only Prefix (100::/64)
        if (words[0] === 0x100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;

        // Documentation Prefix (2001:db8::/32)
        if (words[0] === 0x2001 && words[1] === 0xdb8) return true;

        // 6to4 Prefix (2002::/16) - deprecated by RFC 7526, unsafe
        if (words[0] === 0x2002) return true;

        // IPv4-Mapped IPv6 (::ffff:0:0/96)
        if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
            const b0 = (words[6] >> 8) & 0xff;
            const b1 = words[6] & 0xff;
            const b2 = (words[7] >> 8) & 0xff;
            const b3 = words[7] & 0xff;
            return isPrivateOrReservedIp(`${b0}.${b1}.${b2}.${b3}`);
        }

        // IPv4-Compatible IPv6 (::/96)
        if (words.slice(0, 6).every((w) => w === 0)) {
            const b0 = (words[6] >> 8) & 0xff;
            const b1 = words[6] & 0xff;
            const b2 = (words[7] >> 8) & 0xff;
            const b3 = words[7] & 0xff;
            return isPrivateOrReservedIp(`${b0}.${b1}.${b2}.${b3}`);
        }

        // NAT64 Prefix (64:ff9b::/96)
        if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
            const b0 = (words[6] >> 8) & 0xff;
            const b1 = words[6] & 0xff;
            const b2 = (words[7] >> 8) & 0xff;
            const b3 = words[7] & 0xff;
            return isPrivateOrReservedIp(`${b0}.${b1}.${b2}.${b3}`);
        }

        return false;
    }

    return true;
};

/**
 * Validates that a URL is safe before connection:
 * - Scheme must be http: or https:
 * - No user credentials in URL
 * - Port must be standard (80, 443, or omitted)
 * - Hostname cannot be private, loopback, or single-label
 * - Trailing dots stripped (FQDN notation)
 * - DNS resolution cannot resolve to any private/reserved IP
 * @param {string|URL} inputUrl
 * @returns {Promise<URL>} The validated URL object
 */
const validateUrlSafety = async (inputUrl) => {
    let parsed;
    try {
        parsed = inputUrl instanceof URL ? inputUrl : new URL(inputUrl);
    } catch (err) {
        throw new SecurityValidationError("Invalid URL format", { cause: err });
    }

    // 1. Protocol check: strictly http: or https:
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new SecurityValidationError(`Unsupported protocol: ${parsed.protocol}. Only http: and https: are allowed`);
    }

    // 2. Reject credentials in URL
    if (parsed.username || parsed.password) {
        throw new SecurityValidationError("URLs containing user credentials are not allowed");
    }

    // 3. Port check: allow standard 80, 443, or empty
    if (!ALLOWED_PORTS.has(parsed.port)) {
        throw new SecurityValidationError(`Non-standard port '${parsed.port}' is not permitted for link previews`);
    }

    const rawHostname = parsed.hostname.toLowerCase();

    // 4. Strip IPv6 bracket notation if present (e.g. [::1] -> ::1)
    let cleanHostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
        ? rawHostname.slice(1, -1)
        : rawHostname;

    // 5. Strip trailing dots (FQDN notation like localhost. or host.docker.internal.)
    cleanHostname = cleanHostname.replace(/\.+$/, "");

    if (!cleanHostname) {
        throw new SecurityValidationError("Invalid or empty hostname");
    }

    // 6. Hostname string checks against blocked names and internal domain suffixes
    if (
        BLOCKED_HOSTNAMES.has(cleanHostname) ||
        cleanHostname.endsWith(".localhost") ||
        cleanHostname.endsWith(".local") ||
        cleanHostname.endsWith(".internal")
    ) {
        throw new SecurityValidationError("Access to internal host is forbidden");
    }

    // 7. If hostname is a literal IP:
    if (net.isIP(cleanHostname)) {
        if (isPrivateOrReservedIp(cleanHostname)) {
            throw new SecurityValidationError("Access to private or reserved IP is forbidden");
        }
        return parsed;
    }

    // 8. Reject single-label hostnames without a dot (e.g., 'redis', 'app', 'intranet')
    if (!cleanHostname.includes(".")) {
        throw new SecurityValidationError("Invalid or internal hostname");
    }

    // 9. DNS Resolution: verify that NONE of the resolved addresses are private/reserved
    let addresses;
    try {
        addresses = await dns.promises.lookup(cleanHostname, { all: true, verbatim: true });
    } catch (err) {
        throw new SecurityValidationError("DNS resolution failed for host", { cause: err });
    }

    if (!addresses || addresses.length === 0) {
        throw new SecurityValidationError("No DNS records found for host");
    }

    for (const record of addresses) {
        if (isPrivateOrReservedIp(record.address)) {
            throw new SecurityValidationError("Host resolves to a restricted IP address");
        }
    }

    return parsed;
};

/**
 * Socket-level DNS lookup validator to eliminate TOCTOU / DNS Rebinding.
 * Intercepts Node's TCP socket establishment and validates every resolved IP address.
 */
const safeSocketLookup = (hostname, options, callback) => {
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) return callback(err);

        if (Array.isArray(address)) {
            for (const item of address) {
                if (isPrivateOrReservedIp(item.address)) {
                    return callback(new SecurityValidationError("Host resolves to a restricted IP address"));
                }
            }
        } else if (isPrivateOrReservedIp(address)) {
            return callback(new SecurityValidationError("Host resolves to a restricted IP address"));
        }

        return callback(null, address, family);
    });
};

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024; // 512 KB
const MAX_REDIRECTS = 3;

/**
 * Performs a single HTTP GET request using Node.js http/https with:
 * - Socket-level DNS lookup pinning (anti-DNS rebinding)
 * - Automatic gzip/deflate decompression
 * - Byte count truncation
 * - Remaining deadline timeout
 */
const fetchHop = (targetUrl, remainingMs, maxBytes) => {
    return new Promise((resolve, reject) => {
        const client = targetUrl.protocol === "https:" ? https : http;

        const req = client.get(
            targetUrl.href,
            {
                lookup: safeSocketLookup,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate",
                },
            },
            (res) => {
                const statusCode = res.statusCode || 0;

                // Handle redirects (301, 302, 303, 307, 308)
                if ([301, 302, 303, 307, 308].includes(statusCode)) {
                    const location = res.headers.location;
                    res.resume(); // Drain and release socket immediately
                    if (!location) {
                        return reject(new Error(`Redirect status ${statusCode} missing Location header`));
                    }
                    return resolve({ redirect: true, location, statusCode });
                }

                if (statusCode < 200 || statusCode >= 300) {
                    res.resume();
                    return reject(new Error(`HTTP ${statusCode}: ${res.statusMessage || "Error"}`));
                }

                // Verify Content-Type is present and HTML-compatible
                const rawContentType = (res.headers["content-type"] || "").toLowerCase();
                const isHtml = /text\/html|application\/xhtml\+xml/.test(rawContentType);
                if (!isHtml) {
                    res.resume();
                    return reject(new Error(`Unsupported or missing content type: '${rawContentType || "none"}'. Expected HTML.`));
                }

                // Setup decompression stream if content-encoding is gzip or deflate
                const encoding = (res.headers["content-encoding"] || "").toLowerCase();
                let dataStream = res;
                if (encoding === "gzip") {
                    dataStream = res.pipe(zlib.createGunzip());
                } else if (encoding === "deflate") {
                    dataStream = res.pipe(zlib.createInflate());
                }

                let receivedBytes = 0;
                const chunks = [];
                let settled = false;

                const cleanup = () => {
                    res.destroy();
                };

                dataStream.on("data", (chunk) => {
                    if (settled) return;
                    receivedBytes += chunk.length;

                    if (receivedBytes > maxBytes) {
                        settled = true;
                        const allowedLength = chunk.length - (receivedBytes - maxBytes);
                        if (allowedLength > 0) {
                            chunks.push(chunk.subarray(0, allowedLength));
                        }
                        cleanup();
                        const html = Buffer.concat(chunks).toString("utf-8");
                        return resolve({ redirect: false, html });
                    }

                    chunks.push(chunk);
                });

                dataStream.on("end", () => {
                    if (settled) return;
                    settled = true;
                    const html = Buffer.concat(chunks).toString("utf-8");
                    resolve({ redirect: false, html });
                });

                dataStream.on("error", (err) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(err);
                });

                res.on("error", (err) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(err);
                });
            }
        );

        let timerId = null;
        if (remainingMs > 0) {
            timerId = setTimeout(() => {
                req.destroy(new Error(`Request timed out after ${remainingMs}ms`));
            }, remainingMs);
        }

        req.on("error", (err) => {
            if (timerId) clearTimeout(timerId);
            reject(err);
        });

        req.on("close", () => {
            if (timerId) clearTimeout(timerId);
        });
    });
};

/**
 * Safely fetches HTML content from a URL with:
 * - Cumulative timeout enforcement
 * - Step-by-step redirect following with re-validation of location and DNS
 * - Socket-level DNS lookup validation (anti-DNS rebinding)
 * - Strict Content-Type enforcement
 * - 512 KB download ceiling
 * @param {string} rawUrl
 * @param {object} [options]
 * @returns {Promise<{ html: string, finalUrl: string }>}
 */
const safeFetchHtml = async (rawUrl, options = {}) => {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes || MAX_BYTES;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

    const deadline = Date.now() + timeoutMs;
    let currentUrl = await validateUrlSafety(rawUrl);
    let redirectsCount = 0;

    while (redirectsCount <= maxRedirects) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error(`Overall request deadline exceeded (${timeoutMs}ms limit)`);
        }

        const hopResult = await fetchHop(currentUrl, remainingMs, maxBytes);

        if (hopResult.redirect) {
            redirectsCount++;
            if (redirectsCount > maxRedirects) {
                throw new Error(`Maximum redirect limit (${maxRedirects}) exceeded`);
            }

            const nextUrl = new URL(hopResult.location, currentUrl.href);
            currentUrl = await validateUrlSafety(nextUrl);
            continue;
        }

        return {
            html: hopResult.html,
            finalUrl: currentUrl.href,
        };
    }

    throw new Error(`Maximum redirect limit (${maxRedirects}) exceeded`);
};

module.exports = {
    SecurityValidationError,
    isPrivateOrReservedIp,
    validateUrlSafety,
    safeFetchHtml,
};
