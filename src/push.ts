/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
const axios = require('axios');
const mysql = require('mysql');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

const pathToDBUser = process.env.PATH_TO_DB_USER;
const pathToDBPass = process.env.PATH_TO_DB_PASS;
const pathToDBHost = process.env.PATH_TO_DB_HOST;
const pathToDBName = process.env.PATH_TO_DB_NAME;
const pathToDBPort = process.env.PATH_TO_DB_PORT;

const pathToCa = process.env.PATH_TO_CA;
const pathToKey = process.env.PATH_TO_KEY;
const pathToCert = process.env.PATH_TO_CERT;

const pathToChannelAccessToken = process.env.PATH_TO_CHANNEL_ACCESS_TOKEN;

const userBirthdaysTableName = process.env.USER_BIRTHDAYS_TABLE_NAME;

exports.push = async (event, context) => {
	const [dbUser, dbPass, dbName, dbHost, dbPort, ca, key, cert, channelAccessToken] = await Promise.all([
		accessSecretVersion(pathToDBUser),
		accessSecretVersion(pathToDBPass),
		accessSecretVersion(pathToDBName),
		accessSecretVersion(pathToDBHost),
		accessSecretVersion(pathToDBPort),
		accessSecretVersion(pathToCa),
		accessSecretVersion(pathToKey),
		accessSecretVersion(pathToCert),
		accessSecretVersion(pathToChannelAccessToken),
	]);

	const [year, month, date] = [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
	console.log(`year: ${year}, month: ${month}, date: ${date}`);

	const connection = mysql.createConnection({
		host: dbHost,
		user: dbUser,
		password: dbPass,
		database: dbName,
		port: dbPort,
		ssl: {
			ca: ca,
			key: key,
			cert: cert,
		},
	});

	connection.connect((error) => {
		if (error) {
			console.error(error);
			return;
		}
	});

	await new Promise((resolve, reject) => {
		connection.query(
			`SELECT name, year, concat(month, "/",date) AS day, sender_id FROM ${userBirthdaysTableName} WHERE month = ? AND date = ?`,
			[month, date],
			(error, result, field) => {
				if (error) {
					reject();
					throw new Error(error);
				}
				resolve(result);
			},
		);
	})
		.then((result) => {
			console.log(`length: ${result.length}`);
			for (let i = 0; i < result.length; i++) {
				if (result[i].year == null) {
					push(channelAccessToken, result[i].sender_id, `${result[i].name}さんのお誕生日です！`);
				} else {
					push(channelAccessToken, result[i].sender_id, `${result[i].name}さんの${year - result[i].year}歳のお誕生日です！`);
				}
			}
			console.log(`OK: ${year}/${month}/${date}`);
		})
		.catch((error) => {
			console.log(error);
		});
};

async function accessSecretVersion(secretKey) {
	const [version] = await client.accessSecretVersion({
		name: secretKey,
	});
	const payload = version.payload.data.toString();
	return payload;
}

async function push(channelAccessToken, to, message = null) {
	await axios({
		method: 'post',
		url: 'https://api.line.me/v2/bot/message/push',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${channelAccessToken}`,
		},
		data: {
			to: to,
			messages: [
				{
					'type': 'text',
					'text': "Today is your friend's birthday!",
				},
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
