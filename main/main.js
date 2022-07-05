/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
const axios = require('axios');
const mysql = require('mysql');
const crypto = require('crypto');
const NodeCache = require('node-cache');
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
const pathToChannelSecret = 'projects/199194440168/secrets/CHANNEL_SECRET/versions/latest';

const client = new SecretManagerServiceClient();
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const cacheObject = {
	status: 0,
	name: null,
};

exports.main = async (req, res) => {
	const [dbUser, dbPass, dbName, dbHost, dbPort, ca, key, cert, channelAccessToken, channelSecret] = await Promise.all([
		accessSecretVersion(pathToDBUser),
		accessSecretVersion(pathToDBPass),
		accessSecretVersion(pathToDBName),
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

	// const connection = mysql.createConnection({
	// 	host: dbHost,
	// 	user: dbUser,
	// 	password: dbPass,
	// 	port: dbPort,
	// 	ssl: {
	// 		ca: ca,
	// 		key: key,
	// 		cert: cert,
	// 	},
	// });

	// connection.connect((error) => {
	// 	if (error) {
	// 		console.log(`Connection Error: ${error}`);
	// 	}
	// });
	// connection.query(`SHOW DATABASES`, (err, results) => {
	// 	err ? console.log(err) : console.log(JSON.stringify({ results }));
	// });

	const requestBody = req.body.events[0];
	const senderId = requestBody.source.userId;
	const replyToken = requestBody.replyToken;
	const requestMessage = requestBody.message.text;

	if (cache.get(senderId) === undefined) {
		switch (requestMessage) {
			case '誕生日の追加':
				cacheObject.status = 1;
				const success = cache.set(senderId, cacheObject);
				if (success) {
					console.log(`cache: ${cache.get(senderId).status}`);
					reply(channelAccessToken, replyToken, `誕生日を追加する人の名前を10文字以内で入力しください&cache: ${JSON.stringify(cache.get(senderId))}`);
				} else {
					reply(channelAccessToken, replyToken, `もう一度試してください: ${cache}`);
				}
				break;
			case '誕生日の一覧':
				deliverBirthdaysList(dbUser, dbPass, dbName, dbHost, dbPort, ca, key, cert, senderId, channelAccessToken, replyToken);
				break;
			case '誕生日の削除':
				cache.status = 3;
				reply(channelAccessToken, replyToken, `誕生日を削除する人の名前を10文字以内で入力しください&cache: ${cache}`);
				break;
			case 'キャンセル':
				const result = cache.del(senderId);
				if (result) {
					reply(channelAccessToken, replyToken, `キャンセルしました&cache: ${cache}`);
				} else {
					reply(channelAccessToken, replyToken, `キャッシュがありません: ${cache}`);
				}
				break;
			default:
				reply(channelAccessToken, replyToken, `リッチメニューから選択してください&cache: ${JSON.stringify(cache)}`);
				break;
		}
	} else {
		if (requestMessage == 'キャンセル') {
			const result = cache.del(senderId);
			if (result) {
				reply(channelAccessToken, replyToken, `他のメニューを選択してください&cache: ${cache}`);
			} else {
				reply(channelAccessToken, replyToken, `キャッシュがありません: ${cache}`);
			}
		}

		switch (cache.get(senderId).status) {
			case 1:
				cacheObject.status = 2;
				cacheObject.name = requestMessage;
				const result = cache.set(senderId, cacheObject);
				if (result) {
					reply(channelAccessToken, replyToken, `生年月日を入力してください: ${cache.get(senderId).status}`);
				} else {
					reply(channelAccessToken, replyToken, `再度入力してください: ${cache.get(senderId).status}`);
				}
				break;
			case 2:
				addBirthday();
			default:
				reply(channelAccessToken, replyToken, 'received');
				break;
		}
	}

	res.status(200);
	res.send(`OK \nreplyToken: ${replyToken}\nsenderId: ${senderId}\nrequestMessage: ${requestMessage}\ncache: ${cache}`);
};

async function deliverBirthdaysList(dbUser, dbPass, dbName, dbHost, dbPort, ca, key, cert, senderId, channelAccessToken, replyToken) {
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
			console.log(`Connection Error: ${error}`);
		}
	});

	const results = await new Promise((resolve, reject) => {
		connection.query(
			`SELECT name, year, concat(month,"/",date) AS day FROM chronos_birthdays_list WHERE sender_id = ?`,
			[senderId],
			(error, result, field) => {
				error ? reject(error) : resolve(result);
			},
		);
	});

	let list = '';
	for (let i = 0; i < results.length; i++) {
		if (results[i].year == null) {
			list += `\n${results[i].name}: ${results[i].day}`;
		} else {
			list += `\n${results[i].name}: ${results[i].year}/${results[i].day}`;
		}
	}

	reply(channelAccessToken, replyToken, `誕生日の一覧: ${list}`);
}

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
