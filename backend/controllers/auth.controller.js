const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/user.model");
const Note = require("../models/note.model"); // Needed for createInitialNotes

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

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
    const { fullName, email, password } = req.body;

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

        const accessToken = jwt.sign(
            {
                _id: user._id,
                email: user.email,
                fullName: user.fullName,
            },
            process.env.ACCESS_TOKEN_SECRET,
            {
                expiresIn: "36000m",
            }
        );

        const { password: _pw, ...safeUser } = user.toObject(); // intentionally ignoring the password and store it as _pw to never use it and avoid linting errors 

        return res.json({
            error: false,
            user: safeUser,
            accessToken,
            message: "Registration Successful",
        });
    } catch (error) {
        console.error("Error in createAccount:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

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
            const accessToken = jwt.sign(
                {
                    _id: userInfo._id,
                    email: userInfo.email,
                    fullName: userInfo.fullName,
                },
                process.env.ACCESS_TOKEN_SECRET,
                { expiresIn: "36000m" }
            );

            const { password: _pw, ...safeUser } = userInfo.toObject();

            return res.json({
                error: false,
                message: "Login successful",
                user: safeUser,
                accessToken,
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

        let user = await User.findOne({ email });

        if (!user) {
            user = await User.create({
                email,
                fullName: name,
                googleId,
            });
        }

        const accessToken = jwt.sign(
            {
                _id: user._id,
                email: user.email,
                fullName: user.fullName,
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "36000m" }
        );

        return res.json({
            error: false,
            message: "Google Login Successful",
            user,
            accessToken,
        });
    } catch (error) {
        console.error("Google Auth Error", error);
        res.status(401).json({ error: true, message: "Invalid Google Token" });
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
};
