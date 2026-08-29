const { OAuth2Client } = require("google-auth-library");
const User = require("../models/user.model");
const Note = require("../models/note.model"); // Needed for createInitialNotes
const {
    clearRefreshCookie,
    issueAuthentication,
    revokeAuthentication,
    rotateAuthentication,
} = require("../services/auth.service");

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

const normalizeEmail = (email) => typeof email === "string" ? email.trim().toLowerCase() : "";

const createInitialNotes = async (userId) => {
    const initialNotes = [
        {
            title: "Welcome to Quill! 🪶",
            content: "This is your first note. Feel free to edit or delete it. You can create new notes, add tags, and even make checklists. Enjoy organizing your thoughts!",
            tags: ["welcome", "getting-started"],
            userId,
        },
        {
            title: "How to Use Checklists",
            isChecklist: true,
            checklist: [
                { content: "Create a new note.", isCompleted: true },
                { content: "Click the checklist icon.", isCompleted: false },
                { content: "Add your to-do items!", isCompleted: false },
            ],
            tags: ["welcome"],
            userId,
        },
        {
            title: "Visualize your notes via Graph",
            content: "Check out the the graph section to see your notes organized as nodes by matching tags.",
            tags: ["tags", "click a tag"],
            userId,
        },
    ];

    try {
        await Note.insertMany(initialNotes);
    } catch (error) {
        console.error("Error creating initial notes:", error);
    }
};

const createAccount = async (req, res) => {
    const { fullName, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!fullName) {
        return res.status(400).json({ error: true, message: "Full Name is required" });
    }

    if (!email) {
        return res.status(400).json({ error: true, message: "Email is required" });
    }

    if (!password) {
        return res.status(400).json({ error: true, message: "Password is required" });
    }

    try {
        const isUser = await User.findOne({ email: email });
        if (isUser) {
            return res.json({ error: true, message: "User already exists" });
        }

        const user = new User({
            fullName,
            email,
            password,
        });
        await user.save();

        await createInitialNotes(user._id);

        const authentication = await issueAuthentication(user, req, res);

        return res.json({
            error: false,
            ...authentication,
            message: "Registration Successful",
        });
    } catch (error) {
        console.error("Error in createAccount:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const login = async (req, res) => {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return res.status(400).json({ error: true, message: "Email is required" });
    }

    if (!password) {
        return res.status(400).json({ error: true, message: "Password is required" });
    }

    try {
        const userInfo = await User.findOne({ email: email });
        if (!userInfo) {
            return res.json({ error: true, message: "User not found" });
        }

        // reject google auth users from this route
        if (!userInfo.password) {
            return res.status(400).json({ error: true, message: "This account uses Google Sign-In. Please login with Google." });
        }

        // Use bcrypt to compare the plain password with the stored hash
        const isPasswordValid = await userInfo.comparePassword(password);

        if (isPasswordValid) {
            const authentication = await issueAuthentication(userInfo, req, res);

            return res.json({
                error: false,
                message: "Login successful",
                ...authentication,
            });
        } else {
            return res.status(400).json({
                error: true,
                message: "Invalid Credentials",
            });
        }
    } catch (error) {
        console.error("Error in login:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const googleAuth = async (req, res) => {
    const { token } = req.body;

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.VITE_GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        const normalizedEmail = normalizeEmail(email);
        let user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            user = await User.create({
                email: normalizedEmail,
                fullName: name,
                googleId,
            });
        }

        const authentication = await issueAuthentication(user, req, res);

        return res.json({
            error: false,
            message: "Google Login Successful",
            ...authentication,
        });
    } catch (error) {
        console.error("Google Auth Error", error);
        res.status(401).json({ error: true, message: "Invalid Google Token" });
    }
};

const refresh = async (req, res) => {
    try {
        const authentication = await rotateAuthentication(req, res, User);
        if (!authentication) {
            clearRefreshCookie(res);
            return res.status(401).json({ error: true, message: "Session expired" });
        }
        return res.json({ error: false, ...authentication });
    } catch (error) {
        console.error("Refresh token error:", error);
        clearRefreshCookie(res);
        return res.status(500).json({ error: true, message: "Unable to refresh session" });
    }
};

const logout = async (req, res) => {
    try {
        await revokeAuthentication(req, res);
        return res.json({ error: false, message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({ error: true, message: "Unable to log out" });
    }
};

const getUser = async (req, res) => {
    const userId = req.user._id;

    try {
        const userInfo = await User.findOne({ _id: userId });

        if (!userInfo) {
            return res.status(401);
        }
        return res.json({
            error: false,
            message: "User Info",
            user: {
                fullName: userInfo.fullName,
                email: userInfo.email,
                _id: userInfo._id,
                createdOn: userInfo.createdOn,
            },
        });
    } catch (error) {
        console.error("Error in getUser:", error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = {
    createAccount,
    login,
    googleAuth,
    getUser,
    refresh,
    logout,
};
