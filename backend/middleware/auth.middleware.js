const jwt = require("jsonwebtoken");
const { ACCESS_TOKEN_SECRET } = require("../config/env");

function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) return res.status(401).json({ error: true, message: "Authentication required" });

    jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
        if (err || user.tokenType !== "access") {
            return res.status(401).json({ error: true, message: "Invalid or expired access token" });
        }
        req.user = {
            _id: user._id,
            email: user.email,
            fullName: user.fullName
        };
        next();
    });
}

module.exports = {
    authenticateToken,
};
