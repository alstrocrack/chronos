/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
const axios = require('axios');
const mysql = require('mysql');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const pathToDBUser = 'projects/199194440168/secrets/DB_USER/versions/latest';
const pathToDBPass = 'projects/199194440168/secrets/DB_PASS/versions/latest';
const pathToDBHost = 'projects/199194440168/secrets/DB_HOST/versions/latest';
const pathToDBName = 'projects/199194440168/secrets/DB_NAME/versions/latest';
const pathToDBPort = 'projects/199194440168/secrets/DB_PORT/versions/latest';

const pathToCa = 'projects/199194440168/secrets/DB_CA/versions/latest';
const pathToKey = 'projects/199194440168/secrets/DB_KEY/versions/latest';
const pathToCert = 'projects/199194440168/secrets/DB_CERT/versions/latest';

const pathTochannelAccessToken = 'projects/199194440168/secrets/CHANNEL_ACCESS_TOKEN/versions/latest';

const client = new SecretManagerServiceClient();

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
		accessSecretVersion(pathTochannelAccessToken),
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
			`SELECT name, year, concat(month, "/",date) AS day, sender_id FROM chronos_birthdays_list WHERE month = ? AND date = ?`,
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
