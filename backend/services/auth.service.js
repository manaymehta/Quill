const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const RefreshSession = require("../models/refresh-session.model");

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_TTL || "15m";
const configuredRefreshTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const REFRESH_TOKEN_TTL_DAYS = Number.isFinite(configuredRefreshTtlDays) && configuredRefreshTtlDays > 0
    ? Math.min(configuredRefreshTtlDays, 365)
    : 30;
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
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
);

const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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

const rotateAuthentication = async (req, res, User) => {
    const rawToken = getRefreshTokenFromRequest(req);
    if (!rawToken) return null;

    const tokenHash = hashRefreshToken(rawToken);
    const now = new Date();
    const existingSession = await RefreshSession.findOne({ tokenHash });

    if (!existingSession || existingSession.expiresAt <= now) return null;

    // Reuse of a rotated token indicates possible theft. Revoke the whole
    // family so an attacker cannot continue using sibling refresh tokens.
    if (existingSession.revokedAt) {
        await RefreshSession.updateMany(
            { familyId: existingSession.familyId, revokedAt: null },
            { $set: { revokedAt: now } }
        );
        return null;
    }

    const claimedSession = await RefreshSession.findOneAndUpdate(
        { _id: existingSession._id, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
        { new: true }
    );
    if (!claimedSession) return null;

    const user = await User.findById(claimedSession.userId);
    if (!user) return null;

    const nextSession = await createRefreshSession(user, req, claimedSession.familyId);
    await RefreshSession.updateOne(
        { _id: claimedSession._id },
        { $set: { replacedByHash: nextSession.tokenHash } }
    );
    setRefreshCookie(res, nextSession.rawToken);

    return {
        accessToken: createAccessToken(user),
        user: serializeUser(user),
    };
};

const revokeAuthentication = async (req, res) => {
    const rawToken = getRefreshTokenFromRequest(req);
    if (rawToken) {
        await RefreshSession.updateOne(
            { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );
    }
    clearRefreshCookie(res);
};

module.exports = {
    clearRefreshCookie,
    createAccessToken,
    issueAuthentication,
    revokeAuthentication,
    rotateAuthentication,
    serializeUser,
};
