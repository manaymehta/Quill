const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const RefreshSession = require("../models/refresh-session.model");
const {
    ACCESS_TOKEN_SECRET,
    ACCESS_TOKEN_TTL: ACCESS_TOKEN_EXPIRES_IN,
    REFRESH_TOKEN_TTL_DAYS,
    NODE_ENV,
} = require("../config/env");

const REFRESH_COOKIE_NAME = "quill_refresh";

const getRefreshExpiry = () => new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

const hashRefreshToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const serializeUser = (user) => {
    const source = typeof user.toObject === "function" ? user.toObject() : user;
    return {
        _id: String(source._id),
        fullName: source.fullName || "",
        email: source.email || "",
        ...(source.createdOn ? { createdOn: source.createdOn } : {}),
    };
};

const createAccessToken = (user) => jwt.sign(
    {
        _id: String(user._id),
        email: user.email,
        fullName: user.fullName,
        tokenType: "access",
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
);

const getCookieOptions = () => ({
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

const getRefreshTokenFromRequest = (req) => {
    const cookieHeader = req.headers.cookie || "";
    const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!cookie) return null;
    try {
        return decodeURIComponent(cookie.slice(REFRESH_COOKIE_NAME.length + 1));
    } catch {
        return null;
    }
};

const setRefreshCookie = (res, rawToken) => {
    res.cookie(REFRESH_COOKIE_NAME, rawToken, getCookieOptions());
};

const clearRefreshCookie = (res) => {
    const { maxAge, ...clearOptions } = getCookieOptions();
    void maxAge;
    res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
};

const createRefreshSession = async (user, req, familyId = crypto.randomUUID()) => {
    const rawToken = crypto.randomBytes(48).toString("base64url");
    const tokenHash = hashRefreshToken(rawToken);

    await RefreshSession.create({
        userId: String(user._id),
        familyId,
        tokenHash,
        replacedByHash: null,
        revokedAt: null,
        userAgent: req.get("user-agent") || "",
        ipAddress: req.ip || "",
        expiresAt: getRefreshExpiry(),
    });

    return { rawToken, tokenHash, familyId };
};

const issueAuthentication = async (user, req, res) => {
    const session = await createRefreshSession(user, req);
    setRefreshCookie(res, session.rawToken);
    return {
        accessToken: createAccessToken(user),
        user: serializeUser(user),
    };
};

const REFRESH_REUSE_GRACE_PERIOD_MS = 30 * 1000;

const isWithinGracePeriod = (session, now) => Boolean(
    session?.revokedAt && now.getTime() - session.revokedAt.getTime() <= REFRESH_REUSE_GRACE_PERIOD_MS
);

// A fresh access token without touching the refresh cookie (for a request that raced another one)
const issueAccessOnly = async (userId, User) => {
    const user = await User.findById(userId);
    if (!user) return null;
    return {
        accessToken: createAccessToken(user),
        user: serializeUser(user),
    };
};

// Issue the family's next refresh token as the browser's cookie; the token it replaces
// (replacedId) is pointed at it
const rotateTo = async (user, familyId, replacedId, req, res) => {
    const nextSession = await createRefreshSession(user, req, familyId);
    await RefreshSession.updateOne(
        { _id: replacedId },
        { $set: { replacedByHash: nextSession.tokenHash } }
    );
    setRefreshCookie(res, nextSession.rawToken);
    return {
        accessToken: createAccessToken(user),
        user: serializeUser(user),
    };
};

// A rotation whose reply never reached the browser (backend restarted mid-request, page reloaded,
// timeout) leaves the browser holding the old, revoked token. If the token it was rotated to was
// never used, nobody holds a live token of this family yet, so rotate again from the old one instead
// of calling it a replay. A stolen old token gets the same while its successor is unused, but the
// owner's next refresh then presents that successor, now revoked, and the whole family is revoked as
// before.
// Returns the authentication, null to refuse, or undefined when this isn't a lost reply.
const recoverLostRotation = async (staleSession, now, req, res, User) => {
    if (!staleSession.replacedByHash) return undefined;

    const successor = await RefreshSession.findOne({ tokenHash: staleSession.replacedByHash });
    if (!successor || successor.expiresAt <= now) return undefined;

    const claimedSuccessor = await RefreshSession.findOneAndUpdate(
        { _id: successor._id, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
        { returnDocument: "after" }
    );

    if (!claimedSuccessor) {
        // Claimed already. Only another request recovering this same lost reply (which leaves the
        // successor without a replacedByHash) gets an access token; a successor its holder rotated
        // normally means this old token is a replay
        const freshlyClaimed = await RefreshSession.findById(successor._id);
        return isWithinGracePeriod(freshlyClaimed, now) && !freshlyClaimed.replacedByHash
            ? issueAccessOnly(freshlyClaimed.userId, User)
            : undefined;
    }

    const user = await User.findById(claimedSuccessor.userId);
    if (!user) return null;

    // The stale token now leads to the new one, so the same lost reply happening again is recovered the
    // same way. The abandoned successor stays without one: presented later, it's a replay.
    return rotateTo(user, claimedSuccessor.familyId, staleSession._id, req, res);
};

const rotateAuthentication = async (req, res, User) => {
    const rawToken = getRefreshTokenFromRequest(req);
    if (!rawToken) return null;

    const tokenHash = hashRefreshToken(rawToken);
    const now = new Date();
    const existingSession = await RefreshSession.findOne({ tokenHash });

    if (!existingSession || existingSession.expiresAt <= now) return null;

    // Check if the session was already revoked
    if (existingSession.revokedAt) {
        // 1. Within grace period: Legitimate concurrent request or network jitter
        // Return a fresh access token without revoking the token family
        if (isWithinGracePeriod(existingSession, now)) return issueAccessOnly(existingSession.userId, User);

        // 2. Outside grace period, but the token it was rotated to was never used: a lost reply
        const recovered = await recoverLostRotation(existingSession, now, req, res, User);
        if (recovered !== undefined) return recovered;

        // 3. Otherwise: Genuine replay attack detected! Revoke the whole
        // family so an attacker cannot continue using sibling refresh tokens.
        await RefreshSession.updateMany(
            { familyId: existingSession.familyId, revokedAt: null },
            { $set: { revokedAt: now } }
        );
        return null;
    }

    const claimedSession = await RefreshSession.findOneAndUpdate(
        { _id: existingSession._id, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
        { returnDocument: "after" }
    );

    if (!claimedSession) {
        // A concurrent request claimed this session at this exact moment.
        // Verify it was claimed within the grace window and issue a fresh access token.
        const freshlyClaimed = await RefreshSession.findById(existingSession._id);
        return isWithinGracePeriod(freshlyClaimed, now) ? issueAccessOnly(freshlyClaimed.userId, User) : null;
    }

    const user = await User.findById(claimedSession.userId);
    if (!user) return null;

    return rotateTo(user, claimedSession.familyId, claimedSession._id, req, res);
};

const revokeAuthentication = async (req, res) => {
    const rawToken = getRefreshTokenFromRequest(req);
    if (rawToken) {
        const tokenHash = hashRefreshToken(rawToken);
        const session = await RefreshSession.findOne({ tokenHash });
        // No session with this hash means nothing to revoke. Expired as well as revoked: a revoked
        // token is still answered for 30 s (two tabs refreshing at once), which must not cover a logout
        if (session) {
            const now = new Date();
            await RefreshSession.updateMany(
                { familyId: session.familyId, revokedAt: null },
                { $set: { revokedAt: now } }
            );
            // Every token of the family, including ones rotated moments ago (already revoked)
            await RefreshSession.updateMany({ familyId: session.familyId }, { $set: { expiresAt: now } });
        }
    }
    clearRefreshCookie(res);
};

module.exports = {
    clearRefreshCookie,
    issueAuthentication,
    revokeAuthentication,
    rotateAuthentication,
    serializeUser,
};
