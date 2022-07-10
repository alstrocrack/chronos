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
const client = new SecretManagerServiceClient();
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const pathToDBUser = process.env.PATH_TO_DB_USER;
const pathToDBPass = process.env.PATH_TO_DB_PASS;
const pathToDBHost = process.env.PATH_TO_DB_HOST;
const pathToDBName = process.env.PATH_TO_DB_NAME;
const pathToDBPort = process.env.PATH_TO_DB_PORT;

const pathToCa = process.env.PATH_TO_CA;
const pathToKey = process.env.PATH_TO_KEY;
const pathToCert = process.env.PATH_TO_CERT;

const pathToChannelAccessToken = process.env.PATH_TO_CHANNEL_ACCESS_TOKEN;
const pathToChannelSecret = process.env.PATH_TO_CHANNEL_SECRET;

const userTableName = process.env.USER_TABLE_NAME;
const userBirthdaysTableName = process.env.USER_BIRTHDAYS_TABLE_NAME;

const regEx = /^((19|20)\d{2}\/)?(0[1-9]|[1-9]|1[0-2]|)\/(0[1-9]|[1-9]|[1-2]\d{1}|3[0-1])$/g;

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
		accessSecretVersion(pathToChannelAccessToken),
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

	const pool = mysql.createPool({
		connectionLimit: 10,
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

	const requestBody = req.body.events[0];
	const senderId = requestBody.source.userId;
	const replyToken = requestBody.replyToken;
	const requestType = requestBody.type;

	if (requestType === 'follow' || requestType === 'unfollow') {
		switch (requestType) {
			case 'follow':
				registerUser(pool, senderId, channelAccessToken, replyToken);
				break;
			case 'unfollow':
				unregisterUser(pool, senderId);
				break;
		}
		res.status(200).send('OK');
		return;
	}

	const requestMessage = requestBody.message.text;
	if (cache.get(senderId) === undefined) {
		switch (requestMessage) {
			case '誕生日の追加':
				cacheObject.status = 1;
				if (cache.set(senderId, cacheObject)) {
					reply(channelAccessToken, replyToken, '誕生日を追加する人の名前を10文字以内で入力してください');
				} else {
					reply(channelAccessToken, replyToken, 'もう一度、入力してください');
				}
				break;
			case '誕生日の一覧':
				deliverBirthdaysList(pool, senderId, channelAccessToken, replyToken);
				break;
			case '誕生日の削除':
				cacheObject.status = 3;
				if (cache.set(senderId, cacheObject)) {
					reply(channelAccessToken, replyToken, '誕生日を削除する人の名前を10文字以内で入力してください');
				} else {
					reply(channelAccessToken, replyToken, 'もう一度、入力してください');
				}
				break;
			case 'キャンセル':
				if (cache.del(senderId)) {
					reply(channelAccessToken, replyToken, '操作をキャンセルしました');
				} else {
					reply(channelAccessToken, replyToken, '他の操作を選択してください');
				}
				break;
			default:
				reply(channelAccessToken, replyToken, 'リッチメニューから操作を選択してください');
				break;
		}
	} else {
		if (requestMessage === 'キャンセル') {
			if (cache.del(senderId)) {
				reply(channelAccessToken, replyToken, '操作をキャンセルしました');
				return;
			} else {
				return new Error('cannot cancel.');
			}
		}

		switch (cache.get(senderId).status) {
			// 誕生日の追加
			case 1:
				console.log(requestMessage.length);
				if (requestMessage.length > 10) {
					reply(channelAccessToken, replyToken, '10文字以内で入力してください');
					break;
				}
				cacheObject.status = 2;
				cacheObject.name = requestMessage;
				if (cache.set(senderId, cacheObject)) {
					reply(
						channelAccessToken,
						replyToken,
						'生年月日を「1996/12/20」の形式で入力してください\n・年はなくても大丈夫です（例）「12/20」\n・0はあってもなくても大丈夫です（例）「4/5」「04/05」',
					);
				} else {
					reply(channelAccessToken, replyToken, 'もう一度、入力してください');
				}
				break;
			case 2:
				if (!regEx.test(requestMessage)) {
					reply(
						channelAccessToken,
						replyToken,
						'生年月日を正しく入力してください（例）「1996/12/20」\n・年はなくても大丈夫です（例）「12/20」\n・0はあってもなくても大丈夫です（例）「4/5」「04/05」',
					);
					break;
				}
				const name = cache.get(senderId).name;
				const splittedDate = requestMessage.split('/');
				const [year, month, date] =
					splittedDate.length === 3 ? [splittedDate[0], splittedDate[1], splittedDate[2]] : [null, splittedDate[0], splittedDate[1]];
				addBirthday(pool, senderId, channelAccessToken, replyToken, name, year, month, date);
				cache.del(senderId);
				break;
			// 誕生日の削除
			case 3:
				deleteBirthday(pool, senderId, channelAccessToken, replyToken, requestMessage);
				cache.del(senderId);
				break;
			default:
				reply(channelAccessToken, replyToken, 'すみませんが、最初からやり直してください');
				cache.del(senderId);
				break;
		}
	}

	res.status(200).send('OK');
};

async function registerUser(pool, senderId, channelAccessToken, replyToken) {
	await axios({
		method: 'get',
		url: `https://api.line.me/v2/bot/profile/${senderId}`,
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${channelAccessToken}`,
		},
	})
		.then((response) => {
			return response.data.displayName;
		})
		.then((name) => {
			pool.getConnection((error, connection) => {
				if (error) {
					throw new Error(error);
				}
				connection.query(
					`INSERT INTO ${userTableName} (sender_id, sender_name, created_at) VALUES (?, ?, Now())`,
					[senderId, name],
					(error, result, field) => {
						connection.release();
						if (error) {
							throw new Error(`cannot insert: ${error}`);
						}
					},
				);
			});
			return name;
		})
		.then((name) => {
			reply(
				channelAccessToken,
				replyToken,
				`こんにちは${name}さん、Birthday Reminderを友達登録していただきありがとうございます！\nさっそく、誕生日を追加してみましょう！`,
			);
		})
		.catch((error) => {
			console.log(error);
		});
}

function unregisterUser(pool, senderId) {
	pool.getConnection((error, connection) => {
		if (error) {
			throw new Error(error);
		}
		connection.beginTransaction((error) => {
			if (error) {
				throw new Error('transaction cannot run.');
			}
			connection.query(`DELETE FROM ${userTableName} WHERE sender_id = ?`, [senderId], (error, result, field) => {
				if (error) {
					connection.rollback(function () {
						throw error;
					});
				}
			});
			connection.query(`DELETE FROM ${userBirthdaysTableName} WHERE sender_id = ?`, [senderId], (error, result, field) => {
				if (error) {
					connection.rollback(function () {
						throw error;
					});
				}
			});
			connection.commit((error) => {
				if (error) {
					connection.rollback(function () {
						throw error;
					});
				}
			});
			console.log('transaction success.');
		});
		connection.release();
	});
}

async function addBirthday(pool, senderId, channelAccessToken, replyToken, name, year, month, date) {
	await new Promise((resolve, reject) => {
		pool.getConnection((error, connection) => {
			if (error) {
				throw new Error(error);
			}
			connection.query(
				`INSERT INTO ${userBirthdaysTableName} (name, year, month, date, sender_id, created_at) VALUES (?, ?, ?, ?, ?, Now())`,
				[name, year, month, date, senderId],
				(error, result, field) => {
					if (error) {
						reject(error);
						throw new Error('cannot insert.');
					}
					connection.release();
					resolve(result);
				},
			);
		});
	});
	const message = year === null ? `${name}さんを${month}/${date}で登録しました` : `${name}さんを${year}/${month}/${date}で登録しました`;
	reply(channelAccessToken, replyToken, message);
}

async function deleteBirthday(pool, senderId, channelAccessToken, replyToken, name) {
	await new Promise((resolve, reject) => {
		pool.getConnection((error, connection) => {
			if (error) {
				throw new Error(error);
			}
			connection.query(`DELETE FROM ${userBirthdaysTableName} WHERE name = ? AND sender_id = ?`, [name, senderId], (error, result, field) => {
				if (error) {
					reject(error);
				}
				resolve(result);
				connection.release();
			});
		});
	})
		.then((result) => {
			if (result.affectedRows === 0) {
				reply(channelAccessToken, replyToken, `${name}さんが見つかりませんでした`);
			} else {
				reply(channelAccessToken, replyToken, `${name}さんを削除しました`);
			}
		})
		.catch((error) => {
			console.log(error);
		});
}

async function deliverBirthdaysList(pool, senderId, channelAccessToken, replyToken) {
	const results = await new Promise((resolve, reject) => {
		pool.getConnection((error, connection) => {
			if (error) {
				throw new Error(error);
			}
			connection.query(
				`SELECT name, year, concat(month,"/",date) AS day FROM ${userBirthdaysTableName} WHERE sender_id = ?`,
				[senderId],
				(error, result, field) => {
					error ? reject(error) : resolve(result);
					connection.release();
				},
			);
		});
	});

	let list = '';
	for (let i = 0; i < results.length; i++) {
		if (results[i].year == null) {
			list += `\n${results[i].name}: ${results[i].day}`;
		} else {
			list += `\n${results[i].name}: ${results[i].year}/${results[i].day}`;
		}
	}

	reply(channelAccessToken, replyToken, `誕生日の一覧: ${list === '' ? '\n誕生日はまだありません' : list}`);
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
