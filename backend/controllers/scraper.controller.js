/* global URL */
const ogs = require("open-graph-scraper");
const { safeFetchHtml, SecurityValidationError } = require("../services/url-safety.service");

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_DESC_LENGTH = 1000;
const MAX_SITENAME_LENGTH = 100;

/**
 * Sanitizes and normalizes an extracted image URL:
 * - Resolves relative paths against the page's final URL
 * - Strictly enforces http: or https: scheme
 * - Rejects data:, javascript:, file: and other dangerous schemes
 * @param {string} rawImageUrl
 * @param {string} baseUrl
 * @returns {string} Sanitized absolute image URL or empty string
 */
const sanitizeImageUrl = (rawImageUrl, baseUrl) => {
    if (!rawImageUrl || typeof rawImageUrl !== "string") return "";
    try {
        const resolved = new URL(rawImageUrl.trim(), baseUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
            return resolved.href;
        }
        return "";
    } catch {
        return "";
    }
};

const extractLinkPreview = async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
        return res.status(400).json({ error: true, message: "URL is required and must be a string" });
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl.length > MAX_URL_LENGTH) {
        return res.status(400).json({
            error: true,
            message: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`
        });
    }

    let fetchResult;
    try {
        fetchResult = await safeFetchHtml(trimmedUrl);
    } catch (err) {
        if (err instanceof SecurityValidationError || err?.isClientSecurityError) {
            return res.status(400).json({
                error: true,
                message: "The requested URL or host is restricted or invalid"
            });
        }
        return res.status(422).json({
            error: true,
            message: "Failed to scrape metadata from the requested URL"
        });
    }

    const { html, finalUrl } = fetchResult;

    try {
        const { result, error } = await ogs({ html });

        if (error || !result) {
            return res.status(422).json({ error: true, message: "Failed to scrape metadata" });
        }

        // Handle image extraction (ogs returns array or object)
        let rawImageUrl = null;
        if (Array.isArray(result.ogImage) && result.ogImage.length > 0) {
            rawImageUrl = result.ogImage[0].url;
        } else if (result.ogImage && typeof result.ogImage === "object") {
            rawImageUrl = result.ogImage.url;
        } else if (Array.isArray(result.twitterImage) && result.twitterImage.length > 0) {
            rawImageUrl = result.twitterImage[0].url;
        } else if (result.twitterImage && typeof result.twitterImage === "object") {
            rawImageUrl = result.twitterImage.url;
        }

        const imageUrl = sanitizeImageUrl(rawImageUrl, finalUrl);

        // Format clean siteName from hostname fallback
        let siteName = (result.ogSiteName || "").trim();
        if (!siteName) {
            try {
                const host = new URL(finalUrl).hostname;
                siteName = host.startsWith("www.") ? host.substring(4) : host;
            } catch {
                siteName = "";
            }
        }

        const rawTitle = result.ogTitle || result.twitterTitle || result.dcTitle || finalUrl;
        const rawDescription = result.ogDescription || result.twitterDescription || "";

        return res.json({
            error: false,
            preview: {
                url: finalUrl,
                title: String(rawTitle).trim().slice(0, MAX_TITLE_LENGTH),
                description: String(rawDescription).trim().slice(0, MAX_DESC_LENGTH),
                image: imageUrl,
                siteName: String(siteName).trim().slice(0, MAX_SITENAME_LENGTH)
            }
        });
    } catch (err) {
        return res.status(500).json({
            error: true,
            message: err.message || "Failed to extract link preview"
        });
    }
};

module.exports = {
    extractLinkPreview
};
