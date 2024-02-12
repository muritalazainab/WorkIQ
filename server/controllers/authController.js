const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken')
const User = require("../Model/userModel");
const { generateCookieToken } = require("../utils/generateToken");
// const crypto = require("crypto");
// const passport = require("passport");

const { sendMail } = require("../utils/sendMail.js");
const createActivationToken = require("../utils/createActivationToken.js");
// Google authentication callback

const successRedirect = async (req, res) => {
	try {
		//   // Assuming the user is available in req.user after successful authentication
		const googleProfile = req.user;

		// Fetch user profile from MongoDB based on the email
		const user = await User.findOne({ email: googleProfile.email });

		if (!user) {
			// Handle the case where the user is not found in the database
			return res
				.status(404)
				.json({ message: "User not found in the database" });
		}

		//   Perform any additional actions with the user profile
		//   ...

		const token = generateCookieToken({
			email: user.email,
			id: user._id,
		});
		//   Redirect or send a response as needed
		res.redirect(`https://quickbillpay.onrender.com/auth/google-verify?token=${token}`);
	} catch (error) {
		// Handle errors
		console.error("Error fetching user profile:", error);
		res.status(500).json({ message: "Internal Server Error" });
	}
};

const signUp = async (req, res) => {
	try {
		// Extracting email, password, and name from the request body
		const { email, username, password, name } = req.body;

		// Checking if the user already exists
		const existingUser = await User.findOne({ email }).select("-password");
		if (existingUser)
			return res.status(400).json({ error: "User already exists" });

		const hashedPassword = await bcrypt.hash(password, 12);
		const user = { name, username, email, password: hashedPassword };

		const activationToken = createActivationToken(user);
		const activationCode = activationToken.activationCode;

		const data = { user: { name: user.name }, activationCode };

		try {
			await sendMail({
				email: user.email,
				subject: "Activation your Account ",
				template: "activation-mail.ejs",
				data,
			});
			res.status(201).json({
				success: true,
				message: `Please check your email ${user.email} to active your account`,
				activationToken: activationToken.token,
			});
		} catch (error) {
			// return next(new ErrorHandler(error.message, 400));
			console.log(error);
			return res.status(400).json({ error: error.message });
		}
	} catch (error) {
		// Handling any errors that occur during the process
		console.log(error);
		res.status(500).json({ error: "Something went wrong" });
	}
};

const activateUser = async (req, res) => {
	try {
		const { activation_token, activation_code } = req.body;

		const newUser = jwt.verify(activation_token, process.env.ACTIVATION_SECRET);

		if (newUser.activationCode !== activation_code) {
			return res.status(400).json({ error: "Invalid activation code" });
		}

		const { name, email, username, password } = newUser.user;

		const existUser = await User.findOne({ email });

		if (existUser) {
			return res.status(400).json({ error: "User already exists" });
		}
		const user = await User.create({
			name,
			username,
			email,
			password,
		});

		res.status(201).json({
			success: true,
			user
		});
	} catch (error) {
		// return next(new ErrorHandler(error.message, 400));
		console.log(error);
		if (error.name === 'TokenExpiredError') {
			return res.status(401).json({ error: 'Token expired, kindly signup again' });
		}
		res.status(500).json({ error: "Something went wrong" });
	}
};


const login = async (req, res) => {
	const { user, password } = req.body;
	if (!user || !password) return res.status(400).json({ 'message': 'Username and password are required.' });

	const foundUser = await User.findOne({ username: user } || { email: user }).exec();
	if (!foundUser) return res.sendStatus(401); //Unauthorized 
	// evaluate password 
	const match = await bcrypt.compare(password, foundUser.password);
	if (match) {
		const roles = Object.values(foundUser.roles).filter(Boolean);
		// create JWTs
		const accessToken = jwt.sign(
			{
				"UserInfo": {
					"username": foundUser.username,
					"roles": roles
				}
			},
			process.env.ACCESS_TOKEN_SECRET,
			{ expiresIn: '10s' }
		);
		const refreshToken = jwt.sign(
			{ "username": foundUser.username },
			process.env.REFRESH_TOKEN_SECRET,
			{ expiresIn: '1d' }
		);
		// Saving refreshToken with current user
		foundUser.refreshToken = refreshToken;
		const result = await foundUser.save();
		console.log(result);
		console.log(roles);

		// Creates Secure Cookie with refresh token
		res.cookie('jwt', refreshToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 24 * 60 * 60 * 1000 });

		// Send authorization roles and access token to user
		res.json({ roles, result, accessToken });

	} else {
		res.sendStatus(401);
	}
};


const logout = async (req, res) => {
	// On client, also delete the accessToken

	const cookies = req.cookies;
	if (!cookies?.jwt) return res.sendStatus(204); //No content
	const refreshToken = cookies.jwt;

	// Is refreshToken in db?
	const foundUser = await User.findOne({ refreshToken }).exec();
	if (!foundUser) {
			res.clearCookie('jwt', { httpOnly: true, sameSite: 'None', secure: true });
			return res.sendStatus(204);
	}

	// Delete refreshToken in db
	foundUser.refreshToken = '';
	const result = await foundUser.save();
	console.log(result);

	res.clearCookie('jwt', { httpOnly: true, sameSite: 'None', secure: true });
	res.sendStatus(204);
}

module.exports = {
	signUp,
	login,
	logout,
	activateUser,
	successRedirect,
};
