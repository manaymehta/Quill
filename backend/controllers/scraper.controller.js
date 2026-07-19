/* global URL, setTimeout */
const ogs = require("open-graph-scraper");

const extractLinkPreview = async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: true, message: "URL is required" });
    }

    // Basic URL validation
    let validUrl;
    try {
        validUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: true, message: "Invalid URL format" });
    }

    const options = {
        url: validUrl.href,
        timeout: 4000, // 4-second got timeout
        headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    };

    // Robust Promise-race to guarantee no hanging request under any circumstances
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), 4500)
    );

    try {
        const ogCall = ogs(options);
        const { result, error } = await Promise.race([ogCall, timeoutPromise]);

        if (error) {
            return res.status(422).json({ error: true, message: "Failed to scrape metadata" });
        }

        // Handle image extraction (ogs returns array or object)
        let imageUrl = null;
        if (result.ogImage && result.ogImage.length > 0) {
            imageUrl = result.ogImage[0].url;
        } else if (result.ogImage && typeof result.ogImage === "object") {
            imageUrl = result.ogImage.url;
        } else if (result.twitterImage && result.twitterImage.length > 0) {
            imageUrl = result.twitterImage[0].url;
        }

        // Format clean siteName from hostname fallback
        let siteName = result.ogSiteName || "";
        if (!siteName) {
            const host = validUrl.hostname;
            siteName = host.startsWith("www.") ? host.substring(4) : host;
        }

        return res.json({
            error: false,
            preview: {
                url: validUrl.href,
                title: result.ogTitle || result.twitterTitle || result.dcTitle || validUrl.href,
                description: result.ogDescription || result.twitterDescription || "",
                image: imageUrl || "",
                siteName
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
