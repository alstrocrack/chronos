/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
const axios = require('axios');
const mysql = require('mysql');
const crypto = require('crypto');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const pathToDBUser = 'projects/199194440168/secrets/DB_USER/versions/latest';
const pathToDBPass = 'projects/199194440168/secrets/DB_PASS/versions/latest';
const pathToDBHost = 'projects/199194440168/secrets/DB_HOST/versions/latest';
const pathToDBPort = 'projects/199194440168/secrets/DB_PORT/versions/latest';

const pathToCa = 'projects/199194440168/secrets/DB_CA/versions/latest';
const pathToKey = 'projects/199194440168/secrets/DB_KEY/versions/latest';
const pathToCert = 'projects/199194440168/secrets/DB_CERT/versions/latest';

const pathTochannelAccessToken = 'projects/199194440168/secrets/CHANNEL_ACCESS_TOKEN/versions/latest';
const pathToChannelSecret = 'projects/199194440168/secrets/CHANNEL_SECRET/versions/latest';

const client = new SecretManagerServiceClient();

exports.main = async (req, res) => {
	const [dbUser, dbPass, dbHost, dbPort, ca, key, cert, channelAccessToken, channelSecret] = await Promise.all([
		accessSecretVersion(pathToDBUser),
		accessSecretVersion(pathToDBPass),
		accessSecretVersion(pathToDBHost),
		accessSecretVersion(pathToDBPort),
		accessSecretVersion(pathToCa),
		accessSecretVersion(pathToKey),
		accessSecretVersion(pathToCert),
		accessSecretVersion(pathTochannelAccessToken),
		accessSecretVersion(pathToChannelSecret),
	]);

	const body = req.body;
	const digest = crypto
		.createHmac('SHA256', channelSecret)
		.update(Buffer.from(JSON.stringify(body)))
		.digest('base64');
	const signature = req.headers['x-line-signature'];
	if (digest !== signature) {
		res.status(403);
		res.send('This request is invalid');
		return;
	}

	const connection = mysql.createConnection({
		host: dbHost,
		user: dbUser,
		password: dbPass,
		port: dbPort,
		ssl: {
			ca: ca,
			key: key,
			cert: cert,
		},
	});

	connection.connect((error) => {
		if (error) {
			console.log(`Connection Error: ${error}`);
		}
	});
	connection.query(`SHOW DATABASES`, (err, results) => {
		err ? console.log(err) : console.log(JSON.stringify({ results }));
	});

	const requestBody = req.body.events[0];
	const senderId = requestBody.source.userId;
	const replyToken = requestBody.replyToken;
	const requestMessage = requestBody.message.text;
	reply(channelAccessToken, replyToken, 'request was received');

	res.status(200);
	res.send(`OK \nreplyToken: ${replyToken}\nsenderId: ${senderId}\nrequestMessage: ${requestMessage}`);
};

async function accessSecretVersion(secretKey) {
	const [version] = await client.accessSecretVersion({
		name: secretKey,
	});
	const payload = version.payload.data.toString();
	return payload;
}

async function reply(channelAccessToken, replyToken, message = null) {
	await axios({
		method: 'post',
		url: 'https://api.line.me/v2/bot/message/reply',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${channelAccessToken}`,
		},
		data: {
			replyToken: replyToken,
			messages: [
				{
					'type': 'text',
					'text': message,
				},
			],
		},
	})
		.then((response) => {
			console.log(response);
		})
		.catch((error) => {
			console.log(error);
		});
}
